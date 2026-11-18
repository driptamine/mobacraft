import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZoneRadius, ghostRectAt, placementStatus } from '../src/input/build-placement.js';

const hq = { type: 'hq', faction: 'ig', team: 'blue', position: { x: 0, z: 0 } };
const generator = { type: 'plasma_generator', faction: 'ig', team: 'blue', position: { x: 30, z: 0 } };
// HQ completed footprint is ~15x16 around its origin: a ghost fully inside it overlaps.
const insideHq = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
// Clear of every footprint, next to the HQ.
const clearNearHq = { minX: 20, maxX: 24, minZ: -2, maxZ: 2 };
// Clear of every footprint and far from every zone.
const farAway = { minX: 200, maxX: 204, minZ: 200, maxZ: 204 };

test('ghost footprint rect follows the cursor with the measured box offset', () => {
  const rect = ghostRectAt({ x: 100, z: 50 }, { x: 8, z: 6 }, { x: 1, z: -1 });
  assert.deepEqual(rect, { minX: 97, maxX: 105, minZ: 46, maxZ: 52 });
});

test('overlapping a finished building blocks with reason overlap', () => {
  assert.deepEqual(
    placementStatus('plasma_generator', 'blue', { x: 0, z: 0 }, insideHq, [hq, generator]).reason,
    'overlap',
  );
  assert.equal(placementStatus('plasma_generator', 'blue', { x: 0, z: 0 }, insideHq, [hq, generator]).ok, false);
});

test('a building under construction still blocks its drop', () => {
  const constructing = { ...generator, constructing: true, position: { x: 22, z: 0 } };
  const ghost = { minX: 20, maxX: 24, minZ: -2, maxZ: 2 };
  assert.equal(placementStatus('turret', 'blue', { x: 22, z: 0 }, ghost, [hq, constructing]).ok, false);
});

test('clear ground inside the HQ zone is allowed', () => {
  assert.deepEqual(
    placementStatus('plasma_generator', 'blue', { x: 22, z: 0 }, clearNearHq, [hq, generator]),
    { ok: true, reason: null },
  );
});

test('clear ground outside every zone is refused with reason zone', () => {
  assert.deepEqual(
    placementStatus('plasma_generator', 'blue', { x: 202, z: 202 }, farAway, [hq, generator]),
    { ok: false, reason: 'zone' },
  );
});

test('zone rings grow from the finished building and ignore unfinished ones', () => {
  const hqRadius = buildZoneRadius({ type: 'hq', faction: 'ig' });
  const turretRadius = buildZoneRadius({ type: 'turret', faction: 'ig' });
  assert.ok(hqRadius > turretRadius, `hq=${hqRadius} turret=${turretRadius}`);
  // A finished generator's own ring covers nearby ground; an unfinished one emits none.
  const nearGenerator = { minX: 210, maxX: 214, minZ: 200, maxZ: 204 };
  const finished = [{ ...generator, position: { x: 202, z: 202 } }];
  assert.equal(placementStatus('turret', 'blue', { x: 212, z: 202 }, nearGenerator, finished).ok, true);
  // Unfinished generator next to a distant HQ: the point is outside the HQ
  // ring and the unfinished drop emits no ring of its own.
  const unfinished = [{ ...generator, position: { x: 202, z: 202 }, constructing: true }];
  assert.deepEqual(
    placementStatus('turret', 'blue', { x: 212, z: 202 }, nearGenerator, [hq, ...unfinished]),
    { ok: false, reason: 'zone' },
  );
  // With no finished building at all there is no zone network yet (first
  // building edge, e.g. a destroyed HQ): placement stays allowed.
  assert.deepEqual(
    placementStatus('hq', 'blue', { x: 212, z: 202 }, nearGenerator, unfinished),
    { ok: true, reason: null },
  );
});

test('enemy buildings neither block nor zone our placement', () => {
  const redHq = { ...hq, team: 'red' };
  assert.deepEqual(
    placementStatus('turret', 'blue', { x: 0, z: 0 }, insideHq, [redHq]),
    { ok: true, reason: null },
  );
});

test('first building with no finished HQ yet is always allowed', () => {
  assert.deepEqual(
    placementStatus('hq', 'blue', { x: 202, z: 202 }, farAway, []),
    { ok: true, reason: null },
  );
});

test('listening posts are exempt from overlap and zone rules', () => {
  assert.deepEqual(
    placementStatus('listening_post', 'blue', { x: 0, z: 0 }, insideHq, [hq, generator]),
    { ok: true, reason: null },
  );
});
