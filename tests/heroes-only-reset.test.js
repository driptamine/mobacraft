import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const probePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'heroes-only-reset-probe.mjs');

describe('heroes-only reset', () => {
  it('resetGame spawns no units or points, only the hero lineup, on arena and SGB maps', () => {
    const output = execFileSync(process.execPath, [probePath], {
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.match(output, /all headless resetGame checks passed/);
    assert.doesNotMatch(output, /FAIL/);
  });
});
