import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.window = {};
globalThis.document = { getElementById: () => null, querySelector: () => null };
const state = await import('../src/core/scene.js');
const scene = new THREE.Scene();
scene._registerShadows = () => {};
state.__setSceneCameraForTests(scene, { target: new THREE.Vector3() });
const { _snapTerrainBegin } = await import('../src/systems/terrain.js');
const selection = await import('../src/input/selection.js');

function stubTerrain(height) {
  window.__sgbTerrainRoot = { position: new THREE.Vector3(0, 0, 0), matrixWorld: new THREE.Matrix4(), updateWorldMatrix() {} };
  window.__sgbSampleHeight = () => height;
  _snapTerrainBegin();
}

describe('rally markers on relief', () => {
  it('sits the flag on flat ground exactly as before', () => {
    window.__sgbTerrainRoot = null;
    window.__sgbSampleHeight = null;
    _snapTerrainBegin();
    selection.updateRallyMarker(1, { position: new THREE.Vector3(0, 0, 0), rallyPoint: new THREE.Vector3(10, 0, 10) });
    const marker = selection._rallyMeshes.get(1);
    assert.ok(marker);
    assert.equal(marker.pole.position.y, 0.7);
    assert.equal(marker.flag.position.y, 1.55);
    selection.clearRallyMarker(1);
  });

  it('lifts the pole, flag and dashed line onto hills', () => {
    stubTerrain(5);
    selection.updateRallyMarker(2, { position: new THREE.Vector3(0, 0, 0), rallyPoint: new THREE.Vector3(10, 0, 10) });
    const marker = selection._rallyMeshes.get(2);
    assert.ok(marker);
    assert.equal(marker.pole.position.y, 5.7);
    assert.equal(marker.flag.position.y, 6.55);
    assert.ok(marker.line.geometry.getAttribute('position').array.every((v, i) => i % 3 !== 1 || Math.abs(v - 5.06) < 1e-4));
    selection.clearRallyMarker(2);
    window.__sgbTerrainRoot = null;
    window.__sgbSampleHeight = null;
    _snapTerrainBegin();
  });
});
