import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/db.ts';
import { addUser } from '../src/auth.ts';
import { demoState, richDemoState, seedRichDemo } from '../src/demo.ts';
import { createGame, gameView, loadGame, setPhase as guardedSetPhase, PhaseChangeBlocked, setRoleFlags, submitAction, setResponse, enablePower, advanceRound, actionKey, navigate, jumpToRevision, postMessage, readMessages, markRead, recordDeath, setNotes, confirmKill, recordDayOutcome, parseState } from '../src/game.ts';
import { broadcast, startCountdown, tickCountdowns } from '../src/broadcast.ts';
import { gameLog } from '../src/log.ts';
import { createApp } from '../src/app.ts';
import type { User } from '../src/contracts.ts';
import { phaseReadiness } from '../src/readiness.ts';

// Existing history/auth scenarios deliberately move past incomplete phases.
// Exercise the same explicit acknowledgement that GM now uses in the UI.
function setPhase(...args:Parameters<typeof guardedSetPhase>){try{return guardedSetPhase(...args);}catch(e){if(!(e instanceof PhaseChangeBlocked))throw e;return guardedSetPhase(args[0],args[1],args[2],args[3],{overrideToken:e.guard.token});}}

function fixture(path=':memory:',size=8) {
  const store=new Store(path); const gm=addUser(store,'GM','2468',true); const state=demoState(store,size); const id=createGame(store,gm,'Test','test',state);
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
    const live=createGame(f.store,f.gm,'Live','live',demoState(f.store,4));assert.throws(()=>jumpToRevision(f.store,live,f.gm,loadGame(f.store,live).revision.id));
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
