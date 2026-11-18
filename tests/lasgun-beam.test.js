import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/core/ecs.js';

globalThis.window = {};
globalThis.document = { getElementById: () => null, querySelector: () => null };
const state = await import('../src/core/scene.js');
const scene = new THREE.Scene(); scene._registerShadows = () => {};
state.__setSceneCameraForTests(scene, { target: new THREE.Vector3() });
const E = await import('../src/entities/entities.js');
const { createLaserBulletEntity } = await import('../src/entities/entities.js');
const { systemBeam } = await import('../src/systems/projectiles.js');
const { LASGUN_LASER_NAME } = await import('../src/fx/lasgun-laser.js');
const { replicaWeapon } = await import('../src/net/skirmish-state.js');

function shoot(weapon) {
  const world = new World();
  const shooter = world.createEntity([]), target = world.createEntity([]);
  world.add(shooter, 'soldier', { squadId: 1, weapon, attackRate: 2, attackCooldown: 0, damageMult: 1 });
  world.add(shooter, 'mesh', { root: new THREE.Group() });
  const targetRoot = new THREE.Group(); targetRoot.position.set(10, 0, 0);
  world.add(target, 'soldier', { hp: 100, armorClass: 'infantry_med' });
  world.add(target, 'mesh', { root: targetRoot });
  const from = new THREE.Vector3(0, 0, 0);
  const id = E.createBeamEntity(world, from, 'blue', shooter, target, 1);
  return { world, id };
}

test('lasgun shots render the layered red lasgun beam, not the thin generic line', () => {
  const { world, id } = shoot('lasgun');
  assert.ok(id !== null && world.has(id, 'beam'));
  const root = world.get(id, 'mesh').root;
  assert.equal(root.name, LASGUN_LASER_NAME);
  // Root + orange + white-hot core layers.
  assert.equal(root.children.length, 2);
  const colors = [root, ...root.children].map((m) => `#${m.material.color.getHexString()}`).sort();
  assert.deepEqual(colors, ['#d52a08', '#ff651a', '#fff8f0']);
  // Beam spans the full shooter->target distance.
  assert.ok(Math.abs(root.scale.y - Math.hypot(10, 0.05)) < 0.01, `scale.y=${root.scale.y}`);
  assert.ok(root.position.distanceTo(new THREE.Vector3(5, 1.025, 0)) < 0.01);
});

test('non-lasgun beam weapons keep the thin generic beam line', () => {
  const { world, id } = shoot('bolter');
  const root = world.get(id, 'mesh').root;
  assert.notEqual(root.name, LASGUN_LASER_NAME);
  assert.equal(root.children.length, 0);
});

test('replicas resolve the authored weapon when the snapshot carries none', () => {
  // Backend snapshots label every infantry volley "Bullet" with no soldier
  // weapon: the registry fallback restores the real tracers in net games.
  assert.equal(replicaWeapon({}, { faction: 'ig', unitType: 'guardsmen' }), 'lasgun');
  assert.equal(replicaWeapon({ unitType: 'kasrkin' }, { faction: 'ig', unitType: 'guardsmen' }), 'hellgun');
  assert.equal(replicaWeapon({}, { faction: 'necrons', unitType: 'necron_warrior' }), 'gauss_flayer');
  assert.equal(replicaWeapon({ weapon: 'plasma_gun' }, { faction: 'ig', unitType: 'guardsmen' }), 'plasma_gun');
  assert.equal(replicaWeapon({}, { faction: 'nope', unitType: 'nope' }), undefined);
  assert.equal(replicaWeapon({}, null), undefined);
});

test('beams ride on the units\u2019 terrain height instead of absolute y (Into the Breach)', () => {
  // SGB maps seat soldier feet onto the heightmap (y far from 0): the beam
  // must hang ~1m above each unit's feet or it renders buried under terrain.
  const world = new World();
  const shooter = world.createEntity([]), target = world.createEntity([]);
  world.add(shooter, 'soldier', { squadId: 1, weapon: 'lasgun', attackRate: 2, attackCooldown: 0, damageMult: 1 });
  world.add(shooter, 'mesh', { root: new THREE.Group() });
  const targetRoot = new THREE.Group(); targetRoot.position.set(10, 22, 0);
  world.add(target, 'soldier', { hp: 100, armorClass: 'infantry_med' });
  world.add(target, 'mesh', { root: targetRoot });
  const id = E.createBeamEntity(world, new THREE.Vector3(0, 20, 0), 'blue', shooter, target, 1);
  assert.ok(id !== null && world.has(id, 'beam'));
  const root = world.get(id, 'mesh').root;
  // Endpoints: shooter chest (0, 21.05, 0), target chest (10, 23, 0).
  assert.ok(root.position.distanceTo(new THREE.Vector3(5, 22.025, 0)) < 0.01, `midpoint=${root.position.toArray()}`);
  assert.ok(Math.abs(root.scale.y - Math.hypot(10, 1.95)) < 0.01, `scale.y=${root.scale.y}`);
});

test('hellgun bolts spawn at the shooter\u2019s height and pitch toward the target (Into the Breach)', () => {
  // Kasrkin stand on elevated terrain: a bolt spawned at absolute y=2.3
  // flies under the ground instead of between the two squads.
  const world = new World();
  const shooter = world.createEntity([]), target = world.createEntity([]);
  world.add(shooter, 'soldier', { squadId: 1, weapon: 'hellgun', attackRate: 2, attackCooldown: 0, damageMult: 1 });
  world.add(shooter, 'mesh', { root: new THREE.Group() });
  const targetRoot = new THREE.Group(); targetRoot.position.set(10, 22, 0);
  world.add(target, 'soldier', { hp: 100, armorClass: 'infantry_med' });
  world.add(target, 'mesh', { root: targetRoot });
  const id = createLaserBulletEntity(world, new THREE.Vector3(0, 20, 0), 'blue', shooter, target, 1);
  assert.ok(id !== null && world.has(id, 'laserBullet'));
  const shot = world.get(id, 'laserBullet');
  const bolt = world.get(id, 'mesh').root;
  assert.ok(Math.abs(bolt.position.y - 22.3) < 1e-9, `bolt spawns at shooter chest, y=${bolt.position.y}`);
  const velocity = new THREE.Vector3(shot.vx, shot.vy, shot.vz).normalize();
  assert.ok(bolt.getWorldDirection(new THREE.Vector3()).distanceTo(velocity) < 1e-9, 'streak pitches along its flight line');
  assert.ok(shot.vy > 0, `bolt climbs toward the higher target, vy=${shot.vy}`);
});

test('lasgun beams fade out and are destroyed on schedule', () => {
  const { world, id } = shoot('lasgun');
  systemBeam(world, 0.1);
  const root = world.get(id, 'mesh').root;
  const faded = [root, ...root.children].map((m) => m.material.opacity);
  assert.ok(faded.every((o) => o < 0.92), `opacities=${faded}`);
  systemBeam(world, 0.1);
  world._flushDestroyed();
  assert.ok(!world.has(id, 'beam'), 'beam entity cleaned up');
});
