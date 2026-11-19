// Rebuild complete, textured heroes from the exported bodies and wearables.
// Usage: npm run heroes:build
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const heroes = JSON.parse(fs.readFileSync(path.join(root, 'animations/batches/1/animations.json'), 'utf8'));
for (const [name, hero] of Object.entries(heroes)) {
  const output = path.join(root, hero.model);
  const source = path.join(root, hero.sourceModel);
  const parts = hero.parts.map((part) => path.join(path.dirname(source), part));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  execFileSync(process.execPath, [path.join(root, 'scripts/merge-hero-parts.mjs'), '--out', output, source, ...parts], { stdio: 'inherit' });
  console.log(`Built ${name}: body + ${parts.length} parts`);
}
