// Build maps/manifest.json: the runtime map list used when vite globs are
// empty (production serves maps/ from R2, never from dist/). Run after
// adding maps, before scripts/upload-maps-r2.sh so the manifest uploads too:
//   node --import tsx scripts/build-maps-manifest.mjs
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAPS = 'maps';
const out = join(MAPS, 'manifest.json');

const displayName = (file) =>
  file.split('/').pop().replace(/\.sgb$/i, '').replace(/[_-]+/g, ' ');
const playersFor = (file) => {
  const match = /(\d+)p[_-]/i.exec(file.split('/').pop() || '');
  return match ? Number(match[1]) : null;
};
const previewFor = (dir) => {
  for (const suffix of ['_icon_custom.png', '_icon.png', '_preview.png']) {
    if (existsSync(join(MAPS, dir, dir + suffix))) return `/maps/${dir}/${dir + suffix}`;
  }
  return null;
};

const entries = readdirSync(MAPS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((dir) => existsSync(join(MAPS, dir, `${dir}.sgb`)))
  .sort((a, b) => a.localeCompare(b))
  .map((dir) => ({
    path: `/maps/${dir}/${dir}.sgb`,
    name: displayName(`${dir}.sgb`),
    players: playersFor(`${dir}.sgb`),
    preview: previewFor(dir),
  }));

writeFileSync(out, JSON.stringify(entries, null, 2) + '\n');
console.log(`Wrote ${out}: ${entries.length} maps`);
