import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./node-esm-hooks.mjs', import.meta.url);
globalThis.document = { getElementById: () => null, querySelector: () => null };
const { cameraAlphaForMap, cameraFarForRadius } = await import('../src/sgb-upload.js');

describe('sgb camera yaw per map', () => {
  it('keeps alvarus on the classic alpha', () => {
    assert.equal(cameraAlphaForMap('/maps/6p_alvarus/6p_alvarus.sgb'), (3 * Math.PI) / 2);
    assert.equal(cameraAlphaForMap('6p alvarus.sgb'), (3 * Math.PI) / 2);
  });

  it('pushes the far plane past the camera on big maps', () => {
    assert.ok(Math.abs(cameraFarForRadius(3000, 5160) - 6192) < 1e-6);
    assert.ok(Math.abs(cameraFarForRadius(3000, 2600) - 3120) < 1e-6);
    assert.equal(cameraFarForRadius(8000, 2600), 8000);
  });

  it('rotates every other map +270 degrees from alvarus', () => {
    const paths = [
      '/maps/4p_doom_spiral/4p_doom_spiral.sgb',
      '/maps/4p_into_the_breach/4p_into_the_breach.sgb',
      '/maps/6p_mortalis/6p_mortalis.sgb',
      '/maps/6p_parmenie/6p_parmenie.sgb',
      '/maps/6p_vandea_coast/6p_vandea_coast.sgb',
      '/maps/8p_burial_grounds/8p_burial_grounds.sgb',
      '/maps/8p_oasis_of_sharr/8p_oasis_of_sharr.sgb',
      '',
      null,
      undefined,
    ];
    for (const p of paths) {
      assert.equal(cameraAlphaForMap(p), Math.PI, String(p));
    }
  });
});
