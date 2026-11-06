// Pure per-decal world-size mapping for SGB decals. No engine imports so
// plain `node --test` can cover it (sgb-decals.js itself needs Vite/DOM).
//
// The SGB DATAENTY chunk stores a per-decal `size` float (~0.02–0.11).
// Chaos taint keeps the legacy flat size byte-for-byte — it renders as
// huge ground sheets and must not change. Every other decal maps
// proportionally, with the same calibration as the layout-driven path
// (size 0.05 ≈ 50 world units at the default decal scale 12).
const CHAOS_MATCH = 'chaos';

export function isChaosDecal(path) {
  return String(path || '').includes(CHAOS_MATCH);
}

export function decalBaseSize(path, sizeRaw) {
  if (isChaosDecal(path)) {
    return Math.max(0.5, sizeRaw) / 0.05;
  }
  return sizeRaw * 1000 / 12;
}
