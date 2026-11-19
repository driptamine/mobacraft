import config from '../../maps/dotamap-game/map.json';
import type { DoomBase, DoomLane, LanePoint } from './doom-spiral.js';

export const DOTA_MAP_KEY = '/maps/dotamap-game/map.json';
export const dotaMapConfig = config;
export function isDotaMap(key: string): boolean {
  return key === 'dotamap' || key === 'dotamap-game' || /(?:^|\/)dotamap-game\/map\.json(?:[?#].*)?$/i.test(key);
}
export function dotaMapBases(): DoomBase[] {
  return config.positions.map(base => ({ ...base, team: base.team as 'blue' | 'red' }));
}
export type TeamLaneRoutes = Record<'blue' | 'red', Record<DoomLane, LanePoint[]>>;
export function dotaMapLanes(): TeamLaneRoutes {
  // Each side follows its own authored Source 2 path_corner chain.
  return structuredClone(config.lanes) as TeamLaneRoutes;
}
