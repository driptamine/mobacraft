import * as THREE from 'three';
import { currentBounds } from '../core/scene.js';
import { _soldierTakeDamage, damageBuilding } from '../systems/combat.js';
import { _groundAt } from '../systems/terrain.js';
import { buildingLineClear, navigationRadius } from '../../pathfinding/building-routing.js';
import { sgbPassBlockedAt } from '../../pathfinding/avoid.js';
import { heroArc, heroBurst, launchHeroShot, tickHeroEffects } from './hero-effects.js';
import { heroShotOrigin } from './hero-shot-visuals.js';
import { heroProjectileSpeed } from './hero-shot-timing.js';
import { abilityShotStyle, kitFor, type HeroAbility } from './hero-kits.js';

interface TimedValue { value: number; until: number }
interface HeroStatus {
  slow?: TimedValue;
  haste?: TimedValue;
  stun?: TimedValue;
  guard?: TimedValue;
  power?: TimedValue;
  cast?: TimedValue;
}
interface Pulse {
  caster: number;
  team: string;
  center: THREE.Vector3;
  ability: HeroAbility;
  color: number;
  count: number;
  interval: number;
  next: number;
}
const clocks = new WeakMap<object, number>();
const simTime = (world: object) => clocks.get(world) ?? 0;
const positionOf = (world: any, id: number) => world.get(id, 'mesh')?.root?.position as THREE.Vector3 | undefined;
const ground = (x: number, z: number) => new THREE.Vector3(x, _groundAt(x, z), z);

function livingSoldiers(world: any, squadId: number): number[] {
  const squad = world.get(squadId, 'squad');
  return (squad?.soldiers ?? []).filter((id: number | null) => id != null && world.get(id, 'soldier')?.hp > 0);
}
function casterPosition(world: any, squadId: number): THREE.Vector3 | undefined {
  const id = livingSoldiers(world, squadId)[0];
  return id === undefined ? undefined : positionOf(world, id);
}
function statusValue(world: any, id: number, key: keyof HeroStatus): number {
  const value = (world.get(id, 'heroStatus') as HeroStatus | undefined)?.[key];
  return value && value.until > simTime(world) ? value.value : 0;
}
function addStatus(world: any, id: number, key: keyof HeroStatus, value: number, seconds: number): void {
  const status: HeroStatus = world.get(id, 'heroStatus') ?? world.add(id, 'heroStatus', {});
  const now = simTime(world);
  const old = status[key];
  if (!old || old.until <= now || value >= old.value) {
    status[key] = { value, until: old?.value === value ? Math.max(old.until, now + seconds) : now + seconds };
  }
}

export const heroStunned = (world: any, id: number): boolean => statusValue(world, id, 'stun') > 0;
export const heroMoveFactor = (world: any, id: number): number =>
  heroStunned(world, id) ? 0 : (1 - statusValue(world, id, 'slow')) * (1 + statusValue(world, id, 'haste'));
export const heroCasting = (world: any, id: number): boolean => statusValue(world, id, 'cast') > 0;
export const heroDamageGuard = (world: any, id: number): number => statusValue(world, id, 'guard');
export const heroBonusDamage = (world: any, id: number): number => statusValue(world, id, 'power');

export function heroAbilityCooldown(world: any, id: number, index: number): number {
  const readyAt = world.get(id, 'heroAbilities')?.[index] ?? 0;
  return Math.max(0, readyAt - simTime(world));
}

function heal(world: any, soldierId: number, amount: number): void {
  const soldier = world.get(soldierId, 'soldier');
  if (soldier?.hp > 0) soldier.hp = Math.min(soldier.maxHp, soldier.hp + amount);
}

