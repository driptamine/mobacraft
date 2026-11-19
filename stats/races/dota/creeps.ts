import type { UnitStats } from '../../types.js';

export type LaneCreepKind = 'melee' | 'ranged' | 'siege';

export function laneCreepKind(unitType: string | null | undefined): LaneCreepKind | undefined {
  return /^(?:radiant|dire)_(melee|ranged|siege)_creep$/.exec(unitType ?? '')?.[1] as LaneCreepKind | undefined;
}

export const meleeCreeps: UnitStats[] = ['radiant', 'dire'].map((side) => ({
  name: `${side}_melee_creep`,
  model: `batches/creeps-lane/final/${side}-melee.glb`,
  // The export includes a complete alternate cavern body on the same rig.
  hiddenNodes: side === 'dire' ? ['modelscreepslane_creepscreep_bad_meleecreep_bad_meleevmdl_ccreep_bad_melee_cavern'] : undefined,
  lazyLoad: true,
  hp: 550,
  armor: 'infantry_med',
  weapon: 'sword',
  attackRange: 2.8,
  size: 1,
  squadSize: 1,
  movementSpeedMultiplier: 0.85,
  animations: {
    idle: 'idle', run: 'run', melee: 'attack', firing: 'attack', stun: 'stun',
    die_normal_1: side === 'radiant' ? 'death' : 'die',
    die_normal_2: side === 'radiant' ? 'death_back' : 'die2',
    spawn: 'spawn_loadout',
  },
}));

export const rangedCreeps: UnitStats[] = ['radiant', 'dire'].map((side) => ({
  name: `${side}_ranged_creep`,
  model: `batches/creeps-lane/final/${side}-ranged.glb`,
  lazyLoad: true,
  hp: 300,
  armor: 'infantry_low',
  weapon: 'creep_ranged',
  attackRange: 12,
  size: 1,
  squadSize: 1,
  movementSpeedMultiplier: 0.85,
  animations: {
    idle: 'idle', run: 'run', melee: 'attack', firing: 'attack', stun: 'stun',
    die_normal_1: 'death',
    die_normal_2: side === 'radiant' ? 'death_fallBack' : 'death_alt1',
    spawn: 'spawn_loadout',
  },
}));

export const siegeCreeps: UnitStats[] = ['radiant', 'dire'].map((side) => {
  const prefix = side === 'radiant' ? 'creep_good_siege' : 'creep_bad_siege';
  return {
    name: `${side}_siege_creep`,
    model: `batches/creeps-lane/final/${side}-siege.glb`,
    lazyLoad: true,
    hp: 935,
    armor: 'vehicle_low',
    weapon: 'creep_siege',
    attackRange: 18,
    size: 1,
    squadSize: 1,
    movementSpeedMultiplier: 0.85,
    // Siege exports contain idle, movement and attack clips, but no death clip.
    animations: {
      idle: `${prefix}_idle`, run: `${prefix}_run`,
      melee: `${prefix}_attack`, firing: `${prefix}_attack`,
    },
  };
});

export const laneCreeps: UnitStats[] = [...meleeCreeps, ...rangedCreeps, ...siegeCreeps];
