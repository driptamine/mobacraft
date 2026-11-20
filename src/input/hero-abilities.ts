import { world, canvas, canCommand, gameOver, selSquads, buildMode } from '../core/scene.js';
import { updateHUD } from '../core/hud.js';
import { kitFor } from '../heroes/hero-kits.js';
import { castHeroAbility, heroAbilityCooldown, heroStunned } from '../heroes/hero-combat.js';
import { cancelBuild } from './build-ghost.js';
import { clearBuilderCommand, cancelFlyTargeting } from './orders.js';
import { pickMesh, raycastGround } from './selection.js';
import { clearUnitCommand } from './unit-commands.js';

export const HERO_ABILITY_KEYS: readonly string[] = ['Digit3', 'Digit4', 'Digit5', 'Digit7'];

interface AbilityTarget { world: typeof world; caster: number; index: number }
export let pendingHeroAbility: AbilityTarget | null = null;
export let heroAbilityMessage = '';

export function selectedAbilityHero(): number | undefined {
  if (!world || gameOver || typeof window !== 'undefined' && window._multiplayerMode) return undefined;
  if (selSquads.length !== 1) return undefined;
  const id = selSquads[0];
  const squad = world.get(id, 'squad');
  return squad && kitFor(squad.unitType)?.abilities.length && canCommand(squad.team, id)
    && squad.soldiers.some((soldier: number | null) => soldier != null && world.get(soldier, 'soldier')?.hp > 0)
    ? id : undefined;
}

export function clearHeroAbilityTarget(): void {
  const wasArmed = pendingHeroAbility !== null;
  pendingHeroAbility = null;
  heroAbilityMessage = '';
  if (wasArmed && canvas) canvas.style.cursor = '';
  if (wasArmed) updateHUD();
}

export function chooseHeroAbility(index: number): boolean {
  const caster = selectedAbilityHero();
  if (caster === undefined) return false;
  const kit = kitFor(world.get(caster, 'squad').unitType)!;
  const ability = kit.abilities[index];
  if (!ability) return false;
  if (heroAbilityCooldown(world, caster, index) > 0 || heroStunned(world, caster)) return true;
  clearHeroAbilityTarget();
  clearUnitCommand();
  clearBuilderCommand();
  cancelFlyTargeting();
  if (buildMode) cancelBuild();
  if (ability.mode === 'self') {
    heroAbilityMessage = castHeroAbility(world, caster, index) ?? '';
  } else {
    pendingHeroAbility = { world, caster, index };
    heroAbilityMessage = ability.mode === 'enemy' ? 'Choose an enemy · Esc to cancel'
      : ability.mode === 'ally' ? 'Choose an ally · Esc to cancel' : 'Choose a point · Esc to cancel';
    if (canvas) canvas.style.cursor = 'crosshair';
  }
  updateHUD();
  return true;
}

export function tryHeroAbilityClick(x: number, y: number, button: number): boolean {
  const pending = pendingHeroAbility;
  if (!pending) return false;
  if (button === 2) {
    clearHeroAbilityTarget();
    return true;
  }
  if (pending.world !== world || selectedAbilityHero() !== pending.caster) {
    clearHeroAbilityTarget();
    return false;
  }
  const ability = kitFor(world.get(pending.caster, 'squad').unitType)!.abilities[pending.index];
  const targeted = ability.mode === 'enemy' || ability.mode === 'ally';
  const target = targeted ? pickMesh(x, y)?.meta?.soldierEntityId : undefined;
  const point = targeted ? undefined : raycastGround(x, y) ?? undefined;
  const error = castHeroAbility(world, pending.caster, pending.index, point, target);
  if (error) {
    heroAbilityMessage = error;
    updateHUD();
  } else {
    clearHeroAbilityTarget();
  }
  return true;
}
