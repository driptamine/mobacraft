import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { setDefaultScene } from '../src/three-helpers.js';
import { CAPTURE_GUARD_DISTANCE } from '../src/soldier-aim.js';

register('./node-esm-hooks.mjs', import.meta.url);
globalThis.document = { getElementById: () => null };
const { STRATEGIC_POINT_HIDDEN_NODES, makeStrategicPointMesh } = await import('../src/meshes.js');
const { createStrategicPointEntity } = await import('../src/entities.js');

function makeStubWorld() {
  const comps = new Map();
  let nextId = 1;
  return {
    createEntity() {
      return nextId++;
    },
    add(id, type, data) {
      if (!comps.has(id)) comps.set(id, new Map());
      comps.get(id).set(type, data);
    },
    get(id, type) {
      return comps.get(id)?.get(type);
    },
    has(id, type) {
      return comps.get(id)?.has(type) ?? false;
    },
  };
}

function glbMeshNodeNames(url) {
  const buf = readFileSync(url);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return [...new Set(json.nodes.filter((n) => 'mesh' in n).map((n) => n.name))];
}

// Mirrors the hidden-node predicate in _instantiateFromContainer
// (src/model-upload.js): exact match or plain prefix.
const covered = (node) => STRATEGIC_POINT_HIDDEN_NODES.some((wanted) => {
  const child = String(node).toLowerCase();
  const want = String(wanted).toLowerCase();
  return child === want || child.startsWith(want);
});

describe('strategic point model', () => {
  it('hides every banner/flag/rod/pole mesh in the point and relic glbs', () => {
    for (const file of ['strategic_point.glb', 'relic.glb']) {
      const names = glbMeshNodeNames(new URL(`../models/points/${file}`, import.meta.url));
      assert.ok(names.length > 20, `${file}: parsed mesh nodes (saw ${names.length})`);
      const flagged = names.filter((n) => /banner|flag|rod|pole/i.test(n));
      assert.ok(flagged.length > 0, `${file} has faction dressing nodes`);
      for (const name of flagged) {
        assert.ok(covered(name), `${file}: ${name} is hidden`);
      }
    }
    const names = glbMeshNodeNames(new URL('../models/points/strategic_point.glb', import.meta.url));
    for (const name of ['base', 'console', 'console_arm', 'doora', 'doorb', 'ground_plane', 'stratetgic_point_centerpost']) {
      assert.ok(names.includes(name), `${name} exists in the glb`);
      assert.ok(!covered(name), `${name} stays visible`);
    }
  });

  it('falls back to the procedural point without a loaded container', () => {
    const viz = makeStrategicPointMesh(10, 20);
    assert.ok(viz.group);
    assert.equal(viz.gem, null);
    assert.equal(viz.gemMat, null);
    assert.equal(viz.capRing, null);
    assert.equal(viz.capRingMat, null);
    assert.equal(viz.pillar, null);
    assert.equal(viz.group.position.x, 10);
    assert.equal(viz.group.position.z, 20);
  });

  it('covers the model with its capture radius, inside the guard ring', () => {
    setDefaultScene(new THREE.Scene());
    const world = makeStubWorld();
    const id = createStrategicPointEntity(world, 5, 6, 'point');
    const radius = world.get(id, 'strategicPoint').captureRadius;
    assert.equal(radius, 4.5);
    assert.ok(CAPTURE_GUARD_DISTANCE > radius);
  });

  it('stamps point meshes as the SP click target', () => {
    setDefaultScene(new THREE.Scene());
    for (const kind of ['point', 'relic']) {
      const world = makeStubWorld();
      const id = createStrategicPointEntity(world, 5, 6, kind);
      const meshes = [];
      world.get(id, 'mesh').root.traverse((child) => {
        if (child.isMesh) meshes.push(child);
      });
      assert.ok(meshes.length > 0, `${kind} has clickable meshes`);
      for (const mesh of meshes) {
        assert.equal(mesh.userData.strategicPointEntityId, id);
        assert.notEqual(mesh.userData.pickable, false);
      }
    }
  });
});
