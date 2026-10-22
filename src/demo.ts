import { randomUUID } from 'node:crypto';
import type { Store } from './db.ts';
import { addUser } from './auth.ts';
import type { User, Role, Power, GameState, Theme, Room } from './contracts.ts';
import { initialRound, createGame, actionKey } from './game.ts';
import { targetsPlayer } from './contracts.ts';
const NAMES = ['Alex','Billie','Charlie','Dani','Elli','Frankie','Gabriel','Harper','Indra','Jamie','Kim','Lee','Mika','Noa','Oli','Pat','Quinn','Robin','Sam','Toni','Uma','Val','Wren','Yuri','Ziggy'];
const ANIMALS = ['Lejonet','Pantern','Ugglan','Elefanten','Kameleonten','Papegojan','Gorillan','Sengångaren','Tigern','Kobran','Tukanen','Jaguaren','Tapiren','Geckon','Lemuren','Flodhästen','Krokodilen','Okapin','Fladdermusen','Pandan','Surikaten','Anakondan','Kolibrin','Orangutangen','Myrsloken'];
function ensurePlayer(store: Store, name: string, index: number): User { const existing = store.one<{ id: string; name: string; admin: number }>('SELECT id,name,admin FROM users WHERE name=?', name); return existing ? { ...existing, admin: Boolean(existing.admin) } : addUser(store, name, String(1101 + index)); }
export function demoState(store: Store, size: number, theme: Theme = 'jungle', populated = false): GameState {
  const roles: Role[] = Array.from({ length: size }, (_, i) => {
    const user = ensurePlayer(store, NAMES[i]!, i); const id = randomUUID();
    const isMafia = i < 2 || (i >= 8 && i < 8 + Math.max(0, Math.floor(size / 5) - 2));
    let p: Omit<Power, 'id'>;
    if (isMafia) p = { name: 'Nattens jakt', description: 'Välj tillsammans vem flocken ska jaga. Den som skickar senast utför handlingen.', type: 'player-kill', groupId: 'predators', conditional: false, gmResponse: false };
    else if (i === 2) p = { name: 'Spana', description: 'Välj en spelare att spana på. Spelledningen ger besked på morgonen.', type: 'player-other', groupId: null, conditional: false, gmResponse: true };
    else if (i === 3) p = { name: 'Skydda', description: 'Välj en spelare att skydda under natten.', type: 'player-other', groupId: null, conditional: false, gmResponse: false };
    else if (i === 4) p = { name: 'Kamouflage', description: 'När spelledningen aktiverar förmågan kan du välja någon att gömma.', type: 'player-other', groupId: null, conditional: true, gmResponse: true };
    else if (i % 4 === 1) p = { name: 'Skogens råd', description: 'Stöder du rådets förslag?', type: 'Yes/No', groupId: null, conditional: false, gmResponse: false };
    else if (i % 4 === 2) p = { name: 'Viska till skogen', description: 'Skriv det du vill meddela spelledningen.', type: 'Text', groupId: null, conditional: false, gmResponse: true };
    else p = { name: 'Nattens budskap', description: 'Du behöver inte göra något val. Spelledningen kan ge dig ett besked.', type: 'None', groupId: null, conditional: false, gmResponse: true };
    return { id, userId: user.id, player: user.name, name: theme === 'jungle' ? ANIMALS[i]! : `Roll ${i + 1}`, summary: isMafia ? 'Du tillhör rovdjurens hemliga flock. Samarbeta i er gruppchatt.' : 'Du är en av djungelns invånare. Håll ögonen öppna och använd din förmåga.', win: isMafia ? 'Du vinner när er flock har säkrat makten i djungeln.' : 'Du vinner när hotet från rovdjuren är undanröjt.', team: isMafia ? 'Rovdjuren' : 'Djungeln', gmHint: isMafia ? 'Delad grupphandling' : p.type === 'None' ? 'Ge besked vid behov' : '', notes: '', alive: true, powers: [{ id: randomUUID(), ...p }] };
  });
  const round = initialRound(roles, 1);
  const rooms: Room[] = roles.map(r => ({ id: randomUUID(), name: r.player, kind: 'gm' as const, roleIds: [r.id] }));
  rooms.push({ id: randomUUID(), name: 'Rovdjurens flock', kind: 'group', roleIds: roles.filter(r => r.team === 'Rovdjuren').map(r => r.id) });
  const state: GameState = { theme, roles, rounds: [round], rooms, messages: [] };
  if (populated) {
    round.phase = 1;
    for (const [i, role] of roles.entries()) {
      const p = role.powers[0]!;
      if (i === 3 || p.conditional || p.type === 'None') continue;
      round.actions[actionKey(role, p)] = { value: p.type === 'Yes/No' ? 'Ja' : p.type === 'Text' ? 'Jag såg rörelse vid floden.' : roles[(i + 2) % roles.length]!.player, targetId: targetsPlayer(p.type) ? roles[(i + 2) % roles.length]!.id : null, executorId: role.id, response: '' };
    }
    round.roles[roles[2]!.id]!.blocked = true;
    state.messages.push({ id: randomUUID(), roomId: rooms[2]!.id, senderId: roles[2]!.userId, senderName: roles[2]!.player, admin: false, body: 'Kan jag spana på samma person två nätter i rad?', round: 1, time: new Date().toISOString() });
    state.messages.push({ id: randomUUID(), roomId: rooms[3]!.id, senderId: roles[3]!.userId, senderName: roles[3]!.player, admin: false, body: 'Jag väljer strax, behöver bara dubbelkolla en sak.', round: 1, time: new Date().toISOString() });
  }
  return state;
}
export function seedDemo(store: Store) {
  if (store.one('SELECT id FROM users LIMIT 1')) return;
  store.transaction(() => { addUser(store, 'GM', '2468', true); });
  const row = store.one<{ id: string }>('SELECT id FROM users WHERE name=?', 'GM')!;
  const gm: User = { ...row, name: 'GM', admin: true };
  createGame(store, gm, 'Djungeln · Övningsparti', 'test', demoState(store, 8, 'jungle', true));
  createGame(store, gm, 'Djungeln · 25 spelare', 'test', demoState(store, 25));
}

