import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dotaItems, dotaItemById, filterItems } from '../src/items/catalog.js';
import { assembleHeroItem, initHeroInventory, buyHeroItem, sellHeroItem, systemHeroInventory, inventoryBonuses } from '../src/items/inventory.js';
import { World } from '../src/core/ecs.js';
import { parseKeyValues } from '../scripts/valve-keyvalues.mjs';

function fixture() {
  const world = new World();
  const id = world.createEntity(), soldierId = world.createEntity();
  world.add(soldierId, 'soldier', { hp: 100, maxHp: 100, attackRate: 1, moveSpeed: 5 });
  world.add(id, 'squad', { speed: 5, soldiers: [null, soldierId], unitType: 'axe' });
  const inventory = initHeroInventory(world, id);
  return { world, id, soldier: world.get(soldierId, 'soldier'), inventory };
}

test('official item catalog has unique definitions, prices, recipes and real PNGs', () => {
  assert.equal(dotaItems.length, 566);
  assert.equal(new Set(dotaItems.map(item => item.id)).size, dotaItems.length);
  assert.equal(dotaItems.filter(item => item.recipe).length, 134);
  const icons = new Set(dotaItems.map(item => item.icon)); assert.equal(icons.size, 433);
  for (const path of icons) {
    const bytes = fs.readFileSync(path);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', path);
    assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
  }
  for (const item of dotaItems) {
    assert.ok(item.title); assert.ok(Number.isFinite(item.cost) && item.cost >= 0);
    assert.ok(item.iconSource.startsWith('panorama/images/items/'));
  }
  assert.equal(dotaItemById.get('item_blink').cost, 2250);
  assert.equal(dotaItemById.get('item_ward_observer').purchasable, true);
  assert.equal(dotaItemById.get('item_ward_observer').cost, 0);
  assert.ok(filterItems('recipes').every(item => item.recipe));
  assert.ok(filterItems('neutral').length > 100);
  assert.ok(filterItems('all', 'blink').some(item => item.id === 'item_blink'));
  assert.equal(filterItems('all', 'not-an-item-qzqzq').length, 0);
});

test('KV parser preserves comments inside strings, nested recipe values and localized escapes', () => {
  const result = parseKeyValues('\uFEFF"root" { // comment\n "x" "https://example.test/a" /* another */ "nested" { "name" "a\\"b\\nстрока" } }');
  assert.equal(result.root.x, 'https://example.test/a');
  assert.equal(result.root.nested.name, 'a"b\nстрока');
  assert.throws(() => parseKeyValues('"broken" {'), /Unclosed/);
});

test('buy and sell update one hero wallet and reverse basic bonuses without stacking drift', () => {
  const { world, id, soldier, inventory } = fixture();
  const price = dotaItemById.get('item_branches').cost;
  assert.equal(buyHeroItem(world, id, 'item_branches'), null);
  assert.equal(inventory.gold, 600 - price);
  assert.equal(soldier.maxHp, 122); assert.equal(soldier.hp, 122);
  assert.equal(soldier.attackRate, 1.01);
  assert.equal(buyHeroItem(world, id, 'item_branches'), null);
  assert.equal(soldier.maxHp, 144); assert.equal(soldier.attackRate, 1.02);
  assert.equal(sellHeroItem(world, id, 0), null);
  assert.equal(soldier.maxHp, 122); assert.equal(soldier.attackRate, 1.01);
  assert.equal(sellHeroItem(world, id, 1), null);
  assert.equal(soldier.maxHp, 100); assert.equal(soldier.attackRate, 1);
  assert.equal(inventory.gold, 600 - 2 * price + 2 * Math.floor(price / 2));
  const gold = inventory.gold;
  assert.ok(sellHeroItem(world, id, 0)); assert.equal(inventory.gold, gold);
});

