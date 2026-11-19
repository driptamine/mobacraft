import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.window = { addEventListener() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null };
const core = await import('../src/core/scene.js');
const { World } = await import('../src/core/ecs.js');
const { batch1Heroes } = await import('../stats/races/batch1/heroes.js');
const { recruitableHeroes } = await import('../stats/races/heroes.js');
const { kitFor } = await import('../src/heroes/hero-kits.js');
const { castHeroAbility, heroAbilityCooldown, heroDamageGuard, heroMoveFactor, heroStunned, systemHeroCombat } = await import('../src/heroes/hero-combat.js');
const { clearHeroEffects } = await import('../src/heroes/hero-effects.js');
const { createHeroProjectile, disposeShotVisual } = await import('../src/heroes/hero-shot-visuals.js');
const { _squadFireAll } = await import('../src/systems/squad.js');

function fixture() {
  const scene = new THREE.Scene();
  core.__setSceneCameraForTests(scene, { target: new THREE.Vector3() });
  const world = new World();
  core.setWorld(world);
  world.addSystem(systemHeroCombat);
  return { scene, world };
}
function spawn(world, unitType, team, x, z, hp = 600) {
  const squad = world.createEntity(), soldier = world.createEntity();
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  world.add(squad, 'squad', {
    unitType, team, soldiers: [soldier], position: root.position.clone(),
    attackMode: kitFor(unitType)?.primary ? 'ranged' : 'melee', projectileType: 'bullet',
  });
  const stats = world.add(soldier, 'soldier', {
    squadId: squad, hp, maxHp: 600, weapon: 'lasgun', attackCooldown: 0, attackRate: 1,
  });
  world.add(soldier, 'mesh', { root });
  return { squad, soldier, root, stats };
}

test('every Batch 1 hero has four abilities and ranged attacks use five different shot shapes', () => {
  const shotNames = new Set();
  for (const hero of batch1Heroes) {
    const { world, scene } = fixture();
    const kit = kitFor(hero.name);
    assert.equal(kit.abilities.length, 4);
    const attacker = spawn(world, hero.name, 'blue', 0, 0);
    const enemy = spawn(world, 'creep', 'red', 10, 0);
    _squadFireAll(world, attacker.squad, world.get(attacker.squad, 'squad'),
      [attacker.soldier], .05, { soldierEntityId: enemy.soldier, distance: 10 });
    assert.equal(world.query('bullet').length, 0, 'no fallback RTS bullet');
    const shot = scene.children.find(root => root.name.startsWith('hero-shot-'));
    if (kit.primary) {
      assert.ok(shot);
      shotNames.add(shot.name);
      assert.equal(enemy.stats.hp, 600, 'damage waits for contact');
      for (let i = 0; i < 20; i++) world.tick(.03);
      assert.ok(enemy.stats.hp < 600);
    } else {
      assert.equal(shot, undefined);
    }
    clearHeroEffects(world);
    assert.equal(scene.children.length, 0);
  }
  assert.equal(shotNames.size, 5);
});

test('the ballistic arc and trail keep the same contact time against a live target', () => {
  const from = new THREE.Vector3(0, 0, 0), first = new THREE.Vector3(10, 0, 0);
  const shot = createHeroProjectile(from, first, { shape: 'weight', color: 0x60aaff, speed: 10 });
  assert.equal(shot.advance(.5, first), null);
  const head = shot.root.getObjectByName('projectile-head');
  assert.ok(Math.abs(head.position.x - 5) < 1e-6);
  assert.ok(Math.abs(head.position.y - 1.4) < 1e-6);
  assert.ok(shot.root.getObjectByName('projectile-trail').count > 0);
  const moved = new THREE.Vector3(12, 0, 0);
  assert.equal(shot.advance(.5, moved), null);
  const contact = shot.advance(.2, moved);
  assert.ok(contact.hit);
  assert.deepEqual(contact.at.toArray(), [12, 0, 0]);
  disposeShotVisual(shot.root);
});

