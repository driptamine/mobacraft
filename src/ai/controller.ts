import * as THREE from 'three';
import { startingResources, BASE_REQUISITION_RATE, pointRequisitionRate, RESOURCE_RATE_SECONDS } from '../core/economy.js';
import { inheritEntityControl } from './ownership.js';
import profiles from '../../ai/profiles.json';
import { createBuildingEntity, createStructureEntity, createListeningPostConstruction } from '../entities/entities.js';
import { assignConstructionWork } from '../systems/construction.js';
import { worldFootprint } from '../core/structure-footprint.js';
import { currentBounds, PLAYER, controlBoth, FORMATION, MAX_PLASMA, requisition, energy, setRequisition, setEnergy, counters } from '../core/scene.js';
import { FACTIONS, playerFaction } from '../factions.js';
import { localMatchFor } from '../core/local-match.js';
import { sgbPassBlockedAt } from '../../pathfinding/avoid.js';
import { _groundAt, _snapTerrainBegin } from '../systems/terrain.js';

export type Difficulty = 'easy' | 'standard' | 'advanced' | 'hard';
type Position = { x: number; z: number };
interface Order { kind: string; type?: string }
interface Profile { 
  capturers: number; 
  engineers: number; 
  pointLimit: number; 
  minAttackSquads: number; 
  armyBudget: number; 
  stopAttackRating: number; 
  noResearch: boolean; 
  noSecondaryBuildings: boolean; 
  opening: Order[] 
}
export interface ComputerPlayer {
  owner: number; team: string; faction: string; difficulty: Difficulty; automatic: boolean;
  base: Position; requisition: number; energy: number; timer: number; opening: number;
  desired: Record<string, number>; retreating: Set<number>; placement: number;
}
/** Factions on this team driven by a human: local lobby seats, or the
 * sandbox player's own faction. */
function humanFactionsOnTeam(bot: ComputerPlayer): Set<string> {
  const factions = new Set<string>();
  const local = localMatchFor(window._currentMapKey || 'arena');
  if (local) {
    for (const seat of local.seats) if (!seat.computer && seat.team === bot.team) factions.add(seat.faction);
  } else if (!controlBoth && bot.team === PLAYER) {
    factions.add(playerFaction);
  }
  return factions;
}
/** True when a teammate already claims this point: another same-team
 * builder is raising a post here, or a human teammate captured it and
 * raises their own post. Keeps allies from stealing the player's points. */
export function lpClaimedByTeammate(world: any, bot: ComputerPlayer, pointId: number): boolean {
  for (const workerId of world.query('builder')) {
    if (belongs(world, workerId, bot)) continue;
    const worker = world.get(workerId, 'builder');
    if (!worker || worker.team !== bot.team) continue;
    if (worker.buildTargetSP === pointId) return true;
    const siteId = worker.buildTarget?.pendingEntityId;
    if (siteId != null && world.get(siteId, 'building')?.strategicPointId === pointId) return true;
  }
  const point = world.get(pointId, 'strategicPoint');
  if (point?.faction && point.faction !== bot.faction && humanFactionsOnTeam(bot).has(point.faction)) return true;
  return false;
}
/** Tech progression past the opening (wiki build order): the faction's own
 * structure sequence from the ai/ build data. */
function techOrderFor(faction: string): string[] {
  return (data.factions[faction] as any)?.techOrder || [];
}
/** Listening post type from the ai/ build data: generic post when the race
 * has one, Tau post for Tau, null when the race has no post data. */
export function listeningPostTypeFor(faction: string): string | null {
  const catalog = (data.factions as any)[faction];
  return catalog?.structures.find((entry: any) => entry.type === 'listening_post')?.type
    || catalog?.structures.find((entry: any) => entry.type === 'tau_listening_post')?.type
    || null;
}
const data = profiles as any;
const distance = (left: Position, right: Position) => Math.hypot(left.x - right.x, left.z - right.z);
export const isPowerGenerator = (type: string) => type === 'thermoGen' || /generator|energy_core/.test(type);
const component = (world: any, id: number) => world.get(id, 'building') || world.get(id, 'structure');
const belongs = (world: any, id: number, bot: ComputerPlayer) => world.get(id, 'networkOwner')?.id === bot.owner;
const alive = (world: any, squad: any) => (squad?.soldiers || []).filter((id: number) => world.get(id, 'soldier')?.hp > 0);
const position = (world: any, id: number) => world.get(id, 'mesh')?.root?.position;