test('six-slot limit, affordability, unavailable items and dead heroes cannot change the wallet', () => {
  const { world, id, soldier, inventory } = fixture();
  for (let i = 0; i < 6; i++) assert.equal(buyHeroItem(world, id, 'item_branches'), null);
  const gold = inventory.gold;
  assert.match(buyHeroItem(world, id, 'item_branches'), /6 слотов/);
  assert.equal(inventory.gold, gold); assert.equal(inventory.slots.filter(Boolean).length, 6);
  sellHeroItem(world, id, 0);
  const previous = inventory.gold;
  assert.match(buyHeroItem(world, id, 'item_blink'), /золота/);
  assert.ok(buyHeroItem(world, id, 'item_recipe_heart'));
  assert.ok(buyHeroItem(world, id, 'item_aegis')); assert.ok(buyHeroItem(world, id, 'bad-id'));
  assert.equal(inventory.gold, previous);
  soldier.hp = 0;
  assert.ok(buyHeroItem(world, id, 'item_branches')); assert.ok(sellHeroItem(world, id, 1));
  systemHeroInventory(world, 10); assert.equal(inventory.gold, previous);
});

test('flat movement speed uses the largest boots bonus, and wallets stay per hero/world', () => {
  const { world, id, inventory } = fixture(); inventory.gold = 10000;
  const before = world.get(id, 'squad').speed;
  assert.equal(buyHeroItem(world, id, 'item_boots'), null);
  const first = world.get(id, 'squad').speed; assert.ok(first > before);
  assert.equal(buyHeroItem(world, id, 'item_boots'), null);
  assert.equal(world.get(id, 'squad').speed, first);
  assert.equal(inventoryBonuses(inventory).movementSpeed, dotaItemById.get('item_boots').passive.movementSpeed);
  const other = fixture();
  systemHeroInventory(world, 5);
  assert.equal(inventory.gold, 10000 - 2 * dotaItemById.get('item_boots').cost + 10);
  assert.equal(other.inventory.gold, 600); assert.equal(other.soldier.maxHp, 100);
});

test('assembly uses distinct matching slots and can free space in a full inventory', () => {
  const { world, id, inventory } = fixture();
  for (const item of ['item_magic_stick', 'item_branches', ...Array(3).fill('item_ward_observer')]) {
    assert.equal(buyHeroItem(world, id, item), null);
  }
  assert.match(assembleHeroItem(world, id, 'item_magic_wand'), /компоненты/);
  assert.equal(buyHeroItem(world, id, 'item_branches'), null);
  assert.ok(inventory.slots.every(Boolean));
  const gold = inventory.gold;
  inventory.gold = 100;
  const originalSlots = structuredClone(inventory.slots);
  assert.match(assembleHeroItem(world, id, 'item_magic_wand'), /золота/);
  assert.deepEqual(inventory.slots, originalSlots);
  assert.equal(inventory.gold, 100);
  inventory.gold = gold;
  assert.deepEqual(assembleHeroItem(world, id, 'item_magic_wand'), { itemId: 'item_magic_wand', slot: 0 });
  assert.deepEqual(inventory.slots[0], { itemId: 'item_magic_wand', paid: 460 });
  assert.equal(inventory.gold, gold - 150);
  assert.equal(inventory.slots.filter(Boolean).length, 4);
  assert.equal(inventory.slots.filter(entry => entry?.itemId === 'item_ward_observer').length, 3);
  assert.equal(sellHeroItem(world, id, 0), null);
  assert.equal(inventory.gold, gold - 150 + 230);
});

test('assembly accepts alternative components and consumes a prepaid recipe without charging twice', () => {
  const { world, id, inventory } = fixture();
  inventory.gold = 10000;
  for (const item of ['item_boots', 'item_gloves', 'item_robe', 'item_magic_stick', 'item_branches', 'item_branches']) {
    assert.equal(buyHeroItem(world, id, item), null);
  }
  const before = inventory.gold;
  assert.deepEqual(assembleHeroItem(world, id, 'item_recipe_power_treads'), { itemId: 'item_power_treads', slot: 0 });
  assert.equal(inventory.gold, before);
  assert.equal(buyHeroItem(world, id, 'item_recipe_magic_wand'), null);
  const afterRecipe = inventory.gold;
  assert.deepEqual(assembleHeroItem(world, id, 'item_recipe_magic_wand'), { itemId: 'item_magic_wand', slot: 1 });
  assert.equal(inventory.gold, afterRecipe);
  assert.deepEqual(inventory.slots.filter(Boolean).map(entry => entry.itemId), ['item_power_treads', 'item_magic_wand']);
});
