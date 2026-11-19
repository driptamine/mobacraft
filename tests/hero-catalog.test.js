import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { heroRoster, recruitableHeroes, heroBatches, filterHeroes } from '../stats/races/heroes.js';
import { FACTIONS, factionContainers, countFactionModels, loadFactionModels, loadFactionUnitModel } from '../src/factions.js';

test('HQ catalog covers every batch with unique heroes and real portrait PNGs', () => {
  assert.deepEqual(heroBatches, Array.from({ length: 13 }, (_, i) => i + 1));
  assert.equal(heroRoster.length, 116);
  assert.equal(new Set(heroRoster.map((hero) => hero.name)).size, heroRoster.length);
  assert.equal(recruitableHeroes.length, 115);
  for (const hero of heroRoster) {
    const icon = fs.readFileSync(hero.icon);
    assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${hero.name} PNG`);
    if (hero.available) {
      assert.ok(fs.existsSync(hero.model), `${hero.name} assembled model exists`);
      assert.equal(FACTIONS.ig.units.find((u) => u.name === hero.name)?.model, hero.model);
    }
  }
  assert.equal(heroRoster.find((h) => h.name === 'marci').available, false, 'missing body stays visible but cannot be recruited');
});

test('hero search supports display names, source names and batch filters', () => {
  assert.equal(filterHeroes(null, 'anti-mage')[0].name, 'antimage');
  assert.equal(filterHeroes(null, 'gyrocopter')[0].name, 'gyro');
  assert.equal(filterHeroes(12, 'tiny')[0].name, 'tiny');
  assert.equal(filterHeroes(2, 'tiny').length, 0);
  assert.equal(filterHeroes(null, 'not-a-hero').length, 0);
  assert.equal(filterHeroes(null, 'vengeful').length, 1);
});

test('faction boot never requests the optional hero models', async () => {
  const requested = [];
  const progress = [];
  await loadFactionModels(undefined, ['ig'], {
    loadModel: async (url) => { requested.push(url); return { stub: url }; },
    onProgress: (event) => progress.push(event),
  });
  const optional = heroRoster.filter((hero) => hero.lazyLoad && hero.available);
  assert.ok(optional.length > 100);
  for (const hero of optional) {
    assert.ok(!requested.includes(hero.model), `${hero.name} is not loaded at boot`);
    assert.equal(factionContainers.ig.units[hero.name], undefined);
  }
  assert.equal(progress.length, countFactionModels(FACTIONS.ig));
  assert.equal(progress.at(-1).loaded, progress.at(-1).total);
});

test('selecting a hero loads one template, shares pending requests and reuses the cache', async () => {
  let finish;
  let calls = 0;
  const template = { scene: { name: 'antimage template' }, animations: [] };
  const loadModel = () => { calls++; return new Promise((resolve) => { finish = resolve; }); };
  const first = loadFactionUnitModel('ig', 'antimage', { loadModel });
  const second = loadFactionUnitModel('ig', 'antimage', { loadModel });
  assert.equal(calls, 1);
  assert.equal(factionContainers.ig.units.antimage, undefined);
  finish(template);
  assert.equal(await first, template);
  assert.equal(await second, template);
  assert.equal(await loadFactionUnitModel('ig', 'antimage', { loadModel }), template);
  assert.equal(calls, 1);
  assert.equal(factionContainers.ig.units.antimage, template);
  assert.equal(factionContainers.ig.units.dazzle, undefined, 'unselected heroes stay unloaded');
});

test('failed hero downloads can be retried without caching a broken model', async () => {
  await assert.rejects(loadFactionUnitModel('ig', 'dazzle', { loadModel: async () => { throw new Error('offline'); } }), /offline/);
  assert.equal(factionContainers.ig.units.dazzle, undefined);
  const template = { scene: { name: 'dazzle' }, animations: [] };
  assert.equal(await loadFactionUnitModel('ig', 'dazzle', { loadModel: async () => template }), template);
  await assert.rejects(loadFactionUnitModel('ig', 'marci'), /Unknown unit/);
});
