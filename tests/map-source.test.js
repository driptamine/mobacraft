import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapBase, mapUrl } from '../src/render/assets.js';
import {
  mapDirFromKey,
  mapFileUrl,
  mapFetchInit,
  mapManifestUrl,
  listRemoteMaps,
  resetMapManifestForTests,
  collectMapFileUrls,
  prefetchMapFiles,
} from '../src/maps/map-source.js';

describe('map source urls', () => {
  it('keeps local paths unchanged without a map base (dev)', () => {
    assert.equal(mapBase(), '');
    assert.equal(mapUrl('/maps/2p_blood_river/2p_blood_river.sgb'), '/maps/2p_blood_river/2p_blood_river.sgb');
    assert.equal(mapUrl(''), '');
    assert.equal(mapUrl('https://cdn.example.com/maps/a.sgb'), 'https://cdn.example.com/maps/a.sgb');
  });

  it('extracts the map dir from keys, paths and urls', () => {
    assert.equal(mapDirFromKey('maps/2p_blood_river/2p_blood_river.sgb'), '2p_blood_river');
    assert.equal(mapDirFromKey('/maps/2p_blood_river/2p_blood_river.sgb'), '2p_blood_river');
    assert.equal(mapDirFromKey('https://r2.example.com/maps/2p_blood_river/2p_blood_river.sgb'), '2p_blood_river');
    assert.equal(mapDirFromKey('arena'), '');
    assert.equal(mapDirFromKey(null), '');
  });

  it('addresses files inside the map folder', () => {
    assert.equal(mapFileUrl('2p_blood_river', 'layout.json'), '/maps/2p_blood_river/layout.json');
    assert.equal(mapFileUrl('', 'layout.json'), 'layout.json');
  });

  it('uses no-store only on localhost (dev iteration)', () => {
    const keep = globalThis.window;
    try {
      globalThis.window = { location: { hostname: 'localhost' } };
      assert.deepEqual(mapFetchInit(), { cache: 'no-store' });
      globalThis.window = { location: { hostname: 'grimcraft.example.com' } };
      assert.deepEqual(mapFetchInit(), {});
      // @ts-expect-error probe without window
      delete globalThis.window;
      assert.deepEqual(mapFetchInit(), {});
    } finally {
      if (keep === undefined) delete globalThis.window;
      else globalThis.window = keep;
    }
  });
});

describe('remote map manifest', () => {
  it('treats spa-fallback html as a missing file, not a json error', async () => {
    const { fetchMapJson } = await import('../src/maps/map-source.js');
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response('<!DOCTYPE html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
      assert.equal(await fetchMapJson('/maps/6p_alvarus/layout.json'), null);
      globalThis.fetch = (async () => new Response('{"rows":[],"grid":{}}', { status: 200, headers: { 'content-type': 'application/json' } }));
      assert.deepEqual(await fetchMapJson('/maps/x/x_path.json'), { rows: [], grid: {} });
      globalThis.fetch = (async () => { throw new Error('offline'); });
      assert.equal(await fetchMapJson('/maps/x/x.json'), null);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('resolves entries to local files when no base is set', async () => {
    resetMapManifestForTests();
    let fetched = '';
    const stubFetch = (async (url) => {
      fetched = String(url);
      return { ok: true, json: async () => [{ path: '/maps/a/a.sgb', name: 'a', players: 2, preview: '/maps/a/a_icon_custom.png' }] };
    });
    const entries = await listRemoteMaps(stubFetch);
    assert.equal(fetched, '/maps/manifest.json');
    assert.deepEqual(entries, [{
      path: '/maps/a/a.sgb',
      url: '/maps/a/a.sgb',
      name: 'a',
      players: 2,
      previewUrl: '/maps/a/a_icon_custom.png',
    }]);
  });

  it('returns [] when the manifest cannot load', async () => {
    resetMapManifestForTests();
    const failing = async () => ({ ok: false, status: 404 });
    assert.deepEqual(await listRemoteMaps(failing), []);
    const throwing = async () => { throw new Error('offline'); };
    resetMapManifestForTests();
    assert.deepEqual(await listRemoteMaps(throwing), []);
  });
});

describe('map file collection', () => {
  const layout = {
    terrain: { detail_textures: [{ file: 'textures/rocky_ground.png' }] },
    decals: [{ ref: 'art/decals/z_all/crater_02b' }, { ref: 'art/decals/jungle/stone_pile_02' }],
  };

  it('lists sgb, layout, grid and every referenced texture and decal', () => {
    const urls = collectMapFileUrls('2p_blood_river', layout);
    for (const file of [
      '/maps/2p_blood_river/2p_blood_river.sgb',
      '/maps/2p_blood_river/layout.json',
      '/maps/2p_blood_river/2p_blood_river_path.json',
      '/maps/2p_blood_river/textures/rocky_ground.png',
      '/maps/2p_blood_river/decals/crater_02b.png',
      '/maps/2p_blood_river/decals/stone_pile_02.png',
    ]) {
      assert.ok(urls.includes(file), file);
    }
    assert.deepEqual([...new Set(urls)], urls, 'no duplicates');
  });

  it('resolves flat decal urls first, subfolders as fallback', async () => {
    const { decalUrlForRef, decalFallbackUrlForRef } = await import('../src/maps/map-source.js');
    const dir = '6p_alvarus';
    const primary = decalUrlForRef(dir, 'art/decals/z_all/crater_02');
    assert.equal(primary, '/maps/6p_alvarus/decals/crater_02.png');
    assert.equal(
      decalFallbackUrlForRef(dir, 'art/decals/z_all/crater_02', primary),
      '/maps/6p_alvarus/decals/z_all/crater_02.png',
    );
    assert.equal(decalFallbackUrlForRef(dir, 'crater_02', primary), null);
    assert.equal(decalUrlForRef('', 'art/decals/z_all/crater_02'), null);
    assert.equal(decalFallbackUrlForRef('', 'art/decals/z_all/crater_02', primary), null);
  });

  it('prefetches the map files in the background and skips arena', async () => {
    const fetched = [];
    const stubFetch = async (url) => {
      fetched.push(String(url));
      if (String(url).endsWith('layout.json')) {
        return { ok: true, json: async () => layout, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = stubFetch;
    try {
      prefetchMapFiles({ path: '/maps/2p_blood_river/2p_blood_river.sgb' });
      prefetchMapFiles({ path: null });
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.ok(fetched.includes('/maps/2p_blood_river/2p_blood_river.sgb'), `fetched sgb, got ${fetched.length} urls`);
    assert.ok(fetched.includes('/maps/2p_blood_river/decals/crater_02b.png'));
  });
});
