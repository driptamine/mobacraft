import type { UnitStats } from '../../../types.js';
import infantries from '../../../../animations/space-marines/space_marines_infantries.json';

export const scout: UnitStats = {
  name: 'scout',
  model: 'models/space marines/troops/scout.glb',
  animations: (infantries as Record<string, unknown>)['scout.glb'],
  icon: 'assets/icons/Space Marines/Units/Basic/scoutmarine_icon.png',
  cost: 75,
  time: 12,
  hp: 100,
  armor: 'infantry_med',
  weapon: 'scout_bolter',
  size: 4,
  reinforceCost: 15,
  reinforceTime: 6,
};
