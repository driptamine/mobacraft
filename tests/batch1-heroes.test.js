import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scene.ts reads the canvas at module load: stub DOM before importing src/*.
const canvas = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
globalThis.window = globalThis.window || { addEventListener() {} };
globalThis.document = globalThis.document || { getElementById: (id) => id === 'renderCanvas' ? canvas : null, querySelector: () => null };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const anims = JSON.parse(fs.readFileSync(path.join(root, 'animations/batches/1/animations.json'), 'utf8'));

test('batch1 animations.json covers 10 heroes split 5v5', () => {
  assert.equal(Object.keys(anims).length, 10);
  const blue = Object.entries(anims).filter(([, v]) => v.team === 'blue').map(([k]) => k);
  const red = Object.entries(anims).filter(([, v]) => v.team === 'red').map(([k]) => k);
  assert.deepEqual(blue, ['axe', 'juggernaut', 'pudge', 'sven', 'tidehunter']);
  assert.deepEqual(red, ['crystal_maiden', 'drow', 'lina', 'lion', 'shadow_fiend']);
});

test('every hero model exists and every mapped action names a real clip', () => {
  const required = ['idle', 'run', 'melee', 'firing', 'stun', 'die_normal_1', 'die_normal_2', 'spawn', 'victory', 'teleport'];
  for (const [hero, entry] of Object.entries(anims)) {
    assert.ok(fs.existsSync(path.join(root, entry.model)), `${hero} model missing: ${entry.model}`);
    assert.ok(entry.clips.length > 10, `${hero} has no clips`);
    for (const action of required) {
      assert.ok(entry.actions[action], `${hero} missing action ${action}`);
      assert.ok(entry.clips.includes(entry.actions[action]), `${hero}.${action}=${entry.actions[action]} not in clips`);
    }
  }
});

test('hero stats rosters match the animations teams', async () => {
  const heroes = await import('../stats/races/batch1/heroes.js');
  assert.deepEqual(heroes.batch1BlueTeam, ['axe', 'juggernaut', 'sven', 'tidehunter', 'pudge']);
  assert.deepEqual(heroes.batch1RedTeam, ['drow', 'lina', 'lion', 'crystal_maiden', 'shadow_fiend']);
  assert.equal(heroes.batch1Heroes.length, 10);
  // Ground speed is tuned to each run clip's own pace (root travel per loop
  // at 1x playback), so stride and displacement stay in sync.
  const pace = {
    axe: 1.2, juggernaut: 1.5, sven: 1.35, tidehunter: 1.25, pudge: 1.3,
    drow: 1.3, lina: 1.3, lion: 1.5, crystal_maiden: 1.45, shadow_fiend: 1.35,
  };
  for (const hero of heroes.batch1Heroes) {
    assert.ok(anims[hero.name], `${hero.name} not in animations.json`);
    assert.equal(hero.model, anims[hero.name].model);
    assert.deepEqual(hero.animations, anims[hero.name].actions);
    assert.equal(hero.size, 1);
    assert.equal(hero.movementSpeedMultiplier, pace[hero.name], `${hero.name} run pace`);
  }
});

test('heroes are registered as ig units so meshes and configs resolve', async () => {
  const ig = (await import('../src/factions/ig.js')).default;
  const { findUnitConfig } = await import('../src/entities/entities.js');
  for (const hero of [...(await import('../stats/races/batch1/heroes.js')).batch1BlueTeam, ...(await import('../stats/races/batch1/heroes.js')).batch1RedTeam]) {
    assert.ok(ig.units.some((u) => u.name === hero), `${hero} missing from ig units`);
    const cfg = findUnitConfig('ig', hero);
    assert.ok(cfg, `${hero} does not resolve via findUnitConfig`);
    assert.ok(cfg.model.endsWith('.glb'), `${hero} model is not a glb`);
  }
});
