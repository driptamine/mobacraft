// Extract official item data + Panorama icons from the installed Dota VPK.
// source2viewer (ValveResourceFormat) must be on PATH; --refresh re-extracts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseKeyValues } from './valve-keyvalues.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const vpk = args.find(arg => !arg.startsWith('--')) || path.join(os.homedir(), 'Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/pak01_dir.vpk');
const cache = path.join(root, 'tmp/dota-items-source');
const definitionPath = path.join(cache, 'scripts/npc/items.txt');
if (args.includes('--refresh') || !fs.existsSync(definitionPath)) {
  execFileSync('source2viewer', ['-i', vpk, '-o', cache, '--vpk_filepath', 'scripts/npc/items.txt,resource/localization/abilities_english.txt,resource/localization/abilities_russian.txt,panorama/images/items/', '--decompile', '--threads', '4'], { stdio: 'inherit' });
}
const definitions = parseKeyValues(fs.readFileSync(definitionPath, 'utf8')).DOTAAbilities;
function localization(language) {
  const file = path.join(cache, `resource/localization/abilities_${language}.txt`);
  const tokens = fs.existsSync(file) ? parseKeyValues(fs.readFileSync(file, 'utf8')).lang.Tokens : {};
  return Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key.toLowerCase(), value]));
}
const english = localization('english'), russian = localization('russian');
function clean(text = '') {
  return String(text).replace(/<br\s*\/?\s*>|<\/h[1-6]>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
}
const number = value => Number.parseFloat(typeof value === 'object' ? value?.value : value) || 0;
const icons = new Set();
const entries = Object.entries(definitions).filter(([key, value]) => key.startsWith('item_') && typeof value === 'object');
const items = entries.map(([id, definition]) => {
  const name = id.slice(5), recipe = definition.ItemRecipe === '1';
  const values = definition.AbilityValues || {};
  const specials = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'object' ? String(value.value ?? '') : String(value)]));
  function description(tokens, suffix) {
    return clean((tokens[`dota_tooltip_ability_${id}${suffix}`] || '').replace(/%([a-z0-9_]+)%/gi, (match, key) => specials[key] || match));
  }
  const neutral = definition.ItemIsNeutralActiveDrop === '1' || definition.ItemIsNeutralPassiveDrop === '1';
  const cost = number(definition.ItemCost);
  const category = recipe ? 'recipes' : neutral ? 'neutral' : definition.ItemPurchasable === '0' || (!cost && id !== 'item_ward_observer') ? 'special' : definition.ItemQuality === 'consumable' ? 'consumables' : ['component', 'common', 'secret_shop'].includes(definition.ItemQuality) ? 'components' : 'equipment';
  const iconName = recipe ? 'recipe' : name;
  const sourceIcon = path.join(cache, `panorama/images/items/${iconName}_png.png`);
  const bytes = fs.readFileSync(sourceIcon);
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Invalid icon: ${sourceIcon}`);
  const icon = `assets/items/${iconName}.png`;
  fs.mkdirSync(path.dirname(path.join(root, icon)), { recursive: true });
  fs.copyFileSync(sourceIcon, path.join(root, icon)); icons.add(icon);
  const attributes = Object.entries(values).filter(([key]) => key.startsWith('bonus_') || ['health_regen', 'hp_regen', 'mana_regen'].includes(key)).map(([key, value]) => ({ key, value: typeof value === 'object' ? String(value.value ?? '') : String(value), label: clean(english[`dota_tooltip_ability_${id}_${key}`] || key.replace(/_/g, ' ')) }));
  return {
    id, name, title: clean(english[`dota_tooltip_ability_${id}`] || name.replace(/_/g, ' ')),
    icon, iconSource: `panorama/images/items/${iconName}_png.vtex_c`, cost, category,
    purchasable: definition.ItemPurchasable !== '0' && (cost > 0 || id === 'item_ward_observer'),
    sellable: definition.ItemSellable !== '0', recipe, result: definition.ItemResult || null,
    components: Object.values(definition.ItemRequirements || {}).map(value => value.split(';')),
    description: description(russian, '_description') || description(english, '_description'),
    descriptionEnglish: description(english, '_description'), lore: description(russian, '_lore') || description(english, '_lore'),
    attributes, values: specials,
    passive: {
      health: number(values.bonus_health), strength: number(values.bonus_strength) + number(values.bonus_all_stats),
      agility: number(values.bonus_agility) + number(values.bonus_all_stats), intelligence: number(values.bonus_intellect) + number(values.bonus_intelligence) + number(values.bonus_all_stats),
      damage: number(values.bonus_damage), armor: number(values.bonus_armor), attackSpeed: number(values.bonus_attack_speed),
      movementSpeed: number(values.bonus_movement_speed) || number(values.bonus_movement),
      movementPercent: number(values.bonus_movement_speed_pct), healthRegen: number(values.bonus_health_regen) || number(values.health_regen),
    },
    behavior: definition.AbilityBehavior || '', initialCharges: number(definition.ItemInitialCharges), stackable: definition.ItemStackable === '1',
  };
}).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
const output = path.join(root, 'stats/dota/items.json'); fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ source: { archive: 'game/dota/pak01_dir.vpk', definitions: 'scripts/npc/items.txt', localization: 'resource/localization/abilities_{english,russian}.txt', icons: 'panorama/images/items/', tool: 'Source 2 Viewer / ValveResourceFormat', url: 'https://s2v.app/' }, itemCount: items.length, iconCount: icons.size, items }, null, 2) + '\n');
console.log(`Built ${items.length} Dota items (${items.filter(item => item.recipe).length} recipes), ${icons.size} official icons.`);