// Stop at the first blocked step so forced movement cannot cross cliffs or
// leave the map. Move the whole squad, including its physical soldier roots.
function displace(world: any, id: number, direction: THREE.Vector3, distance: number): void {
  const squad = world.get(id, 'squad');
  if (!squad || distance <= 0) return;
  const dx = direction.x, dz = direction.z;
  const length = Math.hypot(dx, dz);
  if (length < .01) return;
  const grid = typeof window === 'undefined' ? null : window.__sgbPassGrid;
  const bound = currentBounds();
  const start = squad.position.clone();
  let previousY = _groundAt(start.x, start.z);
  let traveled = 0;
  const footprint = navigationRadius(squad);
  for (let next = Math.min(.5, distance); next > traveled; next = Math.min(next + .5, distance)) {
    const x = start.x + dx / length * next, z = start.z + dz / length * next;
    if (Math.abs(x) > bound || Math.abs(z) > bound || sgbPassBlockedAt(grid, x, z)
      || !buildingLineClear(start, { x, z }, footprint, true)) break;
    const y = _groundAt(x, z);
    if (Math.abs(y - previousY) > 1.5) break;
    traveled = next;
    previousY = y;
  }
  if (!traveled) return;
  const x = dx / length * traveled, z = dz / length * traveled;
  squad.position.set(start.x + x, previousY, start.z + z);
  for (const soldier of livingSoldiers(world, id)) {
    const at = positionOf(world, soldier);
    if (!at) continue;
    at.x += x;
    at.z += z;
    at.y = _groundAt(at.x, at.z);
  }
}

interface Victim { id: number; squad: number; position: THREE.Vector3 }
function soldiersOfSide(world: any, team: string, allied: boolean): Victim[] {
  const victims: Victim[] = [];
  for (const id of world.query('soldier', 'mesh')) {
    const soldier = world.get(id, 'soldier');
    const squad = world.get(soldier.squadId, 'squad');
    const position = positionOf(world, id);
    if (position && squad && soldier.hp > 0 && !soldier._flyStage && (squad.team === team) === allied) {
      victims.push({ id, squad: soldier.squadId, position });
    }
  }
  return victims;
}
function isOffensive(ability: HeroAbility): boolean {
  return Boolean(ability.damage || ability.stun || ability.slow || ability.push || ability.pull);
}
function affectEnemies(world: any, victims: Victim[], center: THREE.Vector3, ability: HeroAbility): void {
  const affected = new Set<number>();
  for (const victim of victims) {
    if (ability.damage) _soldierTakeDamage(world, victim.id, ability.damage);
    if (affected.has(victim.squad)) continue;
    affected.add(victim.squad);
    if (ability.stun) addStatus(world, victim.squad, 'stun', 1, ability.stun);
    if (ability.slow) addStatus(world, victim.squad, 'slow', ability.slow, ability.pulses ? 1.1 : ability.duration ?? 2);
    if (ability.pull) {
      const direction = center.clone().sub(victim.position);
      displace(world, victim.squad, direction, Math.min(ability.pull, Math.max(0, Math.hypot(direction.x, direction.z) - 2)));
    }
    if (ability.push) displace(world, victim.squad, victim.position.clone().sub(center), ability.push);
  }
}
function affectAllies(world: any, victims: Victim[], ability: HeroAbility): void {
  const duration = ability.duration ?? 3;
  for (const victim of victims) {
    if (ability.heal) heal(world, victim.id, ability.heal);
    if (ability.haste) addStatus(world, victim.squad, 'haste', ability.haste, duration);
    if (ability.guard) addStatus(world, victim.squad, 'guard', ability.guard, duration);
    if (ability.power) addStatus(world, victim.squad, 'power', ability.power, duration);
  }
}

