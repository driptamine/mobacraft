import type { Lobby } from './lobbies.js';

export function multiplayerAPI(config = import.meta.env?.VITE_MULTIPLAYER_API_URL, location = globalThis.location): string {
  if (config) return config.replace(/\/+$/, '');
  if (!location || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return 'http://127.0.0.1:8080';
  return `${location.protocol}//${location.hostname}:8080`;
}
export async function fetchOnlineLobbies(): Promise<Lobby[]> {
  const response = await fetch(`${multiplayerAPI()}/api/lobbies`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Go server: HTTP ${response.status}`);
  return (await response.json()).map((lobby: Lobby) => ({ ...lobby, players: lobby.players || [] }));
}
export async function createOnlineLobby(name: string, map: string, capacity: number): Promise<Lobby> {
  const response = await fetch(`${multiplayerAPI()}/api/lobbies`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, map, capacity }), signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error((await response.text()).trim() || `HTTP ${response.status}`);
  return response.json();
}

export interface WebTransportConnection {
  enabled: boolean;
  webtransport_url: string;
  certificate_hash: string;
  websocket_path?: string;
}
export async function fetchMultiplayerConnection(): Promise<WebTransportConnection> {
  const response = await fetch(`${multiplayerAPI()}/api/connection`, {
    cache: 'no-store', signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Cannot discover Go server: HTTP ${response.status}`);
  return response.json();
}

export async function fetchWebTransportConnection(info?: WebTransportConnection): Promise<WebTransportConnection> {
  info ??= await fetchMultiplayerConnection();
  if (!info.enabled) throw new Error('WebTransport is disabled. Start mobacraft-go without --no-wt.');
  const url = new URL(info.webtransport_url);
  if (url.protocol !== 'https:' || !/^[a-f0-9]{64}$/i.test(info.certificate_hash)) {
    throw new Error('Go server returned invalid WebTransport connection settings.');
  }
  // Default Go discovery uses loopback. When joining from another machine,
  // the API's hostname is the one the browser can actually reach.
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    url.hostname = new URL(multiplayerAPI()).hostname;
  }
  return { ...info, webtransport_url: url.toString(), certificate_hash: info.certificate_hash.toLowerCase() };
}

export function multiplayerWebSocketURL(info: WebTransportConnection, lobbyId: string, username: string, faction: string, api = multiplayerAPI()): string | null {
  if (info.websocket_path !== '/join') return null;
  const url = new URL(info.websocket_path, api);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('lobby', lobbyId);
  url.searchParams.set('username', username);
  url.searchParams.set('faction', faction);
  return url.toString();
}
