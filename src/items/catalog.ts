import catalog from '../../stats/dota/items.json';

export type DotaItem = typeof catalog.items[number];
export const dotaItems: DotaItem[] = catalog.items;
export const dotaItemById = new Map(dotaItems.map(item => [item.id, item]));
const recipesByResult = new Map<string, DotaItem[]>();
for (const item of dotaItems) {
  if (!item.recipe || !item.result || !item.components.some(parts => parts.some(Boolean))) continue;
  const recipes = recipesByResult.get(item.result) ?? [];
  recipes.push(item);
  recipesByResult.set(item.result, recipes);
}

export function itemRecipes(item: DotaItem): DotaItem[] {
  return item.recipe
    ? (item.result && recipesByResult.get(item.result)?.includes(item) ? [item] : [])
    : recipesByResult.get(item.id) ?? [];
}

export function recipeComponentIds(parts: string[]): string[] {
  return parts.map(part => part.trim().replace(/\*$/, '')).filter(Boolean);
}
export const itemCategories = [
  ['all', 'Все предметы'], ['equipment', 'Снаряжение'], ['components', 'Компоненты'],
  ['consumables', 'Расходуемые'], ['neutral', 'Нейтральные'], ['recipes', 'Рецепты'], ['special', 'Особые'],
] as const;
export function filterItems(category = 'all', search = ''): DotaItem[] {
  const query = search.trim().toLocaleLowerCase().replace(/_/g, ' ');
  return dotaItems.filter(item => (category === 'all' || item.category === category)
    && `${item.title} ${item.name.replace(/_/g, ' ')} ${item.description}`.toLocaleLowerCase().includes(query));
}
export function itemStatus(item: DotaItem): string {
  return item.purchasable ? `${item.cost} золота` : item.category === 'neutral' ? 'Нейтральный предмет' : item.recipe ? 'Автоматический рецепт' : 'Особый предмет';
}
