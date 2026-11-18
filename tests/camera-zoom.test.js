import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyZoom, MIN_ZOOM_RADIUS, MAX_ZOOM_RADIUS, DEFAULT_CAMERA_RADIUS, DEFAULT_CAMERA_ALPHA, DEFAULT_CAMERA_BETA } from '../src/render/camera-zoom.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('camera zoom', () => {
  it('exposes the widened default range', () => {
    assert.equal(MIN_ZOOM_RADIUS, 6);
    assert.equal(MAX_ZOOM_RADIUS, 800);
  });

  it('pins the default radius used by init and backspace reset', () => {
    assert.equal(DEFAULT_CAMERA_RADIUS, 55);
  });

  it('pins the backspace reset orientation at alpha 315deg beta 50deg', () => {
    assert.equal(DEFAULT_CAMERA_ALPHA, (315 * Math.PI) / 180);
    assert.equal(DEFAULT_CAMERA_BETA, (50 * Math.PI) / 180);
  });

  it('zooms in on positive deltaY and out on negative', () => {
    assert.ok(applyZoom(62, 100) < 62);
    assert.ok(applyZoom(62, -100) > 62);
  });

  it('clamps to the active radius limits', () => {
    assert.equal(applyZoom(62, 100000), MIN_ZOOM_RADIUS);
    assert.equal(applyZoom(62, -100000), MAX_ZOOM_RADIUS);
  });

  it('respects per-map limit overrides', () => {
    assert.equal(applyZoom(500, 100000, 10, 500), 10);
    assert.equal(applyZoom(20, -100000, 10, 500), 500);
  });

  it('starts Doom Spiral straight-on (alpha 0, beta 50), everywhere else default', () => {
    const game = fs.readFileSync(path.join(root, 'src/core/game.ts'), 'utf8');
    assert.ok(game.includes('/doom.?spiral/i.test(mapKey'), 'doom spiral matched by map key');
    assert.ok(game.includes('const startAlpha = doomSpiral ? 0 : DEFAULT_CAMERA_ALPHA'), 'doom spiral yaws to 0');
    assert.ok(game.includes('(50 * Math.PI) / 180'), 'doom spiral pitch is 50deg');
    assert.ok(game.includes('camera.beta = startBeta'), 'both spawn paths use the per-map pitch');
    assert.ok(game.includes('camera.alpha = startAlpha'), 'both spawn paths use the per-map yaw');
  });
});
