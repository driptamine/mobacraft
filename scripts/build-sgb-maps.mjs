// Batch-port the remaining SGB maps using maps/all_tiles as the asset pack.
// Per map (maps/<dir>/<dir>.sgb) without layout.json:
//   layout.json + <map>_heightmap.png + textures/*.png + decals/*.png
//   <map>_path.json (passability sidecar)
//   <map>.json gameplay file (name/bounds/positions/strategicPoints)
//   README.md
// Usage: node --import tsx scripts/build-sgb-maps.mjs [--only a,b] [--force]
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { extractSgbLayout, writeSgbLayout, encodePng } from './extract-sgb-layout.mjs';
import { extractSgbPath } from './extract-sgb-path.mjs';

const MAPS = 'maps';
const TILES = join(MAPS, 'all_tiles/textures');
const DECALS = join(MAPS, 'all_tiles/decals-all');
const SKIP = new Set(['all_tiles', 'default_arena', 'gmp', 'tiles', '6p_alvarus']);
const BLUE = ['ig', 'space marines', 'eldar', 'sob', 'tau', 'necrons'];
const RED = ['chaos', 'orks', 'necrons', 'dark eldar', 'sob', 'tau'];

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx !== -1 ? new Set(args[onlyIdx + 1].split(',')) : null;
const force = args.includes('--force');

// Minimal BC3/DXT5 decoder (opaque-or-gradient alpha + RGB565 color block).
function decodeDXT5(bytes, width, height) {
  const out = Buffer.alloc(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  for (let by = 0; by < Math.ceil(height / 4); by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const o = (by * blocksX + bx) * 16;
      const a0 = bytes[o], a1 = bytes[o + 1];
      const alphaBits = bytes.readUIntLE(o + 2, 6);
      const c0 = bytes.readUInt16LE(o + 8), c1 = bytes.readUInt16LE(o + 12);
      const lut = decode565(c0), lut1 = decode565(c1);
      const r = [lut[0], lut1[0]], g = [lut[1], lut1[1]], b = [lut[2], lut1[2]];
      if (c0 > c1) {
        r.push(Math.round((2 * r[0] + r[1]) / 3), Math.round((r[0] + 2 * r[1]) / 3));
        g.push(Math.round((2 * g[0] + g[1]) / 3), Math.round((g[0] + 2 * g[1]) / 3));
        b.push(Math.round((2 * b[0] + b[1]) / 3), Math.round((b[0] + 2 * b[1]) / 3));
      } else {
        r.push(Math.round((r[0] + r[1]) / 2), 0); g.push(Math.round((g[0] + g[1]) / 2), 0); b.push(Math.round((b[0] + b[1]) / 2), 0);
      }
      const alpha = [a0, a1];
      if (a0 > a1) for (let i = 2; i < 8; i++) alpha.push(Math.round(((8 - i) * a0 + (i - 1) * a1) / 7));
      else { for (let i = 2; i < 6; i++) alpha.push(Math.round(((6 - i) * a0 + (i - 1) * a1) / 5)); alpha.push(0, 255); }
      for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
        const x = bx * 4 + px, y = by * 4 + py;
        if (x >= width || y >= height) continue;
        const ci = (bytes.readUInt32LE(o + 12) >> ((py * 4 + px) * 2)) & 3;
        const ai = Number((BigInt(alphaBits) >> BigInt((py * 4 + px) * 3)) & 7n);
        const p = (y * width + x) * 4;
        out[p] = r[ci]; out[p + 1] = g[ci]; out[p + 2] = b[ci]; out[p + 3] = alpha[ai];
      }
    }
  }
  return out;
}
function decode565(v) {
  return [Math.round(((v >> 11) & 31) * 255 / 31), Math.round(((v >> 5) & 63) * 255 / 63), Math.round((v & 31) * 255 / 31)];
}
function ddsTopMip(path) {
  const d = readFileSync(path);
  if (d.toString('ascii', 0, 4) !== 'DDS ') throw new Error('not a DDS: ' + path);
  const fourcc = d.toString('ascii', 84, 88);
  if (fourcc !== 'DXT5') throw new Error('unsupported DDS codec ' + fourcc + ': ' + path);
  const height = d.readUInt32LE(12), width = d.readUInt32LE(16);
  return { width, height, pixels: decodeDXT5(d.subarray(128), width, height) };
}

function findTga(base, roots) {
  for (const root of roots) {
    const direct = join(root, base + '.tga');
    if (existsSync(direct)) return direct;
  }
  // basename anywhere under decals-all
  const stack = [DECALS];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) stack.push(join(dir, e.name));
      else if (e.isFile() && e.name.toLowerCase() === base.toLowerCase() + '.tga') return join(dir, e.name);
    }
  }
  return null;
}

// world = (-z_sgb, -x_sgb): 90-degree yaw + horizontal mirror of the map root.
const toWorld = (x, z) => ({ x: -z, z: -x });
const round2 = (v) => Math.round(v * 100) / 100;

