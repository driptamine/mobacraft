import { mapFileUrl, fetchMapJson } from '../maps/map-source.js';
import { isDoomSpiral } from '../maps/doom-spiral.js';
import { DOTA_MAP_KEY, isDotaMap } from '../maps/dota-map-layout.js';

// Temporary SGB restriction; the built-in grid arena remains available.
export const DOOM_SPIRAL_ONLY = true;

function visibleMaps<T extends { path: string | null }>(entries: T[]): T[] {
  return DOOM_SPIRAL_ONLY ? entries.filter((entry) => entry.path && (isDoomSpiral(entry.path) || isDotaMap(entry.path))) : entries;
}

function withDotaMap(entries: MapEntry[]): MapEntry[] {
  if (entries.some(entry => isDotaMap(entry.path))) return entries;
  return [...entries, {
    path: DOTA_MAP_KEY, url: mapFileUrl('dotamap-game', 'map.json'),
    name: 'Dota 2', players: 2, previewUrl: mapFileUrl('dotamap-game', 'preview.png'),
  }];
}

let _selectedPath: string | null = null;

export interface MapEntry {
  path: string;
  url: string;
  name: string;
  players: number | null;
  previewUrl: string | null;
}

export interface MapCard {
  path: string | null;
  url: string | null;
  name: string;
  players: number | null;
  previewUrl: string | null;
}

let _entries: MapCard[] = [];

export function displayName(path: string): string {
  return (String(path)
    .split('/')
    .pop() || '')
    .replace(/\.sgb$/i, '')
    .replace(/[_-]+/g, ' ');
}

export function playersFor(path: string): number | null {
  const match = /(\d+)p[_-]/i.exec(String(path).split('/').pop() || '');
  return match ? Number(match[1]) : null;
}

export function previewFor(path: string, previews: Record<string, string> = {}): string | null {
  const base = String(path).replace(/\.sgb$/i, '');
  return previews[base + '_icon_custom.png'] || previews[base + '_icon.png'] || previews[base + '_preview.png'] || null;
}

export function listBuiltinMaps(glob: Record<string, string> = {}, previews: Record<string, string> = {}): MapEntry[] {
  return Object.entries(glob)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, url]) => ({
      path,
      url,
      name: displayName(path),
      players: playersFor(path),
      previewUrl: previewFor(path, previews),
    }));
}

// Production serves maps/ from R2, never from dist/, so the build-time globs
// above are empty there: fall back to the uploaded manifest (same entries,
// resolved through mapUrl for the bucket or the local dev server).
export async function listMaps(fetchImpl: typeof fetch = fetch): Promise<MapEntry[]> {
  const builtin = listBuiltinMaps();
  if (builtin.length) return withDotaMap(visibleMaps(builtin));
  const { listRemoteMaps } = await import('../maps/map-source.js');
  const remote = await listRemoteMaps(fetchImpl);
  return withDotaMap(visibleMaps(remote.map((entry) => ({
    path: entry.path,
    url: entry.url,
    name: entry.name || displayName(entry.path),
    players: entry.players,
    previewUrl: entry.previewUrl,
  }))));
}

export function entryLabel({ name, players }: { name: string; players: number | null }): string {
  return players ? `${name} (${players}P)` : name;
}

export function skirmishMapCards(builtin: MapEntry[] = listBuiltinMaps()): MapCard[] {
  return [
    { path: null, url: null, name: 'Default Arena', players: null, previewUrl: null },
    ...withDotaMap(visibleMaps(builtin)),
  ];
}

// Skirmish preselects Doom Spiral when available.
export function defaultSkirmishMap(cards?: MapCard[] | null): MapCard | null {
  return (cards || []).find((c) => c.path && /doom.?spiral/i.test(c.path)) || null;
}

export function previewState(entry: MapEntry | MapCard | null): { kind: 'image'; url: string } | { kind: 'empty' } {
  const url = entry?.previewUrl || null;
  return url ? { kind: 'image', url } : { kind: 'empty' };
}

function renderMapPreview(entry: MapEntry | MapCard | null): void {
  const box = document.getElementById('maps-preview');
  if (!box) {
    return;
  }
  box.innerHTML = '';
  const preview = previewState(entry);
  if (preview.kind === 'image' && entry) {
    const img = document.createElement('img');
    img.src = preview.url;
    img.alt = entry.name;
    img.addEventListener('error', () => {
      box.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'maps-empty';
      empty.textContent = 'NO PREVIEW';
      box.appendChild(empty);
      const cap = document.createElement('div');
      cap.className = 'maps-preview-cap';
      cap.textContent = entryLabel(entry as MapCard);
      box.appendChild(cap);
    });
    box.appendChild(img);
  } else {
    const empty = document.createElement('div');
    empty.className = 'maps-empty';
    empty.textContent = entry ? 'NO PREVIEW' : 'SELECT A MAP';
    box.appendChild(empty);
  }
  if (entry) {
    const cap = document.createElement('div');
    cap.className = 'maps-preview-cap';
    cap.textContent = entryLabel(entry);
    box.appendChild(cap);
  }
}

