import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decalBaseSize, isChaosDecal } from '../src/decal-size.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CHAOS = 'art/decals/z_all/chaos_taint_02';
const OTHERS = [
  'art/decals/jungle/jungle_rubble01',
  'art/decals/urban/urban_rubble03',
  'art/decals/z_all/crater_02',
  'art/decals/z_all/crater_dust_01',
  'art/decals/jungle/jungle_mud_02',
  'art/decals/jungle/stone_cliff_05',
  'art/decals/z_all/crater_charred_01',
];

describe('sgb decal sizes', () => {
  it('detects only the chaos taint ref', () => {
    assert.equal(isChaosDecal(CHAOS), true);
    for (const ref of OTHERS) {
      assert.equal(isChaosDecal(ref), false, ref);
    }
    assert.equal(isChaosDecal(''), false);
    assert.equal(isChaosDecal(null), false);
  });

  it('chaos keeps the legacy flat size for any stored size', () => {
    for (const size of [0.02, 0.0397, 0.05, 0.075, 0.11]) {
      assert.equal(decalBaseSize(CHAOS, size), 10, `size ${size}`);
    }
  });

  it('other decals map proportionally (0.05 -> 50u at scale 12)', () => {
    for (const ref of OTHERS) {
      assert.equal(decalBaseSize(ref, 0.05), 0.05 * 1000 / 12, ref);
      // distinct stored sizes -> distinct world sizes
      const a = decalBaseSize(ref, 0.03);
      const b = decalBaseSize(ref, 0.06);
      assert.ok(Math.abs(b - a) > 1e-9, `${ref} varies with size`);
      assert.ok(b > a, `${ref} grows with size`);
    }
  });

  it('real alvarus sizes spread the seven groups, chaos stays flat', () => {
    const layout = JSON.parse(
      fs.readFileSync(path.join(root, 'maps/6p_alvarus/6p_alvarus_layout_upd.json'), 'utf8'),
    );
    const byRef = new Map();
    for (const d of layout.decals) {
      if (!byRef.has(d.ref)) byRef.set(d.ref, new Set());
      byRef.get(d.ref).add(decalBaseSize(d.ref, d.size_raw));
    }
    assert.equal(byRef.get(CHAOS).size, 1, 'chaos one flat size');
    assert.equal([...byRef.get(CHAOS)][0], 10);
    for (const ref of OTHERS) {
      assert.ok((byRef.get(ref) || new Set()).size > 1, `${ref} has spread sizes`);
    }
  });

  it('sgb path uses the helper, layout path keeps its own formula', () => {
    const src = fs.readFileSync(path.join(root, 'src/sgb-decals.js'), 'utf8');
    assert.match(src, /import \{ decalBaseSize \} from '\.\/decal-size\.js';/);
    assert.match(src, /const baseSize = decalBaseSize\(path, decal\.size\);/);
    // layout-driven builder untouched: same inline calibration, no chaos branch
    assert.match(src, /const baseSize = decal\.sizeRaw \* 1000 \/ 12;/);
  });
});
