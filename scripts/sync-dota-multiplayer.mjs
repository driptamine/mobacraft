// Keep the Go match data aligned with the client without shipping render assets.
import fs from 'node:fs';
import path from 'node:path';
import { recruitableHeroes } from '../stats/races/heroes.ts';
import { laneCreeps } from '../stats/races/dota/creeps.ts';

const server = process.argv[2] ?? '../mobacraft-go';
const map = JSON.parse(fs.readFileSync(new URL('../maps/dotamap-game/map.json', import.meta.url)));
const surface = JSON.parse(fs.readFileSync(new URL('../maps/dotamap-game/surface.json', import.meta.url)));
const point = ({ x, z }) => ({ x, z });
const write = (file, data) => fs.writeFileSync(path.join(server, 'internal/sim', file), JSON.stringify(data) + '\n');
const lanes = Object.fromEntries(Object.entries(map.lanes).map(([team, routes]) => [team,
  Object.fromEntries(Object.entries(routes).map(([name, points]) => [name, points.map(point)]))]));
write('maps/dotamap-game.json', {
  name: map.name, bounds: map.bounds, positions: map.positions.map(({ x, z, team }) => ({ x, z, team })),
  heroStarts: map.heroStarts, lanes,
});
write('data/dota-nav.json', { grid: surface.grid, rows: surface.rows });
const unit = stats => ({ hp: stats.hp, range: stats.attackRange, melee: stats.weapon === 'sword', speed: 6 * stats.movementSpeedMultiplier });
write('data/dota-units.json', {
  heroes: Object.fromEntries(recruitableHeroes.map(hero => [hero.name, unit(hero)])),
  creeps: Object.fromEntries(laneCreeps.map(creep => [creep.name, { ...unit(creep), speed: 5.5 }])),
});