function buildMap(dir) {
  const folder = join(MAPS, dir);
  const sgbPath = join(folder, dir + '.sgb');
  const { layout, heightData } = extractSgbLayout(readFileSync(sgbPath), dir + '.sgb');

  // Stage only the TGAs this map references.
  const stage = `/tmp/sgb-stage/${dir}`;
  const stageTex = join(stage, 'textures'), stageDec = join(stage, 'decals');
  mkdirSync(stageTex, { recursive: true }); mkdirSync(stageDec, { recursive: true });
  const texRefs = [...new Set(layout.terrain.detail_textures.map(t => t.path.split('/').pop()))];
  const decRefs = [...new Set(layout.decals.map(d => d.ref.replace(/^art\/decals\//, '')))];
  const missing = [];
  for (const base of texRefs) {
    const src = join(TILES, base + '.tga');
    if (existsSync(src)) copyFileSync(src, join(stageTex, base + '.tga'));
    else missing.push('texture:' + base);
  }
  const ddsOnly = [];
  for (const ref of decRefs) {
    const base = ref.split('/').pop();
    const exact = join(DECALS, ref + '.tga');
    if (existsSync(exact)) { copyFileSync(exact, join(stageDec, base + '.tga')); continue; }
    const found = findTga(base, [DECALS]);
    if (found) copyFileSync(found, join(stageDec, base + '.tga'));
    else ddsOnly.push({ ref, base });
  }
  // DDS-only refs: decode straight to the map's decals folder.
  mkdirSync(join(folder, 'decals'), { recursive: true });
  for (const { base } of ddsOnly) {
    const stack = [DECALS]; let dds = null;
    while (stack.length && !dds) {
      const d = stack.pop();
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) stack.push(join(d, e.name));
        else if (e.isFile() && e.name.toLowerCase() === base.toLowerCase() + '.dds') dds = join(d, e.name);
      }
    }
    if (dds) {
      const { width, height, pixels } = ddsTopMip(dds);
      writeFileSync(join(folder, 'decals', base + '.png'), encodePng(width, height, pixels, 4));
    } else missing.push('decal:' + base);
  }

  writeSgbLayout(sgbPath, { assetsDir: stage });

  // Passability sidecar, same framing as the CLI.
  const doc = extractSgbPath(readFileSync(sgbPath), dir);
  const head = JSON.stringify({ ...doc, rows: undefined }, null, 2).replace(/\n\}$/, '');
  const body = '"rows": [\n' + doc.rows.map(row => '    [' + row.join(', ') + ']').join(',\n') + '\n  ]\n}';
  writeFileSync(join(folder, `${dir}_path.json`), head + ',\n  ' + body + '\n');

  // Gameplay file from authored entities.
  const starts = layout.entities.filter(e => e.blueprint === 'starting_position');
  const half = Math.max(1, Math.round(starts.length / 2));
  const positions = starts.map((e, i) => {
    const w = toWorld(e.x, e.z);
    const team = i < half ? 'blue' : 'red';
    const pool = team === 'blue' ? BLUE : RED;
    return { x: round2(w.x), z: round2(w.z), team, faction: pool[i % pool.length] };
  });
  // Blue slot 0 is the human default: keep Imperial Guard first on blue.
  if (positions.length && positions[0].team === 'blue') positions[0].faction = 'ig';
  const kindOf = (b) => b === 'relic_struct' ? 'relic' : b === 'strategic_objective_struct' ? 'objective' : 'point';
  const strategicPoints = layout.entities
    .filter(e => ['strategic_point_flag', 'relic_struct', 'strategic_objective_struct'].includes(e.blueprint))
    .map(e => { const w = toWorld(e.x, e.z); return { x: round2(w.x), z: round2(w.z), kind: kindOf(e.blueprint) }; });
  // scenario_name is usually a "$..." localization key; existing gameplay
  // files use the plain map name ("Parmenie", "Burial Grounds").
  const scenario = layout.metadata.scenario_name || '';
  const name = /^\$/.test(scenario) || !scenario
    ? dir.replace(/^\d+p_/i, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : scenario;
  const gameplay = {
    name,
    bounds: Math.round(layout.terrain.world_half_extent),
    positions, strategicPoints,
  };
  writeFileSync(join(folder, `${dir}.json`), JSON.stringify(gameplay, null, 2) + '\n');

  const lines = [
    `# ${name} layout`, '',
    `\`layout.json\` is extracted from \`${dir}.sgb\` in the same format as`,
    `Into the Breach. It contains ${layout.terrain.detail_textures.length} detail textures,`,
    `${layout.decals.length} decal placements and ${layout.entities.length} entity records.`, '',
    'Rebuild the layout, heightmap and lossless browser PNGs:', '', '```sh',
    `node --import tsx scripts/extract-sgb-layout.mjs maps/${dir}/${dir}.sgb --assets-dir maps/all_tiles_staged/${dir}`,
    '```', '',
    `\`${dir}_path.json\` comes directly from the SGB \`DATAIMPA\` chunk:`,
    'open paint is free, everything else is closed for movement.', '',
    '```sh', `node --import tsx scripts/extract-sgb-path.mjs maps/${dir}/${dir}.sgb`, '```',
  ];
  if (missing.length) { lines.push('', 'Missing sources (decals render skipped):', '', ...missing.map(m => `- ${m}`)); }
  writeFileSync(join(folder, 'README.md'), lines.join('\n') + '\n');
  return { dir, name, tex: texRefs.length, dec: decRefs.length, starts: starts.length, points: strategicPoints.length, missing };
}

const results = [];
for (const e of readdirSync(MAPS, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name).sort()) {
  if (SKIP.has(e) || (only && !only.has(e))) continue;
  if (!existsSync(join(MAPS, e, e + '.sgb'))) { console.log(`${e}: NO SGB, skipped`); continue; }
  if (!force && existsSync(join(MAPS, e, 'layout.json'))) { console.log(`${e}: layout exists, skipped (--force to redo)`); continue; }
  try {
    const r = buildMap(e);
    results.push(r);
    console.log(`${e}: "${r.name}" tex=${r.tex} dec=${r.dec} starts=${r.starts} pts=${r.points}${r.missing.length ? ' MISSING ' + r.missing.join(',') : ''}`);
  } catch (err) { console.log(`${e}: FAIL ${err.message}`); }
}
