import * as THREE from 'three';
import assert from 'node:assert/strict';
globalThis.window = { addEventListener() {}, _currentMapKey: '/maps/4p_doom_spiral/4p_doom_spiral.sgb' };
const canvas = { style: {} };
globalThis.document = { getElementById: (id) => id === 'renderCanvas' ? canvas : null, querySelector: () => null };
const core = await import('../src/core/scene.js');
const scene = new THREE.Scene(); scene._registerShadows = () => {};
core.__setSceneCameraForTests(scene, { target: new THREE.Vector3() });
const { factionContainers } = await import('../src/factions.js');
const { setLocalMatch } = await import('../src/core/local-match.js');
const { laneCreeps } = await import('../stats/races/dota/creeps.js');
for (const creep of laneCreeps) factionContainers.ig.units[creep.name] = { scene: new THREE.Group(), animations: [] };
const { resetGame } = await import('../src/core/game.js');
resetGame();
let world = core.world;
const factions = () => world.query('building').map(id => world.get(id, 'building').faction).sort();
assert.deepEqual(factions(), ['ig', 'ig']);
assert.equal(world.query('builder').length, 0);
assert.equal(world.query('strategicPoint').length, 0);
assert.equal(world.query('squad').length, 30, 'only creep squads, no free heroes or race infantry');
for (const id of world.query('building')) {
  const base = world.get(id, 'building');
  assert.equal(base.heroBase, true);
  assert.deepEqual(base.production, []);
  assert.equal(world.get(id, 'mesh').root.children.filter(child => child.isMesh).length, 1, 'one flat square');
  assert.equal(world.get(id, 'mesh').root.children.find(child => child.isMesh).geometry.type, 'PlaneGeometry');
}
const red = world.query('building').find(id => world.get(id, 'building').team === 'red');
const blue = world.query('building').find(id => world.get(id, 'building').team === 'blue');
assert.equal(world.get(blue, 'building').position.x, 101.87);
assert.equal(world.get(blue, 'building').position.z, 107.57);
assert.equal(world.get(red, 'building').position.x, -101.87);
assert.equal(world.get(red, 'building').position.z, -89.58);
assert.equal(world.query('laneCreep').length, 30);
assert.equal(world.query('creepSpawner').length, 1);
assert.equal(core.camera.target.x, 101.87);
assert.equal(core.camera.target.z, 107.57);
setLocalMatch({ mapKey: window._currentMapKey, seats: [
  { slot: 0, faction: 'ig', team: 'blue', computer: false },
  { slot: 1, faction: 'orks', team: 'blue', computer: true },
  { slot: 2, faction: 'chaos', team: 'red', computer: true },
  { slot: 3, faction: 'space marines', team: 'red', computer: true },
] });
const old = world;
resetGame(); world = core.world;
assert.deepEqual(factions(), ['ig', 'ig']);
assert.equal(world.query('laneCreep').length, 30);
assert.equal(old.get(old.query('creepSpawner')[0], 'creepSpawner').active, false);
assert.equal(world.query('building', 'computer').length, 0, 'no RTS computer bases');
for (let i = 0; i < 100; i++) world.tick(.05);
assert.equal(world.query('building').length, 2, 'race AI cannot add buildings');
assert.equal(world.query('builder').length, 0);
assert.ok(world.query('squad').every(id => world.has(id, 'laneCreep')));
setLocalMatch(null);
window._currentMapKey = 'arena'; resetGame('arena'); world = core.world;
assert.equal(world.query('creepSpawner').length, 0);
assert.equal(world.query('laneCreep').length, 0);
assert.ok(world.query('building').length > 2);
window._currentMapKey = '/maps/4p_doom_spiral/4p_doom_spiral.sgb'; resetGame(); world = core.world;
assert.equal(world.query('creepSpawner').length, 1);
assert.equal(world.query('laneCreep').length, 30);
console.log('Doom Spiral: two flat squares at original starts, no race units, three lanes and clean resets');
process.exit(0);
