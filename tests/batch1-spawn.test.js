import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// scene.ts reads the canvas at module load: stub DOM before importing src/*.
const canvas = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
globalThis.window = globalThis.window || { addEventListener() {} };
globalThis.document = globalThis.document || { getElementById: (id) => id === 'renderCanvas' ? canvas : null, querySelector: () => null };

const core = await import('../src/core/scene.js');
const { World } = await import('../src/core/ecs.js');
const { spawnBatchHeroes } = await import('../src/core/match-spawn.js');
const heroes = await import('../stats/races/batch1/heroes.js');

function fixture() {
  const scene = new THREE.Scene(); scene._registerShadows = () => {};
  const camera = new THREE.OrthographicCamera(-40, 40, 30, -30, .1, 200);
  camera.position.set(0, 80, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true); camera.target = new THREE.Vector3();
  core.__setSceneCameraForTests(scene, camera);
  const world = new World(); core.setWorld(world);
  return { world };
}

test('spawnBatchHeroes fields 10 single-hero squads, 5 per side', () => {
  const { world } = fixture();
  spawnBatchHeroes(world, [{ x: -74, z: -110, team: 'blue' }, { x: 74, z: 110, team: 'red' }]);
  const squads = [...world.query('squad')].map((id) => world.get(id, 'squad'));
  assert.equal(squads.length, 10);
  const blue = squads.filter((s) => s.team === 'blue').map((s) => s.unitType).sort();
  const red = squads.filter((s) => s.team === 'red').map((s) => s.unitType).sort();
  assert.deepEqual(blue, [...heroes.batch1BlueTeam].sort());
  assert.deepEqual(red, [...heroes.batch1RedTeam].sort());
  for (const s of squads) {
    const alive = s.soldiers.filter((id) => id !== null && world.has(id, 'soldier'));
    assert.equal(alive.length, 1, `${s.unitType} must be a lone hero`);
    assert.equal(s.faction, 'ig');
  }
  // Melee blues close in, ranged reds keep distance.
  for (const s of squads.filter((s) => s.team === 'blue')) assert.ok(s.attackRange <= 5, `${s.unitType} range ${s.attackRange}`);
  for (const s of squads.filter((s) => s.team === 'red')) assert.ok(s.attackRange >= 20, `${s.unitType} range ${s.attackRange}`);
  // Lines stand off from their own base, on opposite halves of the map.
  for (const s of squads.filter((s) => s.team === 'blue')) assert.ok(s.position.z > -110 && s.position.x > -110);
  for (const s of squads.filter((s) => s.team === 'red')) assert.ok(s.position.z < 110 && s.position.x < 110);
});

test('spawnBatchHeroes is a no-op without both bases', () => {
  const { world } = fixture();
  spawnBatchHeroes(world, [{ x: 0, z: 0, team: 'blue' }]);
  assert.equal([...world.query('squad')].length, 0);
});

test('teams take diagonally opposite corners (westmost blue, eastmost red)', () => {
  const { world } = fixture();
  spawnBatchHeroes(world, [
    { x: -220, z: -110, team: 'blue' }, { x: 220, z: -110, team: 'blue' },
    { x: -220, z: 110, team: 'red' }, { x: 220, z: 110, team: 'red' },
  ]);
  const squads = [...world.query('squad')].map((id) => world.get(id, 'squad'));
  assert.equal(squads.length, 10);
  for (const s of squads.filter((s) => s.team === 'blue')) {
    assert.ok(s.position.x < -150, `blue hero near the west base, got x=${s.position.x}`);
  }
  for (const s of squads.filter((s) => s.team === 'red')) {
    assert.ok(s.position.x > 150, `red hero near the east base, got x=${s.position.x}`);
  }
});