function areaImpact(world: any, team: string, center: THREE.Vector3, ability: HeroAbility, color: number): void {
  const radius = ability.radius ?? 0;
  const within = ({ position }: Victim) => Math.hypot(position.x - center.x, position.z - center.z) <= radius;
  heroBurst(world, ground(center.x, center.z), color, radius);
  if (isOffensive(ability)) affectEnemies(world, soldiersOfSide(world, team, false).filter(within), center, ability);
  if (radius > 0 && !isOffensive(ability)) affectAllies(world, soldiersOfSide(world, team, true).filter(within), ability);
}
function lineVictims(victims: Victim[], start: THREE.Vector3, end: THREE.Vector3, width: number): Victim[] {
  const dx = end.x - start.x, dz = end.z - start.z;
  const squaredLength = dx * dx + dz * dz;
  return victims.flatMap(victim => {
    const x = victim.position.x - start.x, z = victim.position.z - start.z;
    const fraction = squaredLength > 0 ? (x * dx + z * dz) / squaredLength : 0;
    return fraction >= 0 && fraction <= 1 && Math.hypot(x - fraction * dx, z - fraction * dz) <= width
      ? [{ victim, fraction }] : [];
  }).sort((a, b) => a.fraction - b.fraction).map(match => match.victim);
}
function raised(at: THREE.Vector3, height = 1.15): THREE.Vector3 {
  return new THREE.Vector3(at.x, at.y + height, at.z);
}
function liveTarget(world: any, id: number, team: string, allied: boolean): THREE.Vector3 | null {
  const soldier = world.get(id, 'soldier');
  if (soldier) {
    const squad = world.get(soldier.squadId, 'squad');
    if (soldier.hp <= 0 || !squad || (squad.team === team) !== allied) return null;
  } else {
    const structure = world.get(id, 'building') || world.get(id, 'structure');
    if (!structure || structure.hp <= 0 || (structure.team === team) !== allied) return null;
  }
  return positionOf(world, id) ?? null;
}

export function launchHeroAttack(world: any, squad: any, soldierId: number, target: number, damage: number): boolean {
  const kit = kitFor(squad.unitType);
  if (!kit?.primary || squad.attackMode === 'melee') return false;
  const from = positionOf(world, soldierId);
  const aim = () => {
    const position = liveTarget(world, target, squad.team, false);
    return position ? raised(position) : null;
  };
  if (!from || !aim()) return false;
  const muzzle = heroShotOrigin(world.get(soldierId, 'mesh')?.root, squad.unitType, raised(from));
  launchHeroShot(world, raised(from), aim, heroProjectileSpeed({ ...kit.primary, color: kit.color }), () => {
    if (world.has(target, 'soldier')) _soldierTakeDamage(world, target, damage);
    else damageBuilding(world, target, damage);
  }, muzzle);
  return true;
}

