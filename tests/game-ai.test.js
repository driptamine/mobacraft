import { it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { compileAI, parseLuaTable } from '../scripts/compile-ai.mjs';

it('compiles reproducible race/difficulty profiles from the supplied Lua sources', async () => {
  const generated = await compileAI();
  const saved = JSON.parse(fs.readFileSync(new URL('../ai/profiles.json', import.meta.url), 'utf8'));
  assert.deepEqual(generated, saved);
  assert.equal(generated.thinkInterval, .5);
  assert.equal(Object.keys(generated.factions).length, 9);
  assert.equal(Object.keys(generated.difficulties).length, 4);
  assert.equal(generated.difficulties.standard.ig.minAttackSquads, 3);
  assert.equal(generated.difficulties.easy.ig.pointLimit, .3);
  assert.equal(generated.difficulties.standard.ig.pointLimit, .6);
  assert.ok(generated.difficulties.standard.ig.opening.some(order => order.type === 'infantry_command'));
  assert.ok(generated.difficulties.hard.ig.armyBudget > generated.difficulties.standard.ig.armyBudget);
  assert.deepEqual(parseLuaTable('Config = { flag = true, list = { "a", "b" }, rating = -INT_MAX }', 'Config'), { flag: true, list: ['a', 'b'], rating: -2147483647 });
});

it('bots capture, construct, train and retain ownership without spending human resources', () => {
  const result = spawnSync(process.execPath, ['--import', './tests/register-hooks.mjs', 'tests/game-ai-probe.mjs'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
