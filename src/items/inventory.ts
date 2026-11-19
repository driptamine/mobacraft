import { dotaItemById, itemRecipes, recipeComponentIds, type DotaItem } from './catalog.js';

export const HERO_ITEM_SLOTS = 6;
export const HERO_STARTING_GOLD = 600;
export interface InventoryEntry { itemId: string; paid: number }
export interface HeroInventory {
  gold: number;
  slots: Array<InventoryEntry | null>;
  baseSpeed: number;
  soldiers: Array<{ id: number; maxHp: number; attackRate: number; moveSpeed: number }>;
  healthRegen: number;
}
export function initHeroInventory(world: any, id: number): HeroInventory {
  const existing = world.get(id, 'heroInventory'); if (existing) return existing;
  const squad = world.get(id, 'squad');
  const inventory: HeroInventory = { gold: HERO_STARTING_GOLD, slots: Array(HERO_ITEM_SLOTS).fill(null), baseSpeed: squad.speed,
    soldiers: squad.soldiers.flatMap((sid: number | null) => {
      const soldier = sid == null ? null : world.get(sid, 'soldier');
      return soldier ? [{ id: sid!, maxHp: soldier.maxHp, attackRate: soldier.attackRate, moveSpeed: soldier.moveSpeed }] : [];
    }), healthRegen: 0 };
  world.add(id, 'heroInventory', inventory); return inventory;
}
export function inventoryBonuses(inventory: HeroInventory): DotaItem['passive'] {
  const total = { health: 0, strength: 0, agility: 0, intelligence: 0, damage: 0, armor: 0, attackSpeed: 0, movementSpeed: 0, movementPercent: 0, healthRegen: 0 };
  for (const entry of inventory.slots) {
    const item = entry && dotaItemById.get(entry.itemId); if (!item || item.recipe) continue;
    for (const key of Object.keys(total) as Array<keyof typeof total>) {
      // Boots use the largest flat movement bonus; other passive bonuses add.
      if (key === 'movementSpeed') total[key] = Math.max(total[key], item.passive[key]);
      else total[key] += item.passive[key];
    }
  }
  return total;
}
function applyInventory(world: any, id: number, inventory: HeroInventory): void {
  const squad = world.get(id, 'squad'); if (!squad) return;
  const bonus = inventoryBonuses(inventory);
  const speedFactor = Math.max(.1, 1 + bonus.movementPercent / 100);
  squad.speed = (inventory.baseSpeed + bonus.movementSpeed * .0254) * speedFactor;
  inventory.healthRegen = bonus.healthRegen + bonus.strength * .1;
  for (const base of inventory.soldiers) {
    const soldier = world.get(base.id, 'soldier'); if (!soldier) continue;
    const maxHp = base.maxHp + bonus.health + bonus.strength * 22;
    if (soldier.hp > 0) soldier.hp = Math.min(maxHp, Math.max(1, soldier.hp + maxHp - soldier.maxHp));
    soldier.maxHp = maxHp;
    soldier.itemAttackSpeedFactor = Math.max(.1, 1 + (bonus.attackSpeed + bonus.agility) / 100);
    soldier.attackRate = base.attackRate * soldier.itemAttackSpeedFactor;
    const root = world.get(base.id, 'mesh')?.root;
    if (root) root._itemAttackSpeed = soldier.itemAttackSpeedFactor;
    soldier.moveSpeed = (base.moveSpeed + bonus.movementSpeed * .0254) * speedFactor;
    soldier.itemBonusDamage = bonus.damage;
    soldier.itemArmor = bonus.armor + bonus.agility / 6;
  }
}
function living(world: any, id: number): boolean {
  return !!world.get(id, 'squad')?.soldiers.some((sid: number | null) => sid != null && world.get(sid, 'soldier')?.hp > 0);
}
export function buyHeroItem(world: any, id: number, itemId: string): string | null {
  const inventory: HeroInventory | undefined = world.get(id, 'heroInventory');
  const item = dotaItemById.get(itemId);
  if (!inventory || !living(world, id)) return 'Выберите живого героя.';
  if (!item?.purchasable) return 'Этот предмет нельзя купить в магазине.';
  const slot = inventory.slots.indexOf(null);
  if (slot < 0) return 'Инвентарь заполнен: все 6 слотов заняты.';
  if (inventory.gold < item.cost) return 'Недостаточно золота.';
  inventory.gold -= item.cost;
  inventory.slots[slot] = { itemId, paid: item.cost };
  applyInventory(world, id, inventory); return null;
}