function claim(world: any, id: number, owner: number, slot: number, automatic = false, faction?: string): void {
  world.add(id, 'networkOwner', { id: owner });
  world.add(id, 'computer', { slot, automatic, faction });
  inheritEntityControl(world, id, id);
}

function discoverPlayers(world: any): Map<number, ComputerPlayer> {
  const players: Map<number, ComputerPlayer> = world._computerPlayers ||= new Map();
  const local = localMatchFor(window._currentMapKey || 'arena');
  // Every unclaimed sandbox race except the selected human becomes a bot.
  // Explicit local/online human seats retain their controller and ownership.
  if (!local && !controlBoth) {
    for (const id of world.query('building')) {
      const hq = world.get(id, 'building');
      if (hq?.type !== 'hq' || (hq.team === PLAYER && hq.faction === playerFaction) || world.get(id, 'computer') || world.get(id, 'networkOwner')) continue;
      const owner = -100000 - id;
      for (const kind of ['building', 'structure', 'builder', 'squad', 'apc', 'vehicle']) {
        for (const ownedId of world.query(kind)) {
          const entry = world.get(ownedId, kind);
          if (entry.team === hq.team && entry.faction === hq.faction && !world.get(ownedId, 'networkOwner')) claim(world, ownedId, owner, owner, true, hq.faction);
        }
      }
    }
  }
  for (const id of world.query('building', 'computer')) {
    const hq = world.get(id, 'building'), computer = world.get(id, 'computer');
    if (hq?.type !== 'hq') continue;
    const owner = world.get(id, 'networkOwner')?.id;
    if (owner == null || players.has(owner) || !data.factions[hq.faction]) continue;
    const difficulty = (local?.seats.find(seat => seat.slot === computer.slot) as any)?.difficulty || 'standard';
    players.set(owner, { owner, team: hq.team, faction: hq.faction, difficulty, automatic: !!computer.automatic,
      base: { x: hq.position.x, z: hq.position.z }, ...startingResources(hq.faction), ...world._sandboxEconomies?.get(`${hq.team}:${hq.faction}`), timer: profiles.thinkInterval,
      opening: 0, desired: {}, retreating: new Set(), placement: 0 });
  }
  return players;
}

function move(squad: any, target: Position, capture: number | null = null, enemy: number | null = null): void {
  if (capture !== null && squad.captureOrderSpId === capture) return;
  squad.captureOrderSpId = capture; squad.forcedTarget = enemy; squad.forcedSoldierId = null;
  squad.autoChase = enemy !== null; squad.attackMove = capture === null && enemy !== null;
  squad.stopped = false;
  if (!squad.moveOrder || distance(squad.moveOrder, target) > 2) squad.moveOrder = new THREE.Vector3(target.x, 0, target.z);
}

// Dedicated capturers per race (scouts, cultists): fast cheap infantry
// that seizes points while the main line fights.
const CAPPER_UNITS: Record<string, string> = { 'space marines': 'scout', chaos: 'cultist' };
export function capperTypeFor(faction: string): string | null {
  return CAPPER_UNITS[faction] || null;
}
function train(world: any, bot: ComputerPlayer, type: string): boolean {
  const catalog = data.factions[bot.faction];
  // The ai/ order of battle only lists line troops; dedicated capturers
  // resolve their price from the faction stats instead.
  const statsUnit = type === 'builder' ? null : [...(FACTIONS[bot.faction]?.units || []), ...(FACTIONS[bot.faction]?.infantry || [])]
    .find((u: any) => u && (u.name === type || String(u.model || '').split('/').pop()?.replace(/\.glb$/i, '') === type));
  const unit = type === 'builder' ? { cost: catalog.workerCost, time: catalog.workerTime, power: 0 }
    : catalog.units.find((unit: any) => unit.type === type)
    || (statsUnit ? { cost: statsUnit.cost, time: statsUnit.time, power: 0 } : null);
  if (!unit || bot.requisition < unit.cost || bot.energy < (unit.power || 0)) return false;
  const producers = world.query('building').filter((id: number) => belongs(world, id, bot)).filter((id: number) => {
    const building = world.get(id, 'building');
    if (building.constructing || building.pendingWorker || building.queue.length) return false;
    if (building.type === 'hq') return type === 'builder' || type === catalog.units[0]?.type;
    const structure = catalog.structures.find((entry: any) => entry.type === building.type);
    return type !== 'builder' && !!structure && !structure.generator && !/listening|mine|turret/.test(structure.type);
  });
  const producer = producers[0];
  if (producer == null) return false;
  bot.requisition -= unit.cost; bot.energy -= unit.power;
  world.get(producer, 'building').queue.push({ type: type === catalog.units[0]?.type ? 'squad' : type, progress: 0, total: unit.time });
  return true;
}

