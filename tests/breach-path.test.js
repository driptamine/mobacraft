import { it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createChunkReader } from '../src/maps/sgb-reader.js';
import { extractSgbPath } from '../scripts/extract-sgb-path.mjs';
import { sgbPassBlockedAt } from '../pathfinding/avoid.js';
import { findSquadPath, hasLineOfSight, clampStepToRoute, cellToWorld } from '../pathfinding/astar-integrated.js';

const map = '4p_into_the_breach';
const read = file => fs.readFileSync(new URL(`../maps/${map}/${file}`, import.meta.url));
const doc = JSON.parse(read(`${map}_path.json`));
const layout = JSON.parse(read(`${map}.json`));
globalThis.window = {};
afterEach(() => { delete window.__sgbPassGrid; });

it('Breach paint matches every original SGB cell at the authored scale and game orientation', () => {
  const reader = createChunkReader(read(`${map}.sgb`));reader.skipChunky();let end = reader.size;
  for (const wanted of ['FOLDSCEN', 'FOLDWSTC', 'FOLDMSTC', 'FOLDPFDR', 'DATAIMPA']) {
    let found = false;
    while (reader.position < end) {
      const header = reader.readHeader(), payloadEnd = reader.position + header.size;
      if (header.typeid === wanted) { end = payloadEnd;found = true;break; }
      reader.skip(payloadEnd - reader.position);
    }
    assert.ok(found, wanted);
  }
  assert.equal(reader.readU32(), 128);assert.equal(reader.readU32(), 128);
  assert.equal(reader.readFloat(), 2);assert.equal(end - reader.position, 128 * 128);
  const raw = reader.readData(128 * 128);
  assert.deepEqual([doc.grid.originX, doc.grid.originZ, doc.grid.sizeX, doc.grid.sizeZ, doc.grid.cellWorld], [-128, -128, 128, 128, 2]);
  for (let row = 0; row < 128; row++) for (let column = 0; column < 128; column++) {
    assert.equal(doc.rows[row][column], raw[(127-column)*128+(127-row)], `world cell ${column},${row}`);
  }
  assert.deepEqual(doc.counts, { 2: 10680, 3: 574, 7: 4887, 70: 125, 71: 118 });
});

it('all four starts and all sixteen objectives remain on open ground', () => {
  assert.equal(layout.positions.length, 4);assert.equal(layout.strategicPoints.length, 16);
  for (const point of [...layout.positions, ...layout.strategicPoints]) {
    assert.equal(sgbPassBlockedAt(doc, point.x, point.z), false, JSON.stringify(point));
  }
});

it('A* connects every start to every objective without crossing closed paint', () => {
  for (const start of layout.positions) for (const goal of layout.strategicPoints) {
    const direct = hasLineOfSight(doc, start.x, start.z, goal.x, goal.z);
    const route = findSquadPath(start, goal, { passGrid: doc, groundAt: () => 0 });
    assert.ok(direct || route?.length, `unreachable ${JSON.stringify(start)} → ${JSON.stringify(goal)}`);
    const legs = [start, ...(route || [goal])];
    for (let index = 1; index < legs.length; index++) {
      assert.ok(hasLineOfSight(doc, legs[index-1].x, legs[index-1].z, legs[index].x, legs[index].z));
      assert.equal(sgbPassBlockedAt(doc, legs[index].x, legs[index].z), false);
    }
  }
});

it('movement blocks 3, 7, 70 and 71 and cannot step through a painted wall', () => {
  window.__sgbPassGrid = doc;
  const found = new Set();
  for (let row = 0; row < 128; row++) for (let column = 0; column < 128; column++) {
    const value = doc.rows[row][column];
    if (value === 2) continue;
    const target = cellToWorld(doc, column, row);
    assert.equal(sgbPassBlockedAt(doc, target.x, target.z), true);
    found.add(value);
  }
  assert.deepEqual([...found].sort((a,b) => a-b), [3, 7, 70, 71]);
  // 70/71 are inside closed regions rather than directly beside open cells.
  for (const value of [3, 7]) {
    let checked = false;
    for (let row = 0; row < 128 && !checked; row++) for (let column = 0; column < 127; column++) {
      if (doc.rows[row][column] !== 2 || doc.rows[row][column+1] !== value) continue;
      const from = cellToWorld(doc, column, row);
      assert.deepEqual(clampStepToRoute({}, from.x, from.z, 2, 0), [0, 0]);
      checked = true;break;
    }
    assert.ok(checked, `tested a real open → ${value} boundary`);
  }
});

it('generalizing the extractor keeps Alvarus geometry and all paint unchanged', () => {
  const source = fs.readFileSync(new URL('../maps/6p_alvarus/6p_alvarus.sgb', import.meta.url));
  const baseline = JSON.parse(fs.readFileSync(new URL('../maps/6p_alvarus/6p_alvarus_path.json', import.meta.url)));
  const extracted = extractSgbPath(source, '6p_alvarus');
  assert.deepEqual(extracted.grid, baseline.grid);assert.deepEqual(extracted.rows, baseline.rows);
});
