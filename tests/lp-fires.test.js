import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.window = { _multiplayerMode: false };
globalThis.document = { getElementById: () => null, querySelector: () => null };
const state = await import('../src/core/scene.js');
const scene = new THREE.Scene();
scene._registerShadows = () => {};
state.__setSceneCameraForTests(scene, { target: new THREE.Vector3() });
const { World } = await import('../src/core/ecs.js');
const { makeHpBar } = await import('../src/meshes.js');
const entities = await import('../src/entities/entities.js');
const systems = await import('../src/core/systems.js');

function fixture(tier) {
  const world = new World();
  state.setWorld(world);
  const pid = world.createEntity([]);
  world.add(pid, 'strategicPoint', {
    position: new THREE.Vector3(0, 0, 0), owner: 'blue',
    hasListeningPost: true, lpTier: tier, captureRadius: 4.5,
  });
  const bid = world.createEntity([]);
  world.add(bid, 'building', {
    type: 'listening_post', team: 'blue', faction: 'ig',
    position: new THREE.Vector3(0, 0, 0), hp: 400, maxHp: 400,
    constructing: false, pendingWorker: false, queue: [],
    strategicPointId: pid,
  });
  world.add(bid, 'mesh', { root: new THREE.Group(), hpBar: makeHpBar(4, 'blue') });
  entities.createSquadEntity(world, 'red', 10, 0, 3, null, 'chaos');
  return world;
}

it('an unfortified post holds fire', () => {
  const world = fixture(1);
  for (let tick = 0; tick < 20; tick++) systems.systemBuilding(world, 0.1);
  assert.equal(world.query('bullet').length, 0);
});

it('a tier 2 post fires its bolters', () => {
  const world = fixture(2);
  for (let tick = 0; tick < 20 && world.query('bullet').length === 0; tick++) {
    systems.systemBuilding(world, 0.1);
  }
  assert.ok(world.query('bullet').length > 0, 'LP2 shoots enemies in range');
});

it('a tier 3 post keeps firing', () => {
  const world = fixture(3);
  for (let tick = 0; tick < 20 && world.query('bullet').length === 0; tick++) {
    systems.systemBuilding(world, 0.1);
  }
  assert.ok(world.query('bullet').length > 0, 'LP3 shoots enemies in range');
});