export function buildMapsMenu(): void {
  const list = document.getElementById('maps-list');
  if (!list) {
    return;
  }
  list.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'maps-empty';
  loading.textContent = 'LOADING MAPS…';
  list.appendChild(loading);
  void listMaps().then((maps) => {
    if (!list.isConnected) return;
    const entries = skirmishMapCards(maps);
    _entries = entries;
    list.innerHTML = '';
    renderMapsMenuEntries(list, entries);
  });
}

function renderMapsMenuEntries(list: HTMLElement, entries: MapCard[]): void {
  entries.forEach((entry) => {
    const { path, url } = entry;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'maps-entry' + (path === _selectedPath ? ' active' : '');
    btn.dataset.path = path || 'arena';
    btn.textContent = entry.name;
    btn.addEventListener('click', () => selectMap(path, url));
    list.appendChild(btn);
  });
  renderMapPreview(_entries.find((e) => e.path === _selectedPath) || null);
}

export async function selectDefaultArena(): Promise<void> {
  const [sgb, terrain, core, dota] = await Promise.all([
    import('../maps/sgb-upload.js'),
    import('../maps/terrain-upload.js'),
    import('../core/scene.js'),
    import('../maps/dota-map.js'),
  ]);
  dota.clearDotaMap();
  sgb.clearSgbMap(true);
  terrain.clearTerrainMesh(true);
  window._currentMapKey = 'arena';
  core.setGridVariant(1);
  if (!core._gridVisible) core.toggleGrid();
}

export async function selectMap(path: string | null, url: string | null): Promise<void> {
  _selectedPath = path;
  (window as unknown as Record<string, unknown>)._currentMapKey = path || 'arena';
  renderMapPreview(_entries.find((e) => e.path === path) || null);
  const list = document.getElementById('maps-list');
  if (list) {
    (Array.from(list.children) as HTMLElement[]).forEach((el) => {
      if (el.classList) {
        el.classList.toggle('active', el.dataset.path === (path || 'arena'));
      }
    });
  }
  if (path && isDotaMap(path)) {
    await (await import('../maps/dota-map.js')).loadDotaMap();
    return;
  }
  if (!path || !url) {
    await selectDefaultArena();
    const { resetGame } = await import('../core/game.js');
    resetGame('arena');
    return;
  }
  (await import('../maps/dota-map.js')).clearDotaMap();
  try {
    const { loadSgbUrl } = await import('../maps/sgb-upload.js');
    await loadSgbUrl(url, displayName(path) + '.sgb', path);
  } catch (err) {
    console.error(err);
  }
  // Paint AFTER the ground material exists — sgb-upload rebuilds the ground,
  // so a pre-load decal would be wiped along with the old material.
  await applyMapDecalAutoPair(path, url);
}

async function applyMapDecalAutoPair(path: string, _url: string): Promise<void> {
  // The 6p_alvarus map is wired to the terrain decal store (maps/6p_alvarus/decals/) as
  // its biomes live there (jungle/urban/z_all + loose), not beside the .sgb.
  // Mirror the decals-browser click (loadTerrainTextureUrl) so the map jump
  // paints the same ground before the heightmap settles.
  if (!/alvarus/i.test(path)) {
    return;
  }
  const { loadTerrainTextureUrl, updateTerrainMeshY } = await import('../maps/terrain-upload.js');
  // Default the map's ground to Y offset 4.0.
  const ySlider = document.getElementById('terrain-mesh-y') as HTMLInputElement | null;
  const yVal = document.getElementById('terrain-mesh-y-val');
  if (ySlider) {
    ySlider.value = '4';
  }
  if (yVal) {
    yVal.textContent = '4.0';
  }
  updateTerrainMeshY(4);
  // Full-coverage sheet the user's own store-list calls the 100%-ground
  // decal: the DDS-derived PNG (256x256, same footprint as the old one).
  // Tiling is eye-picked; defaults come from tex-tile-x/y.
  loadTerrainTextureUrl(mapFileUrl('6p_alvarus', 'decals/terrain/chaos_taint_02_dds.png'), '6P ALVARUS');

  // Project the per-decal layout (maps/*_layout_upd.json) onto the surface,
  // mirroring the ground-sheet attachment for x/z/size/angle.
  try {
    const layoutPath = String(path).replace(/\.sgb$/i, '') + '_layout_upd.json';
    const layout = await fetchMapJson(layoutPath);
    if (!layout) {
      return;
    }
    const [{ buildSgbDecalsFromLayout }, sgbModule] = await Promise.all([
      import('../maps/sgb-decals.js'),
      import('../maps/sgb-upload.js'),
    ]);
    const sampleHeight = ((window as unknown as Record<string, unknown>).__sgbSampleHeight || (() => 0)) as (x: number, z: number) => number;
    buildSgbDecalsFromLayout(sgbModule._sgbRoot, layout, sampleHeight);
  } catch (err) {
    console.error('layout decals error:', err);
  }
}
