// Helper for necron-default-spawn.test.js (not a test file itself).
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

function necronSquads(world) {
  return world.query('squad')
    .map((id) => ({ id, c: world.get(id, 'squad') }))
    .filter((s) => s.c.faction === 'necrons');
}

function aliveSoldiers(world, squad) {
  return squad.c.soldiers.filter((sid) => sid !== null && world.has(sid, 'soldier'));
}

let failures = 0;
const check = (cond, label) => {
  console.log(cond ? `  ok - ${label}` : `  FAIL - ${label}`);
  if (!cond) failures += 1;
};

for (const mapKey of ['arena', '/maps/6p_alvarus/6p_alvarus.sgb', '/maps/6p_mortalis/mortalis.sgb']) {
  console.log(`map: ${mapKey}`);
  globalThis.window._currentMapKey = mapKey;
  game.resetGame(mapKey);
  const world = sceneMod.world;

  check(
    factions.FACTIONS.necrons.infantry[1].model === 'models/necrons/infantry/necron_basic_warrior.glb',
    'soldier slot is necron_basic_warrior.glb',
  );
  check(world.query('squad').length === 0, 'reset creates no combat squads');
  const workers=world.query('builder').filter(id=>world.get(id,'builder').faction==='necrons');
  check(workers.length===1, 'Necrons start with one worker');
  // Unit visuals still work when the player orders normal HQ production.
  const hqId=world.query('building').find(id=>world.get(id,'building').faction==='necrons');
  world.get(hqId,'building').queue.push({type:'squad',progress:0,total:3});
  for(let tick=0;tick<70;tick++)world.tick(.05);
  const produced=necronSquads(world);
  check(produced.length===1, 'HQ production creates the requested squad');
  for(const squad of produced){
    check(squad.c.projectileType==='lightning','produced Necrons fire green lightning');
    check(aliveSoldiers(world,squad).length===5,'produced squad has five warriors');
    check(aliveSoldiers(world,squad).every(id=>world.get(id,'mesh').root.name==='faction_soldier_root'),'produced meshes resolve through the soldier slot');
  }
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all headless resetGame checks passed');
process.exit(0);
