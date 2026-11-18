// Compile the declarative strategy tables from the supplied Dawn of War AI.
// The original Lua remains source data; no Lua/Node simulation runs online.
// Run: node --import tsx scripts/compile-ai.mjs [--go-dir ../grimcraft-go]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function parseLuaTable(source, name) {
  if (!/^[A-Za-z_]\w*$/.test(name)) throw Error(`Invalid Lua table name ${name}`);
  const assignment = new RegExp('\\b' + name + '\\s*=\\s*\\{').exec(source);
  if (!assignment) throw Error(`Missing Lua table ${name}`);
  const start = assignment.index + assignment[0].lastIndexOf('{');
  const tokens = source.slice(start).match(/--[^\r\n]*|\s+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\d*\.?\d+(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|./g)
    .filter(token => !/^\s+$/.test(token) && !token.startsWith('--'));
  let cursor = 0;
  function value() {
    const token = tokens[cursor++];
    if (token === '{') {
      const entries = [], fields = {};
      while (tokens[cursor] !== '}') {
        if (tokens[cursor + 1] === '=') { const key = tokens[cursor]; cursor += 2; fields[key] = value(); }
        else entries.push(value());
        if (tokens[cursor] === ',' || tokens[cursor] === ';') cursor++;
        if (cursor >= tokens.length) throw Error(`Unclosed Lua table ${name}`);
      }
      cursor++;
      if (entries.length && Object.keys(fields).length) throw Error(`Mixed Lua table ${name}`);
      return entries.length ? entries : fields;
    }
    if (token === '-') return -value();
    if (token === 'INT_MAX') return 2147483647;
    if (token === 'true' || token === 'false') return token === 'true';
    if (token === 'nil') return null;
    if (/^["']/.test(token)) return token.slice(1, -1).replace(/\\([\\"'])/g, '$1');
    if (/^\d*\.?\d/.test(token)) return Number(token);
    throw Error(`Unsupported Lua value ${token} in ${name}`);
  }
  return value();
}

const races = { ig: ['ig', 'guard_race'], chaos: ['chaos', 'chaos_marine_race'], 'space marines': ['space-marines', 'space_marine_race'], orks: ['orks', 'ork_race'], necrons: ['necrons', 'necron_race'], eldar: ['eldar', 'eldar_race'], 'dark eldar': ['dark-eldar', 'dark_eldar_race'], tau: ['tau', 'tau_race'], sob: ['sob', 'sisters_race'] };
const aliases = {
  guard_squad_guardsmen: 'guardsmen', guard_squad_enginseer: 'builder', guard_squad_commissar: 'commissar', guard_squad_command_squad: 'imperial_captain', guard_infantry: 'infantry_command', guard_tactica: 'tactica_control', guard_plasma_generator: 'plasma_generator',
  space_marine_squad_tactical: 'space_marine', space_marine_squad_servitor: 'builder', space_marine_barracks: 'barracks',
  chaos_marine_squad: 'chaos_space_marine', chaos_squad_slave: 'builder', chaos_squad_bloodthirster: 'bloodthirster',
  ork_squad_grot: 'builder', ork_squad_slugga: 'boyz', ork_squad_shoota: 'boyz_shoota', ork_boy_hut: 'da_boyz_hut', ork_waagh_banner: 'waagh_banner', ork_pile_o_guns: 'pile_o_guns', ork_mek_shop: 'mek_shop',
  necron_builder_scarab_squad: 'builder', necron_basic_warrior_squad: 'necron_basic_warrior', necron_plasma_generator: 'plasma_generator',
  eldar_guardian_squad: 'guardian', eldar_squad_bonesinger: 'builder', eldar_aspect_portal: 'aspect_portal', eldar_squad_dark_reaper: 'dark_reaper',
  tau_fire_warrior_squad: 'fire_warrior', tau_earth_caste_builder_squad: 'builder',
  sisters_squad_servitor: 'builder', sisters_squad_battle_sister: 'battle_sister', sisters_infantry: 'ecclesiarchal_chapel',
  dark_eldar_squad_slave: 'builder', dark_eldar_squad_warrior: 'warrior',
};
const basename = file => path.posix.basename(file || '', '.glb');
function filesBelow(folder) { return fs.readdirSync(folder, { recursive: true }).filter(file => file.endsWith('.ai')).sort(); }
export async function compileAI() {
  const read = file => fs.readFileSync(path.join(root, 'ai', file), 'utf8');
  const sourceFiles = filesBelow(path.join(root, 'ai'));
  const sourceHash = crypto.createHash('sha256');
  for (const file of sourceFiles) sourceHash.update(file).update(read(file));
  const interval = Number(read('default.ai').match(/Rule_AddInterval\(AI_Think,\s*([\d.]+)\)/)?.[1]);
  if (!(interval > 0)) throw Error('AI_Think interval is missing');
  const result = { version: 1, sourceHash: sourceHash.digest('hex'), sourceFiles, thinkInterval: interval, factions: {}, difficulties: {} };
  for (const [faction, [file]] of Object.entries(races)) {
    const { default: config } = await import(path.join(root, `src/factions/${file}.ts`));
    const units = [...(config.infantry || []).slice(1), ...(config.units || [])].map(unit => ({
      type: basename(unit.model), name: unit.name, cost: unit.cost ?? 100, power: unit.power ?? 0, time: unit.time ?? 3,
      size: unit.size ?? 5, maxSize: unit.squadSize ?? unit.size ?? 5, hp: unit.hp ?? 100,
      reinforceCost: unit.reinforceCost ?? 20, reinforceTime: unit.reinforceTime ?? 7,
    }));
    const structures = (config.structures || []).filter(entry => entry.type && entry.type !== 'hq-anim').map(entry => ({
      type: entry.type, cost: entry.cost ?? 100, time: entry.time ?? 8,
      generator: /generator|energy_core/.test(entry.type),
      production: (entry.production || []).filter(item => typeof item === 'object' && item.name).map(item => item.name),
    }));
    if (!structures.some(entry => entry.type === 'hq')) structures.unshift({ type: 'hq', cost: 300, time: 15, generator: false, production: [] });
    // Tech progression past the opening (wiki build order): the faction's own
    // build grid, falling back to its structure list, minus the starting HQ
    // and listening posts (those have dedicated logic).
    const hqBase = basename(config.hq || '');
    const techOrder = ((config.buildOrder && config.buildOrder.length ? config.buildOrder : (config.structures || []).map(entry => entry.type)) || [])
      .filter(type => typeof type === 'string' && type !== 'hq' && type !== 'hq-anim' && type !== hqBase
        && type !== 'listening_post' && !type.startsWith('tau_listening_post'));
    result.factions[faction] = { units, structures, workerCost: config.infantry?.[0]?.cost ?? 80, workerTime: config.infantry?.[0]?.time ?? 2, techOrder };
  }
  for (const difficulty of ['easy', 'standard', 'advanced', 'hard']) {
    const prefix = `strategies/${difficulty}/`;
    const attack = parseLuaTable(read(prefix + 'attackstrategyinfo.ai'), 'AttackStrategyInfo');
    const base = parseLuaTable(read(prefix + 'buildbasestrategyinfo.ai'), 'BuildBaseStrategyInfo');
    const orders = parseLuaTable(read(prefix + 'buildorderstrategyinfo.ai'), 'BuildOrderStrategyInfo');
    result.difficulties[difficulty] = {};
    for (const [faction, [, race]] of Object.entries(races)) {
      const catalog = result.factions[faction], settings = base[race], military = attack[race];
      if (!settings || !military || !Array.isArray(orders[race])) throw Error(`Missing ${difficulty}/${race} strategy`);
      const opening = [], unsupported = [];
      for (const [kind, blueprint] of orders[race]) {
        const translated = aliases[blueprint] || blueprint;
        if (kind === 'flag_capture' || kind === 'post_builder') opening.push({ kind });
        else if (kind === 'building' && catalog.structures.some(entry => entry.type === translated)) opening.push({ kind: 'build', type: translated });
        else if (kind === 'squad' && (translated === 'builder' || catalog.units.some(entry => entry.type === translated))) opening.push({ kind: 'train', type: translated });
        else unsupported.push({ kind, blueprint });
      }
      result.difficulties[difficulty][faction] = {
        capturers: settings.resource_capturers ?? 1, engineers: settings.engineer_count ?? 2,
        pointLimit: settings.limit_strategic_points_percentage ?? 1,
        minAttackSquads: military.min_units ?? 2,
        armyBudget: military.max_army_size ?? 1500 * (military.max_army_percentage ?? settings.max_army_percentage ?? 1),
        stopAttackRating: military.stop_attack_rating ?? -100,
        noResearch: !!settings.no_research, noSecondaryBuildings: !!settings.no_secondary_buildings,
        opening, unsupported,
      };
    }
  }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profile = await compileAI(), output = JSON.stringify(profile, null, 2) + '\n';
  fs.writeFileSync(path.join(root, 'ai/profiles.json'), output);
  const flag = process.argv.indexOf('--go-dir');
  if (flag !== -1) { const target = path.resolve(process.argv[flag + 1], 'internal/botai'); fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'profiles.json'), output); }
  console.log(`Compiled ${profile.sourceFiles.length} AI sources: ${Object.keys(races).length} factions × 4 difficulties, ${profile.thinkInterval}s think interval.`);
}