export function castHeroAbility(world: any, caster: number, index: number, point?: THREE.Vector3, target?: number): string | null {
  const squad = world.get(caster, 'squad');
  const kit = kitFor(squad?.unitType);
  const ability = kit?.abilities[index];
  const casterAt = casterPosition(world, caster);
  if (!kit || !ability || !casterAt) return 'Select a living hero.';
  if (heroStunned(world, caster)) return 'This hero is stunned.';
  if (heroAbilityCooldown(world, caster, index) > 0) return 'This ability is recharging.';
  const origin = casterAt.clone();
  const team: string = squad.team;
  const targeted = ability.mode === 'enemy' || ability.mode === 'ally';
  const allied = ability.mode === 'ally';
  const unitAt = targeted && target != null && world.has(target, 'soldier') ? liveTarget(world, target, team, allied) : null;
  const aim = ability.mode === 'self' ? origin : targeted ? unitAt : point;
  if (!aim || !Number.isFinite(aim.x) || !Number.isFinite(aim.z)) {
    return targeted ? (allied ? 'Choose an allied unit.' : 'Choose an enemy unit.') : 'Choose a point on the ground.';
  }
  const distance = Math.hypot(aim.x - origin.x, aim.z - origin.z);
  if (ability.range != null && distance > ability.range + .01) return `Out of range (${ability.range} units).`;
  if (ability.mode === 'line' && distance < .1) return 'Choose a direction.';
  const cooldowns: number[] = world.get(caster, 'heroAbilities') ?? world.add(caster, 'heroAbilities', []);
  cooldowns[index] = simTime(world) + ability.cooldown;
  const center = ground(aim.x, aim.z);
  const shotStyle = abilityShotStyle(ability, kit.color);
  const root = world.get(livingSoldiers(world, caster)[0], 'mesh')?.root;
  const castClip = root?._animGroups?.cast ? 'cast' : kit.primary ? 'shoot' : 'melee';
  if (root?._animGroups?.[castClip]) {
    if (distance > .1) root.rotation.y = Math.atan2(aim.x - origin.x, aim.z - origin.z);
    root._playAnim?.(castClip, false, true);
    addStatus(world, caster, 'cast', 1, Math.min(.55, root._animGroups[castClip].getDuration?.() ?? .45));
  }
  if (ability.dash) {
    displace(world, caster, center.clone().sub(origin), Math.min(distance, ability.dash));
    const arrival = casterPosition(world, caster);
    if (arrival) center.copy(arrival);
  }
  if (ability.mode === 'line') {
    const victims = lineVictims(soldiersOfSide(world, team, false), origin, center, ability.radius ?? 1);
    heroArc(world, origin, center, kit.color, ability.radius ?? 1);
    if (shotStyle) {
      const first = victims[0];
      const shootAt = () => first ? liveTarget(world, first.id, team, false) : center;
      launchHeroShot(world, raised(origin), () => {
        const current = shootAt();
        return current ? raised(current) : null;
      }, heroProjectileSpeed(shotStyle), impact => {
        if (first) affectEnemies(world, [first], casterPosition(world, caster) ?? origin, ability);
        heroBurst(world, ground(impact.x, impact.z), kit.color, 2);
      }, heroShotOrigin(root, squad.unitType, raised(origin)));
    } else {
      affectEnemies(world, victims, origin, ability);
    }
  } else if (targeted && target !== undefined) {
    const targetId = target;
    const impact = () => {
      const at = liveTarget(world, targetId, team, allied);
      const soldier = world.get(targetId, 'soldier');
      if (!at || !soldier) return;
      const victim = { id: targetId, squad: soldier.squadId, position: at };
      if (allied) {
        affectAllies(world, [victim], ability);
        heroBurst(world, ground(at.x, at.z), kit.color, 2);
      } else if (ability.radius) {
        areaImpact(world, team, at, ability, kit.color);
      } else {
        affectEnemies(world, [victim], origin, ability);
        heroBurst(world, ground(at.x, at.z), kit.color, 2);
      }
      if (!allied && ability.heal) {
        for (const soldier of livingSoldiers(world, caster)) heal(world, soldier, ability.heal);
      }
    };
    if (shotStyle) {
      launchHeroShot(world, raised(origin), () => {
        const at = liveTarget(world, targetId, team, allied);
        return at ? raised(at) : null;
      }, heroProjectileSpeed(shotStyle), impact, heroShotOrigin(root, squad.unitType, raised(origin)));
    } else {
      impact();
    }
  } else {
    if (!ability.radius || isOffensive(ability)) {
      const allies = livingSoldiers(world, caster).map(id => ({ id, squad: caster, position: origin }));
      affectAllies(world, allies, ability);
    }
    areaImpact(world, team, center, ability, kit.color);
    if (ability.pulses && ability.pulses > 1) {
      const interval = (ability.duration ?? 1) / (ability.pulses - 1);
      const pulse = { caster, team, center, ability, color: kit.color, count: ability.pulses - 1, interval, next: simTime(world) + interval };
      world.add(world.createEntity(), 'heroAbilityPulse', pulse);
    }
  }
  return null;
}

export function systemHeroCombat(world: any, dt: number): void {
  const time = simTime(world) + dt;
  clocks.set(world, time);
  for (const id of world.query('heroStatus')) {
    const status: HeroStatus = world.get(id, 'heroStatus');
    for (const key of Object.keys(status) as Array<keyof HeroStatus>) {
      if (status[key]!.until <= time) delete status[key];
    }
    if (!Object.keys(status).length) world.remove(id, 'heroStatus');
  }
  for (const id of world.query('heroAbilityPulse')) {
    const pulse: Pulse = world.get(id, 'heroAbilityPulse');
    if (pulse.next > time) continue;
    const center = pulse.ability.mode === 'self' ? casterPosition(world, pulse.caster) : pulse.center;
    if (!center) {
      world.destroyEntity(id);
      continue;
    }
    areaImpact(world, pulse.team, center, pulse.ability, pulse.color);
    pulse.next += pulse.interval;
    if (--pulse.count <= 0) world.destroyEntity(id);
  }
  tickHeroEffects(world, dt);
}
