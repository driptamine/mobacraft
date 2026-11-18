import * as THREE from 'three';
import assert from 'node:assert/strict';
globalThis.window = { addEventListener() {}, _currentMapKey: 'arena' };
globalThis.document = { getElementById: () => null };
const state = await import('../src/core/scene.js');
const { setDefaultScene } = await import('../src/render/three-helpers.js');
const scene = new THREE.Scene();scene._registerShadows = () => {};
state.__setSceneCameraForTests(scene, { target: new THREE.Vector3() });setDefaultScene(scene);
const { World } = await import('../src/core/ecs.js');
const { spawnMatchSeat } = await import('../src/core/match-spawn.js');
const { setLocalMatch } = await import('../src/core/local-match.js');
const { createStrategicPointEntity, createBuildingEntity } = await import('../src/entities/entities.js');
const systems = await import('../src/core/systems.js');
const { FACTIONS, factionContainers } = await import('../src/factions.js');
for (const key of Object.keys(FACTIONS)) {
  factionContainers[key] ||= {};
  factionContainers[key].structures ||= {};
  factionContainers[key].soldier = { scene: new THREE.Group(), animations: [], _hiddenNodes: null };
  factionContainers[key].worker = { scene: new THREE.Group(), animations: [], _hiddenNodes: null };
}
const reports = [];
const scenarios = process.env.AI_TEST_FACTIONS ? process.env.AI_TEST_FACTIONS.split(';').map(faction => ({ faction, allied: false })) : [...Object.keys(FACTIONS).map(faction => ({faction, allied: false})), { faction: 'ig', allied: true }];
for (const {faction, allied} of scenarios) {
  const world = new World();state.setWorld(world);state.setPlayerTeam('blue');state.setRequisition(1000);state.setEnergy(100);state.counters.baseReqT = 0;
  const human = { slot: 0, team: 'blue', faction: 'ig', computer: false };
  const bot = { slot: 1, team: allied ? 'blue' : 'red', faction, computer: true };
  setLocalMatch({ mapKey: 'arena', seats: [human, bot] });
  spawnMatchSeat(world, human, { x: -380, z: -300 });
  spawnMatchSeat(world, bot, { x: 70, z: 0 });
  if (allied) createBuildingEntity(world, 'hq', new THREE.Vector3(400, 0, 400), 'red', 'chaos', { completed: true });
  for (const [x, z] of [[65, -32], [110, 5], [60, 40], [10, 10], [130, 50], [150, -20]]) createStrategicPointEntity(world, x, z);
  assert.equal(world.query('squad').length, 0, 'all races start with workers only');
  assert.equal(world.query('soldier').length, 0);
  systems._initSystems(world);world.addSystem(systems.systemAI);
  // The smaller starting bank takes longer to fund the full opening and expansion.
  const duration = 160;
  for (let tick = 0; tick < duration * 20; tick++) world.tick(.05);
  const computer = world._computerPlayers.get(2);
  const owned = kind => world.query(kind).filter(id => world.get(id, 'networkOwner')?.id === 2);
  const captured = world.query('strategicPoint').filter(id => world.get(id, 'strategicPoint').owner === bot.team).length;
  const generators = owned('structure').filter(id => /generator|energy_core/.test(world.get(id, 'structure').type) && !world.get(id, 'structure').constructing).length;
  assert.ok(captured >= 2, 'computers capture through normal planter/progress systems');
  if (faction !== 'dark eldar') assert.ok(generators >= 1, `${faction}: builders complete a real generator; budget ${computer.requisition}, opening ${computer.opening}`);
  if (faction === 'ig') assert.ok(owned('building').some(id => world.get(id, 'building').type === 'infantry_command' && !world.get(id, 'building').constructing), 'the Lua build order creates a finished infantry command');
  assert.ok(owned('squad').length >= 3, 'normal production queues train additional squads');
  assert.ok(owned('builder').length >= 2, `${faction}: the computer trains its desired engineers`);
  assert.ok(owned('squad').every(id => world.has(id, 'computer')), 'produced squads keep computer control');
  assert.ok(owned('builder').every(id => world.has(id, 'computer')), 'produced workers keep computer control');
  assert.ok(computer.requisition >= 0 && (faction === 'dark eldar' || computer.energy > 100), 'independent economy pays costs and gains power');
  assert.equal(state.energy, 100, 'computer generators never credit the human economy, including allies');
  if (!allied) assert.ok(Math.abs(state.requisition - (1000 + duration * 2)) < 2, 'bot construction does not charge the human');
  assert.equal(state.canCommand(bot.team, owned('squad')[0]), false, 'human cannot command an allied computer');
  reports.push({ faction, allied, captured, generators, squads: owned('squad').length, workers: owned('builder').length, requisition: computer.requisition, energy: computer.energy });
  window._multiplayerMode = true;const saved = computer.requisition;systems.systemAI(world, 60);assert.equal(computer.requisition, saved, 'online replicas never run client AI');window._multiplayerMode = false;
}
setLocalMatch(null);
console.log(JSON.stringify(reports));process.exit(0);
