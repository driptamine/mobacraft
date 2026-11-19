import type { UnitStats } from '../types.js';
import catalog from '../../animations/heroes.json';
import { batch1Heroes } from './batch1/heroes.js';

export interface RecruitableHero extends UnitStats {
  name: string;
  title: string;
  batch: number;
  available: boolean;
}

interface CatalogEntry {
  title: string;
  batch: number;
  model: string | null;
  actions: Record<string, string>;
  icon: string;
  ranged: boolean;
}

const entries: Record<string, CatalogEntry> = catalog;

export const heroRoster: RecruitableHero[] = [
  ...batch1Heroes.map((hero) => ({ ...hero, name: hero.name!, title: hero.name!.replace(/_/g, ' '), batch: 1, available: true })),
  ...Object.entries(entries).map(([name, entry]): RecruitableHero => ({
    name,
    title: entry.title,
    batch: entry.batch,
    available: !!entry.model,
    model: entry.model || undefined,
    animations: entry.actions,
    icon: entry.icon,
    lazyLoad: true,
    cost: entry.ranged ? 175 : 200,
    time: 20,
    hp: entry.ranged ? 700 : 950,
    armor: 'infantry_hmed',
    weapon: entry.ranged ? 'lasgun' : 'sword',
    attackRange: entry.ranged ? 30 : 3,
    size: 1,
    squadSize: 1,
    movementSpeedMultiplier: 1.3,
  })),
];

export const recruitableHeroes = heroRoster.filter((hero) => hero.available);
export const heroNames = new Set(heroRoster.map((hero) => hero.name));
export const heroBatches = [...new Set(heroRoster.map((hero) => hero.batch))].sort((a, b) => a - b);

export function filterHeroes(batch: number | null, search: string): RecruitableHero[] {
  const query = search.trim().toLowerCase().replace(/_/g, ' ');
  return heroRoster.filter((hero) => (batch === null || hero.batch === batch)
    && `${hero.title} ${hero.name.replace(/_/g, ' ')}`.toLowerCase().includes(query));
}
