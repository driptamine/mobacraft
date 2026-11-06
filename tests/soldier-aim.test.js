import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSoldierYaw, isFleeingMove } from '../src/soldier-aim.js';

describe('soldier aim yaw', () => {
  it('snaps to movement direction when running without firing', () => {
    assert.equal(
      computeSoldierYaw({ shooting: false, moving: true, moveAngle: 1.2, aimAngle: -0.5, currentYaw: 0, deltaTime: 0.016 }),
      1.2,
    );
  });

  it('eases toward aim when firing on the move', () => {
    const yaw = computeSoldierYaw({ shooting: true, moving: true, moveAngle: Math.PI / 2, aimAngle: 0, currentYaw: Math.PI / 2, deltaTime: 0.016 });
    assert.ok(yaw < Math.PI / 2 && yaw > 0, `turns from run dir toward aim, got ${yaw}`);
    // Converges near the aim within one 0.4s shoot window.
    let y = Math.PI / 2;
    for (let t = 0; t < 0.4; t += 0.016) {
      y = computeSoldierYaw({ shooting: true, moving: true, moveAngle: Math.PI / 2, aimAngle: 0, currentYaw: y, deltaTime: 0.016 });
    }
    assert.ok(Math.abs(y) < 0.1, `converged to aim, got ${y}`);
  });

  it('eases toward aim when idle (unchanged behavior)', () => {
    const yaw = computeSoldierYaw({ shooting: false, moving: false, moveAngle: 0, aimAngle: 1, currentYaw: 0, deltaTime: 0.016 });
    assert.ok(yaw > 0 && yaw < 1, `eases toward aim, got ${yaw}`);
  });

  it('takes the short way around the circle', () => {
    const yaw = computeSoldierYaw({ shooting: true, moving: true, moveAngle: 0, aimAngle: Math.PI - 0.1, currentYaw: -Math.PI + 0.1, deltaTime: 0.016 });
    assert.ok(yaw < -Math.PI + 0.1, `wraps the short way, got ${yaw}`);
  });

  it('detects running away from the aim direction', () => {
    assert.equal(isFleeingMove(0, 0), false);
    assert.equal(isFleeingMove(0.5, 0), false);
    assert.equal(isFleeingMove(Math.PI / 2, 0), false);
    assert.equal(isFleeingMove(Math.PI / 2 + 0.1, 0), true);
    assert.equal(isFleeingMove(Math.PI, 0), true);
  });

  it('faces movement while fleeing even when firing', () => {
    assert.equal(
      computeSoldierYaw({ shooting: true, moving: true, moveAngle: 1.2, aimAngle: -1.2, currentYaw: 0, deltaTime: 0.016, fleeing: true }),
      1.2,
    );
  });

  it('still aims on the run when advancing (not fleeing)', () => {
    const yaw = computeSoldierYaw({ shooting: true, moving: true, moveAngle: 0.2, aimAngle: 0, currentYaw: 0.2, deltaTime: 0.016, fleeing: false });
    assert.ok(yaw < 0.2 && yaw > -0.1, `turns toward aim, got ${yaw}`);
  });
});
