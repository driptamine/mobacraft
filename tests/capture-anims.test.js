import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPTURE_SEQUENCE, nextCaptureStage, guardCaptureAnim, captureClipDone, isPointCapturedBy, GUARD_CAPTURE_SEQUENCE, nextGuardCaptureStage, isPlantingDone, isPlanterFinished } from '../src/soldier-aim.js';

function glbClipNames(url) {
  const buf = readFileSync(url);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return (json.animations || []).map((a) => a.name);
}

describe('capture anims', () => {
  it('guardsmen.glb carries the planter and capturer clips', () => {
    const names = glbClipNames(new URL('../models/ig/infantry/guardsmen.glb', import.meta.url));
    for (const clip of ['flag_plant_1', 'flag_plant_2', 'capture_strategic_point_1', 'capture_strategic_point_2']) {
      assert.ok(names.includes(clip), `${clip} exists`);
    }
  });

  it('planter sequence plays three one-shots then holds the last stage', () => {
    assert.deepEqual(CAPTURE_SEQUENCE, ['flagPlant1', 'flagPlant2', 'capture1']);
    let next = nextCaptureStage(0, 'idle', null);
    assert.deepEqual(next, { stage: 0, want: 'flagPlant1' });
    next = nextCaptureStage(0, null, 'flagPlant1');
    assert.deepEqual(next, { stage: 1, want: 'flagPlant2' });
    next = nextCaptureStage(1, null, 'flagPlant2');
    assert.deepEqual(next, { stage: 2, want: 'capture1' });
    next = nextCaptureStage(2, 'capture1', 'capture1');
    assert.deepEqual(next, { stage: 2, want: 'capture1' });
  });

  it('sequencer ignores mid-play ticks and clamps bad stages', () => {
    assert.deepEqual(nextCaptureStage(0, 'flagPlant1', 'flagPlant1').stage, 0);
    assert.deepEqual(nextCaptureStage(undefined, null, null), { stage: 0, want: 'flagPlant1' });
    assert.deepEqual(nextCaptureStage(99, 'capture1', 'capture1'), { stage: 2, want: 'capture1' });
  });

  it('detects a finished one-shot capture clip', () => {
    assert.equal(captureClipDone('capture1', 'capture1', null), true);
    assert.equal(captureClipDone('capture1', 'capture1', undefined), true);
    assert.equal(captureClipDone('capture1', 'capture1', 'capture1'), false);
    assert.equal(captureClipDone('capture1', null, null), false);
    assert.equal(captureClipDone('capture1', 'flagPlant2', null), false);
  });

  it('all guards use capture2 until the point is captured', () => {
    for (const idx of [1, 2, 3, 4]) {
      assert.equal(guardCaptureAnim(idx), 'capture2');
    }
    assert.equal(isPointCapturedBy('blue', 'blue'), true);
    assert.equal(isPointCapturedBy('red', 'blue'), false);
    assert.equal(isPointCapturedBy(null, 'blue'), false);
  });

  it('planting finishes when flag_plant_2 ends (stage 2+)', () => {
    assert.equal(isPlantingDone({ captureStage: 0, hasPlantAnims: true }), false);
    assert.equal(isPlantingDone({ captureStage: 1, hasPlantAnims: true }), false);
    assert.equal(isPlantingDone({ captureStage: 2, hasPlantAnims: true }), true);
    assert.equal(isPlantingDone({ captureStage: undefined, hasPlantAnims: true }), false);
    assert.equal(isPlantingDone({ captureStage: 0, hasPlantAnims: false }), true);
  });

  it('planter leaves the center once his sequence played through', () => {
    assert.equal(isPlanterFinished({ captureDone: false, hasCaptureAnims: true }), false);
    assert.equal(isPlanterFinished({ captureDone: true, hasCaptureAnims: true }), true);
    assert.equal(isPlanterFinished({ captureDone: false, hasCaptureAnims: false }), true);
  });

  it('guard sequencer plays capture1 once then holds capture2', () => {
    assert.deepEqual(GUARD_CAPTURE_SEQUENCE, ['capture1', 'capture2']);
    assert.deepEqual(nextGuardCaptureStage(undefined, 'run', null), { stage: 0, want: 'capture1' });
    assert.deepEqual(nextGuardCaptureStage(0, 'capture1', 'capture1'), { stage: 0, want: 'capture1' });
    assert.deepEqual(nextGuardCaptureStage(0, null, 'capture1'), { stage: 1, want: 'capture2' });
    assert.deepEqual(nextGuardCaptureStage(1, 'capture2', 'capture2'), { stage: 1, want: 'capture2' });
    assert.deepEqual(nextGuardCaptureStage(1, null, 'capture2'), { stage: 1, want: 'capture2' });
    assert.deepEqual(nextGuardCaptureStage(0, null, null), { stage: 0, want: 'capture1' });
  });
});
