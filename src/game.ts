import { randomUUID, createHash } from 'node:crypto';
import type { Store } from './db.ts';
import { Problem } from './auth.ts';
import { PHASES, targetsPlayer } from './contracts.ts';
import type { User, GameState, GameView, GameSummary, Role, Power, Round, Phase, Action, RoleView, TimelineEntry, Theme, Death } from './contracts.ts';
import { phaseReadiness, type PhaseGuard } from './readiness.ts';

export class PhaseChangeBlocked extends Problem {
  guard: PhaseGuard;
  constructor(guard: PhaseGuard) { super(409,guard.kind==='actions'?'Alla natthandlingar är ännu inte inskickade.':guard.kind==='responses'?'Alla GM-besked är ännu inte sparade.':'Spelarval och GM-besked återstår innan morgonen.');this.guard=guard; }
}

interface GameRow { id: string; name: string; mode: 'test' | 'live'; current_revision: number; forward_revision: number | null; automation_paused: number }
interface RevisionRow { id: number; parent_id: number | null; state_json: string; label: string; round: number; phase: Phase; created_at: string }
export function parseState(json: string):GameState {
  const state=JSON.parse(json) as GameState;
  for (const role of state.roles) for (const power of role.powers) if ((power.type as string) === 'Name') {
    // Legacy snapshots remain immutable. Only the known demo hunting ability is promoted to kill.
    power.type = power.groupId === 'predators' && power.name === 'Nattens jakt' ? 'player-kill' : 'player-other';
  }
  for(const round of state.rounds) {
    round.deaths ??= []; round.countdown ??= null;
    round.dayOutcome ??= round.deaths.some(d => d.cause !== 'night') ? 'deaths' : 'pending';
    for (const death of round.deaths) { death.reason ??= death.cause === 'lynch' ? 'Utröstning' : death.cause === 'day' ? 'Annan död under dagen' : 'Annan död under natten'; death.source ??= null; }
    for (const flags of Object.values(round.roles)) { flags.notes ??= ''; flags.morningNotes ??= ''; }
  }
  return state;
}
export function latestRound(state: GameState) { return state.rounds.at(-1)!; }
export function actionKey(role: Role, power: Power) { return power.groupId ? `group:${power.groupId}` : `${role.id}:${power.id}`; }
export function initialRound(roles: Role[], number: number): Round { return { number, phase: 0, notes: '', countdown: null, deaths: [], dayOutcome: 'pending', actions: {}, roles: Object.fromEntries(roles.map(r => [r.id, { blocked: false, summoned: false, notes: '', morningNotes: '', enabled: r.powers.filter(p => !p.conditional).map(p => p.id) }])) }; }
export function loadGame(store: Store, id: string) {
  const game = store.one<GameRow>('SELECT * FROM games WHERE id=?', id);
  if (!game) throw new Problem(404, 'Partiet finns inte.');
  const revision = store.one<RevisionRow>('SELECT * FROM revisions WHERE id=? AND game_id=?', game.current_revision, id)!;
  const state = parseState(revision.state_json);
  return { game, revision, state };
}
function authorize(user: User, state: GameState) { if (!user.admin && !state.roles.some(r => r.userId === user.id)) throw new Problem(403, 'Du deltar inte i partiet.'); }
function summary(game: GameRow, state: GameState): GameSummary { const r = latestRound(state); return { id: game.id, name: game.name, mode: game.mode, theme: state.theme, players: state.roles.length, round: r.number, phase: r.phase }; }
export function listGames(store: Store, user: User): GameSummary[] {
  return store.all<GameRow>('SELECT * FROM games ORDER BY created_at DESC,id').flatMap(game => {
    const { state } = loadGame(store, game.id); return user.admin || state.roles.some(r => r.userId === user.id) ? [summary(game, state)] : [];
  });
}
export function appendRevision(store: Store, gameId: string, parent: number | null, user: User, state: GameState, label: string) {
  const round = latestRound(state);
  const result = store.run('INSERT INTO revisions(game_id,parent_id,label,actor_id,state_json,round,phase,created_at) VALUES(?,?,?,?,?,?,?,?)', gameId, parent, label, user.id, JSON.stringify(state), round.number, round.phase, new Date().toISOString());
  const id = Number(result.lastInsertRowid);
  if (parent !== null) store.run('INSERT INTO navigation_choices VALUES(?,?,?) ON CONFLICT(game_id,parent_id) DO UPDATE SET child_id=excluded.child_id', gameId, parent, id);
  store.run('UPDATE games SET current_revision=?,forward_revision=NULL WHERE id=?', id, gameId);
  return id;
}
export function createGame(store: Store, user: User, name: string, mode: 'test' | 'live', state: GameState) {
  if (!user.admin) throw new Problem(403, 'Endast GM kan skapa partier.');
  return store.transaction(() => { const id = randomUUID(); store.run('INSERT INTO games(id,name,mode) VALUES(?,?,?)', id, name, mode); appendRevision(store, id, null, user, state, 'Partiet skapades'); return id; });
}
export function mutate(store: Store, id: string, user: User, label: string, update: (state: GameState) => void) {
  return store.transaction(() => { const { game, state } = loadGame(store, id); authorize(user, state); update(state); return appendRevision(store, id, game.current_revision, user, state, label); });
}
function gm(user: User) { if (!user.admin) throw new Problem(403, 'Endast spelledningen har tillgång.'); }
function getRole(state: GameState, roleId: string) { const role = state.roles.find(r => r.id === roleId); if (!role) throw new Problem(404, 'Rollen finns inte.'); return role; }
function saveDeath(state:GameState, death:Death) {
  const role=getRole(state,death.roleId); const round=latestRound(state);
  if (!role.alive && !round.deaths.some(d=>d.roleId===role.id)) throw new Problem(409,'Spelaren dog ett tidigare dygn.');
  role.alive=false; round.deaths=round.deaths.filter(d=>d.roleId!==role.id); round.deaths.push(death);
  if (round.deaths.some(d=>d.cause !== 'night')) round.dayOutcome='deaths';
  else if (round.dayOutcome==='deaths') round.dayOutcome='pending';
}
export function recordDeath(store:Store,id:string,user:User,input:{roleId:string;cause:Death['cause'];clue:string;reason?:string}) {
  gm(user); return mutate(store,id,user,input.cause==='night'?'Nattens dödsfall och ledtråd':'Dagens dödsfall och ledtråd',state=>{
    const old=latestRound(state).deaths.find(d=>d.roleId===input.roleId);
    const sameCause=old?.cause===input.cause;
    saveDeath(state,{...input,reason:input.reason ?? (sameCause ? old!.reason : input.cause==='lynch'?'Utröstning':input.cause==='day'?'Annan död under dagen':'Annan död under natten'),source:sameCause?old!.source:null});
  });
}
export function confirmKill(store:Store,id:string,user:User,input:{targetRoleId:string;actorRoleId:string;powerId:string}) {
  gm(user);return mutate(store,id,user,'GM bekräftade dödande handling',state=>{
    const round=latestRound(state);if(round.phase===0)throw new Problem(409,'Bekräfta natthandlingar under natten, gryningen eller morgonen.');
    const target=getRole(state,input.targetRoleId);if(!target.alive)throw new Problem(409,'Spelaren är redan registrerad som död.');
    const actor=getRole(state,input.actorRoleId);const power=actor.powers.find(p=>p.id===input.powerId);
    if(!power || power.type!=='player-kill')throw new Problem(400,'Förmågan är inte av typen player-kill.');
    const key=actionKey(actor,power);const action=round.actions[key];
    if(!action || action.targetId!==target.id || action.executorId!==actor.id)throw new Problem(409,'Den inkommande handlingen har ändrats. Läs in senaste valet.');
    saveDeath(state,{roleId:target.id,cause:'night',reason:power.name,clue:'',source:{actorRoleId:actor.id,actorPlayer:actor.player,actorRole:actor.name,powerId:power.id,powerName:power.name,actionKey:key,sourceRevision:loadGame(store,id).revision.id}});
  });
}
export function recordDayOutcome(store:Store,id:string,user:User,input:{outcome:'none'}|{outcome:'deaths';roleIds:string[];reason:string;cause:'lynch'|'day'}) {
  gm(user);return mutate(store,id,user,input.outcome==='none'?'Ingen dog under dagen':'GM registrerade dagens dödsfall',state=>{
    const round=latestRound(state);if(round.phase!==0)throw new Problem(409,'Dagens utfall registreras i fas Möte.');
    if(input.outcome==='none'){
      if(round.deaths.some(d=>d.cause!=='night'))throw new Problem(409,'Återuppliva felregistrerade spelare innan du markerar att ingen dog.');
      round.dayOutcome='none';return;
    }
    if(!input.roleIds.length || !input.reason.trim())throw new Problem(400,'Välj minst en spelare och ange dödsorsak.');
    for(const roleId of new Set(input.roleIds)){
      const role=getRole(state,roleId);if(!role.alive)throw new Problem(409,`${role.player} är redan död.`);
      saveDeath(state,{roleId,cause:input.cause,reason:input.reason.trim(),source:null,clue:''});
    }
  });
}
export function setPhase(store: Store, id: string, user: User, phase: Phase, options: { overrideToken?: string; expectedPhase?: Phase } = {}) {
  gm(user);return store.transaction(()=>{
    const {game,state}=loadGame(store,id);const round=latestRound(state);
    if(options.expectedPhase!==undefined&&round.phase!==options.expectedPhase)throw new Problem(409,'Fasen har redan ändrats. Kontrollera det aktuella läget.');
    const progress=state.roles.map(role=>({...role,powers:role.powers.map(power=>({...power,enabled:!power.conditional||round.roles[role.id].enabled.includes(power.id),action:round.actions[actionKey(role,power)]??null}))}));
    let readiness:Omit<PhaseGuard,'token'|'fromPhase'|'toPhase'>|null=phaseReadiness(round.phase,progress);
    // A direct Night -> Morning jump must also acknowledge the skipped GM work.
    if(round.phase===1&&phase===3){
      const responses=phaseReadiness(2,progress)!;
      if(responses.missingCount){
        if(readiness?.missingCount){
          const pending=progress.flatMap(role=>{
            const actions=readiness!.pending.find(r=>r.roleId===role.id)?.powers.map(p=>({...p,name:`${p.name} (spelarval)`}))??[];
            const replies=responses.pending.find(r=>r.roleId===role.id)?.powers.map(p=>({...p,name:`${p.name} (GM-besked)`}))??[];
            return actions.length||replies.length?[{roleId:role.id,player:role.player,powers:[...actions,...replies]}]:[];
          });
          readiness={kind:'mixed',pending,missingCount:readiness.missingCount+responses.missingCount,nextPhase:3};
        }else readiness=responses;
      }
    }
    let label=`Fas: ${PHASES[phase]}`;
    if(phase!==round.phase&&readiness?.missingCount){
      const token=createHash('sha256').update(JSON.stringify({game:id,round:round.number,from:round.phase,to:phase,pending:readiness.pending})).digest('hex');
      if(options.overrideToken!==token)throw new PhaseChangeBlocked({...readiness,fromPhase:round.phase,toPhase:phase,token});
      label+=` · GM gick vidare trots saknade ${readiness.kind==='actions'?'val':readiness.kind==='responses'?'besked':'val och besked'}: ${readiness.pending.map(r=>`${r.player} (${r.powers.map(p=>p.name).join(', ')})`).join('; ')}`;
    }
    round.phase=phase;if(phase!==1)round.countdown=null;
    return appendRevision(store,id,game.current_revision,user,state,label);
  });
}
export function advanceRound(store: Store, id: string, user: User) { gm(user); return mutate(store, id, user, 'Nytt dygn', state => { const round = latestRound(state); if (round.phase !== 3) throw new Problem(409, 'Avsluta dygnet i morgonfasen först.'); state.rounds.push(initialRound(state.roles, round.number + 1)); }); }
export function setTheme(store: Store, id: string, user: User, theme: Theme) { gm(user); return mutate(store, id, user, 'Tema ändrat', state => { state.theme = theme; }); }
export function setNotes(store: Store, id: string, user: User, notes: string) { gm(user); return mutate(store, id, user, 'Dygnsanteckningar sparade', state => { latestRound(state).notes = notes; }); }
export function setRoleFlags(store: Store, id: string, user: User, roleId: string, patch: { blocked?: boolean; summoned?: boolean; alive?: boolean; notes?: string; roundNotes?: string; morningNotes?: string }) {
  gm(user); return mutate(store, id, user, 'GM uppdaterade roll', state => {
    const role = getRole(state, roleId);const round=latestRound(state);const flags=round.roles[roleId];
    if(patch.blocked!==undefined)flags.blocked=patch.blocked;if(patch.summoned!==undefined)flags.summoned=patch.summoned;
    if(patch.alive===false)saveDeath(state,{roleId,cause:round.phase===0?'lynch':'night',reason:round.phase===0?'Utröstning':'Annan död under natten',source:null,clue:''});
    if(patch.alive===true){role.alive=true;round.deaths=round.deaths.filter(d=>d.roleId!==roleId);if(round.dayOutcome==='deaths'&&!round.deaths.some(d=>d.cause!=='night'))round.dayOutcome='pending';}
    if(patch.notes!==undefined)role.notes=patch.notes;
    if(patch.roundNotes!==undefined)flags.notes=patch.roundNotes;
    if(patch.morningNotes!==undefined)flags.morningNotes=patch.morningNotes;
  });
}
export function enablePower(store: Store, id: string, user: User, roleId: string, powerId: string, enabled: boolean) {
  gm(user); return mutate(store, id, user, 'Tillgänglighet för förmåga ändrad', state => {
    const role = getRole(state, roleId); const power = role.powers.find(p => p.id === powerId); if (!power) throw new Problem(404, 'Förmågan finns inte.');
    // One switch for the shared ability: all group members see the same availability.
    for (const member of state.roles) for (const p of member.powers) if ((power.groupId && p.groupId === power.groupId) || (member.id === roleId && p.id === powerId)) {
      const flags = latestRound(state).roles[member.id]; flags.enabled = flags.enabled.filter(v => v !== p.id); if (enabled) flags.enabled.push(p.id);
    }
  });
}
export function submitAction(store: Store, id: string, user: User, roleId: string, powerId: string, value: string, targetId: string | null) {
  return mutate(store, id, user, 'Natthandling inskickad', state => {
    const round = latestRound(state); const role = getRole(state, roleId);
    if (!user.admin && role.userId !== user.id) throw new Problem(403, 'Du kan bara lämna dina egna handlingar.');
    if (round.phase !== 1) throw new Problem(409, 'Handlingar kan bara lämnas in under natten.');
    if (!role.alive) throw new Problem(409, 'Du är inte längre med i spelet.');
    const power = role.powers.find(p => p.id === powerId); if (!power || power.type === 'None') throw new Problem(400, 'Förmågan tar inte emot något val.');
    if (power.conditional && !round.roles[role.id].enabled.includes(power.id)) throw new Problem(409, 'Den här förmågan kan inte användas just nu.');
    // Deliberate: blocked is GM-only information and NEVER prevents submission.
    let actionValue = value.trim();
    if (targetsPlayer(power.type)) {
      if (targetId) { const target = getRole(state, targetId); if (!target.alive) throw new Problem(400, 'Välj en levande spelare.'); actionValue = target.player; }
      else if (actionValue !== 'Ingen') throw new Problem(400, 'Välj en spelare eller Ingen.');
    } else if (targetId) throw new Problem(400, 'Den här förmågan har inget spelarmål.');
    if (power.type === 'Yes/No' && !['Ja', 'Nej'].includes(actionValue)) throw new Problem(400, 'Välj Ja eller Nej.');
    if (!actionValue) throw new Problem(400, 'Fyll i ditt val.');
    round.actions[actionKey(role, power)] = { value: actionValue, targetId, executorId: role.id, response: '' };
  });
}
export function setResponse(store: Store, id: string, user: User, roleId: string, powerId: string, response: string, expectedValue: string | null) {
  gm(user); return mutate(store, id, user, 'GM-besked sparat', state => {
    const round = latestRound(state); if (round.phase !== 2 && round.phase !== 3) throw new Problem(409, 'Besked skrivs under gryning eller morgon.');
    const role = getRole(state, roleId); const power = role.powers.find(p => p.id === powerId); if (!power || !power.gmResponse) throw new Problem(400, 'Den här förmågan tar inte emot GM-besked.');
    const key = actionKey(role, power); const action = round.actions[key];
    if ((action?.value ?? null) !== expectedValue) throw new Problem(409, 'Valet har ändrats. Läs in det senaste innan du svarar.');
    if (power.type !== 'None' && !action) throw new Problem(409, 'Spelaren har ännu inte lämnat ett val.');
    round.actions[key] = { ...(action ?? { value: '', targetId: null, executorId: role.id }), response };
  });
}
export function editRole(store: Store, id: string, user: User, roleId: string, patch: Pick<Role, 'name' | 'summary' | 'win' | 'team' | 'gmHint'>, expectedRevision: number) {
  gm(user); return mutate(store, id, user, 'Rollbeskrivning ändrad', state => { if (loadGame(store, id).game.current_revision !== expectedRevision) throw new Problem(409, 'Partiet ändrades medan du redigerade. Öppna rollen på nytt.'); Object.assign(getRole(state, roleId), patch); });
}
export function navigate(store: Store, id: string, user: User, direction: 'back' | 'forward', expectedRevision: number) {
  gm(user); return store.transaction(() => {
    const { game, revision } = loadGame(store, id);
    if (game.mode !== 'test') throw new Problem(403, 'Bakåt/framåt finns bara i testpartier.');
    if (game.current_revision !== expectedRevision) throw new Problem(409, 'Historiken har ändrats. Försök igen.');
    store.run('UPDATE games SET automation_paused=1 WHERE id=?', id);
    if (direction === 'back') {
      if (!revision.parent_id) throw new Problem(409, 'Du är vid början av partiet.');
      store.run('INSERT INTO navigation_choices VALUES(?,?,?) ON CONFLICT(game_id,parent_id) DO UPDATE SET child_id=excluded.child_id', id, revision.parent_id, revision.id);
      store.run('UPDATE games SET current_revision=?,forward_revision=? WHERE id=?', revision.parent_id, revision.id, id);
      return revision.parent_id;
    }
    const choice = store.one<{ child_id: number }>('SELECT child_id FROM navigation_choices WHERE game_id=? AND parent_id=?', id, revision.id);
    const next = store.one<{ id: number }>('SELECT id FROM revisions WHERE game_id=? AND parent_id=? ORDER BY (id=?) DESC,id DESC LIMIT 1', id, revision.id, choice?.child_id ?? -1);
    if (!next) throw new Problem(409, 'Det finns inget senare steg på den här grenen.');
    store.run('UPDATE games SET current_revision=?,forward_revision=NULL WHERE id=?', next.id, id); return next.id;
  });
}
export function jumpToRevision(store: Store, id: string, user: User, target: number) {
  gm(user); return store.transaction(() => { const { game } = loadGame(store, id); if (game.mode !== 'test') throw new Problem(403, 'Återställning finns bara i testpartier.'); if (!store.one('SELECT id FROM revisions WHERE id=? AND game_id=?', target, id)) throw new Problem(404, 'Historiksteget finns inte.'); store.run('UPDATE games SET current_revision=?,forward_revision=NULL,automation_paused=1 WHERE id=?', target, id); return target; });
}
function roomAccess(state: GameState, roomId: string, user: User) { const room = state.rooms.find(r => r.id === roomId); if (!room) throw new Problem(404, 'Chatten finns inte.'); const role = state.roles.find(r => r.userId === user.id); if (!user.admin && (!role || !room.roleIds.includes(role.id))) throw new Problem(403, 'Du har inte tillgång till den här chatten.'); return room; }
export function readMessages(store: Store, id: string, user: User, roomId: string) {
  const { state } = loadGame(store, id); authorize(user, state); roomAccess(state, roomId, user); return state.messages.filter(m => m.roomId === roomId);
}
export function postMessage(store: Store, id: string, user: User, roomId: string, body: string, clientId: string) {
  return store.transaction(() => {
    const { game, state } = loadGame(store, id); authorize(user, state); const room = roomAccess(state, roomId, user);
    const existing = state.messages.find(m => m.id === clientId);
    if (existing) { if (existing.senderId !== user.id || existing.roomId !== roomId || existing.body !== body.trim()) throw new Problem(409, 'Meddelande-ID används redan.'); return existing; }
    if (!user.admin && latestRound(state).phase === 3 && room.kind !== 'gm') throw new Problem(409, 'Gruppchattar är stängda under morgonen. Du kan skriva till GM.');
    const message = { id: clientId, roomId, body: body.trim(), senderId: user.id, senderName: user.admin ? `GM · ${user.name}` : user.name, admin: user.admin, round: latestRound(state).number, time: new Date().toISOString() };
    if (!message.body) throw new Problem(400, 'Skriv ett meddelande.');
    state.messages.push(message); appendRevision(store, id, game.current_revision, user, state, 'Chattmeddelande'); return message;
  });
}
export function markRead(store: Store, id: string, user: User, roomId: string, messageId: string) {
  const { state } = loadGame(store, id); authorize(user, state); roomAccess(state, roomId, user);
  if (!state.messages.some(m => m.id === messageId && m.roomId === roomId)) throw new Problem(400, 'Meddelandet finns inte i chatten.');
  const previous = store.one<{ message_id: string }>('SELECT message_id FROM room_reads WHERE user_id=? AND game_id=? AND room_id=?', user.id, id, roomId);
  if (previous && state.messages.findIndex(m => m.id === previous.message_id) > state.messages.findIndex(m => m.id === messageId)) return;
  store.run('INSERT INTO room_reads VALUES(?,?,?,?) ON CONFLICT(user_id,game_id,room_id) DO UPDATE SET message_id=excluded.message_id', user.id, id, roomId, messageId);
}
export function gameView(store: Store, id: string, user: User, roundNumber?: number): GameView {
  const { game, state, revision } = loadGame(store, id); authorize(user, state);
  const current = latestRound(state); const round = user.admin && roundNumber ? state.rounds.find(r => r.number === roundNumber) : current;
  if (!round) throw new Problem(404, 'Dygnet finns inte.');
  const visibleRoles = user.admin ? state.roles : state.roles.filter(r => r.userId === user.id);
  const roles: RoleView[] = visibleRoles.map(role => {
    const flags = round.roles[role.id];
    const powers = role.powers.map(power => {
      const action = round.actions[actionKey(role, power)];
      return { ...power, enabled: !power.conditional || flags.enabled.includes(power.id), action: action ? { ...action, executorId: user.admin ? action.executorId : action.executorId === role.id ? role.id : '', response: user.admin || (round.phase === 3 && !flags.summoned) ? action.response : '' } : null };
    });
    return { ...role, gmHint: user.admin ? role.gmHint : '', notes: user.admin ? role.notes : '', roundNotes: user.admin ? flags.notes : '', morningNotes: user.admin ? flags.morningNotes : '', blocked: user.admin ? flags.blocked : false, summoned: user.admin || round.phase === 3 ? flags.summoned : false, powers,
      finished: !role.alive || powers.every(p => !p.enabled || p.type === 'None' || Boolean(p.action?.value)),
      gmFinished: !role.alive || powers.every(p => !p.enabled || !p.gmResponse || (p.type !== 'None' && !p.action?.value) || Boolean(p.action?.response.trim())) };
  });
  const rooms = state.rooms.filter(room => user.admin || room.roleIds.some(r => visibleRoles.some(role => role.id === r))).map(room => {
    const messages = state.messages.filter(m => m.roomId === room.id);
    const read = store.one<{ message_id: string }>('SELECT message_id FROM room_reads WHERE user_id=? AND game_id=? AND room_id=?', user.id, id, room.id);
    const readIndex = messages.findIndex(m => m.id === read?.message_id);
    return { ...room, roleIds: user.admin ? room.roleIds : [], count: messages.length, latest: messages.at(-1)?.body ?? null, unread: messages.slice(readIndex + 1).filter(m => m.senderId !== user.id).length };
  });
  const timeline: TimelineEntry[] = user.admin ? store.all<RevisionRow>('SELECT id,parent_id,label,round,phase,created_at FROM revisions WHERE game_id=? ORDER BY id', id).map(r => ({ id: r.id, parentId: r.parent_id, label: r.label, round: r.round, phase: r.phase, time: r.created_at, current: r.id === revision.id })) : [];
  return { game: summary(game, state), revision: revision.id, viewedRound: round.number, viewedPhase: round.phase, dayOutcome: user.admin ? round.dayOutcome : 'pending', morning: user.admin ? round.deaths.map(d => ({...d, player: state.roles.find(r => r.id === d.roleId)?.player ?? ''})) : [], countdown: round.countdown ? { deadline: round.countdown.deadline, paused: Boolean(game.automation_paused) } : null, roundNumbers: user.admin ? state.rounds.map(r => r.number) : [current.number], notes: user.admin ? round.notes : '', roles, rooms, targets: state.roles.map(r => ({ id: r.id, name: r.player, alive: r.alive })), timeline, canUndo: user.admin && game.mode === 'test' && revision.parent_id !== null, canRedo: user.admin && game.mode === 'test' && Boolean(store.one('SELECT id FROM revisions WHERE game_id=? AND parent_id=? LIMIT 1', id, revision.id)) };
}
