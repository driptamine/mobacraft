import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayName, playersFor, previewFor, listBuiltinMaps, entryLabel, previewState, skirmishMapCards, defaultSkirmishMap } from '../src/ui/maps-menu.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dota = { path: '/maps/dotamap-game/map.json', url: '/maps/dotamap-game/map.json', name: 'Dota 2', players: 2, previewUrl: '/maps/dotamap-game/preview.png' };

describe('map selection menu', () => {
  it('displayName uses the file base name without extension or separators', () => {
    assert.equal(displayName('/maps/6p_alvarus/6p_alvarus.sgb'), '6p alvarus');
    assert.equal(displayName('/maps/duel/my-cool_map.SGB'), 'my cool map');
  });

  it('playersFor parses the Np prefix', () => {
    assert.equal(playersFor('/maps/6p_alvarus/6p_alvarus.sgb'), 6);
    assert.equal(playersFor('/maps/duel/2p_duel.sgb'), 2);
    assert.equal(playersFor('/maps/6p_alvarus/alvarus.sgb'), null);
  });

  it('previewFor pairs the _preview.png file in the same folder', () => {
    const previews = { '/maps/6p_alvarus/6p_alvarus_preview.png': '/assets/6p_alvarus_preview.png' };
    assert.equal(previewFor('/maps/6p_alvarus/6p_alvarus.sgb', previews), '/assets/6p_alvarus_preview.png');
    assert.equal(previewFor('/maps/other/other.sgb', previews), null);
  });

  it('previewFor prefers icon_custom over icon over _preview', () => {
    const previews = {
      '/maps/a/a_icon_custom.png': 'custom-img',
      '/maps/a/a_icon.png': 'icon-img',
      '/maps/a/a_preview.png': 'preview-img',
      '/maps/b/b_icon.png': 'icon-img',
      '/maps/b/b_preview.png': 'preview-img',
      '/maps/c/c_preview.png': 'preview-img',
    };
    assert.equal(previewFor('/maps/a/a.sgb', previews), 'custom-img');
    assert.equal(previewFor('/maps/b/b.sgb', previews), 'icon-img');
    assert.equal(previewFor('/maps/c/c.sgb', previews), 'preview-img');
  });

  it('every shipped map has an icon preview except the known icon-less one', () => {
    const noIcon = new Set(['8p_oasis_of_sharr']);
    for (const dir of fs.readdirSync(path.join(root, 'maps'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
      const folder = path.join(root, 'maps', dir);
      if (!fs.readdirSync(folder).some((f) => f.toLowerCase() === `${dir.toLowerCase()}.sgb`)) continue;
      const files = fs.readdirSync(folder).map((f) => f.toLowerCase());
      const has = files.includes(`${dir.toLowerCase()}_icon_custom.png`) || files.includes(`${dir.toLowerCase()}_icon.png`) || files.includes(`${dir.toLowerCase()}_preview.png`);
      if (noIcon.has(dir)) assert.equal(has, false, dir);
      else assert.ok(has, `${dir} has no map preview`);
    }
  });

  it('entryLabel appends the player count when known', () => {
    assert.equal(entryLabel({ name: '4p doom spiral', players: 4 }), '4p doom spiral (4P)');
    assert.equal(entryLabel({ name: '6p alvarus', players: 6 }), '6p alvarus (6P)');
    assert.equal(entryLabel({ name: 'b', players: null }), 'b');
  });

  it('listBuiltinMaps lists per-map folders in path order', () => {
    const glob = {
      '/maps/6p_alvarus/6p_alvarus.sgb': 'alvarus-url',
      '/maps/8p_burial_grounds/8p_burial_grounds.sgb': 'burial-url',
      '/maps/4p_doom_spiral/4p_doom_spiral.sgb': 'doom-url',
    };
    const entries = listBuiltinMaps(glob, {});
    assert.deepEqual(entries.map((e) => e.path), [
      '/maps/4p_doom_spiral/4p_doom_spiral.sgb',
      '/maps/6p_alvarus/6p_alvarus.sgb',
      '/maps/8p_burial_grounds/8p_burial_grounds.sgb',
    ]);
    assert.deepEqual(entries.map((e) => entryLabel(e)), [
      '4p doom spiral (4P)',
      '6p alvarus (6P)',
      '8p burial grounds (8P)',
    ]);
  });

  it('previewState maps entries to image or empty preview', () => {
    assert.deepEqual(previewState({ previewUrl: 'a-img' }), { kind: 'image', url: 'a-img' });
    assert.deepEqual(previewState({ previewUrl: null }), { kind: 'empty' });
    assert.deepEqual(previewState(null), { kind: 'empty' });
  });

  it('skirmishMapCards shows Default Arena, Doom Spiral and Dota while other SGB maps stay hidden', () => {
    const doom = { path: '/maps/4p_doom_spiral/4p_doom_spiral.sgb', url: 'd', name: 'Doom Spiral', players: 4, previewUrl: null };
    const builtin = [{ path: '/maps/a.sgb', url: 'u', name: 'a', players: 4, previewUrl: null }, doom];
    const cards = skirmishMapCards(builtin);
    assert.deepEqual(cards, [
      { path: null, url: null, name: 'Default Arena', players: null, previewUrl: null }, doom, dota,
    ]);
  });

  it('skirmishMapCards keeps Default Arena available when Doom Spiral is unavailable', () => {
    assert.deepEqual(skirmishMapCards([]), [
      { path: null, url: null, name: 'Default Arena', players: null, previewUrl: null }, dota,
    ]);
  });

  it('defaultSkirmishMap preselects 4p_doom_spiral when shipped', () => {
    const cards = skirmishMapCards([
      { path: '/maps/4p_doom_spiral/4p_doom_spiral.sgb', url: 'd', name: 'doom', players: 4, previewUrl: null },
      { path: '/maps/6p_alvarus/6p_alvarus.sgb', url: 'a', name: 'alvarus', players: 6, previewUrl: null },
    ]);
    assert.equal(defaultSkirmishMap(cards)?.path, '/maps/4p_doom_spiral/4p_doom_spiral.sgb');
    assert.equal(defaultSkirmishMap(skirmishMapCards([])), null);
    assert.equal(defaultSkirmishMap([]), null);
  });

  it('skirmish grid defaults the selection to doom spiral', () => {
    const src = fs.readFileSync(path.join(root, 'src/net/multiplayer.ts'), 'utf8');
    const grid = src.slice(src.indexOf('function _buildMapGrid'), src.indexOf('function _setConnectOverlay'));
    assert.ok(grid.includes('defaultSkirmishMap(cards)'), 'grid consults the default');
    assert.ok(grid.includes('_selectedMap = { path: def.path, url: def.url, name: def.name };'), 'default becomes the selection');
  });

  it('skirmish grid selects on click and opens slots on double-click', () => {
    const src = fs.readFileSync(path.join(root, 'src/net/multiplayer.ts'), 'utf8');
    const grid = src.slice(src.indexOf('function _buildMapGrid'), src.indexOf('function _setConnectOverlay'));
    const click = grid.slice(grid.indexOf("addEventListener('click'"), grid.indexOf("addEventListener('dblclick'"));
    assert.ok(click.includes('_renderMapDetail(card, detail)'), 'first click renders the detail preview');
    assert.ok(click.includes('_openSkirmishSlots(card)'), 'second click on the selected card opens slots');
    assert.ok(click.includes("if (key === selectedKey && btn.classList.contains('active'))"), 'slots open only for the already selected card');
    const dblclick = grid.slice(grid.indexOf("addEventListener('dblclick'"));
    assert.ok(dblclick.includes('_openSkirmishSlots(card)'), 'double-click opens the slot menu');
  });

  it('listMaps falls back to the uploaded manifest when the build glob is empty', async () => {
    const { listMaps, listBuiltinMaps } = await import('../src/ui/maps-menu.js');
    const { resetMapManifestForTests } = await import('../src/maps/map-source.js');
    assert.deepEqual(listBuiltinMaps({}, {}), [], 'empty globs in production builds');
    const stubFetch = async (url) => {
      assert.equal(String(url), '/maps/manifest.json');
      return { ok: true, json: async () => [
        { path: '/maps/a/a.sgb', name: 'a land', players: 4, preview: '/maps/a/a_icon_custom.png' },
        { path: '/maps/4p_doom_spiral/4p_doom_spiral.sgb', name: 'Doom Spiral', players: 4, preview: '/maps/4p_doom_spiral/4p_doom_spiral_icon_custom.png' },
      ] };
    };
    resetMapManifestForTests();
    assert.deepEqual(await listMaps(stubFetch), [{
      path: '/maps/4p_doom_spiral/4p_doom_spiral.sgb', url: '/maps/4p_doom_spiral/4p_doom_spiral.sgb', name: 'Doom Spiral', players: 4, previewUrl: '/maps/4p_doom_spiral/4p_doom_spiral_icon_custom.png',
    }, dota]);
    resetMapManifestForTests();
    assert.deepEqual(await listMaps(async () => ({ ok: false, status: 404 })), [dota], 'failed manifest means no maps, not a crash');
  });

  it('listBuiltinMaps sorts entries and attaches meta', () => {
    const glob = { '/maps/b/b.sgb': 'b-url', '/maps/a/6p_a.sgb': 'a-url' };
    const previews = { '/maps/a/6p_a_preview.png': 'a-img' };
    assert.deepEqual(listBuiltinMaps(glob, previews), [
      { path: '/maps/a/6p_a.sgb', url: 'a-url', name: '6p a', players: 6, previewUrl: 'a-img' },
      { path: '/maps/b/b.sgb', url: 'b-url', name: 'b', players: null, previewUrl: null },
    ]);
  });
});

describe('alvarus ground sheet', () => {
  it('uses the DDS-derived PNG, and the file is a real 256x256 PNG', () => {
    const src = fs.readFileSync(path.join(root, 'src/ui/maps-menu.ts'), 'utf8');
    assert.match(src, /loadTerrainTextureUrl\(mapFileUrl\('6p_alvarus', 'decals\/terrain\/chaos_taint_02_dds\.png'\), '6P ALVARUS'\)/);
    const buf = fs.readFileSync(path.join(root, 'maps/6p_alvarus/decals/terrain/chaos_taint_02_dds.png'));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG');
    assert.equal(buf.readUInt32BE(16), 256);
    assert.equal(buf.readUInt32BE(20), 256);
  });
});