function placement(world: any, bot: ComputerPlayer, type: string): THREE.Vector3 | null {
  const occupied = [...world.query('building'), ...world.query('structure')].map((id: number) => component(world, id)).filter(Boolean);
  for (let attempt = 0; attempt < 96; attempt++) {
    const angle = ((bot.placement + attempt) % 12) * Math.PI / 6;
    const radius = 24 + Math.floor(attempt / 12) * 15;
    const point = new THREE.Vector3(bot.base.x + Math.cos(angle) * radius, 0, bot.base.z + Math.sin(angle) * radius);
    if (Math.abs(point.x) > currentBounds() - 15 || Math.abs(point.z) > currentBounds() - 15) continue;
    const heights = [[0, 0], [-7, -7], [-7, 7], [7, -7], [7, 7]].map(([x, z]) => _groundAt(point.x + x, point.z + z));
    if (Math.max(...heights) - Math.min(...heights) > 3) continue;
    const bounds = worldFootprint({ type, faction: bot.faction, position: point, constructing: true });
    const grid = window.__sgbPassGrid;
    if (grid && [[point.x, point.z], [bounds.minX, bounds.minZ], [bounds.maxX, bounds.minZ], [bounds.minX, bounds.maxZ], [bounds.maxX, bounds.maxZ]]
      .some(([x, z]) => sgbPassBlockedAt(grid, x, z))) continue;
    if (occupied.some(site => { const other = worldFootprint(site); return bounds.minX - 3 < other.maxX && bounds.maxX + 3 > other.minX && bounds.minZ - 3 < other.maxZ && bounds.maxZ + 3 > other.minZ; })) continue;
    bot.placement = (bot.placement + attempt + 1) % 12;
    return point;
  }
  return null;
}

function construct(world: any, bot: ComputerPlayer, type: string, pointId?: number): boolean {
  const config = data.factions[bot.faction].structures.find((entry: any) => entry.type === type);
  if (!config || bot.requisition < config.cost) return false;
  const workerId = world.query('builder').find((id: number) => belongs(world, id, bot) && !world.get(id, 'builder').buildTarget && !world.get(id, 'builder').isBuilding);
  if (workerId == null) return false;
  const at = pointId == null ? placement(world, bot, type) : world.get(pointId, 'strategicPoint')?.position;
  if (!at) return false;
  const previousOwner = world.defaultOwner; world.defaultOwner = bot.owner;
  let siteId: number | null;
  try {
    siteId = pointId != null ? createListeningPostConstruction(world, pointId, bot.team, bot.faction, type)
      : config.generator ? createStructureEntity(world, type, at, bot.faction, bot.team)
      : createBuildingEntity(world, type, at, bot.team, bot.faction);
  } finally { world.defaultOwner = previousOwner; }
  if (siteId == null) return false;
  const tag = world.get(workerId, 'computer');
  world.add(siteId, 'computer', { ...tag });
  const site = component(world, siteId);
  assignConstructionWork(world, workerId, siteId, site);
  world.get(workerId, 'builder').buildTarget.costPaid = true;
  bot.requisition -= config.cost;
  return true;
}

