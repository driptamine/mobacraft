import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./node-esm-hooks.mjs', import.meta.url);
globalThis.window = {};
globalThis.document = { getElementById: () => null };
const heroMod = await import('../src/hero.js');
const sceneMod = await import('../src/scene.js');

function stubContainer(clips = ['idle']) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()));
  return { scene: group, animations: clips.map((name) => new THREE.AnimationClip(name, 1, [])) };
}

describe('hero registry', () => {
  it('lists the batch-1 roster with models', () => {
    assert.equal(heroMod.HERO_BATCH_1.length, 14);
    assert.ok(
      heroMod.HERO_AUTOLOAD.every((key) => heroMod.HERO_BATCH_1.includes(key)),
      'autoload is a subset of the roster',
    );
    for (const key of heroMod.HERO_BATCH_1) {
      const config = heroMod.heroConfig(key);
      assert.ok(config && config.model, `${key} has a model path`);
      assert.ok(config.scale > 0 && config.speed > 0, `${key} has sane scale/speed`);
    }
    assert.equal(heroMod.heroConfig('nope'), null);
  });

  it('spawn before load returns null', () => {
    assert.equal(heroMod.heroLoaded('axe'), false);
    assert.equal(heroMod.spawnHero(new THREE.Group(), new THREE.Vector3(), 'axe'), null);
  });

  it('loads axe via injected loader and spawns an idle hero', async () => {
    const container = await heroMod.loadHero('axe', { loadModel: async () => stubContainer() });
    assert.ok(container);
    assert.equal(heroMod.heroLoaded('axe'), true);
    assert.deepEqual(heroMod.heroClips('axe'), ['idle']);

    const parent = new THREE.Group();
    const active = heroMod.spawnHero(parent, new THREE.Vector3(7, 0, 7), 'axe');
    assert.ok(active);
    assert.equal(active.id, 'axe');
    assert.equal(active.root.parent, parent);
    assert.equal(active.root.position.x, 7);
    assert.equal(active.root.scale.x, 0.6);
    const idle = active.instance.animationGroups.find((g) => g.name === 'idle');
    assert.ok(idle);

    assert.equal(heroMod.playHeroAnim('axe', 'idle'), 'idle');
    assert.equal(heroMod.playHeroAnim('axe', 'missing-clip-fallback'), 'idle');

    heroMod.despawnHero('axe');
    assert.equal(active.root.parent, null);
    heroMod.despawnHero('axe'); // safe when empty
  });

  it('selects, moves toward orders, and idles on arrival', () => {
    const parent = new THREE.Group();
    const active = heroMod.spawnHero(parent, new THREE.Vector3(0, 0, 0), 'axe');
    assert.ok(active);

    assert.equal(heroMod.isHeroSelected('axe'), false);
    assert.equal(heroMod.selectHero('axe'), true);
    assert.equal(active.root._selDisc.visible, true);
    heroMod.deselectHero('axe');
    assert.equal(active.root._selDisc.visible, false);

    assert.equal(heroMod.orderHeroMove('axe', new THREE.Vector3(20, 0, 0)), true);
    const target = new THREE.Vector3(20, 0, 0);
    const before = active.root.position.distanceTo(target);
    heroMod.tickHeroes(1.0);
    const after = active.root.position.distanceTo(target);
    assert.ok(after < before, 'hero advances on its order');
    assert.ok(active.root.position.x > 0 && active.root.position.x <= 7);

    for (let i = 0; i < 10 && heroMod.getHero('axe').moveTarget; i++) {
      heroMod.tickHeroes(1.0);
    }
    assert.equal(heroMod.getHero('axe').moveTarget, null);
    assert.equal(heroMod.getHero('axe').clip, 'idle');

    // Orders clamp to the map bounds (arena layout defines its own bound).
    const bound = sceneMod.currentBounds();
    heroMod.orderHeroMove('axe', new THREE.Vector3(9999, 0, -9999));
    const clamped = heroMod.getHero('axe').moveTarget;
    assert.equal(clamped.x, bound);
    assert.equal(clamped.z, -bound);
    heroMod.stopHero('axe');
    assert.equal(heroMod.getHero('axe').moveTarget, null);

    heroMod.despawnHero('axe');
    heroMod.tickHeroes(1.0); // safe when empty
    assert.equal(heroMod.orderHeroMove('axe', new THREE.Vector3()), false);
  });

  it('supports a second registered hero alongside axe', async () => {
    heroMod.registerHero('lina', { model: 'axe-final/lina-combined.glb', scale: 0.5, speed: 9 });
    assert.equal(heroMod.heroConfig('lina').speed, 9);
    await heroMod.loadHero('lina', { loadModel: async () => stubContainer(['idle', 'run']) });

    const parent = new THREE.Group();
    const axe = heroMod.spawnHero(parent, new THREE.Vector3(0, 0, 0), 'axe');
    const lina = heroMod.spawnHero(parent, new THREE.Vector3(0, 0, 5), 'lina');
    assert.equal(axe.root.scale.x, 0.6);
    assert.equal(lina.root.scale.x, 0.5);
    assert.equal(heroMod.allHeroes().length, 2);

    heroMod.selectHero('axe');
    assert.equal(heroMod.getSelectedHeroId(), 'axe');
    assert.deepEqual(heroMod.getSelectedHeroIds(), ['axe']);
    assert.equal(axe.root._selDisc.material.color.g, 1);
    heroMod.selectHero('lina');
    assert.deepEqual(heroMod.getSelectedHeroIds(), ['axe', 'lina']);
    assert.equal(axe.root._selDisc.visible, true);
    assert.equal(lina.root._selDisc.visible, true);

    heroMod.orderHeroMove('axe', new THREE.Vector3(30, 0, 0));
    heroMod.orderHeroMove('lina', new THREE.Vector3(30, 0, 5));
    heroMod.tickHeroes(1.0);
    assert.equal(axe.root.position.x, 7);
    assert.equal(lina.root.position.x, 9);
    assert.equal(lina.clip, 'run');

    heroMod.deselectHero();
    assert.equal(heroMod.getSelectedHeroId(), null);
    heroMod.despawnAllHeroes();
    assert.equal(heroMod.allHeroes().length, 0);
  });

  it('crossfades between clips instead of hard-cutting', async () => {
    heroMod.registerHero('fadehero', { model: 'fadehero.glb', scale: 1, speed: 1 });
    await heroMod.loadHero('fadehero', { loadModel: async () => stubContainer(['idle', 'run']) });
    const parent = new THREE.Group();
    const active = heroMod.spawnHero(parent, new THREE.Vector3(), 'fadehero');
    const groups = Object.fromEntries(active.instance.animationGroups.map((g) => [g.name, g]));
    const mixer = active.instance.mixer;

    assert.equal(heroMod.playHeroAnim('fadehero', 'run', true, 0.25), 'run');
    mixer.update(0.1);
    assert.ok(groups.idle.weight < 1 && groups.idle.weight > 0, 'old clip fading out');
    assert.ok(groups.run.weight > 0 && groups.run.weight < 1, 'new clip fading in');
    mixer.update(0.3);
    assert.ok(groups.idle.weight < 0.01, 'old clip silent after fade');
    assert.ok(groups.run.weight > 0.99, 'new clip full after fade');

    // Hard switch back replays the faded-out clip at full weight.
    assert.equal(heroMod.playHeroAnim('fadehero', 'idle'), 'idle');
    assert.ok(groups.idle.weight > 0.99, 'replayed clip restored to full weight');
    heroMod.despawnHero('fadehero');
  });
});

