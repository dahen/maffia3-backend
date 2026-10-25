import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/db.ts';
import { addUser, checkPin } from '../src/auth.ts';
import { demoState, richDemoState, seedRichDemo } from '../src/demo.ts';
import { createGame, gameView, loadGame, setPhase as guardedSetPhase, PhaseChangeBlocked, setRoleFlags, submitAction, setResponse, enablePower, advanceRound, actionKey, navigate, jumpToRevision, postMessage, readMessages, markRead, recordDeath, setNotes, confirmKill, recordDayOutcome, parseState, setLiveGame, liveGameId, listGames } from '../src/game.ts';
import { broadcast, startCountdown, tickCountdowns } from '../src/broadcast.ts';
import { gameLog } from '../src/log.ts';
import { createApp } from '../src/app.ts';
import type { User } from '../src/contracts.ts';
import { setupData, saveLibrary, deleteLibrary, savePartyTemplate, createRoster, addRosterPlayer, updatePlayer, prepareGame, changeAssignment, approvePreparation, resetPreparation } from '../src/setup.ts';
import { seedLibrary } from '../src/setup-seed.ts';
import { phaseReadiness } from '../src/readiness.ts';

// Existing history/auth scenarios deliberately move past incomplete phases.
// Exercise the same explicit acknowledgement that GM now uses in the UI.
function setPhase(...args:Parameters<typeof guardedSetPhase>){try{return guardedSetPhase(...args);}catch(e){if(!(e instanceof PhaseChangeBlocked))throw e;return guardedSetPhase(args[0],args[1],args[2],args[3],{overrideToken:e.guard.token});}}

function fixture(path=':memory:',size=8) {
  const store=new Store(path); const gm=addUser(store,'GM','2468',true); const state=demoState(store,size); const id=createGame(store,gm,'Test','test',state);setLiveGame(store,gm,id);
  const player=(i:number):User=>({id:state.roles[i]!.userId,name:state.roles[i]!.player,admin:false});
  return {store,gm,state,id,player};
}

test('fasbyte skyddas på servern, visar rätt återstående arbete och tillåter bara en aktuell uttrycklig bekräftelse',()=>{
  const f=fixture();try{
    guardedSetPhase(f.store,f.id,f.gm,1);let guard:PhaseChangeBlocked['guard']|undefined;
    const before=loadGame(f.store,f.id).revision.id;
    try{guardedSetPhase(f.store,f.id,f.gm,2);}catch(e){assert.ok(e instanceof PhaseChangeBlocked);guard=e.guard;}
    assert.ok(guard);assert.equal(guard.kind,'actions');assert.equal(guard.missingCount,6);
    assert.throws(()=>guardedSetPhase(f.store,f.id,f.gm,3),(e:unknown)=>e instanceof PhaseChangeBlocked&&e.guard.kind==='mixed','Att hoppa direkt till morgon får inte kringgå saknade GM-besked');
    assert.ok(!guard.pending.some(r=>r.roleId===f.state.roles[4]!.id||r.roleId===f.state.roles[7]!.id));
    assert.equal(loadGame(f.store,f.id).revision.id,before);assert.equal(loadGame(f.store,f.id).state.rounds[0]!.phase,1);
    const first=f.state.roles[0]!;submitAction(f.store,f.id,f.player(0),first.id,first.powers[0]!.id,'Ingen',null);
    assert.throws(()=>guardedSetPhase(f.store,f.id,f.gm,2,{overrideToken:guard!.token}),PhaseChangeBlocked,'Bekräftelse av en gammal lista får inte användas');
    for(const role of gameView(f.store,f.id,f.gm).roles)for(const p of role.powers){
      if(!p.enabled||p.type==='None'||p.action?.value)continue;
      submitAction(f.store,f.id,{id:role.userId,name:role.player,admin:false},role.id,p.id,p.type==='Yes/No'?'Ja':p.type==='Text'?'Text':'Ingen',null);
    }
    assert.equal(phaseReadiness(1,gameView(f.store,f.id,f.gm).roles)!.missingCount,0);
    guardedSetPhase(f.store,f.id,f.gm,2);
    assert.throws(()=>guardedSetPhase(f.store,f.id,f.gm,3),PhaseChangeBlocked);
    for(const role of gameView(f.store,f.id,f.gm).roles)for(const p of role.powers){
      if(!p.enabled||!p.gmResponse||(p.type!=='None'&&!p.action?.value))continue;
      setResponse(f.store,f.id,f.gm,role.id,p.id,'Besked',p.action?.value??null);
    }
    assert.equal(phaseReadiness(2,gameView(f.store,f.id,f.gm).roles)!.missingCount,0);guardedSetPhase(f.store,f.id,f.gm,3);
    guardedSetPhase(f.store,f.id,f.gm,1);
    // Remove a response by resubmitting a text choice, then deliberately acknowledge the new guard.
    const text=f.state.roles[6]!;submitAction(f.store,f.id,f.player(6),text.id,text.powers[0]!.id,'Nytt val',null);guardedSetPhase(f.store,f.id,f.gm,2);
    try{guardedSetPhase(f.store,f.id,f.gm,3);}catch(e){assert.ok(e instanceof PhaseChangeBlocked);guard=e.guard;}
    guardedSetPhase(f.store,f.id,f.gm,3,{overrideToken:guard!.token,expectedPhase:2});
    assert.ok(gameLog(f.store,f.id,f.gm).some(e=>e.label.includes('GM gick vidare trots saknade besked')));
  }finally{f.store.close();}
});

test('Morgonanteckningar gäller även levande spelare, är GM-hemliga och bevaras per dygn och vid tidsresor',()=>{
  const f=fixture();try{
    const role=f.state.roles[2]!;setRoleFlags(f.store,f.id,f.gm,role.id,{morningNotes:'HEMLIGT: leriga tasspår vid floden'});
    let view=gameView(f.store,f.id,f.gm);assert.equal(view.roles[2]!.alive,true);assert.equal(view.roles[2]!.morningNotes,'HEMLIGT: leriga tasspår vid floden');
    assert.ok(!JSON.stringify(gameView(f.store,f.id,f.player(2))).includes('HEMLIGT'));
    setPhase(f.store,f.id,f.gm,3);const before=loadGame(f.store,f.id).revision.id;advanceRound(f.store,f.id,f.gm);const after=loadGame(f.store,f.id).revision.id;
    assert.equal(gameView(f.store,f.id,f.gm).roles[2]!.morningNotes,'');assert.equal(gameView(f.store,f.id,f.gm,1).roles[2]!.morningNotes,'HEMLIGT: leriga tasspår vid floden');
    navigate(f.store,f.id,f.gm,'back',after);view=gameView(f.store,f.id,f.gm);assert.equal(view.roles[2]!.morningNotes,'HEMLIGT: leriga tasspår vid floden');
    navigate(f.store,f.id,f.gm,'forward',before);assert.equal(gameView(f.store,f.id,f.gm).roles[2]!.morningNotes,'');
    assert.ok(gameLog(f.store,f.id,f.gm).some(e=>e.details.some(d=>d.includes('Morgonanteckning')&&d.includes('leriga tasspår'))));
  }finally{f.store.close();}
});

