// Helper for heroes-only-reset.test.js (not a test file itself).
// Drives the real public resetGame headlessly: importing game.js leaves the
// process unable to exit on its own under node --test, so this runs in a
// child process and terminates explicitly; the test asserts its exit code.
import { register } from 'node:module';

register('./node-esm-hooks.mjs', import.meta.url);
import * as THREE from 'three';

globalThis.window = { addEventListener() {}, _currentMapKey: 'arena' };
const fakeCanvas = { style: {} };
globalThis.document = { getElementById: (id) => (id === 'renderCanvas' ? fakeCanvas : null) };

const sceneMod = await import('../src/scene.js');
const headlessScene = new THREE.Scene();
headlessScene._registerShadows = () => {};
sceneMod.__setSceneCameraForTests(headlessScene, { target: new THREE.Vector3() });

const { setModelSource } = await import('../src/model-source.js');
setModelSource('glb');
const factions = await import('../src/factions.js');
// Stand-ins for loaded GLB containers (real load needs fetch + GL); the
// soldier-slot lookup under test is identical either way.
for (const key of factions.ARENA_POSITION_FACTIONS) {
  factions.factionContainers[key].soldier = { scene: new THREE.Group(), animations: [], _hiddenNodes: null };
  factions.factionContainers[key].worker = { scene: new THREE.Group(), animations: [], _hiddenNodes: null };
}

const game = await import('../src/game.js');
const hero = await import('../src/hero.js');
// Stand-in hero container so the lineup spawn path is exercised headlessly.
await hero.loadHero('axe', {
  loadModel: async () => ({ scene: new THREE.Group(), animations: [] }),
});

const EMPTY_TAGS = ['squad', 'soldier', 'builder', 'building', 'structure', 'strategicPoint', 'vehicle', 'airfield', 'jet'];

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
  // Heroes-only scene: no units, buildings or points may exist after reset.
  for (const tag of EMPTY_TAGS) {
    check(world.query(tag).length === 0, `no ${tag} entities spawned`);
  }
  const axe = hero.getHero('axe');
  check(!!axe, 'axe hero spawned in lineup');
  check(axe && axe.root.parent !== null, 'axe hero attached to scene');

  for (let i = 0; i < 30; i++) world.tick(1 / 60);
  for (const tag of EMPTY_TAGS) {
    check(world.query(tag).length === 0, `still no ${tag} entities after 30 ticks`);
  }
  check(!!hero.getHero('axe'), 'axe hero persists after 30 ticks');
}

// The procedural Dota map lives on its own map pick: 18 towers on dota,
// nothing on the default arena.
const dota = await import('../src/dota.js');
globalThis.window._currentMapKey = 'dota';
game.resetGame('dota');
check(dota.dotaTowers().length === 18, 'dota map builds 18 towers');
check(!!hero.getHero('axe'), 'axe hero spawned on dota map');
globalThis.window._currentMapKey = 'arena';
game.resetGame('arena');
check(dota.dotaTowers().length === 0, 'arena stays clean of dota map');
check(!!hero.getHero('axe'), 'axe hero spawned on arena');

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all headless resetGame checks passed');
process.exit(0);
