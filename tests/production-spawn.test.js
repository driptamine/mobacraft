import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/core/ecs.js';

globalThis.window = { _multiplayerMode: false };
globalThis.document = { getElementById: () => null, querySelector: () => null };
const state = await import('../src/core/scene.js');
const scene = new THREE.Scene(); scene._registerShadows = () => {};
state.__setSceneCameraForTests(scene, { target: new THREE.Vector3() });
const { spawnGateOffset, productionSpawnPoint } = await import('../src/systems/structures.js');

test('rally direction snaps to one of eight gates', () => {
  const SQ = Math.SQRT1_2;
  const cases = [
    [[10, 0], [1, 0]], [[-10, 0], [-1, 0]],
    [[0, 10], [0, 1]], [[0, -10], [0, -1]],
    [[10, 10], [SQ, SQ]], [[-10, 10], [-SQ, SQ]],
    [[10, -10], [SQ, -SQ]], [[-10, -10], [-SQ, -SQ]],
    [[3, 1], [1, 0]], [[1, 3], [0, 1]],
    [[-3, 1], [-1, 0]], [[1, -3], [0, -1]],
  ];
  for (const [[dx, dz], [wx, wz]] of cases) {
    assert.deepEqual(spawnGateOffset(dx, dz), [wx, wz], `gate(${dx},${dz})`);
  }
  assert.deepEqual(spawnGateOffset(0, 0), [-1, 0], 'zero vector keeps the legacy west side');
});

test('production spawns at the footprint edge toward the rally', () => {
  const world = new World();
  const barracks = { type: 'barracks', faction: 'ig', position: new THREE.Vector3(0, 0, 0), rallyPoint: new THREE.Vector3(100, 0, 0) };
  const east = productionSpawnPoint(barracks);
  assert.ok(east.x > 4 && east.z === 0, `east gate beyond the wall: ${east.x},${east.z}`);
  const north = productionSpawnPoint({ ...barracks, rallyPoint: new THREE.Vector3(0, 0, -100) });
  assert.ok(north.z < -4 && north.x === 0, `north gate beyond the wall: ${north.x},${north.z}`);
  const fallback = productionSpawnPoint({ ...barracks, rallyPoint: null });
  assert.deepEqual([fallback.x, fallback.y, fallback.z], [-6, 0, 0], 'missing rally keeps the legacy west offset');
  void world;
});