describe('hero skirmish', () => {
  async function spawnFighter(key, overrides, position) {
    heroMod.registerHero(key, { model: `${key}.glb`, scale: 1, speed: 7, ...overrides });
    await heroMod.loadHero(key, { loadModel: async () => stubContainer(['idle', 'run', 'attack', 'death']) });
    return heroMod.spawnHero(new THREE.Group(), position, key);
  }

  it('melee fighters trade blows, die, and end the game', async () => {
    await spawnFighter('sk_axe', { damage: 10, hp: 20, cooldown: 0.5 }, new THREE.Vector3(0, 0, 0));
    await spawnFighter('sk_jug', { damage: 10, hp: 20, cooldown: 0.5 }, new THREE.Vector3(1, 0, 0));
    await spawnFighter('sk_civ', {}, new THREE.Vector3(5, 0, 0));
    assert.equal(heroMod.setHeroTeam('sk_axe', 'radiant'), true);
    assert.equal(heroMod.setHeroTeam('sk_jug', 'dire'), true);
    assert.equal(heroMod.heroTeam('sk_axe'), 'radiant');
    assert.equal(heroMod.heroTeam('sk_civ'), null);
    assert.deepEqual(heroMod.teamAliveCounts(), { radiant: 1, dire: 1 });

    // Neutrals can't be damaged.
    assert.equal(heroMod.damageHero('sk_civ', 999), false);
    assert.equal(heroMod.getHero('sk_civ').hp, heroMod.getHero('sk_civ').maxHp);

    // No auto-acquire: fighters hold until explicitly ordered to attack.
    heroMod.tickHeroes(0.5);
    assert.equal(heroMod.getHero('sk_axe').hp, 20);
    assert.equal(heroMod.getHero('sk_jug').hp, 20);
    heroMod.orderHeroAttack('sk_axe', 'sk_jug');
    heroMod.orderHeroAttack('sk_jug', 'sk_axe');

    // First exchange: both strike (10 hp each left).
    heroMod.tickHeroes(0.1);
    assert.equal(heroMod.getHero('sk_axe').hp, 10);
    assert.equal(heroMod.getHero('sk_jug').hp, 10);
    assert.equal(heroMod.getHero('sk_axe').clip, 'attack');
    // Second exchange: axe strikes first and kills jug before it retaliates.
    heroMod.tickHeroes(0.5);
    assert.equal(heroMod.getHero('sk_jug').hp, 0);
    assert.equal(heroMod.getHero('sk_jug').alive, false);
    assert.equal(heroMod.getHero('sk_jug').hpBar.visible, false, 'dead bar hidden');
    assert.equal(heroMod.getHero('sk_axe').hpBar.isSprite, true, 'bar is a sprite');
    assert.equal(heroMod.getHero('sk_axe').hp, 10);
    assert.deepEqual(heroMod.teamAliveCounts(), { radiant: 1, dire: 0 });
    assert.equal(sceneMod.gameOver, true);
    sceneMod.setGameOver(false);

    // Corpses are removed after the death clip plays out.
    heroMod.tickHeroes(3.0);
    assert.equal(heroMod.getHero('sk_jug'), null);
    assert.ok(heroMod.getHero('sk_axe'));

    heroMod.despawnAllHeroes();
    assert.equal(heroMod.allHeroes().length, 0);
  });

  it('victory overlay keeps its headline slot and restart button', async () => {
    await spawnFighter('sk_win_a', { damage: 50, hp: 50, cooldown: 0.5 }, new THREE.Vector3(0, 0, 0));
    await spawnFighter('sk_win_b', { damage: 0, hp: 10, cooldown: 99 }, new THREE.Vector3(1, 0, 0));
    heroMod.setHeroTeam('sk_win_a', 'radiant');
    heroMod.setHeroTeam('sk_win_b', 'dire');
    heroMod.orderHeroAttack('sk_win_a', 'sk_win_b');
    const els = { winText: { textContent: '' }, win: { style: {} } };
    const prevDoc = globalThis.document;
    globalThis.document = { getElementById: (id) => els[id] || null };
    try {
      heroMod.tickHeroes(0.5);
      assert.equal(els.winText.textContent, 'Radiant VICTORY');
      assert.equal(els.win.style.display, 'flex');
    } finally {
      globalThis.document = prevDoc;
    }
    sceneMod.setGameOver(false);
    heroMod.despawnAllHeroes();
  });

  it('ranged fighters fire homing projectiles', async () => {
    await spawnFighter(
      'sk_archer',
      { attackKind: 'ranged', attackRange: 14, damage: 10, hp: 30, cooldown: 0.5, projectileSpeed: 50 },
      new THREE.Vector3(0, 0, 0),
    );
    await spawnFighter('sk_dummy', { damage: 0, hp: 10, cooldown: 99 }, new THREE.Vector3(10, 0, 0));
    heroMod.setHeroTeam('sk_archer', 'radiant');
    heroMod.setHeroTeam('sk_dummy', 'dire');
    heroMod.orderHeroAttack('sk_archer', 'sk_dummy');

    heroMod.tickHeroes(0.1);
    assert.equal(heroMod.heroProjectiles().length, 1);
    assert.equal(heroMod.getHero('sk_dummy').hp, 10, 'no instant damage at range');

    for (let i = 0; i < 10 && heroMod.getHero('sk_dummy')?.alive; i++) {
      heroMod.tickHeroes(0.1);
    }
    assert.equal(heroMod.getHero('sk_dummy').alive, false);
    assert.equal(heroMod.heroProjectiles().length, 0);
    sceneMod.setGameOver(false);
    heroMod.despawnAllHeroes();
  });

  it('fighters hold after a move order, never re-acquiring', async () => {
    await spawnFighter('sk_fleer', { damage: 10, hp: 30, cooldown: 0.5 }, new THREE.Vector3(0, 0, 0));
    await spawnFighter('sk_bully', { damage: 10, hp: 30, cooldown: 0.5 }, new THREE.Vector3(1, 0, 0));
    heroMod.setHeroTeam('sk_fleer', 'radiant');
    heroMod.setHeroTeam('sk_bully', 'dire');

    heroMod.orderHeroMove('sk_fleer', new THREE.Vector3(20, 0, 0));
    heroMod.tickHeroes(1.0);
    assert.equal(heroMod.getHero('sk_fleer').root.position.x, 7);
    assert.equal(heroMod.getHero('sk_bully').hp, 30, 'fleeing fighter holds fire');
    assert.equal(heroMod.getHero('sk_fleer').hp, 30, 'bully holds without orders');

    heroMod.tickHeroes(1.0);
    heroMod.tickHeroes(1.0);
    heroMod.tickHeroes(0.1);
    const fleer = heroMod.getHero('sk_fleer');
    assert.equal(fleer.manual, false, 'order completed');
    assert.equal(fleer.moveTarget, null, 'holds position, no re-acquire');
    assert.equal(fleer.clip, 'idle');
    assert.equal(heroMod.getHero('sk_bully').root.position.x, 1, 'bully never moved');
    sceneMod.setGameOver(false);
    heroMod.despawnAllHeroes();
  });

  it('attack orders focus one target past nearer enemies', async () => {
    await spawnFighter('sk_hunter', { damage: 10, hp: 50, cooldown: 99 }, new THREE.Vector3(0, 0, 0));
    await spawnFighter('sk_near', { damage: 0, hp: 50, cooldown: 99 }, new THREE.Vector3(2, 0, 0));
    await spawnFighter('sk_far', { damage: 0, hp: 10, cooldown: 99 }, new THREE.Vector3(30, 0, 0));
    heroMod.setHeroTeam('sk_hunter', 'radiant');
    heroMod.setHeroTeam('sk_near', 'dire');
    heroMod.setHeroTeam('sk_far', 'dire');

    assert.equal(heroMod.orderHeroAttack('sk_hunter', 'sk_far'), true);
    assert.equal(heroMod.orderHeroAttack('sk_hunter', 'sk_hunter'), false);
    assert.equal(heroMod.orderHeroAttack('sk_hunter', 'nope'), false);
    heroMod.tickHeroes(1.0);
    assert.ok(heroMod.getHero('sk_hunter').moveTarget, 'hunter picks its focus');
    heroMod.tickHeroes(1.0);
    // Hunter walks past the nearer enemy toward its focus.
    assert.ok(heroMod.getHero('sk_hunter').root.position.x > 0);
    assert.equal(heroMod.getHero('sk_near').hp, 50);
    // Focus dies -> focus drops, chase stops, hunter holds (no fallback).
    heroMod.damageHero('sk_far', 999);
    heroMod.tickHeroes(0.1);
    assert.equal(heroMod.getHero('sk_hunter').focusId, null);
    assert.equal(heroMod.getHero('sk_hunter').moveTarget, null);
    const heldX = heroMod.getHero('sk_hunter').root.position.x;
    heroMod.tickHeroes(0.5);
    assert.equal(heroMod.getHero('sk_hunter').root.position.x, heldX);
    // Stop cancels a live focus too.
    heroMod.orderHeroAttack('sk_hunter', 'sk_near');
    heroMod.stopHero('sk_hunter');
    assert.equal(heroMod.getHero('sk_hunter').focusId, null);
    sceneMod.setGameOver(false);
    heroMod.despawnAllHeroes();
  });

  it('ordered fighters chase the focus outside attack range', async () => {
    await spawnFighter('sk_chaser', { damage: 1, hp: 30, cooldown: 9 }, new THREE.Vector3(0, 0, 0));
    await spawnFighter('sk_runner', { damage: 0, hp: 30, cooldown: 99 }, new THREE.Vector3(10, 0, 0));
    heroMod.setHeroTeam('sk_chaser', 'radiant');
    heroMod.setHeroTeam('sk_runner', 'dire');
    heroMod.orderHeroAttack('sk_chaser', 'sk_runner');

    heroMod.tickHeroes(1.0);
    assert.ok(heroMod.getHero('sk_chaser').moveTarget, 'chaser picks a chase target');
    heroMod.tickHeroes(1.0);
    const chaser = heroMod.getHero('sk_chaser');
    assert.ok(chaser.root.position.x > 0, 'chaser advances on the enemy');
    assert.equal(chaser.clip, 'run');
    assert.equal(heroMod.getHero('sk_runner').hp, 30, 'too far to hit');
    sceneMod.setGameOver(false);
    heroMod.despawnAllHeroes();
  });
});
