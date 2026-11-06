import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./node-esm-hooks.mjs', import.meta.url);
globalThis.window = {};
globalThis.document = { getElementById: () => null };
const sceneMod = await import('../src/scene.js');
const headlessScene = new THREE.Scene();
headlessScene._registerShadows = () => {};
sceneMod.__setSceneCameraForTests(headlessScene, { target: new THREE.Vector3() });
const { PLAYER } = sceneMod;
const { World } = await import('../src/ecs.js');
const { systemBullet, systemReaperBullet } = await import('../src/systems.js');
const { createSquadEntity } = await import('../src/entities.js');
const { factionContainers } = await import('../src/factions.js');
const {
  makeReaperBoltMesh,
  updateReaperBoltFx,
  REAPER_CORE_NAME,
  REAPER_SHELL_NAME,
} = await import('../src/reaper-bolt.js');

function collectByName(root) {
  const found = {};
  root.traverse((child) => {
    if (child.name) {
      found[child.name] = child;
    }
  });
  return found;
}

describe('dark reaper bolt', () => {
  it('builds a symmetric egg with a black core and white glow', () => {
    const bolt = makeReaperBoltMesh();
    assert.equal(bolt.name, 'reaperbolt');
    const found = collectByName(bolt);
    assert.ok(found[REAPER_CORE_NAME], 'core present');
    assert.ok(found[REAPER_SHELL_NAME], 'shell present');
    // Black unlit core, white additive glow around it.
    assert.equal(found[REAPER_CORE_NAME].material.color.getHex(), 0x060608);
    assert.equal(found[REAPER_SHELL_NAME].material.color.getHex(), 0xffffff);
    assert.equal(found[REAPER_SHELL_NAME].material.blending, THREE.AdditiveBlending);
    // Plump symmetric egg: elongated but compact, round cross-section.
    for (const name of [REAPER_CORE_NAME, REAPER_SHELL_NAME]) {
      const geo = found[name].geometry;
      geo.computeBoundingBox();
      const size = geo.boundingBox.getSize(new THREE.Vector3());
      assert.ok(size.z > size.x * 1.5 && size.z < size.x * 2.5, `${name} is egg-shaped`);
      assert.ok(Math.abs(size.x - size.y) / size.x < 0.05, `${name} is radially symmetric`);
    }
    // Shared across bolts.
    const other = collectByName(makeReaperBoltMesh());
    assert.equal(found[REAPER_CORE_NAME].geometry, other[REAPER_CORE_NAME].geometry);
    assert.equal(found[REAPER_SHELL_NAME].material, other[REAPER_SHELL_NAME].material);
  });

  it('updateReaperBoltFx shimmers the shared shell', () => {
    const shell = collectByName(makeReaperBoltMesh())[REAPER_SHELL_NAME].material;
    updateReaperBoltFx(1.0);
    const a = shell.opacity;
    updateReaperBoltFx(1.2);
    assert.notEqual(shell.opacity, a);
    assert.ok(shell.opacity > 0.25 && shell.opacity < 0.65);
  });

  it('systemBullet ignores reaper bolts', () => {
    const world = new World();
    const id = world.createEntity([]);
    const root = new THREE.Group();
    root.position.set(0, 1.05, 0);
    world.add(id, 'bullet', {
      team: PLAYER, targetId: 9999, age: 0,
      vx: 10, vy: 0, vz: 0, damage: 10, projectileType: 'reaper',
    });
    world.add(id, 'mesh', { root });
    systemBullet(world, 0.1);
    assert.equal(world.get(id, 'bullet').age, 0);
    assert.equal(world.get(id, 'mesh').root.position.x, 0);
  });

  it('reaper bolt reaches a troop body and evaporates on impact', () => {
    const world = new World();
    world.addSystem(systemBullet);
    world.addSystem(systemReaperBullet);
    const target = world.createEntity([]);
    const targetRoot = new THREE.Group();
    targetRoot.position.set(20, 0, 0);
    world.add(target, 'soldier', { hp: 100, squadId: 0 });
    world.add(target, 'mesh', { root: targetRoot });
    const id = world.createEntity([]);
    const root = new THREE.Group();
    root.position.set(0, 1.05, 0);
    world.add(id, 'bullet', {
      team: PLAYER, targetId: target, age: 0,
      vx: 26, vy: 0, vz: 0, damage: 10, projectileType: 'reaper',
    });
    world.add(id, 'mesh', { root });
    for (let i = 0; i < 600 && world.has(id, 'bullet'); i++) {
      world.tick(1 / 60);
    }
    assert.ok(world.get(target, 'soldier').hp < 100, 'troop takes the hit');
    assert.ok(!world.has(id, 'bullet'), 'bolt evaporates on impact');
  });

  it('dark reaper squads fire reaper bolts, guardians keep theirs', () => {
    factionContainers.eldar = factionContainers.eldar || {};
    factionContainers.eldar.soldier = {
      scene: (() => {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
        return g;
      })(),
      animations: [],
      _hiddenNodes: null,
    };
    const world = new World();
    const reaperSquad = createSquadEntity(world, 'red', 0, 0, 2, 'dark_reaper', 'eldar');
    assert.equal(world.get(reaperSquad, 'squad').projectileType, 'reaper');
    const guardianSquad = createSquadEntity(world, 'red', 10, 0, 2, null, 'eldar');
    assert.equal(world.get(guardianSquad, 'squad').projectileType, 'bullet');
  });
});
