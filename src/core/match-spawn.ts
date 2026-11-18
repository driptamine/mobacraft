import * as THREE from 'three';
import { createBuildingEntity, createBuilderEntity, createSquadEntity } from '../entities/entities.js';
import { batch1BlueTeam, batch1RedTeam } from '../../stats/races/batch1/heroes.js';
import type { LocalMatchSeat } from './local-match.js';
export function spawnMatchSeat(world: any, seat: LocalMatchSeat, position: {
    x: number;
    z: number;
}): void {
    world.defaultOwner = seat.owner ?? seat.slot + 1;
    const controlled = (id: number) => { if (seat.computer) world.add(id, 'computer', { slot: seat.slot }); return id; };
    const { x, z } = position;
    controlled(createBuildingEntity(world, 'hq', new THREE.Vector3(x, 0, z), seat.team, seat.faction, { completed: true }));
    controlled(createBuilderEntity(world, x + (x > 0 ? -10 : 10), z, seat.team, seat.faction));
    world.defaultOwner = null;
}

// Batch 1 heroes showcase: 5 blue (melee) vs 5 red (ranged), lined up ahead
// of their bases on diagonally opposite corners (westmost blue base vs
// eastmost red base), facing each other. Faction 'ig' only resolves
// models/animations; teams drive control and colors.
export function spawnBatchHeroes(world: any, spots: { x: number; z: number; team: unknown }[]): void {
  const blueSpots = spots.filter((s) => s.team === 'blue');
  const redSpots = spots.filter((s) => s.team === 'red');
  if (!blueSpots.length || !redSpots.length) {
    return;
  }
  const blueBase = blueSpots.reduce((a, b) => (b.x < a.x ? b : a));
  const redBase = redSpots.reduce((a, b) => (b.x > a.x ? b : a));
  const place = (base: { x: number; z: number }, foe: { x: number; z: number }, names: string[], team: string): void => {
    const dx = foe.x - base.x;
    const dz = foe.z - base.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len;
    const fz = dz / len;
    names.forEach((name, i) => {
      const off = (i - (names.length - 1) / 2) * 7;
      createSquadEntity(world, team, base.x + fx * 24 - fz * off, base.z + fz * 24 + fx * off, 1, name, 'ig');
    });
  };
  place(blueBase, redBase, batch1BlueTeam, 'blue');
  place(redBase, blueBase, batch1RedTeam, 'red');
}
