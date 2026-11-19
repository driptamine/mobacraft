import * as THREE from 'three';
import { createSquadEntity } from '../entities/entities.js';
import { factionContainers, loadFactionUnitModel, type LoadFactionHooks } from '../factions.js';
import { doomSpiralLanes, DOOM_LANES, type DoomBase, type DoomLane, type LanePoint } from '../maps/doom-spiral.js';
import { snapOrderToFree } from '../../pathfinding/astar-integrated.js';
import { refreshNavigation } from './navigation.js';
import type { TeamLaneRoutes } from '../maps/dota-map-layout.js';

export const CREEP_WAVE_SECONDS = 30;
export const CREEP_WAVE_KINDS = ['melee', 'melee', 'melee', 'ranged', 'siege'] as const;
export const CREEPS_PER_LANE = CREEP_WAVE_KINDS.length;
const CREEP_KINDS = ['melee', 'ranged', 'siege'] as const;
type CreepKind = typeof CREEP_KINDS[number];
export const CREEP_LANE_LIMIT = 24;
export interface CreepBase extends DoomBase { id: number }
interface LaneWalker { lane: DoomLane; team: 'blue' | 'red'; path: LanePoint[]; waypoint: number; enemyHQ: number }
interface CreepSpawner {
  active: boolean;
  ready: boolean;
  remaining: number;
  bases: CreepBase[];
  lanes: Record<DoomLane, LanePoint[]>;
  teamLanes?: TeamLaneRoutes;
}

const typeFor = (team: string, kind: CreepKind) => `${team === 'blue' ? 'radiant' : 'dire'}_${kind}_creep`;

export async function preloadDoomCreepModels(hooks: LoadFactionHooks = {}): Promise<void> {
  let loaded = 0;
  await Promise.all(['blue', 'red'].flatMap(team => CREEP_KINDS.map(async kind => {
    await loadFactionUnitModel('ig', typeFor(team, kind), hooks);
    hooks.onProgress?.({ loaded: ++loaded, total: 6, label: `${team === 'blue' ? 'Radiant' : 'Dire'} ${kind} creep` });
  })));
}

function alive(world: any, id: number): boolean {
  return world.get(id, 'squad')?.soldiers.some((soldier: number | null) => soldier != null && world.get(soldier, 'soldier')?.hp > 0) ?? false;
}

export function spawnCreepWave(world: any, state: CreepSpawner): void {
  for (const base of state.bases) {
    if (!(world.get(base.id, 'building')?.hp > 0)) continue;
    const enemy = state.bases.find((other) => other.team !== base.team);
    if (!enemy || !(world.get(enemy.id, 'building')?.hp > 0)) continue;
    for (const lane of DOOM_LANES) {
      const count = world.query('laneCreep').filter((id: number) => {
        const walker: LaneWalker = world.get(id, 'laneCreep');
        return walker.team === base.team && walker.lane === lane && alive(world, id);
      }).length;
      const path = state.teamLanes?.[base.team][lane]
        || (base.team === 'blue' ? state.lanes[lane] : [...state.lanes[lane]].reverse());
      const start = path[0];
      const dx = path[1].x - start.x;
      const dz = path[1].z - start.z;
      const length = Math.hypot(dx, dz) || 1;
      const previousOwner = world.defaultOwner;
      // Autonomous lane units belong to neither player nor the RTS computer.
      world.defaultOwner = base.team === 'blue' ? -900001 : -900002;
      try {
        for (let i = 0; i < Math.min(CREEPS_PER_LANE, CREEP_LANE_LIMIT - count); i++) {
          const kind = CREEP_WAVE_KINDS[i];
          const raw = { x: start.x - dx / length * i * 2.5, z: start.z - dz / length * i * 2.5 };
          const { x, z } = snapOrderToFree(raw.x, raw.z) || raw;
          const id = createSquadEntity(world, base.team, x, z, 1, typeFor(base.team, kind), 'ig');
          const squad = world.get(id, 'squad');
          for (const unit of [id, ...squad.soldiers.filter((soldier: number | null) => soldier != null)]) {
            world.add(unit, 'computer', { slot: -1 });
          }
          squad.speed = 5.5;
          squad.attackMode = kind === 'melee' ? 'melee' : 'ranged';
          squad.projectileType = 'bullet';
          squad.attackMove = true;
          squad.autoChase = true;
          squad.detectionRange = Math.max(14, squad.attackRange + 2);
          squad.moveOrder = new THREE.Vector3(path[1].x, 0, path[1].z);
          world.add(id, 'laneCreep', { lane, team: base.team, path, waypoint: 1, enemyHQ: enemy.id } satisfies LaneWalker);
        }
      } finally {
        world.defaultOwner = previousOwner;
      }
    }
  }
}