test('each Batch 2 hero fires a custom basic or ability projectile while preserving their attack mode', () => {
  const roster = recruitableHeroes.filter(hero => hero.batch === 2);
  assert.equal(roster.length, 11);
  for (const hero of roster) {
    const kit = kitFor(hero.name);
    assert.equal(!!kit?.primary, hero.weapon === 'lasgun', hero.title);
    const { scene, world } = fixture();
    const attacker = spawn(world, hero.name, 'blue', 0, 0);
    const enemy = spawn(world, 'creep', 'red', 9, 0);
    if (kit.primary) {
      _squadFireAll(world, attacker.squad, world.get(attacker.squad, 'squad'),
        [attacker.soldier], .05, { soldierEntityId: enemy.soldier, distance: 9 });
    } else {
      assert.equal(castHeroAbility(world, attacker.squad, 0, undefined, enemy.soldier), null, hero.title);
    }
    const shape = kit.primary?.shape ?? kit.abilities[0]?.shot;
    assert.ok(scene.getObjectByName(`hero-shot-${shape}`), hero.title);
    assert.equal(world.query('bullet').length, 0, hero.title);
    assert.equal(enemy.stats.hp, 600, hero.title);
    for (let i = 0; i < 25; i++) world.tick(.03);
    assert.ok(enemy.stats.hp < 600, hero.title);
    clearHeroEffects(world);
  }
});

test('target validation and cooldown protect casts, with ally heal and guard expiring in simulation time', () => {
  const { world } = fixture();
  const hero = spawn(world, 'crystal_maiden', 'blue', 0, 0);
  const ally = spawn(world, 'creep', 'blue', 7, 0, 250);
  const foe = spawn(world, 'creep', 'red', 8, 0);
  assert.match(castHeroAbility(world, hero.squad, 1, undefined, ally.soldier), /enemy/);
  assert.equal(heroAbilityCooldown(world, hero.squad, 1), 0);
  assert.equal(castHeroAbility(world, hero.squad, 1, undefined, foe.soldier), null);
  assert.match(castHeroAbility(world, hero.squad, 1, undefined, foe.soldier), /recharging/);
  for (let i = 0; i < 10; i++) world.tick(.05);
  assert.equal(foe.stats.hp, 520);
  assert.equal(heroStunned(world, foe.squad), true);
  assert.equal(heroMoveFactor(world, foe.squad), 0);
  assert.equal(castHeroAbility(world, hero.squad, 2, undefined, ally.soldier), null);
  assert.equal(ally.stats.hp, 380);
  assert.equal(heroDamageGuard(world, ally.squad), .3);
  world.tick(6);
  assert.equal(heroStunned(world, foe.squad), false);
  assert.equal(heroDamageGuard(world, ally.squad), 0);
});

test('chain targets the first enemy in its path without moving allies or enemies off the line', () => {
  const { world } = fixture();
  const hero = spawn(world, 'pudge', 'blue', 0, 0);
  const ally = spawn(world, 'creep', 'blue', 3, 0);
  const near = spawn(world, 'creep', 'red', 8, 0);
  const far = spawn(world, 'creep', 'red', 15, 0);
  const outside = spawn(world, 'creep', 'red', 7, 3);
  assert.equal(castHeroAbility(world, hero.squad, 0, new THREE.Vector3(22, 0, 0)), null);
  for (let i = 0; i < 20; i++) world.tick(.03);
  assert.equal(near.stats.hp, 500);
  assert.equal(near.root.position.x, 2);
  for (const target of [ally, far, outside]) assert.equal(target.stats.hp, 600);
});

test('area pulses tick four times and healing from a self-only ability is applied once', () => {
  const { world } = fixture();
  const hero = spawn(world, 'juggernaut', 'blue', 0, 0);
  const ally = spawn(world, 'creep', 'blue', 3, 0, 100);
  const foe = spawn(world, 'creep', 'red', 3, 0);
  assert.equal(castHeroAbility(world, hero.squad, 1, new THREE.Vector3(3, 0, 0)), null);
  for (let i = 0; i < 85; i++) world.tick(.05);
  assert.equal(ally.stats.hp, 360);
  assert.equal(foe.stats.hp, 600);
  const pudge = spawn(world, 'pudge', 'blue', 12, 0, 100);
  assert.equal(castHeroAbility(world, pudge.squad, 2), null);
  assert.equal(pudge.stats.hp, 255);
});
