import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/core/ecs.js';
import { worldFootprint, insideFootprint } from '../src/core/structure-footprint.js';
globalThis.window = {};
globalThis.document = { getElementById: () => null, querySelector: () => null };
const state = await import('../src/core/scene.js');
const scene = new THREE.Scene();
scene._registerShadows = () => { };
state.__setSceneCameraForTests(scene, { target: new THREE.Vector3() });
const { makeHpBar } = await import('../src/meshes.js');
const entities = await import('../src/entities/entities.js');
const systems = await import('../src/core/systems.js');
const { refreshNavigation } = await import('../src/systems/navigation.js');
const { setDefaultScene } = await import('../src/render/three-helpers.js');
setDefaultScene(scene);
for (const kind of ['squad', 'builder', 'apc', 'vehicle'])
    it(`${kind} reaches its order around completed buildings and construction sites`, () => {
        for (const constructing of [false, true]) {
            const world = new World();
            state.setWorld(world);
            const siteId = world.createEntity([]), site = { type: 'hq', faction: 'ig', team: 'red', hp: 2000, position: new THREE.Vector3(), constructing };
            world.add(siteId, 'building', site);
            let id, unit, position;
            if (kind === 'squad') {
                id = entities.createSquadEntity(world, 'blue', -30, 0, 3, null, 'ig');
                unit = world.get(id, 'squad');
                position = unit.position;
                unit.stopped = false;
                unit.moveOrder = new THREE.Vector3(30, 0, 0);
            }
            if (kind === 'builder') {
                id = entities.createBuilderEntity(world, -30, 0, 'blue', 'ig');
                unit = world.get(id, 'builder');
                position = world.get(id, 'mesh').root.position;
                unit.moveTarget = new THREE.Vector3(30, 0, 0);
            }
            if (kind === 'apc') {
                id = entities.createApcEntity(world, new THREE.Vector3(-30, 0, 0), 'ig');
                unit = world.get(id, 'apc');
                position = unit.position;
                unit.moveOrder = new THREE.Vector3(30, 0, 0);
            }
            if (kind === 'vehicle') {
                id = world.createEntity([]);
                unit = { team: 'blue', faction: 'ig', position: new THREE.Vector3(-30, 0, 0), moveOrder: new THREE.Vector3(30, 0, 0), speed: 7, attackCd: 0, attackRange: 0, constructing: false, hp: 100, maxHp: 100, queue: [] };
                world.add(id, 'vehicle', unit);
                world.add(id, 'mesh', { root: new THREE.Group(), hpBar: makeHpBar(2, 'blue') });
                position = unit.position;
            }
            const bounds = worldFootprint(site), radius = kind === 'apc' ? 1.2 : kind === 'vehicle' ? 1 : .5;
            let detoured = false;
            for (let tick = 0; tick < 1800; tick++) {
                systems[kind === 'squad' ? 'systemSquad' : kind === 'builder' ? 'systemBuilder' : kind === 'apc' ? 'systemApc' : 'systemVehicle'](world, .05);
                systems.systemStructureCollision(world, .05);
                assert.equal(insideFootprint(position, bounds, radius - .01), false, 'unit entered the building collider');
                if (Math.abs(position.z) > 5)
                    detoured = true;
                if (kind === 'squad')
                    for (const soldierId of unit.soldiers.filter(Boolean))
                        assert.equal(insideFootprint(world.get(soldierId, 'mesh').root.position, bounds, .45), false, 'individual soldier cut through building');
                if (!(unit.moveOrder || unit.moveTarget) && kind !== 'squad')
                    break;
                if (kind === 'squad' && !unit.moveOrder && tick > 500)
                    break;
            }
            assert.ok(detoured, 'unit must go around the contour');
            assert.ok(position.distanceTo(new THREE.Vector3(30, 0, 0)) < 1, 'order finishes');
            assert.equal(unit.moveOrder ?? unit.moveTarget ?? null, null);
        }
    });
it('a new building invalidates an existing order without issuing a second click', () => {
    const world = new World();
    state.setWorld(world);
    const id = entities.createBuilderEntity(world, -25, 0, 'blue', 'ig'), worker = world.get(id, 'builder'), position = world.get(id, 'mesh').root.position;
    worker.moveTarget = new THREE.Vector3(25, 0, 0);
    for (let tick = 0; tick < 10; tick++)
        systems.systemBuilder(world, .05);
    const site = { type: 'hq', team: 'red', faction: 'chaos', hp: 100, position: new THREE.Vector3(), constructing: true }, siteId = world.createEntity([]);
    world.add(siteId, 'building', site);
    const bounds = worldFootprint(site);
    for (let tick = 0; tick < 400 && worker.moveTarget; tick++) {
        systems.systemBuilder(world, .05);
        systems.systemStructureCollision(world, .05);
        assert.equal(insideFootprint(position, bounds, .49), false);
    }
    assert.equal(worker.moveTarget, null);
    assert.ok(position.x > 24);
    world.destroyEntity(siteId);
    refreshNavigation(world);
});

it('workers repair wide HQs and airfields from their outside boundary', () => {
    for (const kind of ['building', 'airfield']) {
        const world = new World();state.setWorld(world);
        const id = world.createEntity([]), site = { type: kind === 'building' ? 'hq' : 'airfield', team: 'blue', faction: 'ig', hp: 95, maxHp: 100, position: new THREE.Vector3(), constructing: false };
        world.add(id, kind, site);
        const workerId = entities.createBuilderEntity(world, -30, 0, 'blue', 'ig'), worker = world.get(workerId, 'builder'), position = world.get(workerId, 'mesh').root.position;
        worker.repairTarget = id;
        for (let tick = 0; tick < 600 && worker.repairTarget != null; tick++) {
            systems.systemBuilder(world, .05);systems.systemStructureCollision(world, .05);
            assert.equal(insideFootprint(position, worldFootprint(site), .49), false);
        }
        assert.equal(site.hp, site.maxHp, 'repair must finish without entering the target');
        assert.equal(worker.repairTarget, null);
    }
});
