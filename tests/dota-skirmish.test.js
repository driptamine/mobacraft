import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';

globalThis.window = { addEventListener() {}, _currentMapKey: '/maps/dotamap-game/map.json' };
const canvas = { style: {} };
globalThis.document = { getElementById: id => id === 'renderCanvas' ? canvas : null, querySelector: () => null };
const core = await import('../src/core/scene.js');
const { World } = await import('../src/core/ecs.js');
const { factionContainers } = await import('../src/factions.js');
const { laneCreeps } = await import('../stats/races/dota/creeps.js');
const { DOTA_MAP_KEY, dotaMapConfig, dotaMapBases, dotaMapLanes, isDotaMap } = await import('../src/maps/dota-map-layout.js');
const { sampleDotaHeight } = await import('../src/maps/dota-surface.js');
const { _snapTerrainBegin, _groundAt } = await import('../src/systems/terrain.js');
const { startDoomCreeps, systemLaneCreeps } = await import('../src/systems/lane-creeps.js');
const { systemSquad } = await import('../src/systems/squad.js');
const { createHeroBase } = await import('../src/entities/hero-base.js');
const { skirmishMapCards } = await import('../src/ui/maps-menu.js');
const { layoutFor, boundsFor } = await import('../src/maps/map-layout.js');
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
  const bases = dotaMapBases().map(base => ({ ...base, id: createHeroBase(world, new THREE.Vector3(base.x, 0, base.z), base.team) }));
  return { world, bases };
}

test('Skirmish includes Dota once alongside Arena and Doom Spiral', () => {
  const doom = { path: '/maps/4p_doom_spiral/4p_doom_spiral.sgb', url: 'doom', name: 'Doom', players: 4, previewUrl: null };
  const cards = skirmishMapCards([doom]);
  assert.deepEqual(cards.map(c => c.name), ['Default Arena', 'Doom', 'Dota 2']);
  assert.equal(skirmishMapCards(cards.filter(c => c.path)).filter(c => isDotaMap(c.path)).length, 1);
  assert.equal(layoutFor(DOTA_MAP_KEY).positions.length, 2);
  assert.equal(boundsFor(DOTA_MAP_KEY), 280);
  assert.equal(isDotaMap('/maps/4p_doom_spiral/4p_doom_spiral.sgb'), false);
});

test('Dota navigation transposes the real GNV flags into game coordinates', { skip: !fs.existsSync('maps/dotamap/navigation/dota.gnv') }, () => {
  const bytes = fs.readFileSync('maps/dotamap/navigation/dota.gnv');
  const width = bytes.readInt32LE(16), height = bytes.readInt32LE(20);
  assert.equal(surface.grid.sizeX, height);
  assert.equal(surface.grid.sizeZ, width);
  for (let r = 0; r < width; r++) for (let c = 0; c < height; c++) {
    const flags = bytes[32 + c * width + r];
    const open = !!(flags & 1) && !(flags & (2 | 4 | 8));
    assert.equal(surface.rows[r][c] === 2, open);
  }
  for (const base of dotaMapConfig.positions) assert.ok(Math.abs(sampleDotaHeight(surface, base.x, base.z) - base.y) < .2);
  assert.equal(surface.authoritativeWalkability, true);
});

test('Dota waves reuse all six creep types and advance on all authored lanes', async () => {
  const { world, bases } = fixture();
  const routes = dotaMapLanes();
  await startDoomCreeps(world, bases, {}, routes);
  const ids = world.query('laneCreep');
  assert.equal(ids.length, 30);
  assert.deepEqual([...new Set(ids.map(id => world.get(id, 'squad').unitType))].sort(), laneCreeps.map(c => c.name).sort());
  for (const team of ['blue', 'red']) for (const lane of ['top', 'mid', 'bottom']) {
    const units = ids.filter(id => { const c = world.get(id, 'laneCreep'); return c.team === team && c.lane === lane; });
    assert.equal(units.length, 5);
    assert.ok(routes[team][lane].length >= 9);
    for (const id of units) {
      const squad = world.get(id, 'squad');
      assert.equal(core.canCommand(team, id), false);
      assert.ok(squad.position.distanceTo(new THREE.Vector3(routes[team][lane][0].x, 0, routes[team][lane][0].z)) < 16);
    }
  }
  const positions = new Map(ids.map(id => [id, world.get(id, 'squad').position.clone()]));
  world.addSystem(systemLaneCreeps); world.addSystem(systemSquad);
  for (let i = 0; i < 100; i++) world.tick(.05);
  for (const team of ['blue', 'red']) for (const lane of ['top', 'mid', 'bottom']) {
    assert.ok(ids.some(id => { const c = world.get(id, 'laneCreep'); return c.team === team && c.lane === lane && world.get(id, 'squad').position.distanceTo(positions.get(id)) > 3; }), `${team} ${lane} advances`);
  }
  for (const sid of world.query('soldier')) {
    const p = world.get(sid, 'mesh').root.position;
    assert.ok(Math.abs(p.y - _groundAt(p.x, p.z)) < .1);
  }
});

test('Dota reset creates only recruitment squares and creeps, with the Radiant camera', () => {
  const result = spawnSync(process.execPath, ['--import', './tests/register-hooks.mjs', 'tests/dota-skirmish-reset-probe.mjs'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
