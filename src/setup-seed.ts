import type { Store } from './db.ts';
import { demoState, richDemoState } from './demo.ts';
import { saveLibrary, savePartyTemplate } from './setup.ts';
import type { GameState } from './contracts.ts';

// Seed fixed example definitions; no export-from-game workflow is exposed.
export function seedLibrary(store:Store){
  if(store.one('SELECT id FROM library_roles LIMIT 1'))return;
  store.transaction(()=>{
    const groups=new Map<string,string>(),wins=new Map<string,string>(),powers=new Map<string,string>();
    function importDefinitions(state:GameState,suffix=''){
      return state.roles.map(role=>{
        let group=groups.get(role.team);if(!group){group=saveLibrary(store,'groups',{name:role.team,description:'',chat:state.rooms.some(room=>room.kind==='group'&&room.roleIds.includes(role.id))});groups.set(role.team,group);}
        let win=wins.get(role.win);if(!win){win=saveLibrary(store,'wins',{name:`${role.team} · vinstvillkor`,description:role.win});wins.set(role.win,win);}
        const powerIds=role.powers.map(({id,...power})=>{const signature=JSON.stringify(power);let key=powers.get(signature);if(!key){key=saveLibrary(store,'powers',{...power,shared:Boolean(power.groupId)});powers.set(signature,key);}return key;});
        return saveLibrary(store,'roles',{name:role.name+suffix,summary:role.summary,gmHint:role.gmHint,groupId:group,winId:win,powerIds});
      });
    }
    const regular=importDefinitions(demoState(store,25));const rich=importDefinitions(richDemoState(store),' · fyra grupper');
    savePartyTemplate(store,{name:'Djungeln · 8 spelare',players:8,theme:'jungle',roleIds:regular.slice(0,8)});
    savePartyTemplate(store,{name:'Djungeln · 8 spelare, fyra grupper',players:8,theme:'jungle',roleIds:rich});
    savePartyTemplate(store,{name:'Djungeln · 25 spelare',players:25,theme:'jungle',roleIds:regular});
  });
}