test('flera förmågor och fyra grupper: gruppval påverkar bara rätt grupp och seed bevarar testpartiet',()=>{
  const f=fixture();try{
    const id=createGame(f.store,f.gm,'Flera förmågor','test',richDemoState(f.store));
    const initial=gameView(f.store,id,f.gm);
    assert.equal(new Set(initial.roles.map(r=>r.team)).size,4);
    assert.ok(initial.roles.every(r=>r.powers.length>=2));assert.ok(initial.roles.some(r=>r.powers.length===3));
    assert.equal(initial.rooms.filter(r=>r.kind==='group').length,3);
    const river=initial.roles.filter(r=>r.team==='Flodklanen');const actor=river[0]!;const power=actor.powers[0]!;
    const otherGroupsBefore=initial.roles.filter(r=>r.team!=='Flodklanen').map(r=>r.powers.map(p=>p.action));
    const individualBefore=actor.powers[1]!.action;
    submitAction(f.store,id,{id:actor.userId,name:actor.player,admin:false},actor.id,power.id,'Ingen',null);
    const updated=gameView(f.store,id,f.gm);
    assert.ok(updated.roles.filter(r=>r.team==='Flodklanen').every(r=>r.powers[0]!.action!.value==='Ingen'&&r.powers[0]!.action!.executorId===actor.id));
    assert.deepEqual(updated.roles.filter(r=>r.team!=='Flodklanen').map(r=>r.powers.map(p=>p.action)),otherGroupsBefore);
    assert.deepEqual(updated.roles.find(r=>r.id===actor.id)!.powers[1]!.action,individualBefore);
    const seeded=seedRichDemo(f.store);setNotes(f.store,seeded,f.gm,'Behåll mina anteckningar');
    assert.equal(seedRichDemo(f.store),seeded);assert.equal(gameView(f.store,seeded,f.gm).notes,'Behåll mina anteckningar');
  }finally{f.store.close();}
});

test('player-kill kräver GM-bekräftelse och bevarar exakt utförare, förmåga och historiksteg',()=>{
  const f=fixture();try{
    const [first,second,target,other]=f.state.roles;setPhase(f.store,f.id,f.gm,1);
    submitAction(f.store,f.id,f.player(0),first!.id,first!.powers[0]!.id,'',target!.id);
    assert.equal(gameView(f.store,f.id,f.gm).roles[2]!.alive,true,'Inlämning får aldrig döda automatiskt');
    assert.throws(()=>confirmKill(f.store,f.id,f.player(0),{targetRoleId:target!.id,actorRoleId:first!.id,powerId:first!.powers[0]!.id}));
    submitAction(f.store,f.id,f.player(1),second!.id,second!.powers[0]!.id,'',target!.id);
    assert.throws(()=>confirmKill(f.store,f.id,f.gm,{targetRoleId:target!.id,actorRoleId:first!.id,powerId:first!.powers[0]!.id}),'Ändrad grupputförare får inte tillskrivas fel spelare');
    submitAction(f.store,f.id,f.player(2),target!.id,target!.powers[0]!.id,'',other!.id);
    assert.throws(()=>confirmKill(f.store,f.id,f.gm,{targetRoleId:other!.id,actorRoleId:target!.id,powerId:target!.powers[0]!.id}),'player-other är inte dödande');
    const sourceRevision=loadGame(f.store,f.id).revision.id;
    confirmKill(f.store,f.id,f.gm,{targetRoleId:target!.id,actorRoleId:second!.id,powerId:second!.powers[0]!.id});
    const confirmed=gameView(f.store,f.id,f.gm);const death=confirmed.morning[0]!;
    assert.equal(confirmed.roles[2]!.alive,false);assert.equal(death.reason,'Nattens jakt');assert.equal(death.source!.actorPlayer,second!.player);assert.equal(death.source!.sourceRevision,sourceRevision);
    submitAction(f.store,f.id,f.player(1),second!.id,second!.powers[0]!.id,'',other!.id);
    recordDeath(f.store,f.id,f.gm,{roleId:target!.id,cause:'night',clue:'Fjädrar låg på marken.'});
    assert.deepEqual(gameView(f.store,f.id,f.gm).morning[0]!.source,death.source,'Ny handling eller redigerad ledtråd får inte skriva om dödsorsaken');
    assert.ok(gameLog(f.store,f.id,f.gm).some(e=>e.details.some(d=>d.includes(`Utförare: ${second!.player}`)&&d.includes('Nattens jakt'))));
    jumpToRevision(f.store,f.id,f.gm,sourceRevision);assert.equal(gameView(f.store,f.id,f.gm).roles[2]!.alive,true);
    navigate(f.store,f.id,f.gm,'forward',sourceRevision);assert.deepEqual(gameView(f.store,f.id,f.gm).morning[0]!.source,death.source);
  }finally{f.store.close();}
});

test('Möte: flera dödsfall med orsak eller uttryckligen ingen dog, bevarat till morgon och nästa dygn',()=>{
  const f=fixture();try{
    recordDayOutcome(f.store,f.id,f.gm,{outcome:'none'});assert.equal(gameView(f.store,f.id,f.gm).dayOutcome,'none');
    recordDayOutcome(f.store,f.id,f.gm,{outcome:'deaths',roleIds:f.state.roles.slice(0,2).map(r=>r.id),cause:'lynch',reason:'Utröstning'});
    let view=gameView(f.store,f.id,f.gm);assert.equal(view.morning.length,2);assert.ok(view.morning.every(d=>d.reason==='Utröstning'));assert.equal(view.dayOutcome,'deaths');
    assert.throws(()=>recordDayOutcome(f.store,f.id,f.gm,{outcome:'none'}));
    const other=f.state.roles[2]!;recordDayOutcome(f.store,f.id,f.gm,{outcome:'deaths',roleIds:[other.id],cause:'day',reason:'Gift från en fälla'});
    setPhase(f.store,f.id,f.gm,1);assert.throws(()=>recordDayOutcome(f.store,f.id,f.gm,{outcome:'none'}));
    setPhase(f.store,f.id,f.gm,3);view=gameView(f.store,f.id,f.gm);assert.equal(view.morning.length,3);assert.equal(view.morning[2]!.reason,'Gift från en fälla');
    advanceRound(f.store,f.id,f.gm);assert.equal(gameView(f.store,f.id,f.gm).dayOutcome,'pending');assert.equal(gameView(f.store,f.id,f.gm,1).morning[2]!.reason,'Gift från en fälla');
    assert.ok(gameLog(f.store,f.id,f.gm).some(e=>e.details.some(d=>d.includes('ingen dog under dagen'))));
  }finally{f.store.close();}
});

