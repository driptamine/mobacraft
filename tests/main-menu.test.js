import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MENU_ITEMS, screenFor, creditNames } from '../src/ui/main-menu.js';

describe('startup main menu', () => {
  it('includes the standalone balance editor in the menu', () => {
    assert.deepEqual(
      MENU_ITEMS.map((item) => item.label),
      ['Campaign', 'Skirmish', 'Multi-player', 'Army Painter', 'Balance Editor', 'Settings', 'Credits'],
    );
  });

  it('routes skirmish and multi-player to live screens, the rest to stubs', () => {
    assert.equal(screenFor('skirmish'), 'skirmish');
    assert.equal(screenFor('multiplayer'), 'multiplayer');
    for (const id of ['campaign', 'army-painter', 'settings', 'credits']) {
      assert.equal(screenFor(id), 'stub');
    }
  });

  it('menu shell never blocks on the multiplayer chunk', () => {
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const src = fs.readFileSync(path.join(root, 'src/ui/main-menu.ts'), 'utf8');
    const inject = src.slice(src.indexOf('export async function injectMainMenu'));
    assert.ok(!/await import\(/.test(inject), 'inject renders without awaiting imports');
    assert.ok(src.includes('_showSkirmishPanel?.();'), 'skirmish click opens the map list when the chunk arrives');
    assert.ok(!src.includes('_openSkirmishSlotsDefault'), 'no slots detour on the skirmish path');
    assert.ok(src.includes('_showConnectOverlay?.(screen);'), 'multi-player click waits for the chunk when handlers are missing');
  });

  it('clicks never show a loading state and extra clicks are ignored while loading', () => {
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const src = fs.readFileSync(path.join(root, 'src/ui/main-menu.ts'), 'utf8');
    const click = src.slice(src.indexOf('function _onItemClick'));
    assert.ok(!click.includes('LOADING'), 'no loading indicator anywhere on the click path');
    assert.ok(!click.includes('.disabled = true'), 'buttons never lock up mid-load');
    assert.ok(click.includes('if (_openingScreen) return;'), 'repeat clicks wait for the same load');
    assert.ok(!/^  hideMainMenu\(\);$/m.test(click), 'menu hides only when the panel is ready, never blank');
  });

  it('shows a static skeleton until the quality value lands', () => {
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.includes('id="main-menu-skeleton"'), 'skeleton paints before any JS');
    assert.ok(html.includes('prefers-reduced-motion'), 'skeleton respects reduced motion');
    assert.ok(/z-index:\s*1000[1-9]/.test(html), 'skeleton sits above the menu until boot is visible');
    const src = fs.readFileSync(path.join(root, 'src/ui/main-menu.ts'), 'utf8');
    assert.ok(src.includes('dismissMenuSkeleton'), 'skeleton dismissal is centralized');
    assert.ok(src.includes('main-menu-btn--value-loading'), 'async button values shimmer while loading');
    assert.ok(src.includes("removeAttribute('aria-busy')"), 'shimmer clears when the value lands');
  });

  it('entry paints the menu before the heavy graph', () => {
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const src = fs.readFileSync(path.join(root, 'src/entry.ts'), 'utf8');
    assert.ok(
      src.indexOf("import('./ui/main-menu.js')") < src.indexOf("import('./hud/index.jsx')"),
      'menu first, hud and game behind it',
    );
    assert.ok(
      src.indexOf("import('./hud/index.jsx')") > src.indexOf('injectMainMenu()'),
      'hud and game load only after the menu DOM exists',
    );
  });

  it('renders each credits name on its own line', () => {
    assert.deepEqual(creditNames, ['Driptamine', 'Alexander Morgun', 'Snezhana Shevtsova']);
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const src = fs.readFileSync(path.join(root, 'src/ui/main-menu.ts'), 'utf8');
    assert.ok(src.includes('for (const name of creditNames)'), 'render uses creditNames');
    assert.ok(src.includes("line.className = 'main-menu-stub-note'"), 'each name gets its own line element');
    assert.ok(src.includes("item.id === 'credits'"), 'credits opens its own screen, not the stub');
  });
});
