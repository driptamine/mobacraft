/**
 * Soldier facing decision. Pure math, no engine imports.
 *
 * - firing (standing or running) -> ease toward the aim angle, so the body
 *   and the muzzle flash agree with where the shots go;
 * - running without firing -> snap to the movement direction;
 * - idle -> ease toward the aim angle (squad facing + per-soldier offset).
 *
 * Angles in radians, deltaTime in seconds.
 */
/**
 * Planter capture sequence (slot names): two one-shot flag plants, then a
 * final one-shot capture clip, then idle. Each clip plays once per capture
 * effort (see _captureKey in systems.js). The rest of the squad plays
 * capture1 once, then replays its guardCaptureAnim clip until the point
 * is captured, then idles too.
 */
export const CAPTURE_SEQUENCE = ['flagPlant1', 'flagPlant2', 'capture1'];

export function nextCaptureStage(stage, currentAnim, prevPlayed) {
  const last = CAPTURE_SEQUENCE.length - 1;
  let s = Math.min(Math.max(stage || 0, 0), last);
  if (s < last && currentAnim === null && prevPlayed === CAPTURE_SEQUENCE[s]) {
    s += 1;
  }
  return { stage: s, want: CAPTURE_SEQUENCE[s] };
}

// A one-shot capture clip finished when it was the last thing played and
// nothing is playing anymore.
export function captureClipDone(want, prevPlayed, currentAnim) {
  return prevPlayed === want && currentAnim == null;
}

// Guards play capture1 once, then repeat capture2 (capture_strategic_point_2)
// until the point is captured (the planter is index 0 and never reaches
// this). The index stays so per-guard variety can return.
export function guardCaptureAnim(aliveIndex) {
  void aliveIndex;
  return 'capture2';
}

// Guard capture stages (slot names): stage 0 plays capture1 once and
// advances when it ends; stage 1 replays capture2 until the point flips.
export const GUARD_CAPTURE_SEQUENCE = ['capture1', 'capture2'];

export function nextGuardCaptureStage(stage, currentAnim, prevPlayed) {
  let s = stage === 1 ? 1 : 0;
  if (s === 0 && currentAnim == null && prevPlayed === GUARD_CAPTURE_SEQUENCE[0]) {
    s = 1;
  }
  return { stage: s, want: GUARD_CAPTURE_SEQUENCE[s] };
}

// The point assembly may rise once the planter finished flag_plant_2
// (planter stage 2+); units without plant clips skip the wait.
export function isPlantingDone({ captureStage, hasPlantAnims }) {
  if (!hasPlantAnims) {
    return true;
  }
  return (captureStage || 0) >= 2;
}

// The planter backs off the center once his whole sequence played through
// (units without capture clips leave right away instead of idling dead).
export function isPlanterFinished({ captureDone, hasCaptureAnims }) {
  return !!captureDone || !hasCaptureAnims;
}

// The point counts as captured for a squad once its team owns it.
export function isPointCapturedBy(spOwner, team) {
  return spOwner != null && spOwner === team;
}

// Capture positioning: the planter (first alive soldier) walks to the point
// center to plant the flag; the rest hold formation at a distance — any slot
// inside CAPTURE_GUARD_DISTANCE of the center is pushed radially out to it.
// Tune this to taste: guards hold no closer than this to a captured point.
export const CAPTURE_GUARD_DISTANCE = 10.0;
// Post-plant stand-off: after flag_plant_2 the planter backs away from the
// center toward his squad but stays on the point (inside the 4.5 capture
// radius) so progress keeps ticking. Tune to taste.
export const PLANTER_STAND_DISTANCE = 4.0;

export function planterStandTarget({ centerX, centerZ, squadX, squadZ, standDistance = PLANTER_STAND_DISTANCE }) {
  let dx = squadX - centerX;
  let dz = squadZ - centerZ;
  if (Math.hypot(dx, dz) < 1e-6) {
    dx = 1;
    dz = 0;
  }
  const inv = 1 / Math.hypot(dx, dz);
  return { x: centerX + dx * inv * standDistance, z: centerZ + dz * inv * standDistance };
}
// Planter pace toward the point: no catch-up bonus, so the flag run reads
// as a deliberate advance instead of a sprint. Tune to taste.
export const PLANTER_SPEED_MULT = 1.0;

export function captureSlotTarget({ isPlanter, slotX, slotZ, centerX, centerZ, soldierX, soldierZ, minDistance = CAPTURE_GUARD_DISTANCE }) {
  if (isPlanter) {
    return { x: centerX, z: centerZ };
  }
  let dx = slotX - centerX;
  let dz = slotZ - centerZ;
  if (Math.hypot(dx, dz) >= minDistance) {
    return { x: slotX, z: slotZ };
  }
  if (Math.hypot(dx, dz) < 1e-6) {
    dx = soldierX - centerX;
    dz = soldierZ - centerZ;
  }
  if (Math.hypot(dx, dz) < 1e-6) {
    dx = 1;
    dz = 0;
  }
  const inv = 1 / Math.hypot(dx, dz);
  return { x: centerX + dx * inv * minDistance, z: centerZ + dz * inv * minDistance };
}

// Capture hold: a squad ordered onto a point halts at guard distance instead
// of marching everybody in — only the planter walks to the center.
export function shouldHoldForCapture({ orderX, orderZ, squadX, squadZ, spX, spZ, captureRadius, guardDistance = CAPTURE_GUARD_DISTANCE }) {
  const orderOnPoint = Math.hypot(orderX - spX, orderZ - spZ) < captureRadius;
  const holdingRange = Math.hypot(squadX - spX, squadZ - spZ) <= guardDistance;
  return orderOnPoint && holdingRange;
}

// Engagement (slots + point anims) needs boots on the point or a held order;
// progress itself needs boots on the point — a bare order must not cap.
export function isCaptureEngaged({ squadInside, soldierInside, orderedHold }) {
  return squadInside || soldierInside || orderedHold;
}

// Fleeing: running away from the aim direction (more than 90° apart) — the
// soldier keeps facing where it runs instead of twisting back to fire.
export function isFleeingMove(moveAngle, aimAngle) {
  return Math.cos(moveAngle - aimAngle) < 0;
}

export function computeSoldierYaw({ shooting, moving, moveAngle, aimAngle, currentYaw, deltaTime, fleeing = false }) {
  if (!fleeing && (!moving || shooting)) {
    let dy = aimAngle - currentYaw;
    while (dy > Math.PI) {
      dy -= Math.PI * 2;
    }
    while (dy < -Math.PI) {
      dy += Math.PI * 2;
    }
    return currentYaw + dy * (1 - Math.exp(-8 * deltaTime));
  }
  return moveAngle;
}
