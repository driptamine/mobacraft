// Runtime source for map files: local /maps in dev, the R2 bucket in
// production (see mapUrl in render/assets). Build-time vite globs cannot
// see R2, so every map load goes through here.
import { mapUrl } from '../render/assets.js';
import { isDotaMap } from './dota-map-layout.js';

export interface RemoteMapEntry {
  path: string;
  url: string;
  name: string;
  players: number | null;
  previewUrl: string | null;
}

// maps/<dir>/... from a map key, .sgb path or R2 url.
export function mapDirFromKey(mapPath: unknown): string {
  const match = String(mapPath || '').match(/(?:^|\/)maps\/([^/]+)(?:\/|$)/);
  return match ? match[1] : '';
}

export function mapFileUrl(mapDir: string, file: string): string {
  if (!mapDir || !file) return file;
  return mapUrl(`/maps/${mapDir}/${String(file).replace(/^\/+/, '')}`);
}

// Map grid/layout loads must bypass the service worker's stale caches in
// dev (fresh paint while iterating), but stay cacheable in production so
// START BATTLE reuses the prefetched files instead of re-downloading them.
export function mapFetchInit(): RequestInit {
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return { cache: 'no-store' };
  }
  return {};
}

export function fetchMapFile(url: string): Promise<Response> {
  return fetch(url, mapFetchInit());
}

// JSON with a content-type guard: dev servers and CDNs answer unknown map
// files with the index.html fallback (HTTP 200), which must not reach
// response.json() as a syntax error.
export async function fetchMapJson(url: string): Promise<any | null> {
  let response: Response;
  try {
    response = await fetchMapFile(url);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const contentType = response.headers ? response.headers.get('content-type') || '' : '';
  if (contentType && !/json/i.test(contentType)) return null;
  try {
    const text = await response.text();
    if (/^\s*</.test(text)) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

let _manifest: RemoteMapEntry[] | null | undefined;
let _manifestUrl: string | null = null;

export function mapManifestUrl(): string {
  if (!_manifestUrl) _manifestUrl = mapUrl('/maps/manifest.json');
  return _manifestUrl;
}

export async function listRemoteMaps(fetchImpl: typeof fetch = fetch): Promise<RemoteMapEntry[]> {
  if (_manifest !== null && _manifest !== undefined) return _manifest;
  try {
    const res = await fetchImpl(mapManifestUrl(), mapFetchInit());
    if (!res.ok) throw new Error(`map manifest: HTTP ${res.status}`);
    const doc = await res.json();
    const entries = (Array.isArray(doc) ? doc : doc.maps || []) as Array<{
      path: string; name: string; players: number | null; preview: string | null;
    }>;
    _manifest = entries
      .filter((e) => e && e.path)
      .map((e) => ({
        path: e.path,
        url: mapUrl(e.path),
        name: e.name || e.path,
        players: e.players ?? null,
        previewUrl: e.preview ? mapUrl(e.preview) : null,
      }));
  } catch {
    _manifest = [];
  }
  return _manifest;
}

export function resetMapManifestForTests(): void {
  _manifest = undefined;
  _manifestUrl = null;
}

// All runtime files one battle needs from a map folder: .sgb, layout,
// heightmap-adjacent sidecars, every referenced detail texture + decal, the
// passability grid and the card preview. Used to warm the HTTP cache in the
// background while the player browses the map list.
export function collectMapFileUrls(
  mapDir: string,
  layout: {
    terrain?: { detail_textures?: Array<{ file?: string }> };
    decals?: Array<{ ref?: string }>;
  } | null,
): string[] {
  if (!mapDir) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (file: string | undefined | null): void => {
    if (!file) return;
    const url = mapFileUrl(mapDir, file);
    if (!seen.has(url)) { seen.add(url); urls.push(url); }
  };
  push(`${mapDir}.sgb`);
  push('layout.json');
  push(`${mapDir}_path.json`);
  for (const detail of layout?.terrain?.detail_textures || []) push(detail.file);
  const decals = new Set<string>();
  for (const decal of layout?.decals || []) {
    const rel = String(decal.ref || '').replace(/^art\/decals\//, '').replace(/\.(tga|dds|png|jpe?g|webp)$/i, '');
    if (rel) decals.add(`${rel.split('/').pop()}.png`);
  }
  for (const file of decals) push(`decals/${file}`);
  return urls;
}

// Background warm-up: fetch every runtime file of the clicked map through
// the service worker cache while the player browses, so START BATTLE finds
// them locally. Fire-and-forget; failures just mean a regular load later.
// Decal files live flat (decals/<base>.png, the extracted maps) or in the
// original subfolders (decals/<biome>/<base>.png, alvarus). The primary URL
// is the flat one the prefetcher warms; the subfolder form is the fallback.
export function decalUrlForRef(mapDir: string, ref: string): string | null {
  if (!mapDir) return null;
  const base = String(ref || '').replace(/\.(tga|dds|png|jpe?g|webp)$/i, '').split('/').pop();
  if (!base) return null;
  return mapFileUrl(mapDir, `decals/${base}.png`);
}

export function decalFallbackUrlForRef(mapDir: string, ref: string, primary: string | null): string | null {
  if (!mapDir) return null;
  const rel = String(ref || '').replace(/^art\/decals\//, '').replace(/\.(tga|dds|png|jpe?g|webp)$/i, '');
  if (!rel || !rel.includes('/')) return null;
  const sub = mapFileUrl(mapDir, `decals/${rel}.png`);
  return sub === primary ? null : sub;
}

export function prefetchMapFiles(card: { path?: string | null } | null | undefined): void {
  if (card?.path && isDotaMap(card.path)) {
    // Warm the small navigation files; stream the map model only at battle start.
    void Promise.allSettled(['map.json', 'surface.json'].map(file => fetchMapFile(mapFileUrl('dotamap-game', file))));
    return;
  }
  const dir = mapDirFromKey(card?.path);
  if (!dir) return;
  void (async () => {
    try {
      const res = await fetchMapFile(mapFileUrl(dir, 'layout.json'));
      const layout = res.ok ? await res.json().catch(() => null) : null;
      const urls = collectMapFileUrls(dir, layout);
      await Promise.allSettled(urls.map(async (url) => {
        try {
          const file = await fetchMapFile(url);
          if (file.ok) await file.arrayBuffer().catch(() => null);
        } catch { /* background only */ }
      }));
    } catch { /* background only */ }
  })();
}

