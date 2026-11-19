import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.window = { addEventListener() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null };
const { loadStartupModels } = await import('../src/core/startup-models.js');
const { factionContainers, loadFactionUnitModel } = await import('../src/factions.js');
const { heroRoster } = await import('../stats/races/heroes.js');
const { World } = await import('../src/core/ecs.js');
const core = await import('../src/core/scene.js');
const { createHeroBase } = await import('../src/entities/hero-base.js');
const { worldFootprint } = await import('../src/core/structure-footprint.js');
const { productionSpawnPoint } = await import('../src/systems/structures.js');
const { buildingEngageRadius } = await import('../src/systems/combat.js');

test('startup fetches six creeps and none of the races or 115 available heroes', async () => {
  const requests = [], progress = [];
  const loadModel = async url => { requests.push(url); return { scene: new THREE.Group(), animations: [] }; };
  const hooks = { loadModel, onProgress: event => progress.push(event) };
  await loadStartupModels('/maps/4p_doom_spiral/4p_doom_spiral.sgb', hooks);
  assert.deepEqual(requests.sort(), [
    'batches/creeps-lane/final/dire-melee.glb',
    'batches/creeps-lane/final/dire-ranged.glb',
    'batches/creeps-lane/final/dire-siege.glb',
    'batches/creeps-lane/final/radiant-melee.glb',
    'batches/creeps-lane/final/radiant-ranged.glb',
    'batches/creeps-lane/final/radiant-siege.glb',
  ]);
  assert.equal(progress.length, 6);
  assert.equal(progress.at(-1).loaded, 6);
  assert.equal(progress.at(-1).total, 6);
  for (const [race, bucket] of Object.entries(factionContainers)) {
    for (const role of ['hq', 'worker', 'soldier']) assert.equal(bucket[role], null, `${race} ${role} remains unloaded`);
    assert.equal(Object.keys(bucket.structures).length, 0);
    assert.equal(Object.keys(bucket.vehicles).length, 0);
  }
  for (const hero of heroRoster.filter(hero => hero.available)) {
    assert.equal(hero.lazyLoad, true, `${hero.name} is lazy, including batch 1`);
    assert.equal(factionContainers.ig.units[hero.name], undefined);
  }
  await loadStartupModels('arena', hooks);
  await loadStartupModels('/maps/4p_doom_spiral/4p_doom_spiral.sgb', hooks);
  assert.equal(requests.length, 6, 'cached creeps are reused and other maps do not fetch races');
  await loadFactionUnitModel('ig', 'axe', { loadModel });
  assert.equal(requests.length, 7, 'the first hero is fetched on selection');
  assert.ok(requests.includes('batches/1/final/axe-combined.glb'));
  assert.equal(factionContainers.ig.units.juggernaut, undefined);
});

test('base squares ignore loaded HQ templates and use a centered footprint', () => {
  const scene = new THREE.Scene(); core.__setSceneCameraForTests(scene, { target: new THREE.Vector3() });
  const world = new World(); core.setWorld(world);
  factionContainers.ig.hq = { scene: new THREE.Group(), animations: [] };
  const id = createHeroBase(world, new THREE.Vector3(94.16, 0, -89.58), 'blue');
  const base = world.get(id, 'building'), mesh = world.get(id, 'mesh');
  assert.equal(base.heroBase, true);
  assert.deepEqual(base.production, []);
  assert.equal(mesh._meshFactory, undefined);
  assert.equal(mesh.scaffold, undefined);
  assert.equal(mesh.root.children.find(child => child.isMesh).geometry.type, 'PlaneGeometry');
  assert.deepEqual(worldFootprint(base), { minX: 89.16, maxX: 99.16, minZ: -94.58, maxZ: -84.58 });
  assert.equal(buildingEngageRadius(world, id), 5);
  assert.equal(productionSpawnPoint(base).x, 86.16);
  assert.equal(world.query('builder').length, 0);
  assert.equal(world.query('soldier').length, 0);
  factionContainers.ig.hq = null;
});
