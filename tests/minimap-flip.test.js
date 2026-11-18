import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The HUD minimap orientation is per map so it always matches the camera:
// legacy maps keep the mirror (+X left, +Z top) that fits the diagonal
// default view, while Doom Spiral (straight-on alpha-0 camera) transposes
// it (-Z right, -X top). Draw and click mappings must use the same mirror
// or clicks land mirrored.
describe('minimap mirror flip', () => {
  const src = () => fs.readFileSync(path.join(root, 'src/hud/components/Minimap.tsx'), 'utf8');

  it('legacy maps draw +X left and +Z top', () => {
    assert.ok(src().includes('? Math.round(((HALF - z) / (HALF * 2)) * W)'), 'doom branch present');
    assert.ok(src().includes(': Math.round(((HALF - x) / (HALF * 2)) * W);'), 'legacy mirrored draw X');
    assert.ok(src().includes(': Math.round(((HALF - z) / (HALF * 2)) * H);'), 'legacy flipped draw Y');
  });

  it('doom spiral draws -Z right and -X top', () => {
    assert.ok(src().includes('? Math.round(((x + HALF) / (HALF * 2)) * H)'), 'doom transposed draw Y');
  });

  it('click inverts the active mapping', () => {
    assert.ok(
      src().includes('normalizedY * HALF * 2 - HALF'),
      'doom click x inverts the transposed draw',
    );
    assert.ok(
      src().includes('HALF - normalizedX * HALF * 2'),
      'doom click z inverts the transposed draw',
    );
    assert.ok(
      src().includes('HALF - normalizedY * HALF * 2'),
      'legacy click z uses the flipped mapping',
    );
  });

  it('orientation follows the map key', () => {
    assert.ok(src().includes('/doom.?spiral/i.test'), 'doom spiral detected by map key');
    assert.ok(src().includes('export function doomSpiralMinimap'), 'mode helper is exported');
  });
});
