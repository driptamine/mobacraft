import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSgbPath } from '../scripts/extract-sgb-path.mjs';
import { sgbPassBlockedAt } from '../pathfinding/avoid.js';
import { findSquadPath, hasLineOfSight } from '../pathfinding/astar-integrated.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};

const GAMEPLAY = { '6p_mortalis': 'mortalis.json' };
const maps = fs.readdirSync(path.join(root, 'maps'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((dir) => fs.existsSync(path.join(root, 'maps', dir, `${dir}.sgb`)))
  .filter((dir) => fs.existsSync(path.join(root, 'maps', dir, `${dir}_path.json`)))
  .sort();

for (const dir of maps) {
  describe(`${dir} passability grid`, () => {
    const gameFile = GAMEPLAY[dir] || `${dir}.json`;
    const doc = JSON.parse(fs.readFileSync(path.join(root, 'maps', dir, `${dir}_path.json`), 'utf8'));
    const layout = JSON.parse(fs.readFileSync(path.join(root, 'maps', dir, gameFile), 'utf8'));

    it('reproduces from the SGB without hand-placed paint', () => {
      const buf = fs.readFileSync(path.join(root, 'maps', dir, `${dir}.sgb`));
      const fresh = extractSgbPath(buf, dir);
      assert.deepEqual(doc.rows, fresh.rows, 'rows match a fresh extract cell for cell');
      assert.deepEqual(doc.grid, fresh.grid, 'grid frame matches');
      assert.deepEqual(doc.counts, fresh.counts, 'paint counts match');
    });

    it('keeps every HQ start and strategic point on open paint', () => {
      assert.ok(layout.positions.length > 0, 'has starts');
      assert.ok(layout.strategicPoints.length > 0, 'has points');
      for (const p of [...layout.positions, ...layout.strategicPoints]) {
        assert.equal(sgbPassBlockedAt(doc, p.x, p.z), false, JSON.stringify(p));
      }
    });

    it('A* reaches every point from some start without crossing closed paint', () => {
      for (const goal of layout.strategicPoints) {
        const starts = [...layout.positions].sort((a, b) =>
          Math.hypot(a.x - goal.x, a.z - goal.z) - Math.hypot(b.x - goal.x, b.z - goal.z));
        let ok = false;
        for (const start of starts) {
          if (hasLineOfSight(doc, start.x, start.z, goal.x, goal.z)) { ok = true; break; }
          const route = findSquadPath(start, goal, { passGrid: doc, groundAt: () => 0 });
          if (route?.length) {
            const legs = [start, ...route];
            ok = legs.every((leg, i) => i === 0 || hasLineOfSight(doc, legs[i - 1].x, legs[i - 1].z, leg.x, leg.z));
            if (ok) break;
          }
        }
        assert.ok(ok, `unreachable ${JSON.stringify(goal)}`);
      }
    });

    it('ships the true-grid-scale diagnostic (html + rendered png)', () => {
      for (const ext of ['html', 'png']) {
        const file = path.join(root, 'artifacts', dir, `${dir}-true-grid-scale.${ext}`);
        assert.ok(fs.existsSync(file), file);
        assert.ok(fs.statSync(file).size > 10000, `${file} is not empty`);
      }
    });
  });
}