interface AssemblyPlan {
  result: DotaItem;
  slots: number[];
  fee: number;
}

export function planItemAssembly(inventory: HeroInventory, item: DotaItem): AssemblyPlan | null {
  let best: AssemblyPlan | null = null;
  for (const recipe of itemRecipes(item)) {
    const result = recipe.result && dotaItemById.get(recipe.result);
    if (!result || result.recipe || (recipe.cost > 0 && !recipe.purchasable)) continue;
    for (const parts of recipe.components) {
      const components = recipeComponentIds(parts);
      if (!components.length) continue;
      const slots: number[] = [];
      for (const component of components) {
        const slot = inventory.slots.findIndex((entry, index) => entry?.itemId === component && !slots.includes(index));
        if (slot < 0) break;
        slots.push(slot);
      }
      if (slots.length !== components.length) continue;
      let fee = recipe.cost;
      const paidRecipe = inventory.slots.findIndex((entry, index) => entry?.itemId === recipe.id && !slots.includes(index));
      if (paidRecipe >= 0) {
        slots.push(paidRecipe);
        fee = 0;
      }
      if (!best || fee < best.fee) best = { result, slots, fee };
    }
  }
  return best;
}

export function assembleHeroItem(world: any, id: number, itemId: string): { itemId: string; slot: number } | string {
  const inventory: HeroInventory | undefined = world.get(id, 'heroInventory');
  if (!inventory || !living(world, id)) return 'Выберите живого героя.';
  const item = dotaItemById.get(itemId);
  const plan = item && planItemAssembly(inventory, item);
  if (!plan) return 'Для сборки нужны компоненты в инвентаре.';
  if (inventory.gold < plan.fee) return 'Недостаточно золота для сборки.';
  const slot = Math.min(...plan.slots);
  let paid = plan.fee;
  for (const index of plan.slots) {
    paid += inventory.slots[index]!.paid;
    inventory.slots[index] = null;
  }
  inventory.slots[slot] = { itemId: plan.result.id, paid };
  inventory.gold -= plan.fee;
  applyInventory(world, id, inventory);
  return { itemId: plan.result.id, slot };
}

export function sellHeroItem(world: any, id: number, slot: number): string | null {
  const inventory: HeroInventory | undefined = world.get(id, 'heroInventory');
  if (!inventory || !living(world, id)) return 'Выберите живого героя.';
  const entry = inventory.slots[slot]; if (!entry) return 'Слот пуст.';
  const item = dotaItemById.get(entry.itemId);
  if (!item?.sellable) return 'Этот предмет нельзя продать.';
  inventory.gold += Math.floor(entry.paid / 2); inventory.slots[slot] = null;
  applyInventory(world, id, inventory); return null;
}
export function systemHeroInventory(world: any, dt: number): void {
  for (const id of world.query('heroInventory')) {
    if (!living(world, id)) continue;
    const inventory: HeroInventory = world.get(id, 'heroInventory');
    inventory.gold += 2 * dt;
    if (inventory.healthRegen <= 0) continue;
    for (const base of inventory.soldiers) {
      const soldier = world.get(base.id, 'soldier');
      if (soldier?.hp > 0) soldier.hp = Math.min(soldier.maxHp, soldier.hp + inventory.healthRegen * dt);
    }
  }
}
