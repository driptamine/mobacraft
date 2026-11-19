import type { UnitStats } from '../../types.js';
import batch1Animations from '../../../animations/batches/1/animations.json';

// Batch 1 heroes (assembled models under batches/1/final): 5v5 showcase
// roster. Models and action->clip maps come from
// animations/batches/1/animations.json; each entry keeps the full clip list
// for reference. Heroes are single-soldier squads, not trainable (no cost).
type Batch1Key = keyof typeof batch1Animations;

function hero(
  name: Batch1Key,
  opts: { hp: number; weapon: string; attackRange: number; melee: boolean; speed: number; cost: number; time: number },
): UnitStats {
  const entry = batch1Animations[name] as { model: string; actions: unknown };
  return {
    name,
    lazyLoad: true,
    model: entry.model,
    animations: entry.actions,
    icon: `assets/batch1/${name}.png`,
    cost: opts.cost,
    time: opts.time,
    hp: opts.hp,
    armor: 'infantry_hmed',
    weapon: opts.weapon,
    attackRange: opts.attackRange,
    size: 1,
    squadSize: 1,
    // Ground speed matched to the run clip's own pace (root travel per loop
    // at 1x playback), so the stride syncs with displacement instead of
    // sliding. Measured per hero from the source clips.
    movementSpeedMultiplier: opts.speed,
  };
}

// Blue side.
export const axe = hero('axe', { hp: 1000, weapon: 'sword', attackRange: 3, melee: true, speed: 1.2, cost: 225, time: 22 });
export const juggernaut = hero('juggernaut', { hp: 950, weapon: 'sword', attackRange: 3, melee: true, speed: 1.5, cost: 200, time: 20 });
export const sven = hero('sven', { hp: 1000, weapon: 'sword', attackRange: 3, melee: true, speed: 1.35, cost: 200, time: 20 });
export const tidehunter = hero('tidehunter', { hp: 1100, weapon: 'sword', attackRange: 3, melee: true, speed: 1.25, cost: 225, time: 22 });
export const pudge = hero('pudge', { hp: 1100, weapon: 'sword', attackRange: 3, melee: true, speed: 1.3, cost: 225, time: 22 });
// Red side (in-place run clips: tuned to a brisk hero pace).
export const drow = hero('drow', { hp: 700, weapon: 'lasgun', attackRange: 30, melee: false, speed: 1.3, cost: 175, time: 18 });
export const lina = hero('lina', { hp: 650, weapon: 'lasgun', attackRange: 30, melee: false, speed: 1.3, cost: 175, time: 18 });
export const lion = hero('lion', { hp: 650, weapon: 'lasgun', attackRange: 30, melee: false, speed: 1.5, cost: 175, time: 18 });
export const crystal_maiden = hero('crystal_maiden', { hp: 650, weapon: 'lasgun', attackRange: 30, melee: false, speed: 1.45, cost: 175, time: 18 });
export const shadow_fiend = hero('shadow_fiend', { hp: 750, weapon: 'lasgun', attackRange: 30, melee: false, speed: 1.35, cost: 200, time: 20 });

export const batch1Heroes: UnitStats[] = [
  axe, juggernaut, sven, tidehunter, pudge,
  drow, lina, lion, crystal_maiden, shadow_fiend,
];

export const batch1BlueTeam: string[] = ['axe', 'juggernaut', 'sven', 'tidehunter', 'pudge'];
export const batch1RedTeam: string[] = ['drow', 'lina', 'lion', 'crystal_maiden', 'shadow_fiend'];