function develop(world: any, bot: ComputerPlayer, profile: Profile, squads: number[]): void {
  const catalog = data.factions[bot.faction];
  const buildings = [...world.query('building'), ...world.query('structure')].filter((id: number) => belongs(world, id, bot));
  const workers = world.query('builder').filter((id: number) => belongs(world, id, bot));
  const queued = world.query('building').filter((id: number) => belongs(world, id, bot)).flatMap((id: number) => world.get(id, 'building').queue);
  const count = (kind: string, type: string) => kind === 'build' ? buildings.filter(id => component(world, id).type === type).length
    : type === 'builder' ? workers.length + queued.filter((item: any) => item.type === 'builder').length
    : squads.filter(id => world.get(id, 'squad').unitType === type || (!world.get(id, 'squad').unitType && type === catalog.units[0].type)).length + queued.filter((item: any) => item.type === type || (item.type === 'squad' && type === catalog.units[0].type)).length;
  // Resume interrupted/abandoned construction before opening another site.
  for (const siteId of buildings.filter(id => component(world, id).constructing)) {
    if (workers.some(id => world.get(id, 'builder').buildTarget?.pendingEntityId === siteId)) continue;
    const workerId = workers.find(id => !world.get(id, 'builder').buildTarget);
    if (workerId != null) { assignConstructionWork(world, workerId, siteId, component(world, siteId)); world.get(workerId, 'builder').buildTarget.costPaid = true; }
  }
  if (!workers.length) { train(world, bot, 'builder'); return; }
  if (count('build', 'hq') === 0) { construct(world, bot, 'hq'); return; }
  // Keep the minimum workforce ahead of expensive opening commanders.
  if (count('train', 'builder') < profile.engineers && train(world, bot, 'builder')) return;
  for (let skipped = 0; skipped < profile.opening.length && bot.opening < profile.opening.length; skipped++) {
    const order = profile.opening[bot.opening];
    if (!order.type) { bot.opening++; continue; }
    const key = `${order.kind}:${order.type}`;
    const desired = 1 + profile.opening.slice(0, bot.opening).filter(previous => previous.kind === order.kind && previous.type === order.type).length;
    if (count(order.kind, order.type) >= desired) { bot.opening++; continue; }
    const done = order.kind === 'build' ? construct(world, bot, order.type) : train(world, bot, order.type);
    bot.desired[key] = desired;
    if (done) bot.opening++;
    return;
  }
  const generator = catalog.structures.find((entry: any) => entry.generator);
  if (generator && count('build', generator.type) < Math.min(3, Math.max(1, Math.floor(squads.length / 2)))) {
    // Reserve the generator budget instead of spending every increment on troops.
    construct(world, bot, generator.type);
    return;
  }
  const postType = listeningPostTypeFor(bot.faction);
  const post = postType ? catalog.structures.find((entry: any) => entry.type === postType) : null;
  if (post) for (const id of world.query('strategicPoint')) {
    const point = world.get(id, 'strategicPoint');
    if (point.owner !== bot.team || point.kind === 'relic' || point.hasListeningPost || point.listeningPostEntityId != null) continue;
    if (lpClaimedByTeammate(world, bot, id)) continue;
    if (construct(world, bot, post.type, id)) return;
  }
  // Dedicated capturers first: 2 scouts for Space Marines, the profile
  // quota otherwise. Main squads of Space Marines stop at 3.
  const capperType = capperTypeFor(bot.faction);
  if (capperType) {
    const wantCappers = bot.faction === 'space marines' ? 2 : profile.capturers;
    if (count('train', capperType) < wantCappers && train(world, bot, capperType)) return;
  }
  const mainType = catalog.units[0]?.type;
  const mainCap = bot.faction === 'space marines' ? 3 : Infinity;
  const target = Math.min(12, Math.max(profile.minAttackSquads + profile.capturers, Math.floor(profile.armyBudget / (catalog.units[0]?.cost || 100))));
  const armyCount = squads.length + queued.filter((item: any) => item.type !== 'builder').length;
  if (armyCount < target && (!mainType || count('train', mainType) < mainCap)) {
    const trained = mainType ? train(world, bot, mainType) : false;
    if (!trained && armyCount < Math.min(target, profile.minAttackSquads + profile.capturers)) return;
  }
  // Continue the race's tech progression past the opening (wiki build order),
  // one structure at a time once the minimum attack force stands.
  if (armyCount >= Math.min(target, profile.minAttackSquads + profile.capturers)) {
    for (const type of techOrderFor(bot.faction)) {
      if (count('build', type) === 0 && construct(world, bot, type)) return;
    }
  }
  for (const id of squads) {
    const squad = world.get(id, 'squad');
    if (squad.reinforceQueue.length || bot.requisition < (squad.reinforceCost || 20)) continue;
    const maximum = Math.min(FORMATION.length, squad.maxSquadSize || catalog.units[0]?.maxSize || 5);
    if (alive(world, squad).length >= maximum) continue;
    for (let slot = 1; slot < maximum; slot++) if (squad.soldiers[slot] == null || !world.has(squad.soldiers[slot], 'soldier')) {
      const cost = squad.reinforceCost || 20;
      bot.requisition -= cost; squad.reinforceQueue.push({ formIdx: slot, cost, time: squad.reinforceTime || 7 }); break;
    }
  }
}

