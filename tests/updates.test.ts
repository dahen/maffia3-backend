import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { type Server } from 'node:http';
import { HostUpdater, UpdateConflict, hostConfigSchema, hostServer } from '../src/updates/host.ts';
import { releaseSchema, type Release } from '../src/updates/protocol.ts';
import { Store } from '../src/db.ts';
import { addUser } from '../src/auth.ts';
import { createApp } from '../src/app.ts';

const release: Release = { version: 'v0.2.0', image: 'ghcr.io/dahen/maffia3-backend@sha256:' + 'a'.repeat(64), backend: 'b'.repeat(40), frontend: 'c'.repeat(40) };
async function fixture(failure = '', gate?: Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'maffia-updater-'));
  const config = hostConfigSchema.parse({ docker: join(dir, 'docker'), composeFile: join(dir, 'compose.yaml'), stateDir: join(dir, 'state'), backupDir: join(dir, 'backups'), tokenFile: join(dir, 'token') });
  const calls: string[][] = []; let running = true; let replaced = false;
  const labels = { 'se.steensland.maffia.version': release.version, 'se.steensland.maffia.backend': release.backend, 'se.steensland.maffia.frontend': release.frontend };
  const docker = async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'pull') { if (gate) await gate; if (failure === 'pull') throw new Error('registry credentials must not leak'); }
    if (args[0] === 'image') return JSON.stringify([{ Config: { Labels: failure === 'labels' ? {} : labels } }]);
    if (args[0] === 'inspect') return JSON.stringify([{ Image: 'sha256:' + 'd'.repeat(64),
      State: { Running: running, Health: { Status: 'healthy' } },
      Config: { Image: replaced ? release.image : 'maffia3:local', Labels: { 'com.docker.compose.project': 'maffia3', 'com.docker.compose.service': 'app' }, Env: ['MAFFIA_DB_PATH=/data/maffia3.sqlite'] },
      Mounts: [{ Type: 'volume', Name: failure === 'volume' ? 'other_data' : config.volume, Destination: '/data', RW: true }],
    }]);
    if (args[0] === 'stop') running = false;
    if (args[0] === 'start') running = true;
    if (args[0] === 'run') {
      if (args.includes('-tf')) return failure === 'archive' ? './\n' : './\n./maffia3.sqlite\n';
      if (failure === 'backup') throw new Error('disk full');
      await writeFile(join(config.backupDir, args.at(-2)!.split('/').at(-1)!), Buffer.alloc(1024));
    }
    if (args[0] === 'compose') { replaced = true; running = true; if (args.includes('--wait') && failure === 'health') throw new Error('unhealthy'); }
    return '';
  };
  const updater = new HostUpdater(config, docker, async () => release);
  await updater.initialize();
  return { dir, config, calls, updater, docker, clean: () => rm(dir, { recursive: true, force: true }) };
}
const request = () => ({ version: release.version, requestId: randomUUID() });
async function listen(server: Server) { await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); return `http://127.0.0.1:${(server.address() as { port: number }).port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }

test('release manifest rejects arbitrary registries, shell fragments and moving tags', () => {
  assert.deepEqual(releaseSchema.parse(release), release);
  for (const image of ['alpine:latest', 'ghcr.io/dahen/maffia3-backend:v0.2.0', release.image + '; whoami']) assert.throws(() => releaseSchema.parse({ ...release, image }));
  assert.throws(() => releaseSchema.parse({ ...release, version: 'main' }));
});

test('host pulls exact digest, backs up stopped volume, then recreates only app and checks health', async () => {
  const f = await fixture();
  try {
    const input = request(); await f.updater.start(input); await f.updater.settled();
    assert.equal((await f.updater.status()).job?.phase, 'complete');
    const commands = f.calls.map(args => args[0]);
    assert.ok(commands.indexOf('pull') < commands.indexOf('stop'));
    assert.ok(commands.indexOf('stop') < commands.indexOf('run'));
    assert.ok(commands.indexOf('run') < commands.indexOf('compose'));
    const backup = f.calls.find(args => args[0] === 'run')!;
    assert.ok(backup.includes(`type=volume,source=${f.config.volume},target=/source,readonly`));
    assert.ok(f.calls.filter(args => args[0] === 'compose').every(args => args.includes('--no-build') && args.includes('never') && args.at(-1) === 'app'));
    const saved = JSON.parse(await readFile(join(f.config.stateDir, 'job.json'), 'utf8'));
    assert.match(saved.previousImage, /^sha256:/); assert.ok(saved.backup.endsWith('.tar'));
    const calls = f.calls.length; await f.updater.start(input); assert.equal(f.calls.length, calls, 'Retry is idempotent');
    const restarted = new HostUpdater(f.config, f.docker, async () => release); await restarted.initialize();
    assert.equal((await restarted.status()).job?.phase, 'complete');
  } finally { await f.clean(); }
});

test('pull, label and volume failures leave the running container untouched', async () => {
  for (const failure of ['pull', 'labels', 'volume']) {
    const f = await fixture(failure);
    try { await f.updater.start(request()); await f.updater.settled(); assert.equal((await f.updater.status()).job?.phase, 'failed'); assert.ok(!f.calls.some(args => args[0] === 'stop')); }
    finally { await f.clean(); }
  }
});

test('failed backup restarts old container without attempting replacement', async () => {
  for (const failure of ['backup', 'archive']) {
    const f = await fixture(failure);
    try {
      await f.updater.start(request()); await f.updater.settled();
      assert.equal((await f.updater.status()).job?.phase, 'failed');
      assert.ok(f.calls.some(args => args[0] === 'start'));
      assert.ok(!f.calls.some(args => args[0] === 'compose'));
    } finally { await f.clean(); }
  }
});

test('failed health check stops new app and blocks further updates without reverting possibly migrated data', async () => {
  const f = await fixture('health');
  try {
    await f.updater.start(request()); await f.updater.settled();
    const status = await f.updater.status(); assert.equal(status.job?.phase, 'recovery-required');
    assert.equal(f.calls.at(-1)?.[0], 'stop');
    assert.ok(!f.calls.some(args => args[0] === 'start' || args.includes('rm') || args.includes('down')));
    await assert.rejects(f.updater.start(request()), UpdateConflict);
  } finally { await f.clean(); }
});

test('concurrent requests, stale release and arbitrary fields cannot start another update', async () => {
  let unblock!: () => void;
  const gate = new Promise<void>(done => { unblock = done; }); const f = await fixture('', gate);
  try {
    const input = request(); await f.updater.start(input);
    assert.equal((await f.updater.start(input)).requestId, input.requestId);
    await assert.rejects(f.updater.start(request()), UpdateConflict);
    await assert.rejects(f.updater.start({ ...request(), command: 'echo unsafe' }));
    unblock(); await f.updater.settled();
    await assert.rejects(f.updater.start({ ...request(), version: 'v0.1.0' }), UpdateConflict);
  } finally { unblock(); await f.updater.settled(); await f.clean(); }
});

test('interrupted job requires explicit host recovery after process restart', async () => {
  const f = await fixture();
  try {
    const now = new Date().toISOString();
    await writeFile(join(f.config.stateDir, 'job.json'), JSON.stringify({ job: { ...request(), phase: 'backup', startedAt: now, updatedAt: now, message: 'test' }, release }));
    const restarted = new HostUpdater(f.config, f.docker, async () => release); await restarted.initialize();
    assert.equal((await restarted.status()).job?.phase, 'recovery-required');
    await assert.rejects(restarted.start(request()), UpdateConflict);
    assert.equal(f.calls.length, 0);
  } finally { await f.clean(); }
});

test('host HTTP requires secret, rejects browser origin and only accepts fixed version/job contract', async () => {
  const f = await fixture(); const token = 'secret-'.repeat(8); const server = hostServer(f.updater, token); const base = await listen(server);
  try {
    assert.equal((await fetch(base + '/status')).status, 403);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(base + '/status', { headers: { ...headers, Origin: 'https://maffia.steensland.se' } })).status, 403);
    const status = await (await fetch(base + '/status', { headers })).text(); assert.ok(!status.includes(token)); assert.ok(!status.includes(f.dir));
    assert.equal((await fetch(base + '/arbitrary', { headers })).status, 404);
    assert.equal((await fetch(base + '/jobs', { method: 'POST', headers, body: JSON.stringify({ ...request(), image: 'alpine' }) })).status, 400);
    assert.equal((await fetch(base + '/jobs', { method: 'POST', headers, body: JSON.stringify(request()) })).status, 202);
    await f.updater.settled();
  } finally { await close(server); await f.clean(); }
});

test('application update API is GM-only and works without a game; players never see host credentials', async () => {
  const store = new Store(':memory:'); addUser(store, 'GM', '2468', true); addUser(store, 'Player', '1234');
  const f = await fixture(); const token = 'secret-'.repeat(8); const host = hostServer(f.updater, token); const hostUrl = await listen(host);
  const oldUrl = process.env.MAFFIA_UPDATER_URL; const oldToken = process.env.MAFFIA_UPDATER_TOKEN;
  process.env.MAFFIA_UPDATER_URL = hostUrl; process.env.MAFFIA_UPDATER_TOKEN = token;
  const server = createApp(store).listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function login(name: string, pin: string) {
    const response = await fetch(base + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pin }) });
    return response.headers.get('set-cookie')!.split(';')[0]!;
  }
  try {
    assert.equal((await fetch(base + '/admin/updates')).status, 401);
    const player = await login('Player', '1234');
    assert.equal((await fetch(base + '/admin/updates', { headers: { Cookie: player } })).status, 403);
    assert.equal((await fetch(base + '/admin/updates', { method: 'POST', headers: { Cookie: player, 'Content-Type': 'application/json' }, body: JSON.stringify(request()) })).status, 403);
    const gm = await login('GM', '2468');
    const response = await fetch(base + '/admin/updates', { headers: { Cookie: gm } }); assert.equal(response.status, 200);
    const text = await response.text(); assert.ok(!text.includes(token)); assert.ok(!text.includes(hostUrl));
    assert.equal((await fetch(base + '/admin/updates', { method: 'POST', headers: { Cookie: gm, 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: JSON.stringify(request()) })).status, 403);
    assert.equal((await fetch(base + '/admin/updates', { method: 'POST', headers: { Cookie: gm, 'Content-Type': 'application/json' }, body: JSON.stringify(request()) })).status, 202);
    await f.updater.settled();
  } finally {
    if (oldUrl === undefined) delete process.env.MAFFIA_UPDATER_URL; else process.env.MAFFIA_UPDATER_URL = oldUrl;
    if (oldToken === undefined) delete process.env.MAFFIA_UPDATER_TOKEN; else process.env.MAFFIA_UPDATER_TOKEN = oldToken;
    await close(server); await close(host); store.close(); await f.clean();
  }
});
