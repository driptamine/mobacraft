import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createSgbParser } from '../src/sgb-parser.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadMap(sgbPath) {
  const buf = fs.readFileSync(path.join(root, sgbPath));
  const parser = createSgbParser(null);
  const origLog = console.log;
  console.log = () => {};
  try {
    parser.parse(buf);
  } finally {
    console.log = origLog;
  }
  return parser;
}

describe('sgb tile blocks', () => {
  for (const sgbPath of ['maps/6p_alvarus/6p_alvarus.sgb', 'maps/8p_burial_grounds/8p_burial_grounds.sgb']) {
    it(`merges 4x4 tile blocks sharing one material (${sgbPath})`, () => {
      const parser = loadMap(sgbPath);
      const map = parser.createThreeMap();
      const blocks = map.children.filter((c) => c.isMesh);
      assert.equal(blocks.length, (parser.numTilesX / 4) * (parser.numTilesZ / 4));
      assert.ok(blocks.every((b) => b.name.startsWith('SGB_Tile')));
      const materials = new Set(blocks.map((b) => b.material));
      assert.equal(materials.size, 1);
      for (const b of blocks) {
        assert.ok(b.geometry.getAttribute('position'));
        assert.ok(b.geometry.getAttribute('normal'));
        assert.ok(b.geometry.getAttribute('uv'));
        assert.ok(b.geometry.getAttribute('uv2'));
        assert.ok(b.geometry.index);
      }
      // No triangle lost: 16x16 cells -> 512 tris per tile.
      const totalIndex = blocks.reduce((sum, b) => sum + b.geometry.index.count, 0);
      assert.equal(totalIndex, parser.numTilesX * parser.numTilesZ * 512 * 3);
      // Merged extents tile the whole map exactly (no gaps/overlaps).
      const box = new THREE.Box3();
      for (const b of blocks) {
        b.geometry.computeBoundingBox();
        box.union(b.geometry.boundingBox);
      }
      assert.ok(Math.abs((box.max.x - box.min.x) - parser.numTilesX * parser.tileSize) < 0.01);
      assert.ok(Math.abs((box.max.z - box.min.z) - parser.numTilesZ * parser.tileSize) < 0.01);
      assert.ok(Number.isFinite(box.min.y) && Number.isFinite(box.max.y));
    });
  }
});
