import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';

globalThis.window = { addEventListener() {}, _currentMapKey: '/maps/dotamap-game/map.json' };
const canvas = { style: {} };
globalThis.document = { getElementById: id => id === 'renderCanvas' ? canvas : null, querySelector: () => null };
const core = await import('../src/core/scene.js');
const { World } = await import('../src/core/ecs.js');
const { factionContainers } = await import('../src/factions.js');
const { laneCreeps } = await import('../stats/races/dota/creeps.js');
const { DOTA_MAP_KEY, dotaMapConfig } = await import('../src/maps/dota-map-layout.js');
const { sampleDotaHeight } = await import('../src/maps/dota-surface.js');
const { _snapTerrainBegin } = await import('../src/systems/terrain.js');
const surface = JSON.parse(fs.readFileSync('maps/dotamap-game/surface.json'));

function fixture() {
  const scene = new THREE.Scene(); scene._registerShadows = () => {};
  core.__setSceneCameraForTests(scene, { target: new THREE.Vector3() });
  const world = new World(); core.setWorld(world);
  for (const creep of laneCreeps) factionContainers.ig.units[creep.name] = { scene: new THREE.Group(), animations: [] };
  const ground = new THREE.Group(); ground.updateMatrixWorld(true);
  window.__sgbTerrainRoot = ground;
  window.__sgbSampleHeight = (x, z) => sampleDotaHeight(surface, x, z);
  window.__sgbPassGrid = surface;
  _snapTerrainBegin();
}

const { resetGame } = await import('../src/core/game.js');
fixture();
resetGame(DOTA_MAP_KEY);
const world = core.world;
assert.equal(world.query('building').length, 2);
assert.ok(world.query('building').every(id => world.get(id, 'building').heroBase));
assert.equal(world.query('builder').length, 0);
assert.equal(world.query('strategicPoint').length, 0);
assert.equal(world.query('laneCreep').length, 30);
assert.equal(core.camera.alpha, Math.PI);
assert.equal(core.camera.beta, Math.PI / 6);
assert.equal(core.camera.target.x, dotaMapConfig.positions[0].x);
assert.equal(core.camera.target.z, dotaMapConfig.positions[0].z);
assert.ok(core.camera.target.y > 9);

const { setLocalMatch } = await import('../src/core/local-match.js');
for (const name of ['drow', 'axe']) factionContainers.ig.units[name] = { scene: new THREE.Group(), animations: [] };
setLocalMatch({ mapKey: DOTA_MAP_KEY, seats: [
  { slot: 0, team: 'blue', faction: 'ig', hero: 'drow', computer: false },
  { slot: 1, team: 'red', faction: 'ig', hero: 'axe', computer: true },
] });
resetGame(DOTA_MAP_KEY);
const squads = core.world.query('matchHero', 'squad').map(id => core.world.get(id, 'squad'));
assert.equal(squads.length, 2);
for (const { team, position } of squads) {
  const start = dotaMapConfig.heroStarts[team];
  assert.equal(position.x, start.x);
  assert.equal(position.z, start.z);
}
assert.equal(core.camera.target.x, dotaMapConfig.heroStarts.blue.x);
assert.equal(core.camera.target.z, dotaMapConfig.heroStarts.blue.z);

process.exit(0);
