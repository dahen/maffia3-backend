import type { Store } from './db.ts';
import type { GameState, Phase, User } from './contracts.ts';
import { Problem } from './auth.ts';
import { loadGame, latestRound, actionKey, parseState } from './game.ts';
export interface LogEntry { id:number; parentId:number|null; time:string; round:number; phase:Phase; actor:string; label:string; kind:'action'|'response'|'chat'|'state'|'notes'; details:string[]; activeBranch:boolean }
export function gameLog(store: Store, id: string, user: User): LogEntry[] {
  if (!user.admin) throw new Problem(403,'Endast spelledningen får läsa hela partiloggen.');
  const {game} = loadGame(store,id);
  const revisions = store.all<{id:number;parent_id:number|null;label:string;created_at:string;round:number;phase:Phase;state_json:string;actor:string}>('SELECT r.*,u.name AS actor FROM revisions r JOIN users u ON u.id=r.actor_id WHERE r.game_id=? ORDER BY r.id',id);
  const states = new Map(revisions.map(r => [r.id,parseState(r.state_json)]));
  const parents = new Map(revisions.map(r => [r.id,r.parent_id])); const active = new Set<number>();
  for (let cursor:number|null = game.current_revision; cursor !== null; cursor = parents.get(cursor) ?? null) active.add(cursor);
  return revisions.map(revision => {
    const state = states.get(revision.id)!; const before = revision.parent_id ? states.get(revision.parent_id) : undefined; const round = latestRound(state); const oldRound = before?.rounds.find(r => r.number === round.number);
    const details:string[] = []; let kind:LogEntry['kind'] = 'state';
    if (!before) details.push(`${state.roles.length} spelare. Roller: ${state.roles.map(r => `${r.player} – ${r.name} (${r.team})`).join(', ')}.`);
    for (const [key,action] of Object.entries(round.actions)) {
      const old = oldRound?.actions[key]; const executor = state.roles.find(r => r.id === action.executorId); const holder = executor?.powers.some(p => actionKey(executor,p) === key) ? executor : state.roles.find(r => r.powers.some(p => actionKey(r,p) === key)); const power = holder?.powers.find(p => actionKey(holder,p) === key);
      if (!power || !holder) continue;
      if (action.value && (!old || old.value !== action.value || old.executorId !== action.executorId)) { kind='action'; details.push(`${holder.player} (${holder.name}) · ${power.name} → ${action.value}${power.groupId ? ' [grupphandling]' : ''}${round.roles[holder.id].blocked ? ' · aktören blockerad, GM avgör effekten' : ''}.`); }
      if (action.response !== (old?.response ?? '')) { kind='response'; details.push(`GM-besked till ${holder.player} · ${power.name}: ${action.response || '(besked borttaget)'}`); }
    }
    if (before) for (const role of state.roles) {
      const prior = before.roles.find(r => r.id === role.id); const flags = round.roles[role.id]; const oldFlags = oldRound?.roles[role.id];
      if (prior && prior.alive !== role.alive) details.push(`${role.player}: ${role.alive ? 'återupplivad' : 'markerad som död'}.`);
      if (prior && prior.notes !== role.notes) { kind='notes'; details.push(`GM-anteckning om ${role.player}: ${role.notes || '(tömd)'}`); }
      if (prior && prior.name !== role.name) details.push(`${role.player}: rollnamn ${prior.name} → ${role.name}.`);
      if (oldFlags && oldFlags.blocked !== flags.blocked) details.push(`${role.player}: ${flags.blocked ? 'blockerad (hemligt för spelaren)' : 'inte längre blockerad'}.`);
      if (oldFlags && oldFlags.summoned !== flags.summoned) details.push(`${role.player}: ${flags.summoned ? 'inkallad till GM' : 'inkallning borttagen'}.`);
      if (flags.notes !== (oldFlags?.notes ?? '')) { kind='notes';details.push(`Dygnsanteckning om ${role.player}: ${flags.notes || '(tömd)'}`); }
      if (flags.morningNotes !== (oldFlags?.morningNotes ?? '')) { kind='notes';details.push(`Morgonanteckning om ${role.player}: ${flags.morningNotes || '(tömd)'}`); }
      if (oldFlags) for (const p of role.powers) if (oldFlags.enabled.includes(p.id) !== flags.enabled.includes(p.id)) details.push(`${role.player} · ${p.name}: ${flags.enabled.includes(p.id) ? 'aktiverad' : 'inaktiverad'}.`);
    }
    if (before && round.notes !== (oldRound?.notes ?? '')) { kind='notes'; details.push(`Dygnsanteckningar: ${round.notes || '(tömda)'}`); }
    for (const death of round.deaths) {
      const old=oldRound?.deaths.find(d=>d.roleId===death.roleId);
      if (!old || old.cause!==death.cause || old.clue!==death.clue || old.reason!==death.reason || JSON.stringify(old.source)!==JSON.stringify(death.source)) {
        const source=death.source ? ` Utförare: ${death.source.actorPlayer} (${death.source.actorRole}) med ${death.source.powerName}. Handling sparad i steg #${death.source.sourceRevision}.` : '';
        details.push(`${state.roles.find(r=>r.id===death.roleId)?.player}: ${death.cause==='night'?'död under natten':death.cause==='lynch'?'utröstad före natten':'död under dagen'}. Dödsorsak: ${death.reason}.${source} Ledtråd: ${death.clue || '(ännu inte skriven)'}`);
      }
    }
    if(round.dayOutcome==='none'&&oldRound?.dayOutcome!=='none')details.push('GM har bekräftat att ingen dog under dagen.');
    const oldMessageIds = new Set(before?.messages.map(m => m.id) ?? []);
    const messages = state.messages.filter(m => !oldMessageIds.has(m.id));
    if (messages.length) { if (before) kind='chat'; for (const m of messages) { const room=state.rooms.find(r=>r.id===m.roomId); details.push(`${m.senderName} → ${room?.kind === 'gm' ? 'GM ↔ ' : ''}${room?.name ?? 'chatt'}: ${m.body}`); } }
    if (!details.length) details.push(revision.label);
    return {id:revision.id,parentId:revision.parent_id,time:revision.created_at,round:revision.round,phase:revision.phase,actor:revision.actor,label:revision.label,kind,details,activeBranch:active.has(revision.id)};
  });
}
