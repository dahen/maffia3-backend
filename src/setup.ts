import { Router } from 'express';
import { randomUUID, randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './db.ts';
import { addUser, hashPin, Problem } from './auth.ts';
import type { GameState, User, Theme } from './contracts.ts';
import { createGame, initialRound, liveGameId, setLiveGame, mutate } from './game.ts';
import { arrivals, lobbyId } from './checkin.ts';
import type { Arrival } from './checkin.ts';

const name=z.string().trim().min(1).max(100), text=z.string().max(4000), id=z.string().min(1);
const pin=z.string().regex(/^\d{4,12}$/,'PIN ska vara 4–12 siffror.');
export const groupSchema=z.object({name,description:text.default(''),chat:z.boolean().default(false)});
export const winSchema=z.object({name,description:text});
export const powerSchema=z.object({name,description:text,type:z.enum(['player-kill','player-other','Text','Yes/No','None']),conditional:z.boolean().default(false),gmResponse:z.boolean().default(false),shared:z.boolean().default(false)});
export const roleSchema=z.object({name,summary:text,gmHint:text.default(''),groupId:id.nullable(),winId:id.nullable(),powerIds:z.array(id).max(30)});
export const templateSchema=z.object({name,players:z.number().int().min(4).max(25),theme:z.enum(['jungle','classic']),roleIds:z.array(id).min(4).max(25)}).refine(value=>value.players===value.roleIds.length,{message:'Välj exakt lika många roller som spelare.',path:['roleIds']});

export interface LibraryGroup {id:string;name:string;description:string;chat:boolean}
export interface LibraryWin {id:string;name:string;description:string}
export interface LibraryPower {id:string;name:string;description:string;type:'player-kill'|'player-other'|'Text'|'Yes/No'|'None';conditional:boolean;gmResponse:boolean;shared:boolean}
export interface LibraryRole {id:string;name:string;summary:string;gmHint:string;groupId:string|null;winId:string|null;powerIds:string[]}
export interface PartyTemplate {id:string;name:string;players:number;theme:Theme;roleIds:string[]}
export interface Roster {id:string;name:string;mode:'test'|'live';players:Arrival[]}
export interface Preparation {id:string;name:string;mode:'test'|'live';templateId:string;rosterId:string;revision:number;gameId:string|null;state:GameState;isLive:boolean}
export interface SetupData {groups:LibraryGroup[];wins:LibraryWin[];powers:LibraryPower[];roles:LibraryRole[];templates:PartyTemplate[];rosters:Roster[];preparations:Preparation[];liveId:string|null;checkinRosterId:string|null}
export type Kind='groups'|'wins'|'powers'|'roles';
const tables={groups:'library_groups',wins:'library_wins',powers:'library_powers',roles:'library_roles'} as const;
function exists(store:Store,table:typeof tables[Kind]|'party_templates'|'player_rosters',value:string){if(!store.one(`SELECT id FROM ${table} WHERE id=?`,value))throw new Problem(404,'Posten finns inte längre.');}
function referenced(work:()=>unknown){try{return work();}catch(error){if(error instanceof Error&&error.message.includes('FOREIGN KEY'))throw new Problem(409,'Posten används fortfarande. Ta bort kopplingarna först.');throw error;}}
export function setupData(store:Store):SetupData {
  const roles=store.all<Omit<LibraryRole,'gmHint'|'groupId'|'winId'|'powerIds'>&{gm_hint:string;group_id:string|null;win_id:string|null}>('SELECT * FROM library_roles ORDER BY name,id').map(({gm_hint,group_id,win_id,...role})=>({...role,gmHint:gm_hint,groupId:group_id,winId:win_id,powerIds:store.all<{power_id:string}>('SELECT power_id FROM library_role_powers WHERE role_id=? ORDER BY position',role.id).map(row=>row.power_id)}));
  const templates=store.all<Omit<PartyTemplate,'roleIds'>>('SELECT * FROM party_templates ORDER BY players,name,id').map(template=>({...template,roleIds:store.all<{role_id:string}>('SELECT role_id FROM party_template_roles WHERE template_id=? ORDER BY position',template.id).map(row=>row.role_id)}));
  const rosters=store.all<Omit<Roster,'players'>>('SELECT * FROM player_rosters ORDER BY name,id').map(roster=>({...roster,players:arrivals(store,roster.id)}));
  const preparations=store.all<{id:string;name:string;mode:'test'|'live';template_id:string;roster_id:string;revision:number;game_id:string|null;state_json:string}>('SELECT * FROM game_preparations ORDER BY created_at DESC,rowid DESC').map(row=>({id:row.id,name:row.name,mode:row.mode,templateId:row.template_id,rosterId:row.roster_id,revision:row.revision,gameId:row.game_id,state:JSON.parse(row.state_json) as GameState,isLive:row.game_id!==null&&row.game_id===liveGameId(store)}));
  return {groups:store.all<{id:string;name:string;description:string;chat:number}>('SELECT * FROM library_groups ORDER BY name,id').map(row=>({...row,chat:Boolean(row.chat)})),wins:store.all<LibraryWin>('SELECT * FROM library_wins ORDER BY name,id'),powers:store.all<{id:string;name:string;description:string;type:LibraryPower['type'];conditional:number;gm_response:number;shared:number}>('SELECT * FROM library_powers ORDER BY name,id').map(({gm_response,...row})=>({...row,gmResponse:Boolean(gm_response),conditional:Boolean(row.conditional),shared:Boolean(row.shared)})),roles,templates,rosters,preparations,liveId:liveGameId(store),checkinRosterId:lobbyId(store)};
}
export function saveLibrary(store:Store,kind:Kind,input:unknown,itemId?:string){
  return store.transaction(()=>{
    if(itemId)exists(store,tables[kind],itemId);const key=itemId??randomUUID();
    if(kind==='groups'){const v=groupSchema.parse(input);store.run('INSERT INTO library_groups VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,chat=excluded.chat',key,v.name,v.description,Number(v.chat));}
    if(kind==='wins'){const v=winSchema.parse(input);store.run('INSERT INTO library_wins VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description',key,v.name,v.description);}
    if(kind==='powers'){const v=powerSchema.parse(input);store.run('INSERT INTO library_powers VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,type=excluded.type,conditional=excluded.conditional,gm_response=excluded.gm_response,shared=excluded.shared',key,v.name,v.description,v.type,Number(v.conditional),Number(v.gmResponse),Number(v.shared));}
    if(kind==='roles'){
      const v=roleSchema.parse(input);if(v.groupId)exists(store,'library_groups',v.groupId);if(v.winId)exists(store,'library_wins',v.winId);for(const power of v.powerIds)exists(store,'library_powers',power);
      if(new Set(v.powerIds).size!==v.powerIds.length)throw new Problem(400,'Samma förmåga kan bara kopplas en gång till rollen.');
      store.run('INSERT INTO library_roles VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,summary=excluded.summary,gm_hint=excluded.gm_hint,group_id=excluded.group_id,win_id=excluded.win_id',key,v.name,v.summary,v.gmHint,v.groupId,v.winId);store.run('DELETE FROM library_role_powers WHERE role_id=?',key);
      v.powerIds.forEach((power,index)=>store.run('INSERT INTO library_role_powers VALUES(?,?,?)',key,power,index));
    }
    return key;
  });
}
export function deleteLibrary(store:Store,kind:Kind,itemId:string){exists(store,tables[kind],itemId);referenced(()=>store.run(`DELETE FROM ${tables[kind]} WHERE id=?`,itemId));}
export function savePartyTemplate(store:Store,input:unknown,templateId?:string){return store.transaction(()=>{
  const v=templateSchema.parse(input);if(templateId)exists(store,'party_templates',templateId);for(const role of v.roleIds)exists(store,'library_roles',role);
  const key=templateId??randomUUID();store.run('INSERT INTO party_templates VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,players=excluded.players,theme=excluded.theme',key,v.name,v.players,v.theme);store.run('DELETE FROM party_template_roles WHERE template_id=?',key);v.roleIds.forEach((role,index)=>store.run('INSERT INTO party_template_roles VALUES(?,?,?)',key,index,role));return key;
});}
function roster(store:Store,key:string){const found=setupData(store).rosters.find(row=>row.id===key);if(!found)throw new Problem(404,'Spelarlistan finns inte.');return found;}
export function generatePlayers(store:Store,rosterId:string,count:number){return store.transaction(()=>{
  const list=roster(store,rosterId);if(list.mode!=='test')throw new Problem(400,'Fiktiva spelare skapas bara i testläget.');if(count<1||count+list.players.filter(player=>player.active).length>25)throw new Problem(400,'En spelarlista kan ha högst 25 spelare.');
  const first=['Alva','Bo','Cleo','Disa','Elis','Freja','Ivar','Lo','Milo','Nora','Otto','Vera'];const last=['Asp','Berg','Dahl','Ek','Falk','Gran','Hed','Lind','Malm','Ny','Ros','Vik'];const credentials:{id:string;name:string;pin:string}[]=[];
  for(let index=0;index<count;index++){
    let playerName=`${first[randomInt(first.length)]} ${last[randomInt(last.length)]}`;
    if(store.one('SELECT id FROM users WHERE name=?',playerName))playerName+=` ${randomUUID().slice(0,6)}`;
    const code=String(randomInt(100000,1000000));const player=addUser(store,playerName,code);store.run('INSERT INTO roster_players(roster_id,user_id) VALUES(?,?)',rosterId,player.id);credentials.push({id:player.id,name:player.name,pin:code});
  }
  return credentials;
});}
export function createRoster(store:Store,input:unknown){return store.transaction(()=>{
  const v=z.object({name,mode:z.enum(['test','live']),count:z.number().int().min(0).max(25).default(0)}).parse(input);const key=randomUUID();store.run('INSERT INTO player_rosters VALUES(?,?,?)',key,v.name,v.mode);if(v.mode==='live'&&v.count)throw new Problem(400,'Lägg till namngivna spelare i skarpt läge.');return {id:key,credentials:v.count?generatePlayers(store,key,v.count):[]};
});}
export function addRosterPlayer(store:Store,rosterId:string,input:unknown){return store.transaction(()=>{
  const v=z.object({name,pin:pin.optional()}).parse(input);const list=roster(store,rosterId);if(list.players.filter(player=>player.active).length>=25)throw new Problem(400,'Listan har redan 25 spelare.');
  const existing=store.one<{id:string;admin:number}>('SELECT id,admin FROM users WHERE name=?',v.name);if(existing?.admin)throw new Problem(400,'Ett GM-konto kan inte användas som spelare.');
  if(existing&&list.players.some(p=>p.id===existing.id))throw new Problem(409,'Spelaren finns redan i listan.');if(!existing&&!v.pin)throw new Problem(400,'Ange en PIN-kod för det nya kontot.');
  const playerId=existing?.id??addUser(store,v.name,v.pin!).id;
  // Adding an existing account never silently changes its PIN.
  store.run('INSERT INTO roster_players(roster_id,user_id) VALUES(?,?)',rosterId,playerId);return playerId;
});}
export function updatePlayer(store:Store,playerId:string,input:unknown){return store.transaction(()=>{
  const v=z.object({name,pin:pin.optional()}).parse(input);const user=store.one<{admin:number}>('SELECT admin FROM users WHERE id=?',playerId);if(!user||user.admin)throw new Problem(400,'Välj ett spelarkonto.');
  const duplicate=store.one<{id:string}>('SELECT id FROM users WHERE name=? AND id<>?',v.name,playerId);if(duplicate)throw new Problem(409,'Namnet används av ett annat konto.');store.run('UPDATE users SET name=? WHERE id=?',v.name,playerId);if(v.pin){store.run('UPDATE users SET pin_hash=? WHERE id=?',hashPin(v.pin),playerId);store.run('DELETE FROM sessions WHERE user_id=?',playerId);}
});}
function shuffle<T>(values:T[]){for(let index=values.length-1;index>0;index--){const other=randomInt(index+1);[values[index],values[other]]=[values[other]!,values[index]!];}return values;}
function assignRandomly(state:GameState){const users=shuffle(state.roles.map(role=>({userId:role.userId,player:role.player})));state.roles.forEach((role,index)=>Object.assign(role,users[index]));for(const room of state.rooms)if(room.kind==='gm')room.name=state.roles.find(role=>role.id===room.roleIds[0])!.player;}
export function prepareGame(store:Store,input:unknown){return store.transaction(()=>{
  const v=z.object({name,templateId:id,rosterId:id}).parse(input);const data=setupData(store);const template=data.templates.find(t=>t.id===v.templateId);if(!template)throw new Problem(404,'Partimallen finns inte.');const sourceRoster=roster(store,v.rosterId);const players={...sourceRoster,players:sourceRoster.players.filter(player=>player.active)};
  if(players.players.length!==template.players||template.roleIds.length!==template.players)throw new Problem(400,'Mallen måste ha lika många roller som det finns spelare.');
  const roles=template.roleIds.map(roleId=>{const source=data.roles.find(role=>role.id===roleId)!;if(!source.winId)throw new Problem(400,`Rollen ${source.name} saknar vinstvillkor.`);return {id:randomUUID(),userId:'',player:'',name:source.name,summary:source.summary,win:data.wins.find(win=>win.id===source.winId)!.description,team:data.groups.find(group=>group.id===source.groupId)?.name??'',gmHint:source.gmHint,notes:'',alive:true,powers:source.powerIds.map(powerId=>{const p=data.powers.find(power=>power.id===powerId)!;return {id:randomUUID(),name:p.name,description:p.description,type:p.type,conditional:p.conditional,gmResponse:p.gmResponse,groupId:p.shared?p.id:null};})};});
  roles.forEach((role,index)=>{role.userId=players.players[index]!.id;role.player=players.players[index]!.name;});
  const state:GameState={theme:template.theme,roles,rounds:[initialRound(roles,1)],messages:[],rooms:roles.map(role=>({id:randomUUID(),name:role.player,kind:'gm',roleIds:[role.id]}))};
  for(const group of data.groups.filter(group=>group.chat)){const members=roles.filter((_,index)=>data.roles.find(r=>r.id===template.roleIds[index])!.groupId===group.id);if(members.length)state.rooms.push({id:randomUUID(),name:`${group.name} · gruppchatt`,kind:'group',roleIds:members.map(role=>role.id)});}
  assignRandomly(state);const key=randomUUID();store.run('INSERT INTO game_preparations(id,name,mode,template_id,roster_id,state_json) VALUES(?,?,?,?,?,?)',key,v.name,players.mode,template.id,players.id,JSON.stringify(state));return key;
});}
function draft(store:Store,key:string,revision:number){const value=setupData(store).preparations.find(p=>p.id===key);if(!value)throw new Problem(404,'Förberedelsen finns inte.');if(value.revision!==revision)throw new Problem(409,'Fördelningen ändrades. Läs in den senaste innan du fortsätter.');return value;}
export function changeAssignment(store:Store,key:string,revision:number,assignments?:{roleId:string;userId:string}[]){return store.transaction(()=>{
  const value=draft(store,key,revision);if(value.gameId)throw new Problem(409,'Nollställ först innan du ändrar en godkänd rollfördelning.');
  if(assignments){const users=new Map(value.state.roles.map(role=>[role.userId,role.player]));const ids=new Set(value.state.roles.map(role=>role.id));if(assignments.length!==ids.size||new Set(assignments.map(a=>a.roleId)).size!==ids.size||new Set(assignments.map(a=>a.userId)).size!==users.size||assignments.some(a=>!ids.has(a.roleId)||!users.has(a.userId)))throw new Problem(400,'Varje spelare och roll måste förekomma exakt en gång.');for(const choice of assignments){const role=value.state.roles.find(role=>role.id===choice.roleId)!;role.userId=choice.userId;role.player=users.get(choice.userId)!;}for(const room of value.state.rooms)if(room.kind==='gm')room.name=value.state.roles.find(role=>role.id===room.roleIds[0])!.player;
  }else assignRandomly(value.state);
  store.run('UPDATE game_preparations SET state_json=?,revision=revision+1 WHERE id=?',JSON.stringify(value.state),key);
});}
export function approvePreparation(store:Store,user:User,key:string,revision:number,replaceLive=false){return store.transaction(()=>{
  const value=draft(store,key,revision);if(value.gameId)throw new Problem(409,'Rollfördelningen är redan godkänd.');const currentRoster=roster(store,value.rosterId);const current={...currentRoster,players:currentRoster.players.filter(player=>player.active)};const assigned=new Map(value.state.roles.map(role=>[role.userId,role.player]));if(current.players.length!==assigned.size||current.players.some(player=>assigned.get(player.id)!==player.name))throw new Problem(409,'Spelarlistan har ändrats. Förbered rollfördelningen igen.');
  const pending=current.players.filter(player=>!player.checkedIn);if(pending.length)throw new Problem(409,`${pending.length} aktiva spelare är inte incheckade: ${pending.map(player=>player.name).join(', ')}.`);
  for(const role of value.state.roles)role.photoId=current.players.find(player=>player.id===role.userId)?.photoId??null;
  const previous=liveGameId(store);if(previous&&!replaceLive)throw new Problem(409,'Ett annat parti är Live. Bekräfta att det ska ersättas.');if(previous)setLiveGame(store,user,null);
  const created=createGame(store,user,value.name,value.mode,value.state);if(value.mode==='test')setLiveGame(store,user,created);store.run('UPDATE game_preparations SET game_id=?,revision=revision+1 WHERE id=?',created,key);store.run('UPDATE checkin_lobby SET roster_id=NULL WHERE roster_id=?',value.rosterId);return {gameId:created,previous};
});}
export function resetPreparation(store:Store,user:User,key:string,revision:number){return store.transaction(()=>{
  const value=draft(store,key,revision);const previous=value.gameId;if(previous){if(liveGameId(store)===previous)setLiveGame(store,user,null);mutate(store,previous,user,'GM nollställde förberedelsen; detta partis historik bevaras',()=>{});store.run('UPDATE games SET automation_paused=1 WHERE id=?',previous);}store.run('UPDATE game_preparations SET game_id=NULL,revision=revision+1 WHERE id=?',key);return previous;
});}

export function setupRouter(store:Store,notify:(ids?:string[])=>void){
  const router=Router();const key=(value:unknown)=>id.parse(value);const kind=(value:unknown)=>z.enum(['groups','wins','powers','roles']).parse(value);const user=(res:{locals:Record<string,unknown>})=>res.locals.user as User;
  router.get('/',(_req,res)=>res.json(setupData(store)));
  router.post('/library/:kind',(req,res)=>res.status(201).json({id:saveLibrary(store,kind(req.params.kind),req.body)}));
  router.put('/library/:kind/:id',(req,res)=>res.json({id:saveLibrary(store,kind(req.params.kind),req.body,key(req.params.id))}));
  router.delete('/library/:kind/:id',(req,res)=>{deleteLibrary(store,kind(req.params.kind),key(req.params.id));res.json({ok:true});});
  router.post('/templates',(req,res)=>res.status(201).json({id:savePartyTemplate(store,req.body)}));
  router.put('/templates/:id',(req,res)=>res.json({id:savePartyTemplate(store,req.body,key(req.params.id))}));
  router.delete('/templates/:id',(req,res)=>{exists(store,'party_templates',key(req.params.id));referenced(()=>store.run('DELETE FROM party_templates WHERE id=?',key(req.params.id)));res.json({ok:true});});
  router.post('/rosters',(req,res)=>res.status(201).json(createRoster(store,req.body)));
  router.put('/rosters/:id',(req,res)=>{const v=z.object({name}).parse(req.body);exists(store,'player_rosters',key(req.params.id));store.run('UPDATE player_rosters SET name=? WHERE id=?',v.name,key(req.params.id));res.json({ok:true});});
  router.delete('/rosters/:id',(req,res)=>{exists(store,'player_rosters',key(req.params.id));referenced(()=>store.run('DELETE FROM player_rosters WHERE id=?',key(req.params.id)));res.json({ok:true});});
  router.post('/rosters/:id/generate',(req,res)=>{const v=z.object({count:z.number().int().min(1).max(25)}).parse(req.body);res.json({credentials:generatePlayers(store,key(req.params.id),v.count)});});
  router.post('/rosters/:id/players',(req,res)=>res.status(201).json({id:addRosterPlayer(store,key(req.params.id),req.body)}));
  router.delete('/rosters/:id/players/:playerId',(req,res)=>{store.run('DELETE FROM roster_players WHERE roster_id=? AND user_id=?',key(req.params.id),key(req.params.playerId));res.json({ok:true});});
  router.put('/players/:id',(req,res)=>{updatePlayer(store,key(req.params.id),req.body);res.json({ok:true});});
  router.post('/preparations',(req,res)=>res.status(201).json({id:prepareGame(store,req.body)}));
  router.post('/preparations/:id/shuffle',(req,res)=>{const v=z.object({revision:z.number().int()}).parse(req.body);changeAssignment(store,key(req.params.id),v.revision);res.json({ok:true});});
  router.put('/preparations/:id/assignments',(req,res)=>{const v=z.object({revision:z.number().int(),assignments:z.array(z.object({roleId:id,userId:id})).min(4).max(25)}).parse(req.body);changeAssignment(store,key(req.params.id),v.revision,v.assignments);res.json({ok:true});});
  router.post('/preparations/:id/approve',(req,res)=>{const v=z.object({revision:z.number().int(),replaceLive:z.boolean().default(false)}).parse(req.body);const result=approvePreparation(store,user(res),key(req.params.id),v.revision,v.replaceLive);notify([result.gameId,...(result.previous?[result.previous]:[])]);res.json(result);});
  router.post('/preparations/:id/reset',(req,res)=>{const v=z.object({revision:z.number().int()}).parse(req.body);const previous=resetPreparation(store,user(res),key(req.params.id),v.revision);notify(previous?[previous]:[]);res.json({ok:true});});
  router.delete('/preparations/:id',(req,res)=>{const v=store.one<{game_id:string|null}>('SELECT game_id FROM game_preparations WHERE id=?',key(req.params.id));if(!v)throw new Problem(404,'Förberedelsen finns inte.');if(v.game_id)throw new Problem(409,'Nollställ förberedelsen först.');store.run('DELETE FROM game_preparations WHERE id=?',key(req.params.id));res.json({ok:true});});
  return router;
}
