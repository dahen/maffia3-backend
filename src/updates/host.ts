// Runs on mini, never inside the public application container.
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, stat, chmod } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { activeJob, jobRequestSchema, jobSchema, releaseSchema, type HostStatus, type Release, type UpdateJob } from './protocol.ts';

const absolutePath = z.string().refine(isAbsolute, 'An absolute path is required');
export const hostConfigSchema = z.object({
  host: z.string().default('127.0.0.1'), port: z.number().int().min(1024).max(65535).default(3048),
  docker: absolutePath, composeFile: absolutePath, stateDir: absolutePath, backupDir: absolutePath,
  tokenFile: absolutePath, githubTokenFile: absolutePath.optional(),
  project: z.literal('maffia3').default('maffia3'), service: z.literal('app').default('app'),
  container: z.literal('maffia3').default('maffia3'),
  volume: z.literal('maffia3_maffia3_data').default('maffia3_maffia3_data'),
}).strict();
export type HostConfig = z.infer<typeof hostConfigSchema>;
type Docker = (args: string[]) => Promise<string>;
type SavedJob = { job: UpdateJob; previousImage?: string; backup?: string; release?: Release };
const savedSchema = z.object({ job: jobSchema, previousImage: z.string().optional(), backup: z.string().optional(), release: releaseSchema.optional() });
export class UpdateConflict extends Error {}

export function dockerCommand(binary: string): Docker {
  const exec = promisify(execFile);
  return async args => {
    try { return (await exec(binary, args, { shell: false, timeout: 20 * 60_000, maxBuffer: 1024 * 1024 })).stdout; }
    catch { throw new Error('Docker-kommandot misslyckades. Kontrollera Docker på mini.'); }
  };
}

