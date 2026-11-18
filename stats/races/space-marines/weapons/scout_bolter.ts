import type { WeaponProfile } from '../../../../src/combat/stats.js';

// Wiki: Scout Marine Squad — Bolter (Range 25, Accuracy 85%, Refire 0.8 s).
// Weaker than the tactical Bolter, hence its own profile.
export const SCOUT_BOLTER: WeaponProfile = {
  name: 'Scout Bolter',
  range: 25,
  refire: 0.8,
  accuracy: 0.85,
  dps: {
    infantry_low: 7.6, infantry_med: 7.1, infantry_high: 7.7,
    infantry_hmed: 6.2, infantry_hhi: 3.1, infantry_cmdr: 1.1,
    vehicle_low: 1.1, vehicle_med: 1.1, vehicle_high: 1.1, vehicle_air: 1.1,
    building_low: 3.4, building_med: 1.1, building_high: 1.1,
    daemon_med: 6.7, daemon_high: 1.1,
  },
  moraleDps: 2.1,
  baseDamage: { dps: 4, min: 10.6, max: 12.9, minD: 1 },
};
