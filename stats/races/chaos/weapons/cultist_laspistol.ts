import type { WeaponProfile } from '../../../../src/combat/stats.js';

// Wiki: Cultist Squad — Laspistol (Range 20, Accuracy 40%, Refire 0.5 s).
export const CULTIST_LASPISTOL: WeaponProfile = {
  name: 'Cultist Laspistol',
  range: 20,
  refire: 0.5,
  accuracy: 0.4,
  dps: {
    infantry_low: 2.9, infantry_med: 3.8, infantry_high: 2.7,
    infantry_hmed: 2.4, infantry_hhi: 1.2, infantry_cmdr: 1.2,
    vehicle_low: 1.2, vehicle_med: 1.2, vehicle_high: 1.2, vehicle_air: 1.2,
    building_low: 1.4, building_med: 1.2, building_high: 1.2,
    daemon_med: 1.2, daemon_high: 1.2,
  },
  moraleDps: 1.2,
  baseDamage: { dps: 3, min: 8, max: 9, minD: 1.5 },
};