// Only GitHub's fixed repository and named release asset are trusted as release sources.
export function githubReleases(token?: string): () => Promise<Release | null> {
  return async () => {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'maffia3-updater', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const response = await fetch('https://api.github.com/repos/dahen/maffia3-backend/releases/latest', { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (response.status === 404 && !token) return null;
    if (!response.ok) throw new Error('GitHub kunde inte nås.');
    const data = z.object({ tag_name: z.string(), draft: z.boolean(), prerelease: z.boolean(), assets: z.array(z.object({ id: z.number().int().positive(), name: z.string() })) }).parse(await response.json());
    if (data.draft || data.prerelease) throw new Error('Ingen stabil release.');
    const asset = data.assets.find(a => a.name === 'maffia-release.json');
    if (!asset) throw new Error('Releasen saknar versionsmanifest.');
    // GitHub redirects asset downloads to signed storage URLs. fetch strips Authorization
    // on cross-origin redirects; no token is included in the URL or returned to the app.
    const download = await fetch(`https://api.github.com/repos/dahen/maffia3-backend/releases/assets/${asset.id}`, {
      headers: { ...headers, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(10_000),
    });
    if (!download.ok) throw new Error('Versionsmanifestet kunde inte hämtas.');
    const release = releaseSchema.parse(await download.json());
    if (release.version !== data.tag_name) throw new Error('Release och manifest stämmer inte överens.');
    return release;
  };
}

export class HostUpdater {
  private saved: SavedJob | null = null;
  private accepting = false;
  private working = false;
  private cached: { latest: Release | null; releaseError: string | null; at: number } | null = null;
  private work: Promise<void> = Promise.resolve();
  private config: HostConfig;
  private docker: Docker;
  private releases: () => Promise<Release | null>;
  constructor(config: HostConfig, docker: Docker, releases: () => Promise<Release | null>) {
    this.config = config; this.docker = docker; this.releases = releases;
  }
  async initialize() {
    await mkdir(this.config.stateDir, { recursive: true, mode: 0o700 });
    await mkdir(this.config.backupDir, { recursive: true, mode: 0o700 });
    try { this.saved = savedSchema.parse(JSON.parse(await readFile(this.stateFile(), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (this.saved && activeJob(this.saved.job)) await this.phase('recovery-required', 'Uppdateringstjänsten startades om under ett jobb. Kontrollera container och backup på mini innan nästa uppdatering.');
  }
  private stateFile() { return join(this.config.stateDir, 'job.json'); }
  private async persist() {
    await writeFile(this.stateFile() + '.tmp', JSON.stringify(this.saved, null, 2), { mode: 0o600 });
    await rename(this.stateFile() + '.tmp', this.stateFile());
  }
  private async phase(phase: UpdateJob['phase'], message: string) {
    if (!this.saved) throw new Error('Jobb saknas');
    this.saved.job = { ...this.saved.job, phase, message, updatedAt: new Date().toISOString() };
    await this.persist();
  }
  async status(): Promise<HostStatus> {
    if (!this.cached || Date.now() - this.cached.at > 60_000) {
      try { this.cached = { latest: await this.releases(), releaseError: null, at: Date.now() }; }
      catch { this.cached = { latest: null, releaseError: 'Kunde inte kontrollera nya versioner på GitHub.', at: Date.now() }; }
    }
    return { latest: this.cached.latest, releaseError: this.cached.releaseError, job: this.saved?.job ?? null };
  }
  async start(input: unknown): Promise<UpdateJob> {
    const request = jobRequestSchema.parse(input);
    if (this.saved?.job.requestId === request.requestId) {
      if (this.saved.job.version !== request.version) throw new UpdateConflict('Begäran har redan använts.');
      return this.saved.job;
    }
    if (this.accepting || this.working || activeJob(this.saved?.job ?? null) || this.saved?.job.phase === 'recovery-required') throw new UpdateConflict('Ett jobb pågår eller kräver återställning.');
    this.accepting = true;
    try {
      const release = await this.releases(); // Revalidate at action time; never accept an image from the browser.
      if (!release || release.version !== request.version) throw new UpdateConflict('Releasen har ändrats. Kontrollera status igen.');
      const now = new Date().toISOString();
      this.saved = { job: { ...request, phase: 'pulling', startedAt: now, updatedAt: now, message: 'Hämtar den nya versionen. Spelet kan fortsätta under hämtningen.' }, release };
      await this.persist();
      const accepted = { ...this.saved.job };
      this.working = true;
      this.work = this.deploy(release).catch(error => { console.error('Kunde inte spara uppdateringsstatus:', error instanceof Error ? error.name : 'Error'); }).finally(() => { this.working = false; });
      return accepted;
    } finally { this.accepting = false; }
  }
  async settled() { await this.work; }
  private compose(override?: string) {
    return ['compose', '--project-name', this.config.project, '--file', this.config.composeFile, ...(override ? ['--file', override] : [])];
  }
  private async inspect() { return JSON.parse(await this.docker(['inspect', this.config.container]))[0]; }
  private async deploy(release: Release) {
    let stopAttempted = false; let replacementAttempted = false;
    try {
      const previous = await this.inspect();
      if (!previous.State.Running || previous.Config.Labels?.['com.docker.compose.project'] !== this.config.project || previous.Config.Labels?.['com.docker.compose.service'] !== this.config.service ||
        !previous.Mounts.some((m: { Type: string; Name: string; Destination: string; RW: boolean }) => m.Type === 'volume' && m.Name === this.config.volume && m.Destination === '/data' && m.RW) ||
        !previous.Config.Env.includes('MAFFIA_DB_PATH=/data/maffia3.sqlite')) throw new Error('Container eller datavolym stämmer inte med installationen.');
      if (previous.Config.Labels?.['se.steensland.maffia.version'] === release.version) throw new Error('Versionen är redan installerad.');
      this.saved!.previousImage = previous.Image;
      await this.persist();
      await this.docker(['pull', release.image]);
      const image = JSON.parse(await this.docker(['image', 'inspect', release.image]))[0];
      const labels = image.Config.Labels;
      if (labels?.['se.steensland.maffia.version'] !== release.version || labels?.['se.steensland.maffia.backend'] !== release.backend || labels?.['se.steensland.maffia.frontend'] !== release.frontend) throw new Error('Imagen stämmer inte med releasen.');
      const backupName = `${this.saved!.job.requestId}.tar`;
      this.saved!.backup = join(this.config.backupDir, backupName);
      await this.phase('backup', 'Tar backup av databas och foton. Appen pausas kort.');
      stopAttempted = true;
      await this.docker(['stop', '--time', '30', this.config.container]);
      if ((await this.inspect()).State.Running) throw new Error('Kunde inte stoppa appen för backup.');
      await this.docker(['run', '--rm', '--network', 'none', '--read-only', '--user', '0',
        '--mount', `type=volume,source=${this.config.volume},target=/source,readonly`,
        '--mount', `type=bind,source=${this.config.backupDir},target=/backup`,
        '--entrypoint', 'tar', release.image, '-C', '/source', '-cf', `/backup/${backupName}`, '.']);
      if ((await stat(this.saved!.backup!)).size < 512) throw new Error('Backupen är tom.');
      await chmod(this.saved!.backup!, 0o600);
      const contents = await this.docker(['run', '--rm', '--network', 'none', '--read-only', '--user', '0',
        '--mount', `type=bind,source=${this.config.backupDir},target=/backup,readonly`,
        '--entrypoint', 'tar', release.image, '-tf', `/backup/${backupName}`]);
      if (!contents.split(/\r?\n/).some(name => name === './maffia3.sqlite' || name === 'maffia3.sqlite')) throw new Error('Backupen saknar SQLite-databasen.');
      const override = join(this.config.stateDir, 'image-override.json');
      await writeFile(override, JSON.stringify({ services: { app: { image: release.image } } }), { mode: 0o600 });
      await this.phase('starting', 'Startar den nya versionen med befintlig datavolym.');
      replacementAttempted = true;
      await this.docker([...this.compose(override), 'up', '--detach', '--no-build', '--pull', 'never', '--no-deps', this.config.service]);
      await this.phase('checking', 'Kontrollerar att den nya versionen fungerar.');
      await this.docker([...this.compose(override), 'up', '--wait', '--wait-timeout', '120', '--no-build', '--pull', 'never', '--no-deps', this.config.service]);
      const deployed = await this.inspect();
      if (!deployed.State.Running || deployed.State.Health?.Status !== 'healthy' || deployed.Config.Image !== release.image) throw new Error('Den nya versionen klarade inte hälsokontrollen.');
      await this.phase('complete', 'Uppdateringen är klar. Ladda om sidan för att använda den nya versionen.');
    } catch {
      if (replacementAttempted) {
        // Never restart old code against a possibly migrated database or silently discard writes.
        try { await this.docker(['stop', '--time', '30', this.config.container]); } catch { /* Operator must inspect before recovery. */ }
        await this.phase('recovery-required', 'Den nya versionen klarade inte starten. Backup och föregående image är sparade. Återställ på mini enligt driftanvisningen.');
      } else if (stopAttempted) {
        try {
          await this.docker(['start', this.config.container]);
          await this.phase('failed', 'Backup eller förberedelse misslyckades. Den tidigare containern har startats igen.');
        } catch { await this.phase('recovery-required', 'Den tidigare containern kunde inte startas igen. Kontrollera Docker på mini.'); }
      } else await this.phase('failed', 'Uppdateringen kunde inte förberedas. Det befintliga partiet fortsätter köra. Kontrollera GitHub, registry och Docker på mini.');
    }
  }
}

export function hostServer(updater: HostUpdater, token: string): Server {
  if (token.length < 32) throw new Error('Uppdateringsnyckeln måste vara minst 32 tecken.');
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    const answer = (code: number, value: unknown) => { res.writeHead(code); res.end(JSON.stringify(value)); };
    const supplied = Buffer.from(req.headers.authorization || ''); const expected = Buffer.from(`Bearer ${token}`);
    if (req.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return answer(403, { error: 'Forbidden' });
    try {
      if (req.method === 'GET' && req.url === '/status') return answer(200, await updater.status());
      if (req.method !== 'POST' || req.url !== '/jobs') return answer(404, { error: 'Not found' });
      if (req.headers['content-type'] !== 'application/json') return answer(415, { error: 'JSON required' });
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2048) { answer(413, { error: 'Too large' }); return; } chunks.push(chunk); }
      answer(202, await updater.start(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    } catch (error) {
      answer(error instanceof UpdateConflict ? 409 : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, { error: 'Update request could not be completed' });
    }
  });
}

async function main() {
  const file = process.env.MAFFIA_UPDATER_CONFIG;
  if (!file) throw new Error('Ange MAFFIA_UPDATER_CONFIG med sökväg till host-konfigurationen.');
  const config = hostConfigSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  const token = (await readFile(config.tokenFile, 'utf8')).trim();
  const githubToken = config.githubTokenFile ? (await readFile(config.githubTokenFile, 'utf8')).trim() : undefined;
  const updater = new HostUpdater(config, dockerCommand(config.docker), githubReleases(githubToken));
  // Bind before reading persistent state: two processes cannot recover/run the same job.
  const server = hostServer(updater, token);
  let ready = false;
  server.prependListener('request', (req, _res) => { if (!ready) req.destroy(); });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(config.port, config.host, done); });
  await updater.initialize(); ready = true;
  console.log(`Maffia updater listening on ${config.host}:${config.port}`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(() => { console.error('Maffia updater kunde inte starta. Kontrollera konfiguration, nyckelfil och Docker-sökväg.'); process.exit(1); });
