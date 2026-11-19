// Build batches 2–13 from the explicit body/wearable recipes. With --batch N,
// rebuild only that batch. Original exports are never rewritten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const heroes = JSON.parse(fs.readFileSync(path.join(root, 'animations/heroes.json'), 'utf8'));
const index = process.argv.indexOf('--batch');
const batch = index >= 0 ? Number(process.argv[index + 1]) : null;
let failed = 0;
for (const [name, hero] of Object.entries(heroes)) {
  if (!hero.model || (batch && hero.batch !== batch)) continue;
  const output = path.join(root, hero.model);
  const source = path.join(root, hero.sourceModel);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts/merge-hero-parts.mjs'), '--out', output, source,
      ...hero.parts.map((part) => path.join(path.dirname(source), part))], { stdio: 'inherit' });
    console.log(`Built ${name} (batch ${hero.batch})`);
  } catch {
    console.error(`FAILED ${name} (batch ${hero.batch})`);
    failed++;
  }
}
process.exitCode = failed ? 1 : 0;
