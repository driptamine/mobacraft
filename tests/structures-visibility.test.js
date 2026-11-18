import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./node-esm-hooks.mjs', import.meta.url);
globalThis.window = {};
globalThis.document = { getElementById: () => null };
const sceneMod = await import('../src/scene.js');

function vis() {
  return { visible: true };
}

// Minimal world stub: two structures (one constructed building, one
// constructing turret) plus one unrelated squad entity that must be ignored.
function fakeWorld() {
  const ents = new Map([
    [1, { building: { constructing: false }, mesh: { root: vis(), hpBar: vis(), constructBar: vis() } }],
    [2, { structure: { constructing: true }, mesh: { root: vis(), hpBar: vis(), constructBar: vis() } }],
    [3, { squad: {}, mesh: { root: vis() } }],
  ]);
  return {
    query(...comps) {
      return [...ents.entries()]
        .filter(([, e]) => comps.every((c) => e[c] !== undefined))
        .map(([id]) => id);
    },
    get(id, comp) {
      return ents.get(id)?.[comp];
    },
  };
}

describe('structures visibility', () => {
  it('setStructuresHidden(true) hides roots and bars, keeps squads visible', () => {
    sceneMod.setWorld(fakeWorld());
    sceneMod.setStructuresHidden(true);
    assert.equal(sceneMod.structuresHidden, true);
    const b = sceneMod.world.get(1, 'mesh');
    assert.equal(b.root.visible, false);
    assert.equal(b.hpBar.visible, false);
    assert.equal(b.constructBar.visible, false);
    const s = sceneMod.world.get(2, 'mesh');
    assert.equal(s.root.visible, false);
    assert.equal(sceneMod.world.get(3, 'mesh').root.visible, true);
  });

  it('toggleStructures() restores steady-state visibility per construction state', () => {
    sceneMod.setWorld(fakeWorld());
    sceneMod.setStructuresHidden(true);
    sceneMod.toggleStructures();
    assert.equal(sceneMod.structuresHidden, false);
    const b = sceneMod.world.get(1, 'mesh');
    assert.equal(b.root.visible, true);
    assert.equal(b.hpBar.visible, true);
    assert.equal(b.constructBar.visible, false);
    const s = sceneMod.world.get(2, 'mesh');
    assert.equal(s.root.visible, true);
    assert.equal(s.hpBar.visible, false);
    assert.equal(s.constructBar.visible, true);
  });

  it('setStructuresHidden is safe with no world yet', () => {
    sceneMod.setWorld(undefined);
    sceneMod.setStructuresHidden(true);
    assert.equal(sceneMod.structuresHidden, true);
    sceneMod.setStructuresHidden(false);
    assert.equal(sceneMod.structuresHidden, false);
  });
});
