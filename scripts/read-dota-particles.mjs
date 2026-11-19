import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const cli = process.env.SOURCE2VIEWER_CLI || 'source2viewer-cli';
const archive = process.argv[2] || process.env.DOTA_VPK || join(homedir(), 'Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/pak01_dir.vpk');
const port = Number(process.env.DOTA_PARTICLE_READER_PORT || 40003);
const run = promisify(execFile);
const heroes = {
  axe: 'Axe', juggernaut: 'Juggernaut', sven: 'Sven', tidehunter: 'Tidehunter', pudge: 'Pudge',
  drow: 'Drow Ranger', lina: 'Lina', lion: 'Lion', crystalmaiden: 'Crystal Maiden', nevermore: 'Shadow Fiend',
};
const groups = {
  m_Emitters: 'Эмиттеры', m_Renderers: 'Рендереры', m_Initializers: 'Инициализаторы',
  m_Operators: 'Операторы', m_PreEmissionOperators: 'До эмиссии', m_ForceGenerators: 'Силы', m_Constraints: 'Ограничения',
};

async function inspectArchive(...args) {
  try {
    const { stdout } = await run(cli, ['-i', archive, ...args], { maxBuffer: 40 * 1024 * 1024, timeout: 30000 });
    return stdout;
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Укажи путь к Source 2 Viewer через SOURCE2VIEWER_CLI.', { cause: error });
    throw new Error(`Source 2 Viewer: ${error.stderr?.trim() || error.message}`, { cause: error });
  }
}

await access(archive).catch(() => { throw new Error(`Архив Dota 2 не найден: ${archive}`); });
const html = await readFile(new URL('./dota-particle-reader.html', import.meta.url));
const modules = new Map([
  ['/particle-diagram.js', './particle-diagram.js'],
  ['/three/three.module.js', '../node_modules/three/build/three.module.js'],
  ['/three/three.core.js', '../node_modules/three/build/three.core.js'],
  ['/three/OrbitControls.js', '../node_modules/three/examples/jsm/controls/OrbitControls.js'],
].map(([route, file]) => [route, new URL(file, import.meta.url)]));
const listing = await inspectArchive('--vpk_list', '-e', 'vpcf_c');
const sizes = new Map([...listing.matchAll(/^([^\s]+\.vpcf_c)\s+CRC:\S+ size:(\d+)$/gm)]
  .map(([, path, size]) => [path, Number(size)]));
const rows = [];
for (const [path, size] of sizes) {
  const id = /^particles\/units\/heroes\/hero_([^/]+)\//.exec(path)?.[1];
  if (Object.hasOwn(heroes, id)) rows.push({ path, hero: heroes[id], size });
}
if (!rows.length) throw new Error('Source 2 Viewer не нашёл частицы Batch 1 в архиве.');
rows.sort((a, b) => a.path.localeCompare(b.path));
const index = { archive: basename(archive), heroes: Object.values(heroes), rows };
const cache = new Map();

function particle(path) {
  if (!cache.has(path)) {
    cache.set(path, inspectArchive('-f', path, '-b', 'DATA').then(output => {
      const raw = output.match(/--- Data for block "DATA" ---\s*([\s\S]*)$/)?.[1]?.trim();
      if (!raw?.includes('CParticleSystemDefinition')) throw new Error('В ресурсе отсутствует описание системы частиц.');
      const classes = {};
      let group;
      for (const line of raw.split('\n')) {
        const key = /^\t(m_\w+)\s*=/.exec(line)?.[1];
        if (key) group = groups[key];
        const name = /^\t{2,}_class = "([^"]+)"/.exec(line)?.[1];
        if (group && name) (classes[group] ??= []).push(name);
      }
      const referenceTable = output.split('--- Resource External Refs: ---')[1]?.split('--- Resource Blocks:')[0] || '';
      const dependencies = [...referenceTable.matchAll(/^\s*[\dA-F]{16}\s+(\S+)\s*$/gmi)].map(([, path]) => path);
      const children = new Set([...raw.matchAll(/m_ChildRef\s*=\s*resource:"([^"]+)"/g)].map(([, path]) => path));
      const references = [...new Set([...children, ...dependencies])].map(ref => ({
        path: ref, child: children.has(ref), readable: sizes.has(`${ref}_c`),
      }));
      const controlPoints = new Map();
      for (const [, field, value] of raw.matchAll(/^\s+(m_n\w*(?:ControlPoint|CP)(?:Index|Number)?\d*)\s*=\s*(\d+)\s*$/gm)) {
        const id = Number(value);
        if (id > 63) continue;
        if (!controlPoints.has(id)) controlPoints.set(id, new Set());
        controlPoints.get(id).add(field);
      }
      return {
        path, size: sizes.get(path), maxParticles: /^\tm_nMaxParticles = (\d+)$/m.exec(raw)?.[1], classes, references, raw,
        controlPoints: [...controlPoints].sort(([a], [b]) => a - b).map(([id, fields]) => ({ id, fields: [...fields] })),
      };
    }).catch(error => { cache.delete(path); throw error; }));
  }
  return cache.get(path);
}

function reply(res, code, value, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
}

const server = createServer(async (req, res) => {
  const host = req.headers.host?.split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') return reply(res, 403, { error: 'Reader доступен только локально.' });
  if (req.method !== 'GET') return reply(res, 405, { error: 'Reader поддерживает только GET.' });
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/') return reply(res, 200, html, 'text/html; charset=utf-8');
  if (modules.has(url.pathname)) {
    try {
      return reply(res, 200, await readFile(modules.get(url.pathname)), 'text/javascript; charset=utf-8');
    } catch {
      return reply(res, 404, { error: 'Модуль viewer не найден.' });
    }
  }
  if (url.pathname === '/api/particles') return reply(res, 200, index);
  if (url.pathname !== '/api/particle') return reply(res, 404, { error: 'Страница не найдена.' });
  const path = url.searchParams.get('path');
  if (!sizes.has(path)) return reply(res, 404, { error: 'Ресурс не найден в архиве.' });
  try {
    return reply(res, 200, await particle(path));
  } catch (error) {
    return reply(res, 502, { error: error.message });
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Dota Particle Reader · ${rows.length} ресурсов Batch 1 · http://127.0.0.1:${server.address().port}`);
});
