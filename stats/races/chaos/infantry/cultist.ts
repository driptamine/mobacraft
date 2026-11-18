import type { UnitStats } from '../../../types.js';
import infantries from '../../../../animations/chaos/chaos_infantries.json';

export const cultist: UnitStats = {
  name: 'cultist',
  model: 'models/chaos/infantry/cultist.glb',
  animations: (infantries as Record<string, unknown>)['cultist.glb'],
  icon: 'assets/icons/Chaos/Units/Basic/cultist_icon.png',
  cost: 50,
  time: 12.5,
  hp: 90,
  armor: 'infantry_low',
  weapon: 'cultist_laspistol',
  size: 4,
  reinforceCost: 10,
  reinforceTime: 6,
};
