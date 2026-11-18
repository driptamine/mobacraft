// Helper for local-match-spawn.test.js (not a test file itself).
// Drives the real public resetGame headlessly: importing game.js leaves the
// process unable to exit on its own under node --test, so this runs in a
// child process and terminates explicitly; the test asserts its exit code.
import { register } from 'node:module';

register('./node-esm-hooks.mjs', import.meta.url);
import * as THREE from 'three';

globalThis.window = { addEventListener() {}, _currentMapKey: 'arena' };
const fakeCanvas = { style: {} };
globalThis.document = { getElementById: (id) => (id === 'renderCanvas' ? fakeCanvas : null) };

const sceneMod = await import('../src/core/scene.js');
const headlessScene = new THREE.Scene();
headlessScene._registerShadows = () => {};
sceneMod.__setSceneCameraForTests(headlessScene, { target: new THREE.Vector3() });

const factions = await import('../src/factions.js');
// Stand-ins for loaded GLB containers (real load needs fetch + GL); the
// soldier-slot lookup under test is identical either way.
for (const key of factions.ARENA_POSITION_FACTIONS) {
  factions.factionContainers[key].soldier = { scene: new THREE.Group(), animations: [], _hiddenNodes: null };
  factions.factionContainers[key].worker = { scene: new THREE.Group(), animations: [], _hiddenNodes: null };
}

const game = await import('../src/core/game.js');


const { makeLocalMatch, setLocalMatch } = await import('../src/core/local-match.js');
const { createLobby, setLobbySlot } = await import('../src/net/lobbies.js');
const { systemAI } = await import('../src/systems/meta.js');
const assert = (await import('node:assert/strict')).default;
const lobby = createLobby({total:6});
lobby.players[0].faction='Imperial Guard';
setLobbySlot(lobby,3,{username:'Computer 4',faction:'Tau',team:2,ping:0,controller:'computer'});
const config=makeLocalMatch(lobby,'/maps/6p_alvarus/6p_alvarus.sgb');
setLocalMatch(config);window._currentMapKey=config.mapKey;
game.resetGame(config.mapKey);
let world=sceneMod.world;
assert.equal(world.query('building').length,2);
assert.equal(sceneMod.requisition,1000);assert.equal(sceneMod.energy,100);
// Check rendered ECS positions, including the camera, rather than just the planner.
const basePositions=world.query('building').map(id=>world.get(id,'mesh').root.position);
assert.ok(basePositions.some(p=>Math.abs(p.x-14.76)<.01 && Math.abs(p.z+102.98)<.01));
assert.ok(basePositions.some(p=>Math.abs(p.x+5.38)<.01 && Math.abs(p.z-114.06)<.01));
assert.equal(sceneMod.camera.target.x,14.76);
assert.equal(sceneMod.camera.target.z,-102.98);

assert.equal(world.query('squad').length,0,'no free combat squads at match start');
assert.equal(world.query('soldier').length,0);
assert.equal(world.query('builder').length,2);
assert.equal(world.query('builder','computer').length,1);
// AI must order normal production before it can command an army.
for(let tick=0;tick<400;tick++)world.tick(.1);
assert.ok(world.query('squad','computer').length>0,'computer builds an army from its worker/HQ start');
for(const id of world.query('squad')){
  assert.equal(world.get(id,'squad').faction,'tau','human receives no unrequested units');
  assert.ok(world.has(id,'computer'));
}
setLobbySlot(lobby,0,{username:'Computer 1',faction:'Necrons',team:1,ping:0,controller:'computer'});
setLocalMatch(makeLocalMatch(lobby,config.mapKey));game.resetGame(config.mapKey);
world=sceneMod.world;
assert.equal(world.query('squad').length,0);
assert.equal(world.query('builder','computer').length,2);
assert.equal(sceneMod.canCommand('blue'),false);
assert.equal(sceneMod.canCommand('red'),false);
setLocalMatch(null);
assert.equal(sceneMod.canCommand('blue'),true);
// Every default map starts with HQs/workers only, across all its race slots.
for(const mapKey of ['arena','/maps/6p_alvarus/6p_alvarus.sgb','/maps/4p_into_the_breach/4p_into_the_breach.sgb']){
  window._currentMapKey=mapKey;game.resetGame(mapKey);world=sceneMod.world;
  assert.equal(world.query('squad').length,0,mapKey);
  assert.equal(world.query('soldier').length,0,mapKey);
  assert.equal(world.query('builder').length,world.query('building').length);
}
console.log('Local match: worker-only starts, normal AI production, stable slots and spectator checks passed');
process.exit(0);