function commandArmy(world: any, bot: ComputerPlayer, profile: Profile, squads: number[]): void {
  // Slugga boyz force melee; shoota squads keep firing from range.
  if (bot.faction === 'orks') for (const id of squads) {
    const sq = world.get(id, 'squad');
    if (sq.unitType !== 'boyz_shoota') sq.attackMode = 'melee';
  }
  const enemies = world.query('squad').filter((id: number) => world.get(id, 'squad').team !== bot.team && alive(world, world.get(id, 'squad')).length);
  const nearest = (from: Position) => enemies.reduce((best: number | null, id: number) => best == null || distance(from, world.get(id, 'squad').position) < distance(from, world.get(best, 'squad').position) ? id : best, null);
  const threat = nearest(bot.base), baseThreat = threat != null && distance(bot.base, world.get(threat, 'squad').position) < 40 ? threat : null;
  const reserved = new Set<number>(world.query('squad').filter((id: number) => !belongs(world, id, bot) && world.get(id, 'squad').team === bot.team && world.get(id, 'squad').captureOrderSpId != null).map((id: number) => world.get(id, 'squad').captureOrderSpId)), capturers: number[] = [];
  const points = world.query('strategicPoint');
  const owned = points.filter((id: number) => world.get(id, 'strategicPoint').owner === bot.team).length;
  const capper = capperTypeFor(bot.faction);
  const ordered = capper
    ? [...squads].sort((a, b) => Number(world.get(b, 'squad').unitType === capper) - Number(world.get(a, 'squad').unitType === capper))
    : squads;
  for (const id of ordered) {
    const squad = world.get(id, 'squad'), living = alive(world, squad);
    const health = living.reduce((sum: number, id: number) => sum + world.get(id, 'soldier').hp, 0) / Math.max(1, living.reduce((sum: number, id: number) => sum + world.get(id, 'soldier').maxHp, 0));
    if (health < .35) bot.retreating.add(id);
    if (bot.retreating.has(id)) {
      if (health > .75) bot.retreating.delete(id);
      else { move(squad, bot.base); continue; }
    }
    if (baseThreat != null) { move(squad, world.get(baseThreat, 'squad').position, null, baseThreat); continue; }
    if (owned >= Math.ceil(points.length * profile.pointLimit) || capturers.length >= profile.capturers) continue;
    const current = squad.captureOrderSpId != null ? world.get(squad.captureOrderSpId, 'strategicPoint') : null;
    let target = current && current.owner !== bot.team && !current.hasListeningPost && !reserved.has(squad.captureOrderSpId) ? squad.captureOrderSpId : null;
    if (target == null) {
      const candidates = points.filter((pointId: number) => { const point = world.get(pointId, 'strategicPoint'); return point.owner !== bot.team && !point.hasListeningPost && !reserved.has(pointId)
        && !enemies.some((enemyId: number) => distance(world.get(enemyId, 'squad').position, point.position) < 20); });
      candidates.sort((left: number, right: number) => distance(squad.position, world.get(left, 'strategicPoint').position) - distance(squad.position, world.get(right, 'strategicPoint').position));
      target = candidates[0] ?? null;
    }
    if (target != null) { move(squad, world.get(target, 'strategicPoint').position, target); reserved.add(target); capturers.push(id); }
  }
  const army = squads.filter(id => !capturers.includes(id) && !bot.retreating.has(id));
  if (baseThreat != null) return;
  const strength = (ids: number[]) => ids.reduce((sum, id) => {
    const squad = world.get(id, 'squad'), catalog = data.factions[squad.faction];
    const unit = catalog?.units.find((unit: any) => unit.type === squad.unitType) || catalog?.units[0];
    return sum + alive(world, squad).reduce((health: number, soldierId: number) => health + world.get(soldierId, 'soldier').hp / Math.max(1, world.get(soldierId, 'soldier').maxHp), 0) * (unit?.cost || 100) / (unit?.size || 5);
  }, 0);
  const ownStrength = strength(army);
  const objective = army.length ? nearest(world.get(army[0], 'squad').position) : null;
  const opposition = objective == null ? [] : enemies.filter((id: number) => distance(world.get(id, 'squad').position, world.get(objective, 'squad').position) < 30);
  if (ownStrength < profile.armyBudget && ownStrength - strength(opposition) < profile.stopAttackRating) {
    for (const id of army) move(world.get(id, 'squad'), bot.base);
    return;
  }
  for (const id of army) {
    const squad = world.get(id, 'squad'), target = nearest(squad.position);
    if (army.length >= profile.minAttackSquads && target != null) move(squad, world.get(target, 'squad').position, null, target);
    else if (army.length >= profile.minAttackSquads) {
      const enemyBase = world.query('building').map((id: number) => world.get(id, 'building')).find((building: any) => building.team !== bot.team && building.type === 'hq');
      if (enemyBase) move(squad, enemyBase.position);
    } else move(squad, { x: bot.base.x + (bot.base.x > 0 ? -14 : 14), z: bot.base.z });
  }
}

