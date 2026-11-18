import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
globalThis.document = { getElementById: () => null };
const scene = await import('../src/core/scene.js');
scene.__setSceneCameraForTests(new THREE.Scene(), { target: new THREE.Vector3() });
const { _makeFactionSoldierMesh } = await import('../src/meshes/soldiers.js');
const { updateMixers } = await import('../src/render/gltf-models.js');

function fixture() {
  const model = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'bip01';
  model.add(bone);
  const track = (name, seconds) => {
    const n = Math.max(2, Math.round(seconds / 0.1));
    const times = Array.from({ length: n }, (_, i) => +(i * seconds / (n - 1)).toFixed(3));
    const vals = [];
    for (let i = 0; i < n; i++) vals.push(0, 0, 0, 1);
    return new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, vals);
  };
  const clip = (name, seconds) => new THREE.AnimationClip(name, seconds, [track(name, seconds)]);
  const container = {
    scene: model, meshes: [], _hiddenNodes: [], dispose() {},
    animations: [clip('idle_1', 1), clip('move_run_1', 1), clip('melee_attack_1', 1), clip('melee_damage_l', 1)],
  };
  const mesh = _makeFactionSoldierMesh(container, 'blue', { unitType: 'guardsmen' }, 'ig');
  return { root: mesh, groups: mesh._animGroups, container };
}

function step(dt = 1 / 60, n = 1) {
  for (let i = 0; i < n; i++) updateMixers(dt, null);
}

test('forced non-loop replays from the start, unforced keeps playing', () => {
  const { root } = fixture();
  root._playAnim('hitL', false, false);
  step(1 / 60, 30);
  const tMid = root._animGroups.hitL._ensureAction().time;
  assert.ok(tMid > 0.3, `flinch advanced, got ${tMid}`);
  // Same reaction, no force: keeps playing, no restart.
  root._playAnim('hitL', false, false);
  step();
  const tKept = root._animGroups.hitL._ensureAction().time;
  assert.ok(tKept >= tMid, `continues without restart (${tMid} -> ${tKept})`);
  // Same reaction, forced (fresh blow): restarts from the impact.
  root._playAnim('hitL', false, true);
  const tRestart = root._animGroups.hitL._ensureAction().time;
  assert.ok(tRestart < tKept, `restarts on force (${tKept} -> ${tRestart})`);
  step(1 / 60, 90);
  for (const g of new Set(Object.values(root._animGroups))) g?.dispose?.();
});

test('looped anims never restart on repeat requests, even forced', () => {
  const { root } = fixture();
  root._playAnim('idle', true, false);
  step(1 / 60, 30);
  const tMid = root._animGroups.idle._ensureAction().time;
  root._playAnim('idle', true, true);
  step();
  const tKept = root._animGroups.idle._ensureAction().time;
  assert.ok(tKept >= tMid, `idle continues (${tMid} -> ${tKept})`);
  for (const g of new Set(Object.values(root._animGroups))) g?.dispose?.();
});

test('squad hit branch protects in-progress swings and restarts stale flinches', () => {
  const src = fs.readFileSync(path.join(root, 'src/systems/squad.ts'), 'utf8');
  assert.ok(src.includes("root._currentAnim !== 'melee'"), 'flinch yields to an active swing');
  assert.ok(src.includes('hitReactionRestart'), 'fresh triggers restart the flinch');
  const react = fs.readFileSync(path.join(root, 'src/combat/melee-hit-reaction.ts'), 'utf8');
  assert.ok(react.includes('hitReactionRestart = true'), 'trigger marks a fresh reaction');
});
