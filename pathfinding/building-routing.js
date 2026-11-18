// Dynamic building contours shared by all grounded movers. Terrain paint stays
// immutable; A* samples it together with these exact world-space rectangles.
import { astar } from './astar.js';
import { sgbPassBlockedAt } from './avoid.js';
let footprints = [], signature = '', revision = 0;
const expandedCache = new Map();
export function setBuildingObstacles(bounds, identity = '') {
    const next = identity + '|' + bounds.map(b => [b.minX, b.maxX, b.minZ, b.maxZ].join(',')).join(';');
    if (next === signature)
        return;
    signature = next;
    footprints = bounds;
    revision++;
    expandedCache.clear();
}
export const buildingRevision = () => revision;
export const hasBuildingObstacles = () => footprints.length > 0;
export const navigationRadius = mover => mover?._navigationRadius ?? .5;
const inside = (point, b) => point.x > b.minX && point.x < b.maxX && point.z > b.minZ && point.z < b.maxZ;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function obstacles(radius) {
    if (!expandedCache.has(radius)) {
        const padding = radius + .2;
        expandedCache.set(radius, footprints.map(b => ({ minX: b.minX - padding, maxX: b.maxX + padding, minZ: b.minZ - padding, maxZ: b.maxZ + padding })));
    }
    return expandedCache.get(radius);
}
export const buildingBlockedAt = (x, z, radius = .5) => obstacles(radius).some(b => inside({ x, z }, b));
function intersects(from, to, bounds) {
    let entry = 0, exit = 1;
    for (const [start, end, min, max] of [[from.x, to.x, bounds.minX + 1e-6, bounds.maxX - 1e-6], [from.z, to.z, bounds.minZ + 1e-6, bounds.maxZ - 1e-6]]) {
        const delta = end - start;
        if (Math.abs(delta) < 1e-9) {
            if (start < min || start > max)
                return false;
        }
        else {
            const a = (min - start) / delta, b = (max - start) / delta;
            entry = Math.max(entry, Math.min(a, b));
            exit = Math.min(exit, Math.max(a, b));
            if (entry > exit)
                return false;
        }
    }
    return entry <= exit;
}
export function buildingLineClear(from, to, radius = .5, escape = false) {
    return !obstacles(radius).some(b => !(escape && inside(from, b)) && intersects(from, to, b));
}
// An order into a building ends on its boundary. Reject candidates inside a
// neighbouring building or painted wall; ties prefer the side facing the mover.
export function projectBuildingDestination(point, from = point, radius = .5, allowed = () => true) {
    const bounds = obstacles(radius);
    if (!bounds.some(b => inside(point, b)))
        return point;
    const candidates = [], gap = .02, clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    for (const b of bounds) {
        candidates.push({ x: clamp(point.x, b.minX, b.maxX), z: b.minZ - gap }, { x: clamp(point.x, b.minX, b.maxX), z: b.maxZ + gap }, { x: b.minX - gap, z: clamp(point.z, b.minZ, b.maxZ) }, { x: b.maxX + gap, z: clamp(point.z, b.minZ, b.maxZ) });
        for (const x of [b.minX - gap, b.maxX + gap])
            for (const z of [b.minZ - gap, b.maxZ + gap])
                candidates.push({ x, z });
    }
    const free = candidates.filter(p => !bounds.some(b => inside(p, b)) && allowed(p));
    free.sort((a, b) => (distance(point, a) + distance(from, a) * .001) - (distance(point, b) + distance(from, b) * .001));
    return free[0] || point;
}
export function findBuildingRoute(from, to, { passGrid = null, radius = .5, lineClear = () => true, smoothClear = lineClear, groundAt = null, slopePenalty = 24, slopeCap = 10, maxExpand = 60000 } = {}) {
    const paintFree = p => !sgbPassBlockedAt(passGrid, p.x, p.z);
    const startExit = projectBuildingDestination(from, to, radius, paintFree);
    if (startExit !== from)
        return [startExit];
    const goal = projectBuildingDestination(to, from, radius, paintFree);
    const clear = (a, b) => buildingLineClear(a, b, radius) && lineClear(a, b);
    if (clear(from, goal) && smoothClear(from, goal))
        return goal === to ? null : [goal];
    // A one-unit search lattice resolves corridors around buildings without
    // changing the SGB's authored cell size or stretching its coverage.
    const all = obstacles(radius), cell = 1;
    const minX = Math.floor(Math.min(from.x, goal.x, ...all.map(b => b.minX)) - 16);
    const minZ = Math.floor(Math.min(from.z, goal.z, ...all.map(b => b.minZ)) - 16);
    const maxX = Math.ceil(Math.max(from.x, goal.x, ...all.map(b => b.maxX)) + 16);
    const maxZ = Math.ceil(Math.max(from.z, goal.z, ...all.map(b => b.maxZ)) + 16);
    const sizeX = Math.ceil((maxX - minX) / cell), sizeZ = Math.ceil((maxZ - minZ) / cell);
    const world = (x, y) => ({ x: minX + (x + .5) * cell, z: minZ + (y + .5) * cell });
    const blockedCache = new Map();
    const blocked = (x, y) => {
        if (x < 0 || y < 0 || x >= sizeX || y >= sizeZ)
            return true;
        const key = y * sizeX + x;
        if (!blockedCache.has(key)) {
            const p = world(x, y);
            blockedCache.set(key, !paintFree(p) || buildingBlockedAt(p.x, p.z, radius));
        }
        return blockedCache.get(key);
    };
    const nearest = (point, visible) => {
        const cx = Math.floor((point.x - minX) / cell), cy = Math.floor((point.z - minZ) / cell);
        for (let ring = 0; ring <= Math.max(sizeX, sizeZ); ring++) {
            const candidates = [];
            for (let dx = -ring; dx <= ring; dx++)
                for (const dy of ring === 0 ? [0] : [-ring, ring])
                    candidates.push({ x: cx + dx, y: cy + dy });
            for (let dy = 1 - ring; dy < ring; dy++)
                for (const dx of [-ring, ring])
                    candidates.push({ x: cx + dx, y: cy + dy });
            candidates.sort((a, b) => distance(world(a.x, a.y), point) - distance(world(b.x, b.y), point));
            for (const c of candidates)
                if (!blocked(c.x, c.y) && (!visible || clear(point, world(c.x, c.y))))
                    return c;
            if (visible && ring >= 8)
                return null;
        }
        return null;
    };
    const start = nearest(from, paintFree(from)), end = nearest(goal, paintFree(goal));
    if (!start || !end)
        return [{ x: from.x, z: from.z }];
    const cells = astar(start, end, { isBlocked: blocked, maxExpand, cost: (nx, ny, px, py) => {
            const a = world(px, py), b = world(nx, ny);
            if (!clear(a, b))
                return Infinity;
            return groundAt ? Math.min(slopeCap, slopePenalty * Math.max(0, groundAt(b.x, b.z) - groundAt(a.x, a.z)) / cell) : 0;
        } });
    if (!cells)
        return [{ x: from.x, z: from.z }];
    const points = [...(paintFree(from) ? [from] : []), ...cells.map(c => world(c.x, c.y))];
    if (paintFree(goal) && clear(points[points.length - 1], goal))
        points.push(goal);
    const route = [];
    let anchor = 0;
    if (!paintFree(from))
        route.push(points[0]);
    while (anchor < points.length - 1) {
        let furthest = anchor + 1;
        for (let next = anchor + 2; next < points.length; next++)
            if (clear(points[anchor], points[next]) && smoothClear(points[anchor], points[next], next === points.length - 1))
                furthest = next;
        route.push(points[furthest]);
        anchor = furthest;
    }
    return route.length ? route : [goal];
}