export const RICH_DEMO_NAME = 'Djungeln · 4 grupper, flera förmågor';

export function richDemoState(store: Store): GameState {
  const state = demoState(store, 8);
  const groups = ['Rovdjuren', 'Rovdjuren', 'Djungeln', 'Djungeln', 'Flodklanen', 'Flodklanen', 'Nattflygarna', 'Nattflygarna'];
  const individual: Omit<Power, 'id'>[] = [
    { name: 'Visa klorna', description: 'Vill du sätta press på skogens råd?', type: 'Yes/No', groupId: null, conditional: false, gmResponse: false },
    { name: 'Hemlig viskning', description: 'Lämna ett hemligt meddelande till spelledningen.', type: 'Text', groupId: null, conditional: false, gmResponse: true },
    { name: 'Skogens tecken', description: 'Du kan få en ledtråd utan att lämna något eget val.', type: 'None', groupId: null, conditional: false, gmResponse: true },
    { name: 'Skogens råd', description: 'Stöder du rådets förslag?', type: 'Yes/No', groupId: null, conditional: false, gmResponse: false },
    { name: 'Flodrapport', description: 'Berätta vad du såg vid floden.', type: 'Text', groupId: null, conditional: false, gmResponse: true },
    { name: 'Kamouflage', description: 'Göm en spelare när GM har aktiverat din förmåga.', type: 'player-other', groupId: null, conditional: true, gmResponse: true },
    { name: 'Flyga högt', description: 'Vill du flyga ovanför trädtopparna i natt?', type: 'Yes/No', groupId: null, conditional: false, gmResponse: false },
    { name: 'Ekolod', description: 'Beskriv vad du lyssnar efter under natten.', type: 'Text', groupId: null, conditional: false, gmResponse: true },
  ];
  for (const [i, role] of state.roles.entries()) {
    role.team = groups[i]!;
    if (role.team === 'Flodklanen' || role.team === 'Nattflygarna') {
      role.summary = `Du tillhör ${role.team}. Samarbeta med din grupp och använd dina egna förmågor.`;
      role.win = role.team === 'Flodklanen' ? 'Ni vinner om flodens heliga källa fortfarande är skyddad när hoten är undanröjda.' : 'Ni vinner om ni lyckas avslöja rovdjurens ledare och överlever till slutet.';
      role.powers[0] = { id: randomUUID(), name: role.team === 'Flodklanen' ? 'Flodens beskydd' : 'Nattlig spaning', description: 'Välj tillsammans en spelare. Den som lämnar gruppens senaste val utför handlingen.', type: 'player-other', groupId: role.team === 'Flodklanen' ? 'river-guard' : 'night-watch', conditional: false, gmResponse: true };
      role.gmHint = 'Grupphandling och individuell förmåga';
    }
    role.powers.push({ id: randomUUID(), ...individual[i]! });
    if (i === 2 || i === 4) role.powers.push({ id: randomUUID(), name: 'Sista utvägen', description: 'Välj en spelare att angripa när GM har aktiverat din reservförmåga.', type: 'player-kill', groupId: null, conditional: true, gmResponse: true });
  }
  const round = initialRound(state.roles, 1); round.phase = 1;
  const roleWithReserve = state.roles[2]!;
  round.roles[roleWithReserve.id]!.enabled.push(roleWithReserve.powers[2]!.id);
  for (const [i, role] of state.roles.entries()) for (const [j, power] of role.powers.entries()) {
    if (power.type === 'None' || (power.conditional && !round.roles[role.id]!.enabled.includes(power.id)) || (i === 3 && j === 0) || (i === 7 && j === 1)) continue;
    const key = actionKey(role, power);
    if (round.actions[key]) continue;
    const target = state.roles[(i + j + 2) % state.roles.length]!;
    round.actions[key] = { value: targetsPlayer(power.type) ? target.player : power.type === 'Yes/No' ? (i % 2 ? 'Nej' : 'Ja') : 'Jag hörde röster vid vattenfallet.', targetId: targetsPlayer(power.type) ? target.id : null, executorId: role.id, response: '' };
  }
  round.roles[roleWithReserve.id]!.blocked = true;
  state.rounds = [round];
  state.rooms = state.roles.map(r => ({ id: randomUUID(), name: r.player, kind: 'gm', roleIds: [r.id] }));
  for (const team of ['Rovdjuren', 'Flodklanen', 'Nattflygarna']) {
    const room: Room = { id: randomUUID(), name: `${team} · gruppchatt`, kind: 'group', roleIds: state.roles.filter(r => r.team === team).map(r => r.id) };
    state.rooms.push(room);
    const sender = state.roles.find(r => r.id === room.roleIds[0])!;
    state.messages.push({ id: randomUUID(), roomId: room.id, senderId: sender.userId, senderName: sender.player, admin: false, body: 'Ska vi välja samma mål i natt, eller byta?', round: 1, time: new Date().toISOString() });
  }
  return state;
}

// Add this scenario once; never overwrite a game that GM has already explored.
export function seedRichDemo(store: Store) {
  const existing = store.one<{id: string}>('SELECT id FROM games WHERE name=?', RICH_DEMO_NAME);
  if (existing) return existing.id;
  const user = store.one<{id: string; name: string}>('SELECT id,name FROM users WHERE admin=1 ORDER BY rowid LIMIT 1');
  if (!user) throw new Error('Skapa demokontot med seedDemo först.');
  return store.transaction(() => createGame(store, { ...user, admin: true }, RICH_DEMO_NAME, 'test', richDemoState(store)));
}
