import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { spawnSync } from 'node:child_process';

globalThis.window = { addEventListener() {}, _currentMapKey: '/maps/4p_doom_spiral/4p_doom_spiral.sgb' };
globalThis.document = { getElementById: () => null, querySelector: () => null };
const core = await import('../src/core/scene.js');
const { World } = await import('../src/core/ecs.js');
const { factionContainers } = await import('../src/factions.js');
const { createHeroBase } = await import('../src/entities/hero-base.js');
const { layoutFor } = await import('../src/maps/map-layout.js');
const { doomSpiralBases, doomSpiralLanes, DOOM_LANES } = await import('../src/maps/doom-spiral.js');
const { startDoomCreeps, stopDoomCreeps, systemLaneCreeps, CREEP_LANE_LIMIT } = await import('../src/systems/lane-creeps.js');
const { systemSquad, _squadFireAll } = await import('../src/systems/squad.js');
const { systemBullet } = await import('../src/systems/projectiles.js');
const { buildingEngageRadius } = await import('../src/systems/combat.js');
const { sgbPassBlockedAt } = await import('../pathfinding/avoid.js');
const { laneCreeps } = await import('../stats/races/dota/creeps.js');
const { _makeFactionSoldierMesh } = await import('../src/meshes/soldiers.js');

const model = () => ({ scene: new THREE.Group(), animations: [] });
function fixture() {
  const scene = new THREE.Scene(); scene._registerShadows = () => {};
  core.__setSceneCameraForTests(scene, { target: new THREE.Vector3() });
  const world = new World(); core.setWorld(world);
  window.__sgbPassGrid = null;
  for (const creep of laneCreeps) factionContainers.ig.units[creep.name] = model();
  const bases = doomSpiralBases(layoutFor(window._currentMapKey).positions).map((base) => ({
    ...base, id: createHeroBase(world, new THREE.Vector3(base.x, 0, base.z), base.team),
  }));
  return { world, bases };
}
const living = (world, id) => world.get(id, 'squad')?.soldiers.some(sid => sid != null && world.get(sid, 'soldier')?.hp > 0);

test('Doom Spiral red square sits diagonally opposite blue', () => {
  const positions = layoutFor(window._currentMapKey).positions;
  const bases = doomSpiralBases(positions);
  assert.deepEqual(bases.map(({ x, z }) => ({ x, z })), ['space marines', 'ig'].map((faction, index) => {
    const { x, z } = positions.find(p => p.faction === faction);
    return { x: index === 1 ? -positions.find(p => p.faction === 'space marines').x : x, z };
  }));
  const lanes = doomSpiralLanes(...bases);
  assert.equal(Object.keys(lanes).length, 3);
  assert.ok(lanes.top.some(p => p.x < -60 && p.z < 0));
  assert.ok(lanes.mid.some(p => p.x === 0 && p.z === 0));
  assert.ok(lanes.bottom.some(p => p.x > 60 && p.z > 60));
  const reversed = doomSpiralLanes(bases[1], bases[0]);
  for (const lane of DOOM_LANES) assert.deepEqual(lanes[lane], [...reversed[lane]].reverse());
});

