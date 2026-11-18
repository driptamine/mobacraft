import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/core/ecs.js';

globalThis.window = {};
globalThis.document = { getElementById: () => null, querySelector: () => null };
const scene = await import('../src/core/scene.js');
const headless = new THREE.Scene();
headless._registerShadows = () => {};
scene.__setSceneCameraForTests(headless, { target: new THREE.Vector3() });
const { systemAI } = await import('../src/systems/meta.js');

it('does not spawn free Chaos armies when the map has no computer producer', () => {
  scene.setControlBoth(false);
  const world = new World();
  for(let tick=0;tick<30;tick++)systemAI(world,30);
  assert.equal(world.query('squad').length,0);
  assert.equal(world.query('soldier').length,0);
});