export function updateComputerPlayers(world: any, deltaTime: number): boolean {
  if (window._multiplayerMode) return true; // The Go authority makes online decisions.
  _snapTerrainBegin();
  const players = discoverPlayers(world);
  for (const bot of players.values()) {
    if (bot.automatic && controlBoth) continue;
    if (bot.automatic && bot.team === PLAYER && bot.faction === playerFaction) {
      bot.requisition = requisition;bot.energy = energy;
      continue;
    }
    const ownedBuildings = [...world.query('building'), ...world.query('structure')].filter((id: number) => belongs(world, id, bot));
    const hqs = ownedBuildings.filter(id => component(world, id).type === 'hq' && !component(world, id).constructing).length;
    const pointIncome = world.query('strategicPoint').reduce((sum: number, id: number) => { const point = world.get(id, 'strategicPoint'); return sum + (point.owner === bot.team ? pointRequisitionRate(point) : 0); }, 0);
    const generators = ownedBuildings.filter(id => isPowerGenerator(component(world, id).type) && !component(world, id).constructing && !component(world, id).pendingWorker).length;
    const powerHqs = ownedBuildings.filter(id => { const type = component(world, id).type; return (type === 'hq' || type === 'hq-anim') && !component(world, id).constructing; }).length;
    const credited = Math.min(generators, MAX_PLASMA * powerHqs);
    bot.requisition = Math.min(9999, bot.requisition + (hqs * BASE_REQUISITION_RATE + pointIncome) / RESOURCE_RATE_SECONDS * deltaTime);
    bot.energy = Math.min(10000, bot.energy + credited * 10 * .1 * deltaTime);
    bot.timer += deltaTime;
    if (bot.timer < profiles.thinkInterval) continue;
    bot.timer %= profiles.thinkInterval;
    const profile: Profile = data.difficulties[bot.difficulty]?.[bot.faction] || data.difficulties.standard[bot.faction];
    const squads = world.query('squad').filter((id: number) => belongs(world, id, bot) && alive(world, world.get(id, 'squad')).length);
    develop(world, bot, profile, squads);
    commandArmy(world, bot, profile, squads);
  }
  return players.size > 0;
}

/** The sandbox faction switch transfers its account along with human control. */
export function handoffSandboxFaction(world: any, nextFaction: string, nextTeam: string): void {
  if (!world || window._multiplayerMode || controlBoth || localMatchFor(window._currentMapKey || 'arena')) return;
  const accounts: Map<string, {requisition: number; energy: number}> = world._sandboxEconomies ||= new Map();
  accounts.set(`${PLAYER}:${playerFaction}`, {requisition, energy});
  const players: ComputerPlayer[] = [...(world._computerPlayers?.values() || [])];
  const previous = players.find(bot => bot.automatic && bot.team === PLAYER && bot.faction === playerFaction);
  if (previous) { previous.requisition = requisition;previous.energy = energy; }
  const next = players.find(bot => bot.automatic && bot.team === nextTeam && bot.faction === nextFaction)
    || accounts.get(`${nextTeam}:${nextFaction}`) || startingResources(nextFaction);
  setRequisition(next.requisition);setEnergy(next.energy);counters.baseReqT = 0;
}
