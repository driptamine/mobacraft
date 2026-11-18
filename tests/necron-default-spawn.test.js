import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const probePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'necron-reset-probe.mjs');

describe('necron worker start and HQ production', () => {
  it('resetGame starts with a worker and HQ production creates a warrior squad', () => {
    const output = execFileSync(process.execPath, [probePath], {
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.match(output, /all headless resetGame checks passed/);
    assert.doesNotMatch(output, /FAIL/);
  });
});
