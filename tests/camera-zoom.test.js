import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { isDotaMap, dotaMapConfig, DOTA_MAP_KEY } from '../src/maps/dota-map-layout.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyZoom, MIN_ZOOM_RADIUS, MAX_ZOOM_RADIUS, DEFAULT_CAMERA_RADIUS, DEFAULT_CAMERA_ALPHA, DEFAULT_CAMERA_BETA, setInitialCameraAlpha, restoreInitialCameraAlpha } from '../src/render/camera-zoom.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('camera zoom', () => {
  it('exposes the widened default range', () => {
    assert.equal(MIN_ZOOM_RADIUS, 6);
    assert.equal(MAX_ZOOM_RADIUS, 800);
  });

  it('pins the default radius used by init and backspace reset', () => {
    assert.equal(DEFAULT_CAMERA_RADIUS, 55);
  });

  it('pins the initial default orientation at alpha 315deg beta 50deg', () => {
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

  it('allows Dota zoom-out beyond its initial view', () => {
    const game = fs.readFileSync(path.join(root, 'src/core/game.ts'), 'utf8');
    assert.ok(game.includes('camera.upperRadiusLimit = MAX_ZOOM_RADIUS;'));
    assert.ok(applyZoom(dotaMapConfig.camera.radius, -1200, 15.24, MAX_ZOOM_RADIUS) > dotaMapConfig.camera.radius);
  });

  it('Backspace restores the map zoom and its original camera alpha', () => {
    const source = fs.readFileSync(path.join(root, 'src/input/events.ts'), 'utf8');
    const ast = ts.createSourceFile('events.ts', source, ts.ScriptTarget.Latest, true);
    let reset;
    function visit(node) {
      if (ts.isIfStatement(node) && node.expression.getText(ast) === "event.code === 'Backspace'") reset = node.thenStatement;
      ts.forEachChild(node, visit);
    }
    visit(ast); assert.ok(reset);
    const code = ts.transpileModule(`(event) => ${reset.getText(ast)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    for (const [map, homeAlpha] of [[DOTA_MAP_KEY, dotaMapConfig.camera.alpha], ['/maps/4p_doom_spiral/4p_doom_spiral.sgb', 0], ['arena', DEFAULT_CAMERA_ALPHA]]) {
      for (const alpha of [0, Math.PI, 1.234]) {
        const camera = { alpha, beta: .2, radius: 300 };
        setInitialCameraAlpha(camera, homeAlpha);
        camera.alpha = alpha;
        const run = vm.runInNewContext(code, { camera, window: { _currentMapKey: map }, isDotaMap, dotaMapConfig, DEFAULT_CAMERA_RADIUS, DEFAULT_CAMERA_BETA, restoreInitialCameraAlpha });
        let prevented = false;
        run({ preventDefault() { prevented = true; } });
        assert.equal(camera.alpha, homeAlpha);
        assert.equal(camera.radius, isDotaMap(map) ? dotaMapConfig.camera.radius : DEFAULT_CAMERA_RADIUS);
        assert.equal(camera.beta, isDotaMap(map) ? dotaMapConfig.camera.beta : DEFAULT_CAMERA_BETA);
        assert.ok(prevented);
        camera.radius = 200;
        camera.alpha = 1.23;
        run({ target: { tagName: 'INPUT' }, preventDefault() {} });
        assert.equal(camera.radius, 200, 'typing keeps the current zoom');
        assert.equal(camera.alpha, 1.23, 'typing keeps the current angle');
      }
    }
  });

  it('starts Doom Spiral straight-on and Dota with its authored orientation', () => {
    const game = fs.readFileSync(path.join(root, 'src/core/game.ts'), 'utf8');
    assert.ok(game.includes('/doom.?spiral/i.test(mapKey'), 'doom spiral matched by map key');
    assert.ok(game.includes('dotaMap ? dotaMapConfig.camera.alpha : doomSpiral ? 0 : DEFAULT_CAMERA_ALPHA'), 'each map uses its own initial yaw');
    assert.ok(game.includes('(50 * Math.PI) / 180'), 'doom spiral pitch is 50deg');
    assert.ok(game.includes('camera.beta = startBeta'), 'both spawn paths use the per-map pitch');
    assert.ok(game.includes('setInitialCameraAlpha(camera, startAlpha)'), 'both spawn paths use the per-map yaw');
  });
});
