import { it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setBuildingObstacles, buildingLineClear, buildingBlockedAt } from '../pathfinding/building-routing.js';
import { findSquadPath, updateMoverRoute, clampStepToRoute, setRoutingMode } from '../pathfinding/astar-integrated.js';
globalThis.window = {};
afterEach(() => { setBuildingObstacles([]); delete window.__sgbPassGrid; setRoutingMode('astar'); });
const box = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
function assertClear(start, route, radius = .5) { let previous = start; for (const point of route) {
    assert.ok(buildingLineClear(previous, point, radius), JSON.stringify([previous, point]));
    previous = point;
} }
it('routes around a building on flat ground instead of depending on collision push-out', () => {
    setBuildingObstacles([box]);
    const start = { x: -20, z: 0 }, goal = { x: 20, z: 0 };
    const route = findSquadPath(start, goal, { groundAt: () => 0 });
    assert.ok(route?.length >= 2);
    assertClear(start, route);
    assert.deepEqual(route.at(-1), goal);
});
it('combines buildings with map paint and does not smooth across either obstacle', () => {
    const grid = { grid: { originX: -30, originZ: -30, sizeX: 60, sizeZ: 60, cellWorld: 1 }, rows: Array.from({ length: 60 }, (_, r) => Array.from({ length: 60 }, (_, c) => c === 35 && r < 40 ? 7 : 2)) };
    window.__sgbPassGrid = grid;
    setBuildingObstacles([box]);
    const start = { x: -20, z: 0 }, goal = { x: 20, z: 0 };
    const route = findSquadPath(start, goal, { passGrid: grid, groundAt: () => 0 });
    assert.ok(route?.length >= 2);
    assertClear(start, route);
    for (const p of route)
        assert.equal(buildingBlockedAt(p.x, p.z), false);
    assert.deepEqual(route.at(-1), goal);
});
it('replans the same order when a building appears, changes contour or is demolished', () => {
    const mover = { moveOrder: { x: 20, z: 0 } }, from = { x: -20, z: 0 };
    assert.equal(updateMoverRoute(mover, from, mover.moveOrder, { groundAt: () => 0 }), null);
    setBuildingObstacles([box]);
    const waypoint = updateMoverRoute(mover, from, mover.moveOrder, { groundAt: () => 0 });
    assert.ok(waypoint);
    assert.notEqual(waypoint.z, 0);
    setBuildingObstacles([{ ...box, minZ: -10, maxZ: 10 }]);
    updateMoverRoute(mover, from, mover.moveOrder, { groundAt: () => 0 });
    assertClear(from, mover._astarPath);
    setBuildingObstacles([]);
    assert.equal(updateMoverRoute(mover, from, mover.moveOrder, { groundAt: () => 0 }), null);
});
it('ends a movement order inside a building at a reachable outside boundary', () => {
    setBuildingObstacles([box]);
    const mover = { moveOrder: { x: 0, z: 0 } }, from = { x: -20, z: 0 };
    updateMoverRoute(mover, from, mover.moveOrder, { groundAt: () => 0 });
    assert.equal(buildingBlockedAt(mover.moveOrder.x, mover.moveOrder.z), false);
    assert.ok(mover.moveOrder.x < box.minX);
});
it('guards the whole step and still routes buildings in straight terrain mode', () => {
    setBuildingObstacles([box]);
    setRoutingMode('straight');
    const from = { x: -10, z: 0 };
    assert.deepEqual(clampStepToRoute({}, from.x, from.z, 20, 0), [0, 0]);
    assert.ok(updateMoverRoute({}, from, { x: 10, z: 0 }, { groundAt: () => 0 }));
});
it('accounts for vehicle width in narrow passages', () => {
    setBuildingObstacles([{ minX: -5, maxX: 5, minZ: -20, maxZ: -.8 }, { minX: -5, maxX: 5, minZ: .8, maxZ: 20 }]);
    const start = { x: -15, z: 0 }, goal = { x: 15, z: 0 };
    assert.equal(findSquadPath(start, goal, { radius: .5, groundAt: () => 0 }), null);
    const route = findSquadPath(start, goal, { radius: 1.2, groundAt: () => 0 });
    assert.ok(route?.length > 1);
    assertClear(start, route, 1.2);
});
