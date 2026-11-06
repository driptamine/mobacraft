import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
describe('decal black fix', () => {
  it('uses glob-resolved URLs so vite build emits textures (not 404)', () => {
    const src = fs.readFileSync(path.join(root, 'src/sgb-decals.js'), 'utf8');
    assert.match(src, /DECAL_GLOB.*import\.meta\.glob/);
    assert.match(src, /DECAL_GLOB\[c\]/);
  });
  it('unlit material not black, no tint, alpha-blend layering', () => {
    const src = fs.readFileSync(path.join(root, 'src/sgb-decals.js'), 'utf8');
    // three.js spelling of the same contract: unlit white base, double-sided,
    // alpha-blended over the texture alpha, layered via polygon offset.
    assert.match(src, /MeshBasicMaterial/);
    assert.match(src, /mat\.color = new THREE\.Color\(1, 1, 1\)/);
    assert.match(src, /side = THREE\.DoubleSide/);
    assert.match(src, /mat\.transparent = true/);
    assert.match(src, /polygonOffsetFactor = -2/);
    assert.match(src, /mat\.map = texture/);
    assert.ok(!src.includes('alphaTest'), 'alpha-test would eat semi-transparent pixels');
  });
  it('vite copies maps so decals not 404 as black', () => {
    const viteCfg = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
    assert.match(viteCfg, /copy-maps-decals/);
    assert.match(viteCfg, /dist\/maps/);
    assert.match(viteCfg, /cpSync/);
  });
});