test('äldre Name-förmågor och dödsfall kan fortfarande läsas utan att ändra sparad JSON',()=>{
  const f=fixture();try{
    const legacy=JSON.parse(JSON.stringify(f.state));for(const role of legacy.roles)for(const power of role.powers)if(power.type.startsWith('player-'))power.type='Name';
    delete legacy.rounds[0].dayOutcome;legacy.rounds[0].deaths=[{roleId:legacy.roles[2].id,cause:'lynch',clue:'En fjäder'}];
    const json=JSON.stringify(legacy);const migrated=parseState(json);
    assert.equal(migrated.roles[0]!.powers[0]!.type,'player-kill');assert.equal(migrated.roles[2]!.powers[0]!.type,'player-other');
    assert.equal(migrated.rounds[0]!.deaths[0]!.reason,'Utröstning');assert.equal(migrated.rounds[0]!.dayOutcome,'deaths');assert.match(json,/'Name'|"Name"/);
  }finally{f.store.close();}
});

test('rollens bestående och dygnsvisa GM-anteckningar bevaras rätt vid rundbyte, läsning och bakåt/framåt',()=>{
  const f=fixture();try{
    const role=f.state.roles[2]!;setRoleFlags(f.store,f.id,f.gm,role.id,{notes:'HEMLIGT: 2 nycklar och 1 medicin',roundNotes:'HEMLIGT: smutsig i natt'});
    assert.ok(!JSON.stringify(gameView(f.store,f.id,f.player(2))).includes('HEMLIGT'));
    setPhase(f.store,f.id,f.gm,3);const before=loadGame(f.store,f.id).revision.id;advanceRound(f.store,f.id,f.gm);const after=loadGame(f.store,f.id).revision.id;
    let view=gameView(f.store,f.id,f.gm);assert.equal(view.roles[2]!.notes,'HEMLIGT: 2 nycklar och 1 medicin');assert.equal(view.roles[2]!.roundNotes,'');
    assert.equal(gameView(f.store,f.id,f.gm,1).roles[2]!.roundNotes,'HEMLIGT: smutsig i natt');
    navigate(f.store,f.id,f.gm,'back',after);assert.equal(loadGame(f.store,f.id).revision.id,before);assert.equal(gameView(f.store,f.id,f.gm).roles[2]!.roundNotes,'HEMLIGT: smutsig i natt');
    navigate(f.store,f.id,f.gm,'forward',before);assert.equal(gameView(f.store,f.id,f.gm).roles[2]!.roundNotes,'');
    setRoleFlags(f.store,f.id,f.gm,role.id,{roundNotes:'Blöt idag'});setRoleFlags(f.store,f.id,f.gm,role.id,{roundNotes:''});
    assert.equal(gameView(f.store,f.id,f.gm,1).roles[2]!.roundNotes,'HEMLIGT: smutsig i natt');
    assert.ok(gameLog(f.store,f.id,f.gm).some(e=>e.details.some(d=>d.includes('smutsig i natt'))));
  }finally{f.store.close();}
});

test('hemlig blockering tillåter val och döljer GM-information och opublicerade svar',()=>{
  const f=fixture();try {
    const role=f.state.roles[2]!;const power=role.powers[0]!;const target=f.state.roles[0]!;
    setRoleFlags(f.store,f.id,f.gm,role.id,{blocked:true,notes:'HEMLIGT'});setNotes(f.store,f.id,f.gm,'HEMLIGT GLOBALT');setPhase(f.store,f.id,f.gm,1);
    submitAction(f.store,f.id,f.player(2),role.id,power.id,'',target.id);
    setPhase(f.store,f.id,f.gm,2);setResponse(f.store,f.id,f.gm,role.id,power.id,'HEMLIGT BESKED',target.player);
    const hidden=gameView(f.store,f.id,f.player(2));const json=JSON.stringify(hidden);
    assert.equal(hidden.roles.length,1);assert.equal(hidden.roles[0]!.blocked,false);assert.equal(hidden.roles[0]!.powers[0]!.action!.value,target.player);
    assert.ok(!json.includes('HEMLIGT'));assert.equal(hidden.timeline.length,0);assert.deepEqual(hidden.morning,[]);
    setPhase(f.store,f.id,f.gm,3);assert.equal(gameView(f.store,f.id,f.player(2)).roles[0]!.powers[0]!.action!.response,'HEMLIGT BESKED');
    setRoleFlags(f.store,f.id,f.gm,role.id,{summoned:true});assert.equal(gameView(f.store,f.id,f.player(2)).roles[0]!.powers[0]!.action!.response,'');
  }finally{f.store.close();}
});

test('alla fyra powertyper, villkor och grupputförare följer normala spelarregler',()=>{
  const f=fixture();try{
    setPhase(f.store,f.id,f.gm,1);const [a,b,c]=f.state.roles;const group=a!.powers[0]!;
    submitAction(f.store,f.id,f.player(0),a!.id,group.id,'',c!.id);
    submitAction(f.store,f.id,f.player(1),b!.id,b!.powers[0]!.id,'',a!.id);
    const shared=gameView(f.store,f.id,f.gm).roles.slice(0,2).map(r=>r.powers[0]!.action!);
    assert.equal(shared[0]!.executorId,b!.id);assert.deepEqual(shared[0],shared[1]);
    const conditional=f.state.roles[4]!;assert.throws(()=>submitAction(f.store,f.id,f.player(4),conditional.id,conditional.powers[0]!.id,'',c!.id));
    enablePower(f.store,f.id,f.gm,conditional.id,conditional.powers[0]!.id,true);submitAction(f.store,f.id,f.player(4),conditional.id,conditional.powers[0]!.id,'Ingen',null);
    const yesno=f.state.roles[5]!;assert.throws(()=>submitAction(f.store,f.id,f.player(5),yesno.id,yesno.powers[0]!.id,'Kanske',null));submitAction(f.store,f.id,f.player(5),yesno.id,yesno.powers[0]!.id,'Nej',null);
    const text=f.state.roles[6]!;submitAction(f.store,f.id,f.player(6),text.id,text.powers[0]!.id,'Min fria text',null);
    const none=f.state.roles[7]!;assert.throws(()=>submitAction(f.store,f.id,f.player(7),none.id,none.powers[0]!.id,'val',null));
    setPhase(f.store,f.id,f.gm,2);setResponse(f.store,f.id,f.gm,none.id,none.powers[0]!.id,'Ett besked utan spelarval',null);
    assert.equal(gameView(f.store,f.id,f.gm).roles[7]!.powers[0]!.action!.response,'Ett besked utan spelarval');
    const other=createGame(f.store,f.gm,'Annat parti','test',demoState(f.store,8));assert.deepEqual(loadGame(f.store,other).state.rounds[0]!.actions,{});
  }finally{f.store.close();}
});

