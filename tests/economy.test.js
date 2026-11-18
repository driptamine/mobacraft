import { it } from 'node:test';
import assert from 'node:assert/strict';
import { startingResources, pointRequisitionRate } from '../src/core/economy.js';
import { World } from '../src/core/ecs.js';

globalThis.window={};globalThis.document={getElementById:()=>null};
const state=await import('../src/core/scene.js');
const {setPlayerFaction}=await import('../src/factions.js');
const {systemRequisitionIncome}=await import('../src/systems/meta.js');

it('starts every normal race at 1000 requisition and 100 energy and preserves Necrons',()=>{
 for(const faction of ['ig','chaos','space marines','orks','eldar','dark eldar','tau','sob'])assert.deepEqual(startingResources(faction),{requisition:1000,energy:100});
 assert.deepEqual(startingResources('necrons'),{requisition:1500,energy:100});
});
it('uses exactly 6/12/18/24 for a point and LP levels 1/2/3',()=>{
 assert.deepEqual([0,1,2,3].map(lpTier=>pointRequisitionRate({lpTier,hasListeningPost:lpTier>0})),[6,12,18,24]);
});
it('income ticks agree with HUD rates for every LP tier',()=>{
 setPlayerFaction('ig');state.setPlayerTeam('blue');window._currentMapKey='arena';
 for(const tier of [null,0,1,2,3]){
  const world=new World();state.setWorld(world);const hq=world.createEntity([]);world.add(hq,'building',{type:'hq',team:'blue',faction:'ig',constructing:false});
  const expectedRate=20+(tier==null?0:[6,12,18,24][tier]);
  if(tier!=null){const point=world.createEntity([]);world.add(point,'strategicPoint',{owner:'blue',lpTier:tier,hasListeningPost:tier>0});}
  state.setRequisition(1000);state.counters.baseReqT=0;
  assert.equal(state.getRequisitionRate(world),expectedRate);systemRequisitionIncome(world,10);assert.equal(state.requisition,1000+expectedRate);
 }
});
it('another race HQ on the same sandbox team does not multiply the starting rate',()=>{
 const world=new World();state.setWorld(world);setPlayerFaction('ig');state.setPlayerTeam('blue');
 for(const faction of ['ig','orks','necrons','tau']){const id=world.createEntity([]);world.add(id,'building',{type:'hq',faction,team:'blue',constructing:false});}
 assert.equal(state.getRequisitionRate(world),20);setPlayerFaction('orks');assert.equal(state.getRequisitionRate(world),20);setPlayerFaction('ig');
});
it('starts energy at 100 with zero income and caps generators at 6 per HQ',()=>{
 setPlayerFaction('ig');state.setPlayerTeam('blue');window._currentMapKey='arena';
 const world=new World();state.setWorld(world);
 assert.equal(state.getPowerRate(world),0);
 const hq=world.createEntity([]);world.add(hq,'building',{type:'hq',team:'blue',faction:'ig',constructing:false});
 assert.equal(state.getPowerRate(world),0);
 const gens=[];for(let i=0;i<8;i++){const id=world.createEntity([]);world.add(id,'structure',{type:'thermo_generator',team:'blue',constructing:false,pendingWorker:false});gens.push(id);}
 assert.equal(state.getPowerRate(world),60);
 assert.deepEqual([...state.powerCreditIds(world)].sort((a,b)=>a-b),gens.slice(0,6));
 const hq2=world.createEntity([]);world.add(hq2,'building',{type:'hq',team:'blue',faction:'ig',constructing:false});
 assert.equal(state.getPowerRate(world),80);
 world.get(hq,'building').constructing=true;world.get(hq2,'building').constructing=true;
 assert.equal(state.getPowerRate(world),0);
});
