import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./node-esm-hooks.mjs', import.meta.url);
globalThis.window = {};
globalThis.document = { getElementById: () => null };
const sceneMod = await import('../src/scene.js');

function fakeScene() {
  return {
    _gridMicroMesh: { visible: true },
    _gridZoomMesh: { visible: false },
    _gridMacroMeshes: [{ visible: true }, { visible: true }],
  };
}

describe('grid variants', () => {
  it('variant 1 shows classic micro lines, variant 2 the zoom-out cells', () => {
    const scene = fakeScene();
    sceneMod.__setSceneCameraForTests(scene, {});
    sceneMod.setGridVariant(1);
    assert.equal(sceneMod._gridVariant, 1);
    assert.equal(scene._gridMicroMesh.visible, true);
    assert.equal(scene._gridZoomMesh.visible, false);
    assert.ok(scene._gridMacroMeshes.every((m) => m.visible), 'macro ribbons stay in both variants');
    sceneMod.setGridVariant(2);
    assert.equal(sceneMod._gridVariant, 2);
    assert.equal(scene._gridMicroMesh.visible, false);
    assert.equal(scene._gridZoomMesh.visible, true);
    assert.ok(scene._gridMacroMeshes.every((m) => m.visible));
  });

  it('toggleGridVariant flips between the two styles', () => {
    const scene = fakeScene();
    sceneMod.__setSceneCameraForTests(scene, {});
    sceneMod.setGridVariant(1);
    sceneMod.toggleGridVariant();
    assert.equal(sceneMod._gridVariant, 2);
    assert.equal(scene._gridZoomMesh.visible, true);
    sceneMod.toggleGridVariant();
    assert.equal(sceneMod._gridVariant, 1);
    assert.equal(scene._gridMicroMesh.visible, true);
  });

  it('setGridVariant clamps bad input to variant 1', () => {
    const scene = fakeScene();
    sceneMod.__setSceneCameraForTests(scene, {});
    sceneMod.setGridVariant(99);
    assert.equal(sceneMod._gridVariant, 1);
    assert.equal(scene._gridMicroMesh.visible, true);
  });

  it('hide/show preserves the active variant', () => {
    const scene = fakeScene();
    sceneMod.__setSceneCameraForTests(scene, {});
    sceneMod.setGridVariant(2);
    sceneMod.toggleGrid(); // off
    assert.equal(scene._gridZoomMesh.visible, false);
    assert.ok(scene._gridMacroMeshes.every((m) => !m.visible));
    sceneMod.toggleGrid(); // on
    assert.equal(scene._gridZoomMesh.visible, true);
    assert.equal(scene._gridMicroMesh.visible, false);
    assert.ok(scene._gridMacroMeshes.every((m) => m.visible));
  });
});
