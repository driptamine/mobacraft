import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mapsRoot = path.join(root, 'maps');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const sgbDirs = fs.readdirSync(mapsRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((dir) => fs.existsSync(path.join(mapsRoot, dir, `${dir}.sgb`)));

describe('maps manifest (R2 runtime list)', () => {
  const manifest = readJson('maps/manifest.json');

  it('lists every shipped .sgb exactly once, sorted', () => {
    const paths = manifest.map((e) => e.path);
    assert.deepEqual([...new Set(paths)], paths, 'no duplicates');
    assert.deepEqual([...paths].sort((a, b) => a.localeCompare(b)), paths, 'sorted');
    for (const dir of sgbDirs) {
      assert.ok(paths.includes(`/maps/${dir}/${dir}.sgb`), `${dir} listed`);
    }
  });

  it('resolves every entry to files on disk', () => {
    for (const entry of manifest) {
      assert.ok(entry.name && entry.players, `${entry.path} has name+players`);
      for (const file of [entry.path, entry.preview]) {
        if (!file) continue;
        const disk = path.join(root, file.replace(/^\/+/, ''));
        assert.ok(fs.existsSync(disk), `${file} exists`);
      }
      assert.ok(entry.path.startsWith('/maps/'), 'root-absolute for mapUrl()');
    }
  });

  it('includes the Dota runtime map and its oriented preview', () => {
    const dota = manifest.filter(entry => entry.path === '/maps/dotamap-game/map.json');
    assert.equal(dota.length, 1);
    assert.equal(dota[0].players, 2);
    assert.equal(dota[0].preview, '/maps/dotamap-game/preview.png');
  });

  it('prefers icon_custom previews, like the menu glob order', () => {
    for (const entry of manifest.filter((e) => e.preview && e.path.endsWith('.sgb'))) {
      assert.match(entry.preview, /_icon_custom\.png$|_icon\.png$|_preview\.png$/, entry.path);
    }
    const customs = manifest.filter((e) => e.preview && e.preview.endsWith('_icon_custom.png'));
    assert.ok(customs.length > manifest.length / 2, 'most maps use icon_custom');
  });
});
