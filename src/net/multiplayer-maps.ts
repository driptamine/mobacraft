import { DOTA_MAP_KEY, isDotaMap } from '../maps/dota-map-layout.js';
import { mapFileUrl, listRemoteMaps, type RemoteMapEntry } from '../maps/map-source.js';
import type { MapCard } from '../ui/maps-menu.js';

const multiplayerDota: MapCard = {
  name: 'Dota 2', path: DOTA_MAP_KEY, url: mapFileUrl('dotamap-game', 'map.json'),
  players: 2, previewUrl: mapFileUrl('dotamap-game', 'preview.png'),
};

export const multiplayerArena: MapCard = { name: 'Default Arena', path: null, url: null, players: 8, previewUrl: null };

function mapLabelKey(label: string): string {
  const name = label.split('/').pop() || '';
  const key = name.toLowerCase().replace(/\.sgb$/, '').replace(/^\d+p[\s_-]*/, '').replace(/[^\p{L}\p{N}]/gu, '');
  return key === 'arena' ? 'defaultarena' : key;
}

export function multiplayerMapCard(label: string | null | undefined, maps: readonly MapCard[]): MapCard | null {
  if (!label) return null;
  const key = mapLabelKey(label);
  if (isDotaMap(label) || key === 'dota2') return multiplayerDota;
  if (key === 'defaultarena') return multiplayerArena;
  return maps.find(map => mapLabelKey(map.name) === key || (map.path && mapLabelKey(map.path) === key)) ?? null;
}

export async function resolveMultiplayerMap(label: string): Promise<MapCard | null> {
  const direct = multiplayerMapCard(label, []);
  if (direct) return direct;
  const maps: RemoteMapEntry[] = await listRemoteMaps();
  return multiplayerMapCard(label, maps);
}
