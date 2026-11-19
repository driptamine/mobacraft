import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.window = { addEventListener() {}, _currentMapKey: '/maps/dotamap-game/map.json' };
globalThis.document = { getElementById: () => null, querySelector: () => null };
const core = await import('../src/core/scene.js');
const { World } = await import('../src/core/ecs.js');
const { factionContainers } = await import('../src/factions.js');
const { loadDotaMatchHeroes, spawnDotaMatchHeroes } = await import('../src/core/match-heroes.js');
const { dotaMapBases } = await import('../src/maps/dota-map-layout.js');
const config = { mapKey: window._currentMapKey, seats: [
  { slot: 0, team: 'red', faction: 'ig', computer: false, hero: 'juggernaut' },
  { slot: 1, team: 'blue', faction: 'ig', computer: true, hero: 'lina' },
] };

test('match boot loads only the picked templates, reuses them and supports subsequent picks', async () => {
  const requests = [], progress = [];
  const hooks = { loadModel: async url => { requests.push(url); return { scene: new THREE.Group(), animations: [] }; }, onProgress: event => progress.push(event) };
  await loadDotaMatchHeroes(null, hooks);
  await loadDotaMatchHeroes({ ...config, mapKey: 'arena' }, hooks);
  assert.equal(requests.length, 0);
  await loadDotaMatchHeroes(config, hooks);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(url => /(?:juggernaut|lina)-combined\.glb$/.test(url)));
  assert.equal(progress.at(-1).loaded, 2);
  assert.equal(progress.at(-1).total, 2);
  await loadDotaMatchHeroes(config, hooks);
  assert.equal(requests.length, 2);
  await loadDotaMatchHeroes({ ...config, seats: config.seats.map(seat => ({ ...seat, hero: 'axe' })) }, hooks);
  assert.equal(requests.length, 3, 'duplicate picks share one template');
  assert.ok(requests.at(-1).endsWith('/axe-combined.glb'));
  assert.equal(factionContainers.ig.units.sven, undefined, 'unpicked heroes stay unloaded');
  await assert.rejects(loadDotaMatchHeroes({ ...config, seats: [{ ...config.seats[0], hero: 'marci' }] }, hooks), /Unavailable hero/);
});

test('picked heroes spawn by team rather than slot, with ownership and without race units', () => {
  const scene = new THREE.Scene(); core.__setSceneCameraForTests(scene, { target: new THREE.Vector3() });
  const world = new World(); core.setWorld(world);
  const bases = dotaMapBases().map((base, i) => ({ ...base, id: i + 100 }));
  spawnDotaMatchHeroes(world, config, bases);
  const ids = world.query('matchHero'); assert.equal(ids.length, 2);
  assert.equal(world.query('builder').length, 0);
  assert.equal(world.query('soldier').length, 2);
  assert.equal(world.query('squad').length, 2);
  for (const seat of config.seats) {
    const id = ids.find(id => world.get(id, 'matchHero').slot === seat.slot);
    const squad = world.get(id, 'squad'), base = bases.find(base => base.team === seat.team);
    assert.equal(squad.unitType, seat.hero);
    assert.equal(squad.team, seat.team);
    assert.equal(world.get(id, 'networkOwner').id, seat.slot + 1);
    assert.equal(world.has(id, 'computer'), seat.computer);
    assert.ok(Math.hypot(squad.position.x - base.x, squad.position.z - base.z) <= 10);
  }
  assert.equal(world.defaultOwner, null);
  spawnDotaMatchHeroes(world, { ...config, mapKey: 'arena' }, bases);
  assert.equal(world.query('matchHero').length, 2, 'RTS maps do not receive these heroes');
});
