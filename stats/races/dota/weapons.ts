import type { WeaponProfile } from '../../../src/combat/stats.js';

export const CREEP_RANGED: WeaponProfile = {
  name: 'Ranged creep attack', range: 12, refire: 1, accuracy: 1,
  dps: { infantry_low: 24, infantry_med: 24, vehicle_low: 12, building_med: 12 },
};

export const CREEP_SIEGE: WeaponProfile = {
  name: 'Siege creep attack', range: 18, refire: 3, accuracy: 1,
  dps: {
    infantry_low: 12, infantry_med: 12, vehicle_low: 18,
    building_low: 60, building_med: 60, building_high: 60,
  },
};
