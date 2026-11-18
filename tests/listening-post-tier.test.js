import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.window = {};
globalThis.document = { getElementById: () => null };
const { applyListeningPostTier } = await import('../src/entities/entities.js');

const ADDONS = ['addon_1_turret', 'addon_1_turret_barrels', 'addon_2_turret', 'addon_2_turret_shadow'];

function fixture(tier) {
  const root = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  base.name = 'listening_post';
  root.add(base);
  for (const name of ADDONS) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.name = name;
    root.add(mesh);
  }
  const byKind = {
    building: new Map([[3, { type: 'listening_post', strategicPointId: 7 }]]),
    mesh: new Map([[3, { root }]]),
    strategicPoint: new Map([[7, { lpTier: tier }]]),
  };
  const world = {
    get: (id, kind) => byKind[kind]?.get(id),
    has: (id, kind) => byKind[kind]?.has(id),
  };
  return { world, root };
}

const visible = (root, name) => {
  const node = root.getObjectByName(name);
  assert.ok(node, `${name} exists`);
  return node.visible;
};

describe('listening post tiers', () => {
  it('LP1 shows the bare post without turrets', () => {
    const { world, root } = fixture(1);
    applyListeningPostTier(world, 3);
    assert.equal(visible(root, 'listening_post'), true);
    for (const name of ADDONS) assert.equal(visible(root, name), false, name);
  });

  it('LP2 mounts the addon_1 turret set', () => {
    const { world, root } = fixture(2);
    applyListeningPostTier(world, 3);
    assert.equal(visible(root, 'addon_1_turret'), true);
    assert.equal(visible(root, 'addon_1_turret_barrels'), true);
    assert.equal(visible(root, 'addon_2_turret'), false);
    assert.equal(visible(root, 'addon_2_turret_shadow'), false);
  });

  it('LP3 mounts the addon_2 turret', () => {
    const { world, root } = fixture(3);
    applyListeningPostTier(world, 3);
    for (const name of ADDONS) assert.equal(visible(root, name), true, name);
  });
});
