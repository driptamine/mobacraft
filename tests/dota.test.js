import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./node-esm-hooks.mjs', import.meta.url);
globalThis.window = {};
globalThis.document = { getElementById: () => null };
const dota = await import('../src/dota.js');

const anchor = () => new THREE.Vector3(0, 0, 0);

describe('dota map', () => {
  it('builds three lanes with nine towers per side and two shops', () => {
    const parent = new THREE.Group();
    dota.buildDotaMap(parent, anchor());
    const towers = dota.dotaTowers();
    assert.equal(towers.length, 18);
    for (const team of ['radiant', 'dire']) {
      assert.equal(towers.filter((t) => t.team === team).length, 9);
      for (const lane of ['top', 'mid', 'bot']) {
        assert.equal(towers.filter((t) => t.team === team && t.lane === lane).length, 3);
      }
    }
    // Tower tiers order outward: tier 0 stands nearest its own base.
    const rb = new THREE.Vector3(-40, 0, 40);
    const db = new THREE.Vector3(40, 0, -40);
    for (const team of ['radiant', 'dire']) {
      const own = team === 'radiant' ? rb : db;
      for (const lane of ['top', 'mid', 'bot']) {
        const row = towers.filter((t) => t.team === team && t.lane === lane);
        const d0 = row[0].root.position.distanceTo(own);
        const d1 = row[1].root.position.distanceTo(own);
        const d2 = row[2].root.position.distanceTo(own);
        assert.ok(d0 < d1 && d1 < d2, `${team}/${lane} tiers ordered`);
      }
    }
    for (const t of towers) {
      assert.equal(t.hp, t.maxHp);
      assert.equal(t.alive, true);
    }
    const shops = dota.dotaShops();
    assert.equal(shops.length, 2);
    assert.deepEqual(shops.map((s) => s.team).sort(), ['dire', 'radiant']);
    // River water runs the top-left to bottom-right diagonal.
    let foundWater = 0;
    let foundBank = 0;
    parent.traverse((child) => {
      if (child.name === 'dota_river_water') {
        foundWater += 1;
      }
      if (child.name === 'dota_river_bank') {
        foundBank += 1;
      }
    });
    assert.equal(foundWater, 1);
    assert.equal(foundBank, 2);
    // Hero lane slots run 2-1-2 near the team's own base.
    const slots = dota.dotaHeroSlots(anchor());
    for (const team of ['radiant', 'dire']) {
      assert.equal(slots[team].length, 5);
      assert.deepEqual(slots[team].map((s) => s.lane), ['top', 'top', 'mid', 'bot', 'bot']);
      const own = team === 'radiant' ? new THREE.Vector3(-40, 0, 40) : new THREE.Vector3(40, 0, -40);
      const foe = team === 'radiant' ? new THREE.Vector3(40, 0, -40) : new THREE.Vector3(-40, 0, 40);
      for (const slot of slots[team]) {
        assert.ok(slot.pos.distanceTo(own) < slot.pos.distanceTo(foe));
      }
    }
    dota.clearDotaMap();
    assert.equal(dota.dotaTowers().length, 0);
    assert.equal(dota.dotaCreeps().length, 0);
    assert.equal(dota.dotaShops().length, 0);
    assert.equal(parent.children.length, 0);
  });

  it('spawns creep waves that walk their lanes', () => {
    const parent = new THREE.Group();
    dota.buildDotaMap(parent, anchor());
    dota.tickDota(3.1);
    const creeps = dota.dotaCreeps();
    assert.equal(creeps.length, 24);
    assert.equal(creeps.filter((c) => c.kind === 'ranged').length, 6);
    const walker = creeps.find((c) => c.team === 'radiant' && c.lane === 'mid' && c.kind === 'melee');
    const from = walker.root.position.clone();
    dota.tickDota(1.0);
    assert.ok(walker.root.position.distanceTo(from) > 1, 'creep advances');
    // Second wave respects the per-lane cap.
    for (let i = 0; i < 30; i++) {
      dota.tickDota(25);
    }
    for (const team of ['radiant', 'dire']) {
      for (const lane of ['top', 'mid', 'bot']) {
        const n = dota.dotaCreeps().filter((c) => c.team === team && c.lane === lane && c.alive).length;
        assert.ok(n <= 10, `cap holds (${team}/${lane}: ${n})`);
      }
    }
    dota.clearDotaMap();
  });

  it('creeps fight adjacent enemies and towers fire projectiles', () => {
    const parent = new THREE.Group();
    dota.buildDotaMap(parent, anchor());
    dota.tickDota(3.1);
    const a = dota.dotaCreeps().find((c) => c.team === 'radiant' && c.kind === 'melee');
    const b = dota.dotaCreeps().find((c) => c.team === 'dire' && c.kind === 'melee');
    b.root.position.copy(a.root.position).add(new THREE.Vector3(1, 0, 0));
    const hpA = a.hp;
    const hpB = b.hp;
    dota.tickDota(1.5);
    assert.ok(a.hp < hpA && b.hp < hpB, 'melee trade blows');

    // Isolate a dire tower far from lane traffic, then drag an enemy creep
    // into range: the tower shoots it down.
    const tower = dota.dotaTowers().find((t) => t.team === 'dire' && t.lane === 'mid');
    tower.root.position.set(500, 0, 500);
    a.hp = a.maxHp;
    a.root.position.copy(tower.root.position).add(new THREE.Vector3(8, 0, 0));
    for (let i = 0; i < 20 && a.hp === a.maxHp; i++) {
      dota.tickDota(0.2);
    }
    assert.ok(a.hp < a.maxHp, 'tower projectile hits');

    // A destroyed tower collapses and leaves the lineup.
    tower.hp = 1;
    const foe = dota.dotaCreeps().find((c) => c.team === 'radiant' && c.kind === 'melee' && c.alive);
    assert.ok(foe, 'a live radiant melee remains');
    foe.hp = foe.maxHp;
    foe.root.position.copy(tower.root.position).add(new THREE.Vector3(1, 0, 0));
    foe.cooldown = 0;
    dota.tickDota(0.1);
    assert.equal(tower.alive, false);
    dota.tickDota(2.0);
    assert.ok(!dota.dotaTowers().includes(tower), 'rubble left, tower removed');
    dota.clearDotaMap();
  });
});
