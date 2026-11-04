import { Router } from 'express';
import { Problem, requireGm } from '../auth.ts';
import { hostStatusSchema, jobRequestSchema, jobSchema, type UpdateStatus } from './protocol.ts';

export function updatesRouter() {
  const router = Router();
  const endpoint = process.env.MAFFIA_UPDATER_URL;
  const token = process.env.MAFFIA_UPDATER_TOKEN;
  const current = {
    version: process.env.MAFFIA_VERSION || 'Utvecklingsversion',
    backend: process.env.MAFFIA_BACKEND_SHA || '', frontend: process.env.MAFFIA_FRONTEND_SHA || '',
  };
  router.use(requireGm);
  async function host(path: string, body?: unknown) {
    if (!endpoint || !token) throw new Problem(503, 'Uppdateringstjänsten är inte konfigurerad.');
    let response: globalThis.Response;
    try {
      response = await fetch(new URL(path, endpoint), {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new Problem(503, 'Kan inte nå uppdateringstjänsten på mini.'); }
    if (!response.ok) throw new Problem(response.status === 409 ? 409 : 503,
      response.status === 409 ? 'Versionen är inte längre tillgänglig eller ett uppdateringsjobb pågår. Kontrollera status igen.' : 'Uppdateringstjänsten kunde inte utföra begäran.');
    return response.json();
  }
  router.get('/', async (_req, res) => {
    const status: UpdateStatus = { configured: Boolean(endpoint && token), current, latest: null, job: null, releaseError: null };
    if (status.configured) Object.assign(status, hostStatusSchema.parse(await host('/status')));
    res.json(status);
  });
  router.post('/', async (req, res) => {
    const body = jobRequestSchema.parse(req.body);
    res.status(202).json(jobSchema.parse(await host('/jobs', body)));
  });
  return router;
}
