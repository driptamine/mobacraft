import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const canvas = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
globalThis.window = { addEventListener() {} };
globalThis.document = { getElementById: id => id === 'renderCanvas' ? canvas : null, querySelector: () => null };
const core = await import('../src/core/scene.js');
const { World } = await import('../src/core/ecs.js');
const ghosts = await import('../src/input/build-ghost.js');
const { setMouseX, setMouseY } = await import('../src/input/camera.js');

function fixture() {
  const scene = new THREE.Scene(); scene._registerShadows = () => {};
  const camera = new THREE.OrthographicCamera(-40, 40, 30, -30, .1, 200);
  camera.position.set(0, 80, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true); camera.target = new THREE.Vector3();
  setMouseX(500); setMouseY(300);
  core.__setSceneCameraForTests(scene, camera);
  const world = new World(); core.setWorld(world); core.setRequisition(5000);
  const workerId = world.createEntity([]);
  const root = new THREE.Group(); root.position.set(9, 0, -1);
  world.add(workerId, 'builder', { team: 'blue', faction: 'ig', hp: 100 });
  world.add(workerId, 'mesh', { root }); core.setSelBuilder(workerId);
  return { scene, world, restore() { ghosts.cancelBuild(); core.setSelBuilder(null); } };
}

test('build ghost mesh and footprint box attach to the scene and follow the cursor', () => {
  const f = fixture();
  try {
    ghosts.startBuild('turret');
    assert.ok(ghosts._buildGhost, 'ghost mesh created');
    assert.ok(ghosts._buildFootprint, 'footprint box created');
    assert.equal(ghosts._buildGhost.parent, f.scene, 'ghost mesh attached to scene');
    assert.equal(ghosts._buildFootprint.parent, f.scene, 'footprint box attached to scene');
    ghosts.setGhostPending(400, 300); core.runBeforeRender();
    assert.equal(ghosts._buildGhost.visible, true);
    assert.equal(ghosts._buildFootprint.visible, true);
    assert.ok(ghosts._buildGhost.position.distanceTo(new THREE.Vector3(0, 0, 0)) < 1e-6, 'ghost follows cursor');
    const expectedBox = ghosts._buildGhost.position.clone();
    ghosts.setGhostPending(200, 200); core.runBeforeRender();
    assert.ok(ghosts._buildGhost.position.distanceTo(new THREE.Vector3(-20, 0, -10)) < 1e-6, 'ghost tracks the next cursor point');
    assert.ok(ghosts._buildFootprint.position.distanceTo(expectedBox) > 1e-6, 'box moves with the ghost');
    const dx = ghosts._buildFootprint.position.x - ghosts._buildGhost.position.x;
    const dz = ghosts._buildFootprint.position.z - ghosts._buildGhost.position.z;
    assert.ok(Math.abs(dx) < 10 && Math.abs(dz) < 10, 'box stays glued to the ghost');
    const cursor = ghosts._buildGhost, box = ghosts._buildFootprint;
    ghosts.cancelBuild(); core.runBeforeRender();
    assert.equal(cursor.parent, null, 'ghost detached on cancel');
    assert.equal(box.parent, null, 'box detached on cancel');
  } finally { f.restore(); }
});
