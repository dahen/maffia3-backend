import { randomUUID } from 'node:crypto';
import type { Store } from './db.ts';
import type { GameState, Role, User } from './contracts.ts';
import { Problem } from './auth.ts';
import { loadGame, latestRound, actionKey, mutate, appendRevision } from './game.ts';
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
    return mutate(store, id, user, `Nedräkning: ${minutes} minuter`, state => { const round = latestRound(state); if (round.phase !== 1) throw new Problem(409, 'Nedräkning kan bara startas under natten.'); round.countdown = { deadline: new Date(now + minutes * 60000).toISOString(), minutes, sent: [], actorId: user.id, actorName: user.name }; });
  });
}
export function stopCountdown(store: Store, id: string, user: User) { if (!user.admin) throw new Problem(403, 'Endast GM får stoppa nedräkning.'); return mutate(store, id, user, 'Nedräkning stoppad', state => { latestRound(state).countdown = null; }); }
export function tickCountdowns(store: Store, onChanged: (id: string) => void, now = Date.now()) {
  const games = store.all<{ id: string }>('SELECT id FROM games WHERE automation_paused=0');
  for (const { id } of games) store.transaction(() => {
    const { game, state } = loadGame(store, id); const round = latestRound(state); const timer = round.countdown;
    if (round.phase !== 1 || !timer) return;
    const left = (Date.parse(timer.deadline) - now) / 60000;
    const due = [3, 1, 0].filter(m => m < timer.minutes && left <= m && !timer.sent.includes(m));
    if (!due.length) return;
    // After downtime send only the most relevant reminder, never a backlog of stale notifications.
    timer.sent.push(...due); const remaining = Math.min(...due);
    const body = remaining === 0 ? 'Tiden för natthandlingar är slut. Skicka in ditt val nu om du inte redan gjort det. GM avslutar natten manuellt.' : `Natten tar snart slut: ${remaining} ${remaining === 1 ? 'minut' : 'minuter'} kvar. Kom ihåg att skicka in dina natthandlingar.`;
    const user: User = { id: timer.actorId, name: timer.actorName, admin: true };
    const count = deliver(state, user, body, 'waiting', now);
    appendRevision(store, id, game.current_revision, user, state, `Automatisk påminnelse: ${remaining} min, ${count} mottagare`); onChanged(id);
    // No phase changes here. Only GM can perform those commands.
  });
}
