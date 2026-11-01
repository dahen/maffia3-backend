import { randomUUID } from 'node:crypto';
import type { Store } from './db.ts';
import type { GameState, Role, User } from './contracts.ts';
import { Problem } from './auth.ts';
import { latestRound, actionKey, mutate } from './game.ts';
function finished(state: GameState, role: Role) { const round = latestRound(state); return role.powers.every(p => p.type === 'None' || (p.conditional && !round.roles[role.id].enabled.includes(p.id)) || Boolean(round.actions[actionKey(role,p)]?.value)); }
function deliver(state: GameState, user: User, body: string, audience: 'alive' | 'waiting', now: number) {
  const roles = state.roles.filter(r => r.alive && (audience === 'alive' || !finished(state,r)));
  for (const role of roles) {
    const room = state.rooms.find(r => r.kind === 'gm' && r.roleIds.includes(role.id)); if (!room) continue;
    state.messages.push({ id: randomUUID(), roomId: room.id, senderId: user.id, senderName: `GM · ${user.name}`, admin: true, body, round: latestRound(state).number, time: new Date(now).toISOString() });
  }
  return roles.length;
}
export function broadcast(store: Store, id: string, user: User, body: string, audience: 'alive' | 'waiting') {
  if (!user.admin) throw new Problem(403, 'Endast GM får göra utskick.'); let count = 0;
  const revision = mutate(store, id, user, `Broadcast: ${audience === 'alive' ? 'alla levande' : 'ej klara'}`, state => { if (audience === 'waiting' && latestRound(state).phase !== 1) throw new Problem(409, 'Påminnelser till ej klara skickas under natten.'); count = deliver(state, user, body, audience, Date.now()); }); return { revision, count };
}
export function startCountdown(store: Store, id: string, user: User, minutes: number, now = Date.now()) {
  if (!user.admin) throw new Problem(403, 'Endast GM får starta nedräkning.');
  return store.transaction(() => {
    store.run('UPDATE games SET automation_paused=0 WHERE id=?', id);
    return mutate(store, id, user, `Nedräkning: ${minutes} minuter`, state => { const round = latestRound(state); if (round.phase !== 1) throw new Problem(409, 'Nedräkning kan bara startas under natten.'); round.countdown = { deadline: new Date(now + minutes * 60000).toISOString(), minutes }; });
  });
}
export function stopCountdown(store: Store, id: string, user: User) { if (!user.admin) throw new Problem(403, 'Endast GM får stoppa nedräkning.'); return mutate(store, id, user, 'Nedräkning stoppad', state => { latestRound(state).countdown = null; }); }