test('all six creep GLBs contain textures and their configured animations', async () => {
  fixture();
  for (const config of laneCreeps) {
    const side = config.name.startsWith('radiant') ? 'radiant' : 'dire';
    assert.ok(config.model.startsWith('batches/creeps-lane/'));
    const bytes = fs.readFileSync(config.model);
    const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    assert.ok(json.images.length >= 3);
    assert.ok(json.images.every(i => i.bufferView !== undefined && !i.uri));
    const loader = new GLTFLoader().register(() => ({ name: 'headless-textures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const mixer = new THREE.AnimationMixer(gltf.scene);
    for (const name of new Set(Object.values(config.animations))) {
      const clip = gltf.animations.find(c => c.name === name);
      assert.ok(clip, `${config.name} has ${name}`);
      mixer.stopAllAction(); mixer.clipAction(clip).play(); mixer.setTime(.25);
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene, true);
      assert.ok(!box.isEmpty());
      assert.ok([...box.min.toArray(), ...box.max.toArray()].every(v => Number.isFinite(v) && Math.abs(v) < 30));
    }
    mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
    const instance = _makeFactionSoldierMesh({ ...gltf, _hiddenNodes: config.hiddenNodes }, side === 'radiant' ? 'blue' : 'red', {
      unitType: config.name, faction: 'ig', animations: config.animations,
    }, 'ig');
    let visibleBodies = 0;
    instance.traverse(node => {
      if (node.isSkinnedMesh && node.visible) visibleBodies++;
    });
    assert.equal(visibleBodies, 1, `${config.name} renders one body without overlapping alternate variants`);
    instance._instanceData.dispose();
  }
});

test('both teams send three melee, one ranged and one siege creep per lane every 30 seconds', async () => {
  const { world, bases } = fixture();
  await startDoomCreeps(world, bases);
  assert.equal(world.query('laneCreep').length, 30);
  for (const team of ['blue', 'red']) for (const lane of DOOM_LANES) {
    const ids = world.query('laneCreep').filter(id => { const c = world.get(id, 'laneCreep'); return c.team === team && c.lane === lane; });
    assert.equal(ids.length, 5);
    assert.deepEqual(ids.map(id => world.get(id, 'squad').unitType.split('_')[1]), ['melee', 'melee', 'melee', 'ranged', 'siege']);
    for (const id of ids) {
      const squad = world.get(id, 'squad');
      const kind = squad.unitType.split('_')[1];
      assert.equal(squad.attackMode, kind === 'melee' ? 'melee' : 'ranged');
      assert.equal(squad.projectileType, kind === 'melee' ? null : 'bullet');
      assert.equal(core.canCommand(team, id), false);
      assert.equal(squad.soldiers.filter(s => s != null).length, 1);
      const soldier = world.get(squad.soldiers.find(s => s != null), 'soldier');
      assert.equal(soldier.hp, { melee: 550, ranged: 300, siege: 935 }[kind]);
      assert.equal(soldier.weapon, { melee: 'sword', ranged: 'creep_ranged', siege: 'creep_siege' }[kind]);
    }
  }
  systemLaneCreeps(world, 29);
  assert.equal(world.query('laneCreep').length, 30);
  systemLaneCreeps(world, 1);
  assert.equal(world.query('laneCreep').length, 60);
  for (let i = 0; i < 20; i++) systemLaneCreeps(world, 30);
  assert.equal(world.query('laneCreep').filter(id => living(world, id)).length, 6 * CREEP_LANE_LIMIT);
});

test('lane orders follow terrain routing, advance waypoints and target the enemy HQ', async () => {
  const { world, bases } = fixture();
  window.__sgbPassGrid = JSON.parse(fs.readFileSync('maps/4p_doom_spiral/4p_doom_spiral_path.json'));
  await startDoomCreeps(world, bases);
  const ids = world.query('laneCreep');
  const initial = new Map(ids.map(id => [id, world.get(id, 'squad').position.clone()]));
  world.addSystem(systemLaneCreeps); world.addSystem(systemSquad);
  for (const id of ids) for (const point of world.get(id, 'laneCreep').path) {
    assert.equal(sgbPassBlockedAt(window.__sgbPassGrid, point.x, point.z), false);
  }
  for (let i = 0; i < 100; i++) world.tick(.05);
  for (const team of ['blue', 'red']) for (const lane of DOOM_LANES) {
    assert.ok(ids.some(id => {
      const c = world.get(id, 'laneCreep');
      return c.team === team && c.lane === lane && world.get(id, 'squad').position.distanceTo(initial.get(id)) > 5;
    }), `${team} ${lane} advances`);
  }
  const id = ids[0], walker = world.get(id, 'laneCreep'), squad = world.get(id, 'squad');
  while (walker.waypoint < walker.path.length - 1) {
    const point = walker.path[walker.waypoint]; squad.position.set(point.x, 0, point.z);
    systemLaneCreeps(world, 0);
  }
  const end = walker.path.at(-1); squad.position.set(end.x, 0, end.z);
  systemLaneCreeps(world, 0);
  assert.equal(squad.forcedTarget, bases.find(b => b.team !== squad.team).id);
});

test('stopping the old map cancels waves and a pending model download', async () => {
  const { world, bases } = fixture();
  for (const creep of laneCreeps) delete factionContainers.ig.units[creep.name];
  let finish;
  const wait = new Promise(resolve => { finish = resolve; });
  const ready = startDoomCreeps(world, bases, { loadModel: async () => { await wait; return model(); } });
  stopDoomCreeps(world);
  finish(); await ready;
  systemLaneCreeps(world, 100);
  assert.equal(world.query('laneCreep').length, 0);
});

test('opposing creeps deal melee damage through the normal combat system', async () => {
  const { world, bases } = fixture();
  await startDoomCreeps(world, bases);
  stopDoomCreeps(world);
  const ids = ['blue', 'red'].map(team => world.query('laneCreep').find(id => world.get(id, 'squad').team === team));
  for (const id of world.query('squad')) if (!ids.includes(id)) {
    for (const sid of world.get(id, 'squad').soldiers) if (sid != null) world.destroyEntity(sid);
    world.destroyEntity(id);
  }
  world._flushDestroyed();
  const soldiers = ids.map(id => world.get(id, 'squad').soldiers.find(sid => sid != null));
  ids.forEach((id, i) => {
    const squad = world.get(id, 'squad');
    squad.position.set(i ? 1 : -1, 0, 0);
    squad.moveOrder = null;
    squad.forcedSoldierId = soldiers[1 - i];
    world.get(soldiers[i], 'mesh').root.position.copy(squad.position);
  });
  world.addSystem(systemSquad);
  for (let i = 0; i < 100; i++) world.tick(.05);
  assert.ok(soldiers.some(id => world.get(id, 'soldier').hp < 550));
  assert.equal(world.query('bullet').length, 0);
});

test('melee creeps only strike bases within reach and never fall through to a projectile', async () => {
  const { world, bases } = fixture();
  await startDoomCreeps(world, bases);
  for (const team of ['blue', 'red']) {
    const id = world.query('laneCreep').find(id => world.get(id, 'squad').team === team);
    const squad = world.get(id, 'squad');
    const soldier = squad.soldiers.find(sid => sid != null);
    const target = bases.find(base => base.team !== team).id;
    const root = world.get(soldier, 'mesh').root;
    const center = world.get(target, 'mesh').root.position;
    const radius = buildingEngageRadius(world, target);
    const hp = world.get(target, 'building').hp;
    const fired = () => world.query('bullet').some(bullet => world.get(bullet, 'bullet').ownerRef === soldier);
    root.position.copy(center).x += radius + 7;
    _squadFireAll(world, id, squad, [soldier], 0, { buildingEntityId: target, distance: 7, radius }, false);
    assert.equal(world.get(target, 'building').hp, hp);
    assert.equal(fired(), false);
    root.position.copy(center).x += radius + 1.5;
    _squadFireAll(world, id, squad, [soldier], 0, { buildingEntityId: target, distance: radius + 1.5, radius }, false);
    assert.ok(world.get(target, 'building').hp < hp);
    assert.equal(fired(), false);
    squad.position.copy(root.position);
    squad.forcedTarget = target;
    squad.moveOrder = null;
    let animation;
    root._playAnim = name => { animation = name; };
    systemSquad(world, .01);
    assert.equal(animation, 'melee');
    assert.equal(fired(), false);
  }
});

for (const kind of ['ranged', 'siege']) test(`${kind} creeps on both teams fire and damage enemies at range`, async () => {
  const { world, bases } = fixture();
  await startDoomCreeps(world, bases);
  stopDoomCreeps(world);
  const ids = ['blue', 'red'].map(team => world.query('laneCreep').find(id => {
    const squad = world.get(id, 'squad');
    return squad.team === team && squad.unitType.includes(`_${kind}_`);
  }));
  for (const id of world.query('squad')) if (!ids.includes(id)) {
    for (const sid of world.get(id, 'squad').soldiers) if (sid != null) world.destroyEntity(sid);
    world.destroyEntity(id);
  }
  world._flushDestroyed();
  const soldiers = ids.map(id => world.get(id, 'squad').soldiers.find(sid => sid != null));
  ids.forEach((id, index) => {
    const squad = world.get(id, 'squad');
    squad.position.set(index ? 5 : -5, 0, 0);
    squad.moveOrder = null;
    squad.forcedSoldierId = soldiers[1 - index];
    world.get(soldiers[index], 'mesh').root.position.copy(squad.position);
  });
  world.addSystem(systemSquad);
  world.addSystem(systemBullet);
  let fired = false;
  for (let i = 0; i < 40; i++) {
    world.tick(.05);
    fired ||= world.query('bullet').length > 0;
  }
  assert.equal(fired, true);
  for (const id of soldiers) {
    const soldier = world.get(id, 'soldier');
    assert.ok(soldier.hp < soldier.maxHp);
    assert.equal(soldier.meleeEngaged, false);
  }
});

test('siege shots damage buildings with their siege profile and a slower attack cadence', async () => {
  const { world, bases } = fixture();
  await startDoomCreeps(world, bases);
  for (const team of ['blue', 'red']) {
    const id = world.query('laneCreep').find(id => world.get(id, 'squad').unitType === `${team === 'blue' ? 'radiant' : 'dire'}_siege_creep`);
    const squad = world.get(id, 'squad');
    const soldier = squad.soldiers.find(sid => sid != null);
    const target = bases.find(base => base.team !== team).id;
    const targetPosition = world.get(target, 'mesh').root.position;
    world.get(soldier, 'mesh').root.position.copy(targetPosition).add(new THREE.Vector3(-12, 0, 0));
    _squadFireAll(world, id, squad, [soldier], 0, { buildingEntityId: target, distance: 12 }, false);
    const shot = world.query('bullet').find(bid => world.get(bid, 'bullet').ownerRef === soldier);
    assert.equal(world.get(shot, 'bullet').damage, 180);
    assert.equal(world.get(shot, 'mesh').root.geometry.type, 'SphereGeometry');
    assert.equal(world.get(soldier, 'soldier').attackCooldown, 3);
    const hp = world.get(target, 'building').hp;
    for (let i = 0; i < 20; i++) systemBullet(world, .05);
    assert.equal(world.get(target, 'building').hp, hp - 180);
  }
});

test('real map resets keep two requested HQs and start only Doom Spiral creep waves', () => {
  const result = spawnSync(process.execPath, ['--import', './tests/register-hooks.mjs', 'tests/doom-creeps-reset-probe.mjs'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
