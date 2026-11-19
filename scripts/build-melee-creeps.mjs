import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'batches/creeps-lane/final');
fs.mkdirSync(output, { recursive: true });
const sources = {
  'radiant-melee': 'RADIANT-MELEE/radiant_melee.glb',
  'dire-melee': 'DIRE-MELEE/creep_bad_melee.glb',
  'radiant-ranged': 'RADIANT-RANGED/radiant_ranged.glb',
  'dire-ranged': 'DIRE-RANGED/lane_dire_ranged.glb',
  'radiant-siege': 'RADIANT-SIEGE/creep_good_siege.glb',
  'dire-siege': 'DIRE-SIEGE/creep_bad_siege.glb',
};
for (const [name, source] of Object.entries(sources)) {
  execFileSync(process.execPath, [path.join(root, 'scripts/merge-hero-parts.mjs'), '--out',
    path.join(output, `${name}.glb`),
    path.join(root, 'batches/creeps-lane', source)], { stdio: 'inherit' });
}
