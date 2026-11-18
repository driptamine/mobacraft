import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Edge-pan must not fight minimap clicks: the panel sits in the screen-edge
// zone, so without suppression the camera drifts away from the clicked point.
globalThis.window = {
  innerWidth: 1600, innerHeight: 900,
  addEventListener() {}, removeEventListener() {},
};
globalThis.document = { getElementById: () => null, hasFocus: () => true };
const scene = await import('../src/core/scene.js');
const cam = await import('../src/input/camera.js');

function rig() {
  const fake = {
    target: new THREE.Vector3(0, 0, 0),
    alpha: 0, beta: 1, radius: 100,
    lowerRadiusLimit: 1, upperRadiusLimit: 500,
    lowerBetaLimit: 0.1, upperBetaLimit: 1.4,
  };
  scene.__setSceneCameraForTests(new THREE.Scene(), fake);
  return fake;
}

test('edge pan moves the camera at the screen edge', () => {
  const fake = rig();
  cam.setHudHover(false);
  cam.setMouseEntered(true);
  cam.setMouseX(5); cam.setMouseY(450);
  cam.tickCamera(0.016);
  assert.notDeepEqual([fake.target.x, fake.target.z], [0, 0]);
});

test('edge pan stays off while the cursor hovers HUD (minimap)', () => {
  const fake = rig();
  cam.setHudHover(true);
  cam.setMouseEntered(true);
  cam.setMouseX(5); cam.setMouseY(450);
  cam.tickCamera(0.016);
  assert.deepEqual([fake.target.x, fake.target.z], [0, 0]);
  cam.setHudHover(false);
});

test('arrow keys still pan while hovering HUD', () => {
  const fake = rig();
  cam.setHudHover(true);
  cam.setMouseEntered(true);
  cam.setMouseX(800); cam.setMouseY(450);
  cam.keys.ArrowRight = true;
  try {
    cam.tickCamera(0.016);
  } finally {
    cam.keys.ArrowRight = false;
  }
  assert.notDeepEqual([fake.target.x, fake.target.z], [0, 0]);
  cam.setHudHover(false);
});

test('minimap panel toggles the HUD hover flag', () => {
  const src = fs.readFileSync(path.join(root, 'src/hud/components/Minimap.tsx'), 'utf8');
  assert.ok(src.includes('onMouseEnter={() => setHudHover(true)}'), 'enter suspends edge pan');
  assert.ok(src.includes('onMouseLeave={() => setHudHover(false)}'), 'leave resumes edge pan');
});
