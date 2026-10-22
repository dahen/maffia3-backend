import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Store } from './db.ts';
import type { User, Phase } from './contracts.ts';
import { targetsPlayer } from './contracts.ts';
import { requireUser, requireGm, createSession, checkPin, logout, getUser, Problem } from './auth.ts';
import * as game from './game.ts';
import { demoState } from './demo.ts';
import { broadcast, startCountdown, stopCountdown, tickCountdowns } from './broadcast.ts';
import { gameLog } from './log.ts';
function path(req: Request, key = 'id') { return z.string().min(1).parse(req.params[key]); }

export function createApp(store: Store) {
  const app = express(); const events = new EventEmitter(); events.setMaxListeners(100);
  const tick = () => tickCountdowns(store, id => events.emit(id));
  app.locals.tick = tick;
  app.disable('x-powered-by'); app.use(express.json({ limit: '32kb' }));
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use((req, _res, next) => {
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return next(new Problem(403, 'Begäran måste komma från samma webbplats.'));
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, database: Boolean(store.one('SELECT version FROM schema_migrations')) }));
  app.get('/api/session', (req, res) => res.json({ user: getUser(store, req) }));
  const attempts = new Map<string, { count: number; reset: number }>();
  app.post('/api/login', (req, res) => {
    const { name, pin } = z.object({ name: z.string().trim().min(1).max(100), pin: z.string().min(1).max(100) }).parse(req.body);
    const key = req.ip || 'unknown'; const now = Date.now();
    for (const [ip, attempt] of attempts) if (attempt.reset < now) attempts.delete(ip);
    const attempt = attempts.get(key) ?? { count: 0, reset: now + 60_000 }; attempts.set(key, attempt);
    if (++attempt.count > 20) throw new Problem(429, 'För många inloggningsförsök. Vänta en minut.');
    const row = store.one<{ id: string; name: string; pin_hash: string; admin: number }>('SELECT * FROM users WHERE name=?', name);
    if (!row || !checkPin(pin, row.pin_hash)) throw new Problem(401, 'Fel namn eller PIN-kod.');
    attempts.delete(key); createSession(store, row.id, res); res.json({ id: row.id, name: row.name, admin: Boolean(row.admin) });
  });
  app.post('/api/logout', (req, res) => { logout(store, req, res); res.json({ ok: true }); });
  app.use('/api', requireUser(store));
  const user = (res: Response) => res.locals.user as User;
  app.get('/api/games', (_req, res) => res.json(game.listGames(store, user(res))));
  app.post('/api/games', requireGm, (req, res) => {
    const input = z.object({ name: z.string().trim().min(1).max(100), size: z.number().int().min(4).max(25), mode: z.enum(['test','live']).default('test'), theme: z.enum(['jungle','classic']).default('jungle') }).parse(req.body);
    const id = game.createGame(store, user(res), input.name, input.mode, demoState(store, input.size, input.theme)); res.status(201).json({ id });
  });
  app.get('/api/games/:id', (req, res) => {
    const round = req.query.round ? z.coerce.number().int().positive().parse(req.query.round) : undefined;
    res.json(game.gameView(store, path(req), user(res), round));
  });
  app.get('/api/games/:id/log',requireGm,(req,res) => res.json(gameLog(store,path(req),user(res))));
  app.get('/api/games/:id/export', requireGm, (req, res) => {
    const { game: metadata } = game.loadGame(store, path(req));
    const revisions = store.all<{ id: number; parent_id: number | null; label: string; state_json: string; created_at: string }>('SELECT id,parent_id,label,state_json,created_at FROM revisions WHERE game_id=? ORDER BY id', metadata.id);
    res.setHeader('Content-Disposition', 'attachment; filename="maffia-parti.json"'); res.json({ formatVersion: 1, exportedAt: new Date().toISOString(), game: metadata, revisions: revisions.map(({ state_json, ...r }) => ({ ...r, state: JSON.parse(state_json) })) });
  });
  function changed(res: Response, id: string, result: unknown) { events.emit(id); res.json({ ok: true, result }); }
  app.post('/api/games/:id/broadcast', requireGm, (req,res) => { const input = z.object({ body:z.string().trim().min(1).max(4000), audience:z.enum(['alive','waiting']) }).parse(req.body); changed(res,path(req),broadcast(store,path(req),user(res),input.body,input.audience)); });
  app.post('/api/games/:id/countdown', requireGm, (req,res) => { const {minutes} = z.object({minutes:z.number().int().min(1).max(60)}).parse(req.body); changed(res,path(req),startCountdown(store,path(req),user(res),minutes)); });
  app.delete('/api/games/:id/countdown', requireGm, (req,res) => changed(res,path(req),stopCountdown(store,path(req),user(res))));
  app.post('/api/games/:id/rooms/:roomId/simulate', requireGm, (req,res) => {
    const input = z.object({body:z.string().trim().min(1).max(4000),clientId:z.uuid(),roleId:z.string()}).parse(req.body);
    const {game:g,state} = game.loadGame(store,path(req)); if (g.mode !== 'test') throw new Problem(403,'Spelarmeddelanden kan bara simuleras i testpartier.');
    const role = state.roles.find(r => r.id === input.roleId); if (!role) throw new Problem(404,'Spelaren finns inte.');
    changed(res,path(req),game.postMessage(store,path(req),{id:role.userId,name:role.player,admin:false},path(req,'roomId'),input.body,input.clientId));
  });
  app.post('/api/games/:id/phase', requireGm, (req, res) => {
    const input = z.object({ phase:z.number().int().min(0).max(3),expectedPhase:z.number().int().min(0).max(3).optional(),overrideToken:z.string().length(64).optional() }).parse(req.body);
    changed(res,path(req),game.setPhase(store,path(req),user(res),input.phase as Phase,{expectedPhase:input.expectedPhase as Phase|undefined,overrideToken:input.overrideToken}));
  });
  app.post('/api/games/:id/next-round', requireGm, (req, res) => changed(res, path(req), game.advanceRound(store, path(req), user(res))));
  app.put('/api/games/:id/theme', requireGm, (req, res) => { const { theme } = z.object({ theme: z.enum(['jungle','classic']) }).parse(req.body); changed(res, path(req), game.setTheme(store, path(req), user(res), theme)); });
  app.put('/api/games/:id/notes', requireGm, (req, res) => { const { notes } = z.object({ notes: z.string().max(8000) }).parse(req.body); changed(res, path(req), game.setNotes(store, path(req), user(res), notes)); });
  app.patch('/api/games/:id/roles/:roleId', requireGm, (req, res) => {
    const patch = z.object({ blocked: z.boolean().optional(), summoned: z.boolean().optional(), alive: z.boolean().optional(), notes: z.string().max(8000).optional(), roundNotes: z.string().max(8000).optional(), morningNotes: z.string().max(8000).optional() }).strict().parse(req.body);
    changed(res, path(req), game.setRoleFlags(store, path(req), user(res), path(req, 'roleId'), patch));
  });
  app.put('/api/games/:id/deaths',requireGm,(req,res) => {
    const input=z.object({roleId:z.string(),cause:z.enum(['night','lynch','day']),clue:z.string().max(4000),reason:z.string().trim().min(1).max(500).optional()}).parse(req.body);
    changed(res,path(req),game.recordDeath(store,path(req),user(res),input));
  });
  app.post('/api/games/:id/deaths/confirm-kill',requireGm,(req,res)=>{
    const input=z.object({targetRoleId:z.string(),actorRoleId:z.string(),powerId:z.string()}).parse(req.body);
    changed(res,path(req),game.confirmKill(store,path(req),user(res),input));
  });
  app.post('/api/games/:id/day-outcome',requireGm,(req,res)=>{
    const input=z.discriminatedUnion('outcome',[
      z.object({outcome:z.literal('none')}),
      z.object({outcome:z.literal('deaths'),roleIds:z.array(z.string()).min(1).max(25),reason:z.string().trim().min(1).max(500).default('Utröstning'),cause:z.enum(['lynch','day']).default('lynch')})
    ]).parse(req.body);
    changed(res,path(req),game.recordDayOutcome(store,path(req),user(res),input));
  });
  app.put('/api/games/:id/roles/:roleId/description', requireGm, (req, res) => {
    const { revision, ...patch } = z.object({ revision: z.number().int(), name: z.string().trim().min(1).max(100), summary: z.string().max(4000), win: z.string().max(4000), team: z.string().max(100), gmHint: z.string().max(1000) }).parse(req.body);
    changed(res, path(req), game.editRole(store, path(req), user(res), path(req, 'roleId'), patch, revision));
  });
  app.put('/api/games/:id/roles/:roleId/powers/:powerId/enabled', requireGm, (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body); changed(res, path(req), game.enablePower(store, path(req), user(res), path(req, 'roleId'), path(req, 'powerId'), enabled));
  });
  app.post('/api/games/:id/roles/:roleId/powers/:powerId/action', (req, res) => {
    const input = z.object({ value: z.string().max(4000), targetId: z.string().nullable().default(null) }).parse(req.body);
    changed(res, path(req), game.submitAction(store, path(req), user(res), path(req, 'roleId'), path(req, 'powerId'), input.value, input.targetId));
  });
  app.put('/api/games/:id/roles/:roleId/powers/:powerId/response', requireGm, (req, res) => {
    const { response, expectedValue } = z.object({ response: z.string().max(4000), expectedValue: z.string().nullable() }).parse(req.body);
    changed(res, path(req), game.setResponse(store, path(req), user(res), path(req, 'roleId'), path(req, 'powerId'), response, expectedValue));
  });
  app.post('/api/games/:id/simulate', requireGm, (req, res) => {
    const { game: g, state } = game.loadGame(store, path(req)); if (g.mode !== 'test') throw new Problem(403, 'Massimulering finns bara i testpartier.');
    if (game.latestRound(state).phase !== 1) throw new Problem(409, 'Starta natten innan du simulerar.');
    const targets = state.roles.filter(r => r.alive); const submitted = new Set<string>();
    const result = store.transaction(() => {
      let count = 0;
      for (const role of targets) for (const power of role.powers) {
        const key = game.actionKey(role, power); if (submitted.has(key) || power.type === 'None' || (power.conditional && !game.latestRound(state).roles[role.id].enabled.includes(power.id))) continue;
        submitted.add(key); if (game.latestRound(state).actions[key]?.value) continue;
        const target = targets.find(r => r.id !== role.id) ?? role;
        // Run the normal player path: simulation must enforce the same permissions and phase rules.
        game.submitAction(store, path(req), { id: role.userId, name: role.player, admin: false }, role.id, power.id, power.type === 'Yes/No' ? 'Ja' : power.type === 'Text' ? 'Jag såg spår vid floden.' : target.player, targetsPlayer(power.type) ? target.id : null); count++;
      }
      return count;
    });
    changed(res, path(req), result);
  });
  app.post('/api/games/:id/navigate', requireGm, (req, res) => {
    const { direction, revision } = z.object({ direction: z.enum(['back','forward']), revision: z.number().int() }).parse(req.body);
    changed(res, path(req), game.navigate(store, path(req), user(res), direction, revision));
  });
  app.post('/api/games/:id/jump', requireGm, (req, res) => { const { revision } = z.object({ revision: z.number().int() }).parse(req.body); changed(res, path(req), game.jumpToRevision(store, path(req), user(res), revision)); });
  app.get('/api/games/:id/rooms/:roomId/messages', (req, res) => res.json(game.readMessages(store, path(req), user(res), path(req, 'roomId'))));
  app.post('/api/games/:id/rooms/:roomId/messages', (req, res) => {
    const input = z.object({ body: z.string().trim().min(1).max(4000), clientId: z.uuid() }).parse(req.body);
    changed(res, path(req), game.postMessage(store, path(req), user(res), path(req, 'roomId'), input.body, input.clientId));
  });
  app.put('/api/games/:id/rooms/:roomId/read', (req, res) => { const { messageId } = z.object({ messageId: z.uuid() }).parse(req.body); game.markRead(store, path(req), user(res), path(req, 'roomId'), messageId); changed(res, path(req), null); });
  app.get('/api/games/:id/events', (req, res) => {
    game.gameView(store, path(req), user(res));
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('X-Accel-Buffering', 'no'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
    const notify = () => res.write('event: change\ndata: {}\n\n');
    const cleanup = () => { clearInterval(timer); events.off(path(req), notify); };
    const timer = setInterval(() => { if (!getUser(store, req)) { res.write('event: expired\ndata: {}\n\n'); res.end(); } else res.write(': heartbeat\n\n'); }, 15000);
    events.on(path(req), notify); res.on('close', cleanup); notify();
  });
  app.use('/api',(_req,_res,next)=>next(new Problem(404,'API-anropet finns inte.')));
  const frontend = resolve(import.meta.dirname, '../../maffia3-frontend/dist');
  if (existsSync(frontend)) { app.use(express.static(frontend)); app.get('/{*path}', (_req, res) => res.sendFile(resolve(frontend, 'index.html'))); }
  app.use((_req, _res, next) => next(new Problem(404, 'Sidan finns inte.')));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return res.end();
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Kontrollera de ifyllda fälten.', details: error.issues.map(i => i.path.join('.') + ': ' + i.message) });
    if (error instanceof game.PhaseChangeBlocked) return res.status(error.status).json({ error:error.message,phaseGuard:error.guard });
    if (error instanceof Problem) return res.status(error.status).json({ error: error.message });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Ogiltig JSON.' });
    console.error(error); res.status(500).json({ error: 'Ett serverfel inträffade. Försök igen.' });
  });
  return app;
}
