import { scryptSync, randomBytes, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Store } from './db.ts';
import type { User } from './contracts.ts';
export class Problem extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export function hashPin(pin: string) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(pin, salt, 32).toString('hex')}`; }
export function checkPin(pin: string, hash: string) { const [salt, digest] = hash.split(':'); if (!salt || !digest) return false; const actual = scryptSync(pin, salt, 32); const expected = Buffer.from(digest, 'hex'); return expected.length === actual.length && timingSafeEqual(expected, actual); }
export function addUser(store: Store, name: string, pin: string, admin = false): User {
  const id = randomUUID(); store.run('INSERT INTO users VALUES(?,?,?,?)', id, name, hashPin(pin), Number(admin)); return { id, name, admin };
}
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function sessionToken(req: Request) { return req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('maffia3='))?.slice(8); }
export function getUser(store: Store, req: Request): User | null {
  const token = sessionToken(req); if (!token) return null;
  const row = store.one<{ id: string; name: string; admin: number }>('SELECT u.id,u.name,u.admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', tokenHash(token), Date.now());
  return row ? { ...row, admin: Boolean(row.admin) } : null;
}
export function createSession(store: Store, userId: string, res: Response) {
  store.run('DELETE FROM sessions WHERE expires_at<?', Date.now());
  const token = randomBytes(32).toString('hex');
  store.run('INSERT INTO sessions VALUES(?,?,?)', tokenHash(token), userId, Date.now() + 12 * 3600_000);
  res.cookie('maffia3', token, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 12 * 3600_000, path: '/' });
}
export function logout(store: Store, req: Request, res: Response) { const token = sessionToken(req); if (token) store.run('DELETE FROM sessions WHERE token_hash=?', tokenHash(token)); res.clearCookie('maffia3', { path: '/' }); }
export function requireUser(store: Store) { return (req: Request, res: Response, next: NextFunction) => { const user = getUser(store, req); if (!user) return next(new Problem(401, 'Logga in för att fortsätta.')); res.locals.user = user; next(); }; }
export function requireGm(_req: Request, res: Response, next: NextFunction) { if (!res.locals.user?.admin) return next(new Problem(403, 'Endast spelledningen har tillgång.')); next(); }
