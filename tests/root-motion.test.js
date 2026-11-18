import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.window = {};
globalThis.document = { getElementById: () => null };
const scene = await import('../src/core/scene.js');
scene.__setSceneCameraForTests(new THREE.Scene(), { target: new THREE.Vector3() });
const { stripRootMotion } = await import('../src/render/gltf-models.js');

// Dota-style run clip: root travels +6 in Z with a preserved Y bob.
function driftingClip() {
  return new THREE.AnimationClip('run_anim', 1, [
    new THREE.VectorKeyframeTrack('root.position', [0, 0.5, 1], [
      0, 2.2, 0,
      0, 2.4, 3,
      0, 2.2, 6,
    ]),
    new THREE.VectorKeyframeTrack('hips.position', [0, 1], [0, 0, 0, 0, 0.3, 0]),
  ]);
}

test('stripRootMotion closes the loop but keeps the bob', () => {
  const clip = driftingClip();
  stripRootMotion(clip);
  const root = clip.tracks[0].values;
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} ~= ${b}`);
  close(root[0], 0); close(root[1], 2.2); close(root[2], 0);
  close(root[root.length - 3], 0); close(root[root.length - 2], 2.2); close(root[root.length - 1], 0);
  // Mid key keeps its shape minus the linear trend (2.4 at f=0.5).
  close(root[4], 2.4);
  close(root[5], 0);
  // Non-root tracks untouched.
  for (const [i, v] of [0, 0, 0, 0, 0.3, 0].entries()) close(clip.tracks[1].values[i], v);
});

test('stripRootMotion is idempotent and ignores in-place clips', () => {
  const clip = driftingClip();
  stripRootMotion(clip);
  const once = [...clip.tracks[0].values];
  stripRootMotion(clip);
  assert.deepEqual([...clip.tracks[0].values], once);
  const still = new THREE.AnimationClip('run', 1, [
    new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0.1, 0]),
  ]);
  stripRootMotion(still);
  const sv = still.tracks[0].values;
  for (const [i, v] of [0, 0, 0, 0, 0.1, 0].entries()) assert.ok(Math.abs(sv[i] - v) < 1e-5);
});