test('25 spelare genom 10 dygn behåller actions, anteckningar och återberättbar logg',()=>{
  const dir=mkdtempSync(join(tmpdir(),'maffia-'));const path=join(dir,'test.sqlite');const f=fixture(path,25);
  try{
    for(let day=1;day<=10;day++){
      setPhase(f.store,f.id,f.gm,1);const role=f.state.roles[2]!;submitAction(f.store,f.id,f.player(2),role.id,role.powers[0]!.id,'',f.state.roles[day%25]!.id);
      setNotes(f.store,f.id,f.gm,`Anteckning dygn ${day}`);setPhase(f.store,f.id,f.gm,2);setResponse(f.store,f.id,f.gm,role.id,role.powers[0]!.id,`Besked ${day}`,f.state.roles[day%25]!.player);setPhase(f.store,f.id,f.gm,3);
      if(day<10)advanceRound(f.store,f.id,f.gm);
    }
    assert.equal(loadGame(f.store,f.id).state.rounds.length,10);
    for(let day=1;day<=10;day++){const view=gameView(f.store,f.id,f.gm,day);assert.equal(view.notes,`Anteckning dygn ${day}`);assert.equal(view.roles[2]!.powers[0]!.action!.response,`Besked ${day}`);}
    const log=gameLog(f.store,f.id,f.gm);assert.ok(log.some(e=>e.round===1&&e.details.some(d=>d.includes('Besked 1'))));assert.ok(log.some(e=>e.round===10&&e.details.some(d=>d.includes('Besked 10'))));
    const revision=loadGame(f.store,f.id).revision.id;f.store.close();const reopened=new Store(path);try{assert.equal(loadGame(reopened,f.id).revision.id,revision);assert.equal(loadGame(reopened,f.id).state.rounds.length,10);}finally{reopened.close();}
    assert.ok(statSync(path).size<10_000_000,'Normalparti utan stor chatt ska rymmas väl under 10 MB');
  }finally{try{f.store.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});

test('nytt dygn har tomma val och nollställda nattflaggor utan att radera gamla',()=>{
  const f=fixture();try{
    const role=f.state.roles[2]!;setPhase(f.store,f.id,f.gm,1);setRoleFlags(f.store,f.id,f.gm,role.id,{blocked:true,summoned:true});submitAction(f.store,f.id,f.player(2),role.id,role.powers[0]!.id,'Ingen',null);
    setPhase(f.store,f.id,f.gm,3);advanceRound(f.store,f.id,f.gm);const view=gameView(f.store,f.id,f.gm);
    assert.equal(view.game.round,2);assert.equal(view.roles[2]!.powers[0]!.action,null);assert.equal(view.roles[2]!.blocked,false);assert.equal(gameView(f.store,f.id,f.gm,1).roles[2]!.blocked,true);
  }finally{f.store.close();}
});

test('bakåt/framåt bevarar grenar och följer rätt väg efter flera bakåtsteg',()=>{
  const f=fixture();try{
    const start=loadGame(f.store,f.id).revision.id;setPhase(f.store,f.id,f.gm,1);const night=loadGame(f.store,f.id).revision.id;setPhase(f.store,f.id,f.gm,2);const oldDawn=loadGame(f.store,f.id).revision.id;
    navigate(f.store,f.id,f.gm,'back',oldDawn);setPhase(f.store,f.id,f.gm,3);const branch=loadGame(f.store,f.id).revision.id;
    jumpToRevision(f.store,f.id,f.gm,oldDawn);navigate(f.store,f.id,f.gm,'back',oldDawn);navigate(f.store,f.id,f.gm,'back',night);
    assert.equal(loadGame(f.store,f.id).revision.id,start);navigate(f.store,f.id,f.gm,'forward',start);navigate(f.store,f.id,f.gm,'forward',night);assert.equal(loadGame(f.store,f.id).revision.id,oldDawn);
    assert.ok(gameView(f.store,f.id,f.gm).timeline.some(t=>t.id===branch));assert.equal(gameLog(f.store,f.id,f.gm).find(e=>e.id===branch)!.activeBranch,false);
    assert.throws(()=>navigate(f.store,f.id,f.player(2),'back',oldDawn));
    setLiveGame(f.store,f.gm,null);const live=createGame(f.store,f.gm,'Live','live',demoState(f.store,4));assert.throws(()=>jumpToRevision(f.store,live,f.gm,loadGame(f.store,live).revision.id));
  }finally{f.store.close();}
});

test('chatt: medlemskap, oläst, omsändning och beständiga meddelanden',()=>{
  const f=fixture();try{
    const room=f.state.rooms.find(r=>r.kind==='gm'&&r.roleIds.includes(f.state.roles[2]!.id))!;const clientId=randomUUID();
    postMessage(f.store,f.id,f.player(2),room.id,'Hej GM',clientId);postMessage(f.store,f.id,f.player(2),room.id,'Hej GM',clientId);
    assert.equal(readMessages(f.store,f.id,f.gm,room.id).length,1);assert.equal(gameView(f.store,f.id,f.gm).rooms.find(r=>r.id===room.id)!.unread,1);
    markRead(f.store,f.id,f.gm,room.id,clientId);assert.equal(gameView(f.store,f.id,f.gm).rooms.find(r=>r.id===room.id)!.unread,0);
    assert.throws(()=>readMessages(f.store,f.id,f.player(3),room.id));assert.throws(()=>postMessage(f.store,f.id,f.player(3),room.id,'Fel spelare',randomUUID()));
    setPhase(f.store,f.id,f.gm,3);const group=f.state.rooms.find(r=>r.kind==='group')!;assert.throws(()=>postMessage(f.store,f.id,f.player(0),group.id,'Stängd',randomUUID()));postMessage(f.store,f.id,f.player(2),room.id,'Morgonfråga',randomUUID());
    advanceRound(f.store,f.id,f.gm);assert.equal(readMessages(f.store,f.id,f.gm,room.id).length,2);assert.throws(()=>gameLog(f.store,f.id,f.player(2)));
  }finally{f.store.close();}
});

test('broadcast och automatiska påminnelser skickas bara till rätt mottagare och byter aldrig fas',()=>{
  const f=fixture();try{
    setPhase(f.store,f.id,f.gm,1);const role=f.state.roles[2]!;submitAction(f.store,f.id,f.player(2),role.id,role.powers[0]!.id,'Ingen',null);
    const count=broadcast(f.store,f.id,f.gm,'Till alla levande','alive').count;assert.equal(count,8);
    const now=Date.now();startCountdown(f.store,f.id,f.gm,5,now);tickCountdowns(f.store,()=>{},now+120001);
    const state=loadGame(f.store,f.id).state;const room=f.state.rooms.find(r=>r.kind==='gm'&&r.roleIds.includes(role.id))!;
    assert.equal(state.rounds[0]!.phase,1);assert.equal(state.messages.filter(m=>m.roomId===room.id).length,1);
    const first=state.messages.length;tickCountdowns(f.store,()=>{},now+120002);assert.equal(loadGame(f.store,f.id).state.messages.length,first);
    tickCountdowns(f.store,()=>{},now+360000);assert.equal(loadGame(f.store,f.id).state.rounds[0]!.phase,1);
    const before=loadGame(f.store,f.id).state.messages.length;const current=loadGame(f.store,f.id).revision.id;navigate(f.store,f.id,f.gm,'back',current);const afterUndo=loadGame(f.store,f.id).state.messages.length;tickCountdowns(f.store,()=>{},now+600000);assert.equal(loadGame(f.store,f.id).state.messages.length,afterUndo);assert.ok(afterUndo<before);
    assert.throws(()=>setPhase(f.store,f.id,f.player(2),2));assert.throws(()=>advanceRound(f.store,f.id,f.player(2)));
  }finally{f.store.close();}
});

test('morgonunderlag skiljer nattdöd från hängning och stannar hos GM',()=>{
  const f=fixture();try{
    recordDeath(f.store,f.id,f.gm,{roleId:f.state.roles[0]!.id,cause:'lynch',clue:'En vass tand låg kvar.'});setPhase(f.store,f.id,f.gm,2);
    recordDeath(f.store,f.id,f.gm,{roleId:f.state.roles[2]!.id,cause:'night',clue:'En fjäder hittades vid floden.'});
    const morning=gameView(f.store,f.id,f.gm).morning;assert.equal(morning.length,2);assert.deepEqual(morning.map(m=>m.cause),['lynch','night']);assert.equal(gameView(f.store,f.id,f.player(3)).morning.length,0);
    setPhase(f.store,f.id,f.gm,3);advanceRound(f.store,f.id,f.gm);assert.equal(gameView(f.store,f.id,f.gm).morning.length,0);assert.equal(gameView(f.store,f.id,f.gm,1).morning.length,2);
    assert.ok(gameLog(f.store,f.id,f.gm).some(e=>e.details.some(d=>d.includes('En fjäder'))));
  }finally{f.store.close();}
});

test('HTTP: login, åtkomst, massimulering och SSE-uppdatering utan omladdning',async()=>{
  const f=fixture();const app=createApp(f.store);const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',()=>resolve()));
  const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}`;
  async function call(path:string,method='GET',body?:unknown,cookie=''){return fetch(base+'/api'+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
  const abort=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
    assert.equal((await call('/games')).status,401);const login=await call('/login','POST',{name:'GM',pin:'2468'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
    const stream=await fetch(`${base}/api/games/${f.id}/events`,{headers:{cookie},signal:abort.signal});assert.equal(stream.headers.get('content-type'),'text/event-stream');reader=stream.body!.getReader();await reader.read();
    assert.equal((await call(`/games/${f.id}/phase`,'POST',{phase:1},cookie)).status,200);
    const notification=await Promise.race([reader.read(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('SSE-notis saknades')),3000))]);assert.match(new TextDecoder().decode(notification.value),/event: change/);
    const unfinishedNight=await call(`/games/${f.id}/phase`,'POST',{phase:2},cookie);assert.equal(unfinishedNight.status,409);assert.equal((await unfinishedNight.json()).phaseGuard.kind,'actions');
    const sim=await call(`/games/${f.id}/simulate`,'POST',{},cookie);assert.equal(sim.status,200);assert.ok(gameView(f.store,f.id,f.gm).roles.every(r=>r.finished));
    assert.equal((await call(`/games/${f.id}/phase`,'POST',{phase:2,expectedPhase:1},cookie)).status,200);
    const unfinishedDawn=await call(`/games/${f.id}/phase`,'POST',{phase:3},cookie);assert.equal(unfinishedDawn.status,409);const dawnGuard=(await unfinishedDawn.json()).phaseGuard;assert.equal(dawnGuard.kind,'responses');
    assert.equal((await call(`/games/${f.id}/phase`,'POST',{phase:3,expectedPhase:2,overrideToken:dawnGuard.token},cookie)).status,200);
    const playerLogin=await call('/login','POST',{name:'Charlie',pin:'1103'});const playerCookie=playerLogin.headers.get('set-cookie')!.split(';')[0]!;
    assert.equal((await call(`/games/${f.id}/log`,'GET',undefined,playerCookie)).status,403);assert.equal((await call(`/games/${f.id}/phase`,'POST',{phase:3},playerCookie)).status,403);
  }finally{abort.abort();await reader?.cancel().catch(()=>{});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));f.store.close();}
});

test('mobilspelare: egna val, privat data, besked och wifi-Origin via HTTP',async()=>{
  const f=fixture();const server=createApp(f.store).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  let cookie='';
  async function call(path:string,method='GET',body?:unknown,origin=base){return fetch(base+'/api'+path,{method,headers:{cookie,origin,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
  try{
    const login=await call('/login','POST',{name:'Charlie',pin:'1103'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie')!.split(';')[0]!;
    const role=f.state.roles[2]!;const power=role.powers[0]!;const other=f.state.roles[0]!;
    setPhase(f.store,f.id,f.gm,1);setRoleFlags(f.store,f.id,f.gm,role.id,{blocked:true,notes:'Hemligt föremål',roundNotes:'Hemlig natt',morningNotes:'Hemlig morgon'});setNotes(f.store,f.id,f.gm,'GM-hemlighet');
    const choice=`/games/${f.id}/roles/${role.id}/powers/${power.id}/action`;
    assert.equal((await call(choice,'POST',{value:'Ingen'},'http://annan-sida.example')).status,403);
    assert.equal((await call(choice,'POST',{value:'Ingen'})).status,200,'Hemlig blockering hindrar inte spelarval via HTTP');
    assert.equal((await call(`/games/${f.id}/roles/${other.id}/powers/${other.powers[0]!.id}/action`,'POST',{value:'Ingen'})).status,403);
    const personal=f.state.rooms.find(r=>r.kind==='gm'&&r.roleIds.includes(role.id))!;
    const forbidden=f.state.rooms.find(r=>r.kind==='gm'&&r.roleIds.includes(other.id))!;
    assert.equal((await call(`/games/${f.id}/rooms/${forbidden.id}/messages`)).status,403);
    const clientId=randomUUID();assert.equal((await call(`/games/${f.id}/rooms/${personal.id}/messages`,'POST',{body:'Från mobilen',clientId})).status,200);
    assert.equal(readMessages(f.store,f.id,f.gm,personal.id)[0]!.body,'Från mobilen');
    setPhase(f.store,f.id,f.gm,2);setResponse(f.store,f.id,f.gm,role.id,power.id,'Privat morgonbesked','Ingen');
    const dawn=await (await call(`/games/${f.id}?round=999`)).json();assert.equal(dawn.roles.length,1);assert.equal(dawn.roles[0].id,role.id);assert.equal(dawn.roles[0].blocked,false);assert.equal(dawn.roles[0].powers[0].action.response,'');assert.equal(dawn.notes,'');assert.equal(dawn.timeline.length,0);assert.equal(dawn.morning.length,0);
    for(const secret of ['Hemligt föremål','Hemlig natt','Hemlig morgon','GM-hemlighet','Privat morgonbesked'])assert.ok(!JSON.stringify(dawn).includes(secret));
    assert.equal((await call(choice,'POST',{value:'Ingen'})).status,409);
    setPhase(f.store,f.id,f.gm,3);const morning=await (await call(`/games/${f.id}`)).json();assert.equal(morning.roles[0].powers[0].action.response,'Privat morgonbesked');
    setRoleFlags(f.store,f.id,f.gm,role.id,{summoned:true});const summoned=await (await call(`/games/${f.id}`)).json();assert.equal(summoned.roles[0].summoned,true);assert.equal(summoned.roles[0].powers[0].action.response,'');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));f.store.close();}
});

test('Live är en enda markering, behåller testhistorik och begränsar spelarnas partilista',()=>{
  const f=fixture();try{
    const second=createGame(f.store,f.gm,'Andra testet','test',demoState(f.store,8));
    assert.equal(liveGameId(f.store),f.id);assert.deepEqual(listGames(f.store,f.player(0)).map(g=>g.id),[f.id]);
    setLiveGame(f.store,f.gm,second);assert.equal(listGames(f.store,f.gm).filter(g=>g.isLive).length,1);assert.equal(gameView(f.store,f.id,f.gm).game.isLive,false);assert.equal(gameView(f.store,second,f.gm).game.mode,'test');
    assert.deepEqual(listGames(f.store,f.player(0)).map(g=>g.id),[second]);assert.throws(()=>setLiveGame(f.store,f.player(0),f.id));
    assert.throws(()=>setLiveGame(f.store,f.gm,'saknas'));assert.equal(liveGameId(f.store),second);
    assert.throws(()=>createGame(f.store,f.gm,'Skarpt','live',demoState(f.store,8)));assert.equal(liveGameId(f.store),second);
    const revision=loadGame(f.store,second).revision.id;navigate(f.store,second,f.gm,'back',revision);assert.equal(liveGameId(f.store),second,'Testhistoria får inte återställa Live-markeringen');
    setLiveGame(f.store,f.gm,null);assert.equal(listGames(f.store,f.player(0)).length,0);assert.ok(listGames(f.store,f.gm).length>=2);
    const live=createGame(f.store,f.gm,'Skarpt','live',demoState(f.store,8));assert.equal(liveGameId(f.store),live);
  }finally{f.store.close();}
});

test('Live-migrering väljer högst ett äldre skarpt parti och bevarar avmarkering efter omstart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'maffia-live-'));const path=join(dir,'game.sqlite');const f=fixture(path);
  try{
    const second=createGame(f.store,f.gm,'Äldre skarpt parti','test',demoState(f.store,8));
    f.store.db.exec("UPDATE games SET mode='live'; DROP TABLE live_game;");f.store.close();
    const migrated=new Store(path);try{const selected=liveGameId(migrated);assert.ok(selected===f.id||selected===second);assert.equal(listGames(migrated,f.gm).filter(g=>g.isLive).length,1);setLiveGame(migrated,f.gm,null);}finally{migrated.close();}
    const reopened=new Store(path);try{assert.equal(liveGameId(reopened),null);assert.equal(listGames(reopened,f.gm).length,2);assert.equal(listGames(reopened,f.player(0)).length,0);}finally{reopened.close();}
  }finally{try{f.store.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});

function setupFixture(){
  const f=fixture();seedLibrary(f.store);const data=setupData(f.store);const template=data.templates.find(t=>t.players===8&&t.name.includes('fyra'))!;const roster=createRoster(f.store,{name:'Testspelare',mode:'test',count:8});return {...f,template,roster};
}

test('biblioteket har CRUD, relationer och mallar med exakt antal roller',()=>{
  const f=fixture();try{
    const group=saveLibrary(f.store,'groups',{name:'Testgrupp',description:'Beskrivning',chat:true});const win=saveLibrary(f.store,'wins',{name:'Vinn',description:'Överlev'});const power=saveLibrary(f.store,'powers',{name:'Fråga',description:'Fråga GM',type:'Text',gmResponse:true});const role=saveLibrary(f.store,'roles',{name:'Ny roll',summary:'Beskrivning',gmHint:'Hemligt',groupId:group,winId:win,powerIds:[power]});
    const data=setupData(f.store);assert.deepEqual(data.roles[0]!.powerIds,[power]);assert.equal(data.groups[0]!.chat,true);assert.equal(data.powers[0]!.gmResponse,true);
    saveLibrary(f.store,'roles',{...data.roles[0],name:'Ändrad roll'},role);assert.equal(setupData(f.store).roles[0]!.name,'Ändrad roll');
    assert.throws(()=>saveLibrary(f.store,'roles',{...data.roles[0],powerIds:[power,power]},role));assert.deepEqual(setupData(f.store).roles[0]!.powerIds,[power]);
    assert.throws(()=>savePartyTemplate(f.store,{name:'Fel antal',players:8,theme:'jungle',roleIds:[role,role,role,role]}));
    const template=savePartyTemplate(f.store,{name:'Fyra roller',players:4,theme:'jungle',roleIds:[role,role,role,role]});assert.equal(setupData(f.store).templates[0]!.roleIds.length,4);
    assert.throws(()=>deleteLibrary(f.store,'roles',role));assert.throws(()=>deleteLibrary(f.store,'powers',power));assert.throws(()=>deleteLibrary(f.store,'wins',win));assert.throws(()=>deleteLibrary(f.store,'groups',group));
    f.store.run('DELETE FROM party_templates WHERE id=?',template);deleteLibrary(f.store,'roles',role);deleteLibrary(f.store,'powers',power);deleteLibrary(f.store,'wins',win);deleteLibrary(f.store,'groups',group);assert.equal(setupData(f.store).roles.length,0);
  }finally{f.store.close();}
});

test('testspelare får fiktiva namn och slumpade PIN medan skarpa konton kan namnges och återanvändas',()=>{
  const f=fixture();try{
    const generated=createRoster(f.store,{name:'Test',mode:'test',count:8});assert.equal(generated.credentials.length,8);assert.equal(new Set(generated.credentials.map(p=>p.id)).size,8);assert.ok(generated.credentials.every(p=>/^\d{6}$/.test(p.pin)));
    const data=JSON.stringify(setupData(f.store));for(const player of generated.credentials){assert.ok(!data.includes(player.pin));const row=f.store.one<{pin_hash:string}>('SELECT pin_hash FROM users WHERE id=?',player.id)!;assert.ok(checkPin(player.pin,row.pin_hash));assert.notEqual(row.pin_hash,player.pin);}
    const roster=createRoster(f.store,{name:'Skarpt',mode:'live'});assert.throws(()=>addRosterPlayer(f.store,roster.id,{name:'Riktig person'}));const player=addRosterPlayer(f.store,roster.id,{name:'Riktig person',pin:'5678'});
    const other=createRoster(f.store,{name:'Nästa kväll',mode:'live'});assert.equal(addRosterPlayer(f.store,other.id,{name:'Riktig person',pin:'9999'}),player);assert.ok(checkPin('5678',f.store.one<{pin_hash:string}>('SELECT pin_hash FROM users WHERE id=?',player)!.pin_hash),'Att återanvända kontot ändrar inte PIN');
    assert.throws(()=>addRosterPlayer(f.store,roster.id,{name:'GM',pin:'4567'}));updatePlayer(f.store,player,{name:'Nytt namn',pin:'8765'});assert.ok(checkPin('8765',f.store.one<{pin_hash:string}>('SELECT pin_hash FROM users WHERE id=?',player)!.pin_hash));assert.throws(()=>updatePlayer(f.store,f.gm.id,{name:'Intrång',pin:'1111'}));
  }finally{f.store.close();}
});

test('rollfördelningen är ett privat utkast, omslumpning och manuellt byte kräver unik fördelning och aktuell revision',()=>{
  const f=setupFixture();try{
    const short=createRoster(f.store,{name:'För få',mode:'test',count:4});assert.throws(()=>prepareGame(f.store,{name:'Fel',templateId:f.template.id,rosterId:short.id}));
    const originalLive=liveGameId(f.store);const key=prepareGame(f.store,{name:'Förberett',templateId:f.template.id,rosterId:f.roster.id});let draft=setupData(f.store).preparations.find(p=>p.id===key)!;
    assert.equal(draft.gameId,null);assert.equal(liveGameId(f.store),originalLive);assert.ok(draft.state.roles.every(r=>r.alive&&!r.notes));assert.equal(draft.state.rounds[0]!.phase,0);assert.deepEqual(draft.state.messages,[]);assert.equal(new Set(draft.state.roles.map(r=>r.userId)).size,8);
    const first=draft.state.roles[0]!,second=draft.state.roles[1]!;const assignments=draft.state.roles.map(r=>({roleId:r.id,userId:r.id===first.id?second.userId:r.id===second.id?first.userId:r.userId}));
    changeAssignment(f.store,key,draft.revision,assignments);assert.throws(()=>changeAssignment(f.store,key,draft.revision));draft=setupData(f.store).preparations.find(p=>p.id===key)!;assert.equal(draft.state.roles[0]!.userId,second.userId);assert.equal(draft.state.roles[1]!.userId,first.userId);
    assert.throws(()=>changeAssignment(f.store,key,draft.revision,assignments.map(a=>({...a,userId:first.userId}))));assert.throws(()=>changeAssignment(f.store,key,draft.revision,assignments.map(a=>({...a,roleId:first.id}))));
    changeAssignment(f.store,key,draft.revision);const shuffled=setupData(f.store).preparations.find(p=>p.id===key)!;assert.equal(new Set(shuffled.state.roles.map(r=>r.userId)).size,8);assert.equal(new Set(shuffled.state.roles.map(r=>r.id)).size,8);assert.equal(liveGameId(f.store),originalLive);
    for(const room of shuffled.state.rooms.filter(r=>r.kind==='gm'))assert.equal(room.name,shuffled.state.roles.find(r=>r.id===room.roleIds[0])!.player);
  }finally{f.store.close();}
});

test('godkännande gör ett parti Live, malländringar påverkar inte kopian, nollställning bevarar hela det gamla partiet',()=>{
  const f=setupFixture();try{
    const key=prepareGame(f.store,{name:'Runda igen',templateId:f.template.id,rosterId:f.roster.id});let draft=setupData(f.store).preparations.find(p=>p.id===key)!;const snapshot=JSON.stringify(draft.state);
    const source=setupData(f.store).roles.find(r=>r.id===f.template.roleIds[0])!;saveLibrary(f.store,'roles',{...source,name:'Ny biblioteksroll'},source.id);assert.equal(JSON.stringify(setupData(f.store).preparations.find(p=>p.id===key)!.state),snapshot);
    assert.throws(()=>approvePreparation(f.store,f.gm,key,draft.revision));const approved=approvePreparation(f.store,f.gm,key,draft.revision,true);assert.equal(liveGameId(f.store),approved.gameId);assert.equal(loadGame(f.store,approved.gameId).state.roles[0]!.name,draft.state.roles[0]!.name);assert.equal(listGames(f.store,f.gm).filter(g=>g.isLive).length,1);
    draft=setupData(f.store).preparations.find(p=>p.id===key)!;assert.throws(()=>changeAssignment(f.store,key,draft.revision));assert.throws(()=>approvePreparation(f.store,f.gm,key,draft.revision));
    const role=loadGame(f.store,approved.gameId).state.roles[0]!;setNotes(f.store,approved.gameId,f.gm,'Gammal hemlighet');setRoleFlags(f.store,approved.gameId,f.gm,role.id,{notes:'Föremål'});const oldCount=f.store.one<{n:number}>('SELECT count(*) n FROM revisions WHERE game_id=?',approved.gameId)!.n;
    resetPreparation(f.store,f.gm,key,draft.revision);assert.equal(liveGameId(f.store),null);assert.equal(loadGame(f.store,approved.gameId).state.roles[0]!.notes,'Föremål');assert.ok(f.store.one<{n:number}>('SELECT count(*) n FROM revisions WHERE game_id=?',approved.gameId)!.n>=oldCount);
    draft=setupData(f.store).preparations.find(p=>p.id===key)!;assert.equal(draft.gameId,null);const restarted=approvePreparation(f.store,f.gm,key,draft.revision);assert.notEqual(restarted.gameId,approved.gameId);assert.equal(loadGame(f.store,restarted.gameId).state.rounds[0]!.notes,'');assert.equal(loadGame(f.store,restarted.gameId).state.roles[0]!.notes,'');assert.equal(loadGame(f.store,restarted.gameId).state.rounds[0]!.phase,0);
  }finally{f.store.close();}
});

test('ändrad spelarlista blockerar godkännande utan att byta Live-parti',()=>{
  const f=setupFixture();try{
    const key=prepareGame(f.store,{name:'Utkast',templateId:f.template.id,rosterId:f.roster.id});const draft=setupData(f.store).preparations.find(p=>p.id===key)!;const current=liveGameId(f.store);const player=draft.state.roles[0]!;updatePlayer(f.store,player.userId,{name:'Namn ändrat efter granskning'});assert.throws(()=>approvePreparation(f.store,f.gm,key,draft.revision,true));assert.equal(liveGameId(f.store),current);assert.equal(setupData(f.store).preparations.find(p=>p.id===key)!.gameId,null);
  }finally{f.store.close();}
});

test('HTTP: hela förberedelseflödet är GM-skyddat och spelare ser roller först efter godkännande',async()=>{
  const f=fixture();seedLibrary(f.store);const server=createApp(f.store).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;const abort=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  async function call(path:string,cookie='',method='GET',body?:unknown){return fetch(base+'/api'+path,{method,headers:{cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
  async function login(name:string,pin:string){const res=await call('/login','','POST',{name,pin});assert.equal(res.status,200);return res.headers.get('set-cookie')!.split(';')[0]!;}
  try{
    assert.equal((await call('/setup')).status,401);const gmCookie=await login('GM','2468');const oldPlayer=await login('Alex','1101');assert.equal((await call('/setup',oldPlayer)).status,403);assert.equal((await call('/setup/library/roles',oldPlayer,'POST',{})).status,403);
    const group=await call('/setup/library/groups',gmCookie,'POST',{name:'HTTP-grupp',chat:true});assert.equal(group.status,201);const groupId=(await group.json()).id;assert.equal((await call('/setup/library/groups/'+groupId,gmCookie,'PUT',{name:'Ändrad grupp',chat:false})).status,200);assert.equal((await call('/setup/library/groups/'+groupId,gmCookie,'DELETE')).status,200);
    const library=await(await call('/setup',gmCookie)).json();assert.ok(library.roles.length>=25);assert.ok(!JSON.stringify(library).includes('pin_hash'));
    const templateResponse=await call('/setup/templates',gmCookie,'POST',{name:'Fyra HTTP-roller',players:4,theme:'jungle',roleIds:library.roles.slice(0,4).map((r:{id:string})=>r.id)});assert.equal(templateResponse.status,201);const templateId=(await templateResponse.json()).id;
    const rosterResponse=await call('/setup/rosters',gmCookie,'POST',{name:'Fyra HTTP-spelare',mode:'test',count:4});assert.equal(rosterResponse.status,201);const rosterResult=await rosterResponse.json();const person=rosterResult.credentials[0];let playerCookie=await login(person.name,person.pin);assert.deepEqual(await(await call('/games',playerCookie)).json(),[]);
    const preparation=await call('/setup/preparations',gmCookie,'POST',{name:'HTTP-start',templateId,rosterId:rosterResult.id});assert.equal(preparation.status,201);const preparationId=(await preparation.json()).id;let draft=setupData(f.store).preparations.find(p=>p.id===preparationId)!;
    assert.equal((await call('/setup/preparations/'+preparationId+'/approve',playerCookie,'POST',{revision:draft.revision,replaceLive:true})).status,403);assert.deepEqual(await(await call('/games',playerCookie)).json(),[]);assert.equal((await call('/games/'+f.id+'/live',gmCookie,'PUT',{enabled:true})).status,409,'Gamla API:t får inte kringgå granskning');assert.equal((await call('/games',gmCookie,'POST',{name:'Kringgå',size:4,mode:'live'})).status,400);
    const stream=await fetch(base+'/api/events',{headers:{cookie:playerCookie},signal:abort.signal});reader=stream.body!.getReader();await reader.read();
    assert.equal((await call('/setup/preparations/'+preparationId+'/approve',gmCookie,'POST',{revision:draft.revision})).status,409);
    assert.equal((await call('/setup/preparations/'+preparationId+'/shuffle',gmCookie,'POST',{revision:draft.revision})).status,200);assert.equal((await call('/setup/preparations/'+preparationId+'/approve',gmCookie,'POST',{revision:draft.revision,replaceLive:true})).status,409);draft=setupData(f.store).preparations.find(p=>p.id===preparationId)!;
    const approval=await call('/setup/preparations/'+preparationId+'/approve',gmCookie,'POST',{revision:draft.revision,replaceLive:true});assert.equal(approval.status,200);const gameId=(await approval.json()).gameId;
    const notice=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('Saknar Live-notis')),3000);timer.unref();})]);assert.match(new TextDecoder().decode(notice.value),/event: catalog/);
    assert.deepEqual((await(await call('/games',playerCookie)).json()).map((g:{id:string})=>g.id),[gameId]);const view=await(await call('/games/'+gameId,playerCookie)).json();assert.equal(view.roles.length,1);assert.equal(view.roles[0].userId,person.id);assert.equal(view.game.phase,0);
    assert.equal((await call('/games/'+f.id,playerCookie)).status,403);assert.equal((await call('/games/'+f.id+'/events',playerCookie)).status,403);assert.equal((await call('/setup',playerCookie)).status,403);
    const personalRoom=view.rooms.find((r:{kind:string})=>r.kind==='gm');assert.equal((await call(`/games/${gameId}/rooms/${personalRoom.id}/messages`,playerCookie,'POST',{body:'Hej från nya kontot',clientId:randomUUID()})).status,200);
    assert.equal((await call('/setup/players/'+person.id,gmCookie,'PUT',{name:person.name,pin:'1234567'})).status,200);assert.equal((await(await call('/session',playerCookie)).json()).user,null);playerCookie=await login(person.name,'1234567');
    draft=setupData(f.store).preparations.find(p=>p.id===preparationId)!;assert.equal((await call('/setup/preparations/'+preparationId+'/reset',gmCookie,'POST',{revision:draft.revision})).status,200);assert.deepEqual(await(await call('/games',playerCookie)).json(),[]);assert.equal(readMessages(f.store,gameId,f.gm,personalRoom.id)[0]!.body,'Hej från nya kontot');assert.equal((await call('/games/'+gameId,gmCookie)).status,200);
  }finally{abort.abort();await reader?.cancel().catch(()=>{});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));f.store.close();}
});

test('skarpt förberett parti kräver namngivna konton och godkännande och tillåter inte testnavigering',()=>{
  const f=fixture();seedLibrary(f.store);try{
    const data=setupData(f.store);const template=savePartyTemplate(f.store,{name:'Fyra skarpa roller',players:4,theme:'classic',roleIds:data.roles.slice(0,4).map(role=>role.id)});const roster=createRoster(f.store,{name:'Riktiga deltagare',mode:'live'});
    for(const name of ['Ada Andersson','Bertil Berg','Cecilia Carlsson','David Dahl'])addRosterPlayer(f.store,roster.id,{name,pin:'5678'});
    const preparation=prepareGame(f.store,{name:'Skarpa kvällen',templateId:template,rosterId:roster.id});const draft=setupData(f.store).preparations.find(p=>p.id===preparation)!;assert.equal(draft.gameId,null);assert.equal(draft.mode,'live');assert.equal(liveGameId(f.store),f.id);
    const result=approvePreparation(f.store,f.gm,preparation,draft.revision,true);const view=gameView(f.store,result.gameId,f.gm);assert.equal(view.game.mode,'live');assert.equal(view.game.isLive,true);assert.equal(view.game.theme,'classic');assert.equal(view.canUndo,false);assert.deepEqual(new Set(view.roles.map(role=>role.player)),new Set(['Ada Andersson','Bertil Berg','Cecilia Carlsson','David Dahl']));assert.throws(()=>navigate(f.store,result.gameId,f.gm,'back',view.revision));
  }finally{f.store.close();}
});
