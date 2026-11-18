import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { extractSgbLayout } from '../scripts/extract-sgb-layout.mjs';
import { createSgbParser } from '../src/maps/sgb-parser.js';
import { resolveDecalUrl } from '../src/maps/decal-size.js';

for (const expected of [
  { map: '6p_mortalis', decals: 288, entities: 296, types: 10, counts: [[14, 126], [15, 66], [18, 32], [35, 28], [50, 4]], origin: -257, size: 257, missing: [] },
  { map: '8p_oasis_of_sharr', decals: 913, entities: 569, types: 15, counts: [[30, 495], [58, 200], [102, 18], [143, 44], [144, 267]], origin: -513, size: 513, missing: [] },
  { map: '8p_burial_grounds', decals: 1180, entities: 1204, types: 17, counts: [[33, 239], [37, 660], [50, 10], [55, 96], [82, 19]], origin: -513, size: 513, missing: [] },
  { map: '4p_doom_spiral', decals: 424, entities: 375, types: 15, counts: [[31, 104], [72, 9], [75, 3]], origin: -257, size: 257, missing: [] },
  { map: '6p_paynes_retribution', decals: 557, entities: 406, types: 19, counts: [[58, 982], [62, 1], [80, 1], [125, 5], [128, 15], [174, 3], [178, 9], [203, 8]], origin: -513, size: 513, missing: [] },
  { map: '4p_into_the_breach', decals: 310, entities: 170, types: 13, counts: [[10, 164], [53, 10], [68, 78], [92, 4]], origin: -257, size: 257, missing: [] },
  { map: '4p_ariel_highlands', decals: 1313, entities: 1091, types: 18, counts: [[56, 580], [94, 16], [97, 428]], origin: -513, size: 513, missing: [] },
  { map: '2p_blood_river', decals: 132, entities: 137, types: 6, counts: [[19, 63], [20, 3], [22, 190]], origin: -257, size: 257, missing: [] },
  { map: '2p_fallen_city', decals: 778, entities: 697, types: 36, counts: [[4, 149], [9, 25], [11, 4], [29, 75], [46, 3]], origin: -257, size: 257, missing: [] },
  { map: '2p_fata_morgana', decals: 396, entities: 368, types: 20, counts: [[36, 252], [71, 4]], origin: -257, size: 257, missing: [] },
  { map: '2p_meeting_of_minds', decals: 326, entities: 280, types: 15, counts: [[17, 68], [38, 188]], origin: -257, size: 257, missing: [] },
  { map: '2p_outer_reaches', decals: 265, entities: 328, types: 11, counts: [[0, 58], [37, 36], [49, 63], [60, 74], [63, 25]], origin: -257, size: 257, missing: [] },
  { map: '2p_shrine_of_excellion', decals: 445, entities: 392, types: 17, counts: [[43, 4], [52, 12], [55, 48], [90, 192]], origin: -257, size: 257, missing: [] },
  { map: '2p_titan_fall', decals: 444, entities: 835, types: 37, counts: [[0, 15], [68, 42], [81, 17], [113, 1], [149, 3], [162, 1], [228, 7], [289, 2], [300, 1], [364, 20], [434, 99], [440, 6], [496, 36], [559, 6]], origin: -257, size: 257, missing: [] },
  { map: '4p_biffys_peril', decals: 218, entities: 404, types: 13, counts: [[17, 74], [27, 156], [32, 4], [49, 20], [51, 2]], origin: -257, size: 257, missing: [] },
  { map: '4p_gurmuns_pass', decals: 424, entities: 209, types: 12, counts: [[13, 66], [25, 36], [102, 154]], origin: -257, size: 257, missing: [] },
  { map: '4p_panrea_lowlands', decals: 848, entities: 576, types: 48, counts: [[92, 114], [94, 1], [117, 141]], origin: -257, size: 257, missing: [] },
  { map: '6p_kasyr_lutien', decals: 1690, entities: 1230, types: 30, counts: [[6, 25], [7, 48], [8, 351], [15, 104], [22, 75], [29, 13], [31, 17], [37, 53], [43, 44], [45, 255], [54, 2], [65, 37]], origin: -513, size: 513, missing: [] },
  { map: '6p_parmenie', decals: 305, entities: 115, types: 14, counts: [[79, 2], [95, 254]], origin: -257, size: 257, missing: [] },
  { map: '6p_thargorum', decals: 701, entities: 186, types: 17, counts: [[48, 256]], origin: -257, size: 257, missing: [] },
  { map: '6p_vandea_coast', decals: 892, entities: 211, types: 37, counts: [[96, 153], [100, 103]], origin: -257, size: 257, missing: [] },
  { map: '6p_western_barrens', decals: 1014, entities: 1326, types: 29, counts: [[75, 502], [137, 8], [207, 2]], origin: -513, size: 513, originZ: -257, sizeZ: 257, missing: [] },
  { map: '8p_demes_northlands', decals: 1873, entities: 66, types: 32, counts: [[63, 92], [64, 262], [100, 1]], origin: -513, size: 513, missing: [] },
  { map: '8p_forbidden_jungle', decals: 1267, entities: 1578, types: 31, counts: [[56, 127], [105, 241], [119, 3], [140, 653]], origin: -513, size: 513, missing: [] },
  { map: '8p_jalaganda_lowlands', decals: 1629, entities: 1543, types: 54, counts: [[0, 403], [87, 50], [93, 102], [165, 51], [191, 418]], origin: -513, size: 513, missing: [] },
  { map: '8p_morriah_coast', decals: 1849, entities: 2987, types: 52, counts: [[78, 768], [82, 243], [200, 4], [247, 9]], origin: -513, size: 513, missing: [] },
  { map: '8p_rhean_jungle', decals: 1431, entities: 2237, types: 41, counts: [[0, 2], [73, 750], [77, 102], [156, 35], [157, 12], [192, 12], [193, 65], [210, 2], [212, 43], [246, 1]], origin: -513, size: 513, missing: [] },
]) {
const folder = fileURLToPath(new URL(`../maps/${expected.map}/`, import.meta.url));
const bytes = fs.readFileSync(folder + `${expected.map}.sgb`);
const layout = JSON.parse(fs.readFileSync(folder + 'layout.json', 'utf8'));

describe(`${expected.map} authored layout`, () => {
  it('can be reproduced from the SGB without hand-placed coordinates', () => {
    assert.deepEqual(layout, extractSgbLayout(bytes, `${expected.map}.sgb`).layout);
    assert.equal(layout.decals.length, expected.decals);
    assert.equal(layout.entities.length, expected.entities);
    assert.equal(new Set(layout.decals.map((decal) => decal.ref)).size, expected.types);
    assert.deepEqual(layout.terrain.detail_textures.map(({ index, tile_count }) => [index, tile_count]).sort((a, b) => a[0] - b[0]), expected.counts);
    assert.deepEqual(layout.terrain.local_origin, [expected.origin, expected.originZ ?? expected.origin]);
    assert.deepEqual(layout.terrain.size, [expected.size, expected.sizeZ ?? expected.size]);
  });

  it('preserves raw decal coordinates, rotations and texture tile IDs', () => {
    const parser = createSgbParser();
    const source = parser.parse(bytes);
    assert.deepEqual(layout.terrain.texture_indices.rows.flat(), source.tileTextureIndices);
    const paths = new Map(source.decalLinks.map(({ id, path }) => [id, path]));
    assert.deepEqual(layout.decals, source.decals.map((decal) => ({ id: decal.id, ref: paths.get(decal.decalIdx), x: decal.x, z: decal.z, size_raw: decal.size, rotation_rad: decal.angle })));
  });

  it('assigns every terrain tile its authored texture and preserves all triangles', () => {
    const parser = createSgbParser();
    parser.parse(bytes);
    const root = parser.createThreeMap(null, { tileTextureIndices: layout.terrain.texture_indices.rows.flat() });
    assert.equal(new Set(root.children.map((mesh) => mesh.material)).size, new Set(layout.terrain.texture_indices.rows.flat()).size);
    let triangles = 0;
    const actualCounts = new Map();
    for (const mesh of root.children) {
      const positions = mesh.geometry.getAttribute('position');
      triangles += mesh.geometry.index.count / 3;
      // Each source tile contributes 17*17 vertices, even after merging.
      for (let vertex = 0; vertex < positions.count; vertex += 289) {
        const col = Math.round((positions.getX(vertex) - expected.origin) / 32);
        const row = Math.round((positions.getZ(vertex) - (expected.originZ ?? expected.origin)) / 32);
        assert.equal(mesh.userData.detailTextureIndex, layout.terrain.texture_indices.rows[row][col], `tile ${col},${row}`);
        actualCounts.set(mesh.userData.detailTextureIndex, (actualCounts.get(mesh.userData.detailTextureIndex) || 0) + 1);
      }
    }
    assert.equal(triangles, ((expected.size - 1) / 16) * ((expected.sizeZ ?? expected.size) - 1) / 16 * 512);
    for (const detail of layout.terrain.detail_textures) assert.equal(actualCounts.get(detail.index), detail.tile_count);
  });

  it('resolves supplied decals to this map before shared files and identifies missing assets', () => {
    const assets = Object.fromEntries(fs.readdirSync(folder + 'decals', { recursive: true }).filter((name) => name.endsWith('.png')).map((name) => [`/maps/${expected.map}/decals/${name}`, `${expected.map}:${name}`]));
    assets['/maps/6p_alvarus/decals/jungle/jungle_canopy_01.png'] = 'wrong shared asset';
    const missing = new Set();
    for (const decal of layout.decals) {
      const url = resolveDecalUrl(decal.ref, `/maps/${expected.map}/${expected.map}.sgb`, assets);
      if (!url) missing.add(decal.ref);
      else assert.ok(url.startsWith(`${expected.map}:`), decal.ref);
    }
    assert.deepEqual([...missing], expected.missing);
    assert.equal(resolveDecalUrl('art/decals/jungle/jungle_canopy_01', '/maps/6p_alvarus/6p_alvarus.sgb', assets), 'wrong shared asset');
  });

  it('stores complete browser-ready RGBA PNGs after removing source format duplicates', () => {
    for (const dir of ['textures', 'decals']) {
      for (const file of fs.readdirSync(folder + dir, { recursive: true }).filter((file) => file.endsWith('.png'))) {
        const png = fs.readFileSync(folder + dir + '/' + file);
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.equal(png[24], 8, '8-bit channels');
        assert.equal(png[25], 6, 'RGBA includes decal transparency');
        const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
        assert.ok(width > 0 && height > 0);
        const compressed = [];
        for (let offset = 8; offset < png.length;) {
          const length = png.readUInt32BE(offset);
          if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') compressed.push(png.subarray(offset + 8, offset + 8 + length));
          offset += length + 12;
        }
        const scanlines = inflateSync(Buffer.concat(compressed));
        assert.equal(scanlines.length, height * (width * 4 + 1), `${dir}/${file}: all pixels present`);
      }
    }
  });
});
}
