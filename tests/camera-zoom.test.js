import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyZoom, MIN_ZOOM_RADIUS, MAX_ZOOM_RADIUS } from '../src/camera-zoom.js';

describe('camera zoom', () => {
  it('exposes the widened default range', () => {
    assert.equal(MIN_ZOOM_RADIUS, 6);
    assert.equal(MAX_ZOOM_RADIUS, 800);
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
});
