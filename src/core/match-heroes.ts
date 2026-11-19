import { recruitableHeroes } from '../../stats/races/heroes.js';
import { isDotaMap } from '../maps/dota-map-layout.js';
import { factionContainers, loadFactionUnitModel, type LoadFactionHooks } from '../factions.js';
import { createSquadEntity } from '../entities/entities.js';
import { snapOrderToFree } from '../../pathfinding/astar-integrated.js';
import type { LocalMatchConfig } from './local-match.js';
import type { CreepBase } from '../systems/lane-creeps.js';

// Lobby browsing loads portraits only. Download exactly the chosen templates
// at battle start, including when the engine was booted for an earlier match.
export async function loadDotaMatchHeroes(config: LocalMatchConfig | null, hooks: LoadFactionHooks = {}): Promise<void> {
  if (!config || !isDotaMap(config.mapKey)) return;
  const names = [...new Set(config.seats.flatMap(seat => seat.hero ? [seat.hero] : []))];
  let loaded = 0;
  await Promise.all(names.map(async name => {
    const hero = recruitableHeroes.find(hero => hero.name === name);
    if (!hero) throw new Error(`Unavailable hero: ${name}`);
    await loadFactionUnitModel('ig', name, hooks);
    hooks.onProgress?.({ loaded: ++loaded, total: names.length, label: hero.title });
  }));
}

export function spawnDotaMatchHeroes(world: any, config: LocalMatchConfig | null, bases: CreepBase[]): void {
  if (!config || !isDotaMap(config.mapKey)) return;
  const previousOwner = world.defaultOwner;
  try {
    for (const seat of config.seats) {
      const base = bases.find(base => base.team === seat.team);
      if (!seat.hero || !base) continue;
      if (!factionContainers.ig.units[seat.hero]) throw new Error(`Hero model is not loaded: ${seat.hero}`);
      const length = Math.hypot(base.x, base.z) || 1;
      const raw = { x: base.x - base.x / length * 9, z: base.z - base.z / length * 9 };
      const point = snapOrderToFree(raw.x, raw.z) || raw;
      world.defaultOwner = seat.owner ?? seat.slot + 1;
      const id = createSquadEntity(world, seat.team, point.x, point.z, 1, seat.hero, 'ig');
      world.add(id, 'matchHero', { slot: seat.slot, hero: seat.hero });
      if (seat.computer) {
        for (const unit of [id, ...world.get(id, 'squad').soldiers.filter((sid: number | null) => sid != null)]) {
          world.add(unit, 'computer', { slot: seat.slot });
        }
      }
    }
  } finally {
    world.defaultOwner = previousOwner;
  }
}
