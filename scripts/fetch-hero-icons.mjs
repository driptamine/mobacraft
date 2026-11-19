// Download official hero portraits using the URLs recorded in the catalog.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const heroes = JSON.parse(fs.readFileSync(path.join(root, 'animations/heroes.json'), 'utf8'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-icons-'));
try {
  const config = Object.values(heroes).map((hero) => {
    const output = path.join(root, hero.icon);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    return `url = ${JSON.stringify(hero.iconSource)}\noutput = ${JSON.stringify(output)}\n`;
  }).join('next\n');
  const file = path.join(temp, 'icons.curl');
  fs.writeFileSync(file, config);
  execFileSync('curl', ['-L', '--fail', '--parallel', '--parallel-max', '8', '--retry', '2', '--max-time', '30', '--config', file], { stdio: 'inherit' });
  // The CDN can return an HTML error page with status 200 for old names.
  for (const [name, hero] of Object.entries(heroes)) {
    const bytes = fs.readFileSync(path.join(root, hero.icon));
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${name}: portrait response is not a PNG`);
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
