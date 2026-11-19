import { it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWebTransportConnection } from '../src/net/lobby-api.js';

it('discovers a fresh certificate and refuses disabled or invalid WebTransport metadata', async () => {
  const original = globalThis.fetch;
  let info = {enabled:true,webtransport_url:'https://127.0.0.1:4433/grimcraft',certificate_hash:'A'.repeat(64)};
  const calls=[];
  globalThis.fetch=async (url,options)=>{calls.push({url,options});return{ok:true,json:async()=>info}};
  try {
    assert.equal((await fetchWebTransportConnection()).certificate_hash,'a'.repeat(64));
    info={...info,certificate_hash:'b'.repeat(64)};
    assert.equal((await fetchWebTransportConnection()).certificate_hash,'b'.repeat(64));
    assert.ok(calls.every(c=>c.options.cache==='no-store'));
    info={...info,enabled:false};
    await assert.rejects(fetchWebTransportConnection(),/without --no-wt/);
    info={...info,enabled:true,certificate_hash:'broken'};
    await assert.rejects(fetchWebTransportConnection(),/invalid WebTransport/);
    info={...info,certificate_hash:'b'.repeat(64),webtransport_url:'ws://127.0.0.1:8080/join'};
    await assert.rejects(fetchWebTransportConnection(),/invalid WebTransport/);
  } finally { globalThis.fetch=original; }
});

it('uses the configured host for an advertised WebSocket, including room and player identity', async () => {
  const { multiplayerAPI, multiplayerWebSocketURL } = await import('../src/net/lobby-api.js');
  assert.equal(multiplayerAPI('https://games.example.test/'), 'https://games.example.test');
  assert.equal(multiplayerAPI('', { protocol: 'http:', hostname: '10.0.0.7' }), 'http://10.0.0.7:8080');
  const info = { enabled: false, websocket_path: '/join', webtransport_url: '', certificate_hash: '' };
  const url = new URL(multiplayerWebSocketURL(info, 'room_a', 'Blue & Red', 'Imperial Guard', 'https://games.example.test'));
  assert.equal(url.origin, 'wss://games.example.test');
  assert.equal(url.pathname, '/join');
  assert.equal(url.searchParams.get('lobby'), 'room_a');
  assert.equal(url.searchParams.get('username'), 'Blue & Red');
  assert.equal(multiplayerWebSocketURL({ ...info, websocket_path: '//wrong.example.test/join' }, 'room_a', 'Blue', 'IG'), null);
});

it('resolves server map names without falling back to a different battlefield', async () => {
  const { multiplayerMapCard } = await import('../src/net/multiplayer-maps.js');
  const doom = { name: '4p doom spiral', path: '/maps/4p_doom_spiral/4p_doom_spiral.sgb' };
  const oasis = { name: '8p oasis of sharr', path: '/maps/8p_oasis_of_sharr/8p_oasis_of_sharr.sgb' };
  const dota = multiplayerMapCard('Dota 2', []);
  assert.equal(dota.path, '/maps/dotamap-game/map.json');
  assert.equal(dota.players, 2);
  assert.equal(multiplayerMapCard(dota.path, []), dota);
  assert.equal(multiplayerMapCard('Arena', []).path, null);
  assert.equal(multiplayerMapCard('Doom Spiral', [doom, oasis]), doom);
  assert.equal(multiplayerMapCard(oasis.path, [doom, oasis]), oasis);
  assert.equal(multiplayerMapCard('Unknown Battlefield', [doom, oasis]), null);
});