export function startDoomCreeps(world: any, bases: CreepBase[], hooks: LoadFactionHooks = {}, teamLanes?: TeamLaneRoutes): Promise<void> {
  const blue = bases.find((base) => base.team === 'blue');
  const red = bases.find((base) => base.team === 'red');
  if (!blue || !red) return Promise.resolve();
  const id = world.createEntity();
  refreshNavigation(world);
  const lanes = doomSpiralLanes(blue, red);
  for (const lane of DOOM_LANES) lanes[lane] = lanes[lane].map((point) => snapOrderToFree(point.x, point.z) || point);
  if (teamLanes) for (const team of ['blue', 'red'] as const) for (const lane of DOOM_LANES) {
    teamLanes[team][lane] = teamLanes[team][lane].map(point => snapOrderToFree(point.x, point.z) || point);
  }
  const state: CreepSpawner = { active: true, ready: false, remaining: CREEP_WAVE_SECONDS, bases, lanes, teamLanes };
  world.add(id, 'creepSpawner', state);
  const activate = () => {
    if (!state.active) return;
    state.ready = true;
    spawnCreepWave(world, state);
  };
  if (bases.every((base) => CREEP_KINDS.every(kind => factionContainers.ig?.units[typeFor(base.team, kind)]))) {
    activate();
    return Promise.resolve();
  }
  return preloadDoomCreepModels(hooks).then(activate);
}

export function stopDoomCreeps(world: any): void {
  for (const id of world.query('creepSpawner')) world.get(id, 'creepSpawner').active = false;
}

// Orders use the normal squad A* routing, melee/ranged combat, terrain following,
// attack/death animations and entity cleanup. No separate visual-only army.
export function systemLaneCreeps(world: any, deltaTime: number): void {
  if (typeof window !== 'undefined' && window._multiplayerMode) return;
  for (const id of world.query('creepSpawner')) {
    const state: CreepSpawner = world.get(id, 'creepSpawner');
    if (!state.active || !state.ready) continue;
    state.remaining -= deltaTime;
    if (state.remaining <= 0) {
      state.remaining += CREEP_WAVE_SECONDS * (1 + Math.floor(-state.remaining / CREEP_WAVE_SECONDS));
      spawnCreepWave(world, state);
    }
  }
  for (const id of world.query('laneCreep', 'squad')) {
    const walker: LaneWalker = world.get(id, 'laneCreep');
    const squad = world.get(id, 'squad');
    if (!alive(world, id) || squad.forcedTarget === walker.enemyHQ) continue;
    const target = walker.path[walker.waypoint];
    if (Math.hypot(squad.position.x - target.x, squad.position.z - target.z) <= 4 || !squad.moveOrder) {
      if (walker.waypoint < walker.path.length - 1) {
        walker.waypoint++;
        const next = walker.path[walker.waypoint];
        squad.moveOrder = new THREE.Vector3(next.x, 0, next.z);
      } else {
        squad.moveOrder = null;
        squad.forcedTarget = walker.enemyHQ;
      }
      squad.attackMove = true;
    }
  }
}
