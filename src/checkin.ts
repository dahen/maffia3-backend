import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { Store } from './db.ts';
import type { GameState, User } from './contracts.ts';
import { Problem, requireGm } from './auth.ts';
import { liveGameId, loadGame, mutate } from './game.ts';

export interface Attendance {userId:string;name:string;photoId:string|null;checkedIn:boolean;checkedAt:string|null;byGm:boolean}
export interface CheckInView {contextKey:string;name:string;started:boolean;player:Attendance}
export interface Arrival {id:string;name:string;active:boolean;photoId:string|null;checkedIn:boolean;checkedAt:string|null;byGm:boolean}
export function lobbyId(store:Store){return store.one<{roster_id:string|null}>('SELECT roster_id FROM checkin_lobby WHERE singleton=1')?.roster_id??null;}
export function arrivals(store:Store,rosterId:string):Arrival[]{
  return store.all<{id:string;name:string;active:number;photo_id:string|null;checked_at:string|null;checked_by:string|null}>('SELECT u.id,u.name,r.active,a.photo_id,a.checked_at,a.checked_by FROM roster_players r JOIN users u ON u.id=r.user_id LEFT JOIN roster_attendance a ON a.roster_id=r.roster_id AND a.user_id=r.user_id WHERE r.roster_id=? ORDER BY u.name,u.id',rosterId).map(row=>({id:row.id,name:row.name,active:Boolean(row.active),photoId:row.photo_id,checkedIn:Boolean(row.checked_at),checkedAt:row.checked_at,byGm:Boolean(row.checked_by&&row.checked_by!==row.id)}));
}
function roster(store:Store,id:string){const row=store.one<{id:string;name:string}>('SELECT id,name FROM player_rosters WHERE id=?',id);if(!row)throw new Problem(404,'Ankomstlistan finns inte.');return row;}
export function openLobby(store:Store,rosterId:string,enabled:boolean){
  roster(store,rosterId);if(!enabled&&lobbyId(store)!==rosterId)throw new Problem(409,'Den här incheckningen är inte öppen.');
  store.run('INSERT INTO checkin_lobby VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET roster_id=excluded.roster_id',enabled?rosterId:null);
}
export function markChecked(store:Store,rosterId:string,userId:string,actor:User,checkedIn:boolean){
  if(!actor.admin)throw new Problem(403,'Endast GM kan checka in manuellt.');
  const member=arrivals(store,rosterId).find(player=>player.id===userId);if(!member)throw new Problem(404,'Spelaren finns inte i ankomstlistan.');if(!member.active&&checkedIn)throw new Problem(409,'Aktivera spelaren först.');
  store.run('INSERT INTO roster_attendance(roster_id,user_id,checked_at,checked_by) VALUES(?,?,?,?) ON CONFLICT(roster_id,user_id) DO UPDATE SET checked_at=excluded.checked_at,checked_by=excluded.checked_by',rosterId,userId,checkedIn?new Date().toISOString():null,checkedIn?actor.id:null);
}
export function setArrivalActive(store:Store,rosterId:string,userId:string,active:boolean){
  if(!arrivals(store,rosterId).some(player=>player.id===userId))throw new Problem(404,'Spelaren finns inte i ankomstlistan.');store.run('UPDATE roster_players SET active=? WHERE roster_id=? AND user_id=?',Number(active),rosterId,userId);
}
export function loginNames(store:Store){
  const ids=new Set<string>();const lobby=lobbyId(store);if(lobby)arrivals(store,lobby).filter(player=>player.active).forEach(player=>ids.add(player.id));
  const live=liveGameId(store);if(live)loadGame(store,live).state.roles.forEach(role=>ids.add(role.userId));
  return store.all<{id:string;name:string}>('SELECT id,name FROM users WHERE admin=0').filter(player=>ids.has(player.id)).map(player=>player.name).sort((a,b)=>a.localeCompare(b,'sv'));
}
function context(store:Store,user:User){
  const live=liveGameId(store);let running:{key:string;name:string;rosterId:string|null;gameId:string;state:GameState}|null=null;
  if(live){const {game,state}=loadGame(store,live);if(state.roles.some(role=>role.userId===user.id)){const prep=store.one<{roster_id:string}>('SELECT roster_id FROM game_preparations WHERE game_id=?',live);running={key:`game:${live}`,name:game.name,rosterId:prep?.roster_id??null,gameId:live,state};}}
  const lobby=lobbyId(store);
  if(lobby&&arrivals(store,lobby).some(player=>player.id===user.id&&player.active)){
    if(running?.rosterId===lobby)return running;
    const value=roster(store,lobby);return {key:`roster:${lobby}`,name:value.name,rosterId:lobby,gameId:null,state:null};
  }
  return running;
}
export function ownCheckIn(store:Store,user:User):CheckInView|null{
  const value=context(store,user);if(!value)return null;const role=value.state?.roles.find(role=>role.userId===user.id);const member=value.rosterId?arrivals(store,value.rosterId).find(player=>player.id===user.id):null;
  return {contextKey:value.key,name:value.name,started:Boolean(value.gameId),player:{userId:user.id,name:user.name,photoId:value.gameId?role?.photoId??null:member?.photoId??null,checkedIn:Boolean(value.gameId)||Boolean(member?.checkedIn),checkedAt:member?.checkedAt??null,byGm:member?.byGm??false}};
}
function expectedContext(store:Store,user:User,key:string){const value=context(store,user);if(!value||value.key!==key)throw new Problem(409,'Partiet för incheckning har ändrats. Läs in sidan igen.');return value;}
export async function savePhoto(store:Store,user:User,input:Buffer,key:string,actor:User=user){
  expectedContext(store,user,key);
  if(!input.length||input.length>512*1024)throw new Problem(400,'Fotot måste vara mindre än 512 kB.');
  const jpeg=input[0]===0xff&&input[1]===0xd8&&input[2]===0xff;
  const png=input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp=input.subarray(0,4).toString()==='RIFF'&&input.subarray(8,12).toString()==='WEBP';
  if(!jpeg&&!png&&!webp)throw new Problem(400,'Välj ett foto i JPEG-, PNG- eller WebP-format.');
  let data:Buffer;
  try{const decoder=sharp(input,{limitInputPixels:20_000_000,animated:false});const metadata=await decoder.metadata();if(!['jpeg','png','webp'].includes(metadata.format??''))throw new Error('format');data=await decoder.rotate().resize(640,640,{fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();}catch{throw new Problem(400,'Fotot kunde inte läsas. Välj en vanlig bildfil eller ta om fotot.');}
  store.transaction(()=>{
    const value=expectedContext(store,user,key);const photoId=randomUUID();store.run('INSERT INTO photo_assets(id,data) VALUES(?,?)',photoId,data);
    if(value.rosterId)store.run('INSERT INTO roster_attendance VALUES(?,?,?,?,?) ON CONFLICT(roster_id,user_id) DO UPDATE SET photo_id=excluded.photo_id,checked_at=excluded.checked_at,checked_by=excluded.checked_by',value.rosterId,user.id,photoId,new Date().toISOString(),actor.id);
    if(value.gameId)mutate(store,value.gameId,actor,'Spelarfoto uppdaterat',state=>{state.roles.find(role=>role.userId===user.id)!.photoId=photoId;});
  });
  return ownCheckIn(store,user);
}
export function confirmPhoto(store:Store,user:User,key:string,actor:User=user){
  const value=expectedContext(store,user,key);if(value.gameId)return ownCheckIn(store,user);const own=ownCheckIn(store,user)!;if(!own.player.photoId)throw new Problem(400,'Ta ett foto först. GM kan checka in utan foto.');
  store.run('UPDATE roster_attendance SET checked_at=?,checked_by=? WHERE roster_id=? AND user_id=?',new Date().toISOString(),actor.id,value.rosterId);return ownCheckIn(store,user);
}
export function photoBytes(store:Store,user:User,photoId:string){
  if(!user.admin){const live=liveGameId(store);const state=live?loadGame(store,live).state:null;const inGame=state?.roles.some(role=>role.userId===user.id)&&state.roles.some(role=>role.photoId===photoId);const own=ownCheckIn(store,user);if(!inGame&&own?.player.photoId!==photoId)throw new Problem(403,'Du har inte tillgång till fotot.');}
  const row=store.one<{data:Uint8Array}>('SELECT data FROM photo_assets WHERE id=?',photoId);if(!row)throw new Problem(404,'Fotot finns inte.');return Buffer.from(row.data);
}
export function checkinRouter(store:Store,notify:()=>void){
  const router=Router();const user=(res:{locals:Record<string,unknown>})=>res.locals.user as User;
  const target=(actor:User,requested:unknown):User=>{if(!requested)return actor;if(!actor.admin)throw new Problem(403,'Endast GM får välja en annan spelare.');const id=z.string().min(1).parse(requested);const row=store.one<{id:string;name:string}>('SELECT id,name FROM users WHERE id=? AND admin=0',id);if(!row)throw new Problem(404,'Spelaren finns inte.');return {...row,admin:false};};
  router.get('/camera',requireGm,(_req,res)=>{const lobby=lobbyId(store);if(lobby)return res.json({name:roster(store,lobby).name,rosterId:lobby,players:arrivals(store,lobby)});const live=liveGameId(store);if(!live)return res.json({name:'',rosterId:null,players:[]});const {game,state}=loadGame(store,live);res.json({name:game.name,rosterId:null,players:state.roles.map(role=>({id:role.userId,name:role.player,photoId:role.photoId??null,active:true,checkedIn:Boolean(role.photoId),checkedAt:null,byGm:false}))});});
  router.get('/',(req,res)=>res.json({checkin:ownCheckIn(store,target(user(res),req.query.userId))}));
  router.put('/photo',express.raw({type:'image/jpeg',limit:'512kb'}),async(req,res,next)=>{try{if(!Buffer.isBuffer(req.body))throw new Problem(400,'Skicka en bild i JPEG-format.');const value=await savePhoto(store,target(user(res),req.headers['x-player-id']),req.body,z.string().min(1).parse(req.headers['x-checkin-context']),user(res));notify();res.json({checkin:value});}catch(e){next(e);}});
  router.post('/confirm',(req,res)=>{const {contextKey,userId}=z.object({contextKey:z.string(),userId:z.string().optional()}).parse(req.body);const value=confirmPhoto(store,target(user(res),userId),contextKey,user(res));notify();res.json({checkin:value});});
  router.put('/rosters/:id/lobby',requireGm,(req,res)=>{const {enabled}=z.object({enabled:z.boolean()}).parse(req.body);openLobby(store,String(req.params.id),enabled);notify();res.json({ok:true});});
  router.put('/rosters/:id/players/:userId',requireGm,(req,res)=>{const {checkedIn}=z.object({checkedIn:z.boolean()}).parse(req.body);markChecked(store,String(req.params.id),String(req.params.userId),user(res),checkedIn);notify();res.json({ok:true});});
  router.put('/rosters/:id/players/:userId/active',requireGm,(req,res)=>{const {active}=z.object({active:z.boolean()}).parse(req.body);setArrivalActive(store,String(req.params.id),String(req.params.userId),active);notify();res.json({ok:true});});
  router.use((error:unknown,_req:unknown,res:express.Response,next:express.NextFunction)=>{if(error&&typeof error==='object'&&'type' in error&&error.type==='entity.too.large')return res.status(413).json({error:'Fotot är för stort. Ta om det eller välj en mindre bild.'});next(error);});
  return router;
}
