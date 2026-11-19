import * as THREE from 'three';
import { startingResources } from '../core/economy.js';
import { applySkirmishSnapshot, initReplicaSystems } from './skirmish-state.js';
import { setNetworkBalanceMod } from '../balance/runtime.js';
import { fetchWebTransportConnection } from './lobby-api.js';
import { LOBBY_FACTIONS, makeLocalMatch, setLocalMatch, type LocalMatchConfig } from '../core/local-match.js';
import { createLobby, lobbySlots, setLobbySlot, type Lobby } from './lobbies.js';
import { isDotaMap } from '../maps/dota-map-layout.js';
import { heroSlotButton } from '../ui/lobby-hero-picker.js';
import { loadDotaMatchHeroes } from '../core/match-heroes.js';
import { layoutFor } from '../maps/map-layout.js';
import { setPlayerFaction, playerFaction } from '../factions.js';
import { setPlayerTeam } from '../core/scene.js';
import { World } from '../core/ecs.js';
import {
  scene, world, setWorld, setStartTime, PLAYER, requisition, setRequisition, energy, setEnergy,
  kills, setKills, gameOver, setGameOver, selSquads, selBuilder, setSelSquads, setSelBuilder, setSelBuildings, setSelListeningPost,
} from '../core/scene.js';
import { updateHUD } from '../core/hud.js';
import { applySquadWeaponVisuals, createSquadEntity, createSoldierEntity } from '../entities/entities.js';
import {
  makeHpBar, makeSoldierMesh, makeBarracksMesh, makeTowerMesh,
  makeThermoMesh, makeAirfieldMesh, makeApcMesh, makeGunTurretMesh,
  makeStrategicPointMesh, makeLaserBulletMesh, makePlasmaBulletMesh,
  makeBulletMesh, makeGrenadeMesh, makeMissileMesh,
} from '../meshes.js';
import { disposeMeshComponent, _initSystems, spawnParticles } from '../core/systems.js';
import { bootGame, resetGame } from '../core/game.js';
import { issueRightClick, pickMesh, raycastGround } from '../core/input.js';
import { disposeObj } from '../render/three-helpers.js';
import { listMaps, selectMap, selectDefaultArena, previewState, entryLabel, skirmishMapCards, defaultSkirmishMap, type MapCard } from '../ui/maps-menu.js';
import { prefetchMapFiles } from '../maps/map-source.js';
import { mountMultiplayerLobby } from './multiplayer-lobby-ui.js';
import { resetR2Progress, subscribeR2Progress, probeR2Cache } from './r2-progress.js';
import { collectBootR2Urls } from './r2-manifest.js';
import { ARENA_POSITION_FACTIONS } from '../factions.js';

declare global {
  interface Window {
    _injectConnectUI?: () => void;
    webTransportConnect?: () => Promise<void>;
    webTransportPlayOffline?: () => Promise<void>;
    _grimcraftNetStop?: (ids: number[]) => void;
    _grimcraftNetAttack?: (ids: number[], target: number) => void;
    _lastBootMs?: number;
  }
}
import { SP_MODEL_PATHS } from '../meshes/points.js';
import { PLASMA_BOLT_PATH, PLASMA_FX_DIR } from '../fx/plasma-bolt.js';
import { LASGUN_MODEL_PATH } from '../render/camera-fps.js';
import { createBootTimer, formatBootTime } from '../core/boot-timer.js';

export let SERVER_URL = 'https://127.0.0.1:4433/grimcraft';
export let SERVER_CERT_HASH = '4c0409537cdf2905891d85c70369531614f138c923008c092ff72e31bc46fc25';

export let _myPlayerId: any = null;
export let _myTeam: any = null;
export let _netStatus = 'disconnected';
export let _netSchema = 1;
export let _netTransport: 'webtransport' | 'websocket' | null = null;
let _lastSnapshotTick = 0;
let _lastDeltaTick = 0;
let _selectedMap: any = null;
let _selectedLobby: any = null;
let _multiplayerLobbyUI: ReturnType<typeof mountMultiplayerLobby> | null = null;

class StreamFramer {
  _buffer: Uint8Array;

  constructor() {
    this._buffer = new Uint8Array(0);
  }

  push(chunk: Uint8Array): void {
    const merged = new Uint8Array(this._buffer.length + chunk.length);
    merged.set(this._buffer);
    merged.set(chunk, this._buffer.length);
    this._buffer = merged;
  }

  drain(): Uint8Array[] {
    const messages: Uint8Array[] = [];
    while (this._buffer.length >= 4) {
      const length = new DataView(this._buffer.buffer, this._buffer.byteOffset, 4).getUint32(0, true);
      if (this._buffer.length < 4 + length) {
        break;
      }
      messages.push(this._buffer.slice(4, 4 + length));
      this._buffer = this._buffer.slice(4 + length);
    }
    return messages;
  }
}

class WTNet {
  _webTransport: any = null;
  _socket: WebSocket | null = null;
  _cmdStream: any = null;
  _cmdWriter: any = null;
  _encoder = new TextEncoder();
  _decoder = new TextDecoder();

  async connect(url: string, certHash: string): Promise<void> {
    _netStatus = 'connecting';
    _updateNetHUD();
    if (/^wss?:/.test(url)) {
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(url); this._socket = socket;
        const timeout = setTimeout(() => { socket.close(); reject(new Error('Go server connection timed out')); }, 8000);
        socket.onmessage = event => _handleServerBytes(this._encoder.encode(event.data));
        socket.onopen = () => { clearTimeout(timeout); _netStatus = 'connected'; _updateNetHUD(); resolve(); };
        socket.onerror = () => { clearTimeout(timeout); reject(new Error('Cannot connect to grimcraft-go on port 8080')); };
        socket.onclose = () => { clearTimeout(timeout); _netStatus = 'disconnected'; _updateNetHUD(); _multiplayerLobbyUI?.status('Disconnected from Go server. Reopen the lobby to reconnect.'); reject(new Error('Connection closed')); };
      });
      _netTransport = 'websocket';
      return;
    }
    if (typeof WebTransport === 'undefined') throw new Error('This browser does not support WebTransport. Use Chrome or Edge.');
    const options: any = { allowPooling: false };
    if (certHash && certHash.length === 64) {
      options.serverCertificateHashes = [{
        algorithm: 'sha-256',
        value: _hexToBytes(certHash),
      }];
    }
    const transport = new WebTransport(url, options);
    this._webTransport = transport;
    void transport.closed.catch(() => {});
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await transport.ready;
          const stream = await transport.createBidirectionalStream();
          if (this._webTransport !== transport) throw new Error('Connection cancelled');
          this._cmdStream = stream;
          this._cmdWriter = stream.writable.getWriter();
          this._readAcks(stream.readable, transport);
          this._readUniStreams(transport);
          this._readDatagrams(transport);
        })(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('WebTransport connection timed out. Check grimcraft-go and UDP port 4433.')), 8000);
        }),
      ]);
    } catch (error) {
      if (this._webTransport === transport) { this.disconnect(); _netStatus = 'error'; _updateNetHUD(); }
      throw error;
    } finally { clearTimeout(timeout); }
    _netTransport = 'webtransport';
    _netStatus = 'connected';
    _updateNetHUD();
    const closed = () => {
      if (this._webTransport !== transport) return;
      this._cmdWriter = null;
      _netStatus = 'disconnected'; _netTransport = null;
      _updateNetHUD();
      _multiplayerLobbyUI?.status('WebTransport disconnected. Reopen the lobby to reconnect.');
    };
    transport.closed.then(closed, closed);
  }

  async _readUniStreams(transport: any) {
    try {
      for await (const stream of transport.incomingUnidirectionalStreams) {
        if (this._webTransport !== transport) return;
        this._readStream(stream, transport);
      }
    } catch (_) { /* transport.closed handles disconnects */ }
  }

  async _readStream(readable: any, transport: any): Promise<void> {
    const framer = new StreamFramer();
    try {
      for await (const chunk of readable) {
        if (this._webTransport !== transport) return;
        framer.push(new Uint8Array(chunk));
        for (const bytes of framer.drain()) {
          _handleServerBytes(bytes);
        }
      }
    } catch (error) {
      // stream ended
    }
  }

  async _readAcks(readable: any, transport: any): Promise<void> {
    const framer = new StreamFramer();
    try {
      for await (const chunk of readable) {
        if (this._webTransport !== transport) return;
        framer.push(new Uint8Array(chunk));
        for (const bytes of framer.drain()) {
          _handleServerBytes(bytes);
        }
      }
    } catch (error) {
      // stream ended
    }
  }

  async _readDatagrams(transport: any) {
    try {
      for await (const datagram of transport.datagrams.readable) {
        if (this._webTransport !== transport) return;
        _handleServerBytes(new Uint8Array(datagram));
      }
    } catch (error) {
      // stream ended
    }
  }

  sendCmd(command: any): void {
    if (this._socket?.readyState === WebSocket.OPEN) { this._socket.send(JSON.stringify({Command:command})); return; }
    if (!this._cmdWriter) {
      return;
    }
    const payload = this._encoder.encode(JSON.stringify({ Command: command }));
    this._cmdWriter.write(_makeFrame(payload)).catch(() => {
      _multiplayerLobbyUI?.status('Cannot send command: WebTransport disconnected.');
    });
  }

  async sendJoin(team: any, username = '', faction = ''): Promise<void> {
    if (this._socket) return;
    if (!this._cmdWriter) throw new Error('WebTransport command stream is not connected');
    const payload = this._encoder.encode(JSON.stringify({ Join: { preferred_team: team, username, faction } }));
    await this._cmdWriter.write(_makeFrame(payload));
  }

  disconnect(): void {
    if (this._socket) { this._socket.onclose = null; this._socket.onmessage = null; this._socket.onerror = null; this._socket.close(); this._socket = null; }
    this._cmdWriter?.releaseLock();
    this._cmdWriter = null;
    this._webTransport?.close();
    this._webTransport = null;
    _netStatus = 'disconnected'; _netTransport = null;
    _updateNetHUD();
  }
}

function _makeFrame(payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + payload.length);
  new DataView(frame.buffer).setUint32(0, payload.length, true);
  frame.set(payload, 4);
  return frame;
}

function _hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

const _decoder = new TextDecoder();
let _lobbyOnly = false;
let _onlineBooting = false;
let _joinGeneration = 0;
let _pendingSession: any = null;
let _pendingSnapshot: any = null;
let _pendingLobby: any = null;
const _netSquads = new Map<number, number>();
const _localSquads = new Map<number, number>();

async function _joinOnlineLobby(lobby: any, username: string): Promise<void> {
  _leaveOnlineLobby();
  const generation = _joinGeneration;
  _myPlayerId = null; _myTeam = null;
  _pendingSession = null; _pendingSnapshot = null; _pendingLobby = null;
  _lobbyOnly = true;
  try {
    const info = await fetchWebTransportConnection();
    if (generation !== _joinGeneration) return;
    const url = new URL(info.webtransport_url);
    url.searchParams.set('lobby', lobby.id);
    SERVER_URL = info.webtransport_url;
    SERVER_CERT_HASH = info.certificate_hash;
    const urlInput = document.getElementById('webTransport-url') as HTMLInputElement | null;
    const certInput = document.getElementById('webTransport-cert') as HTMLInputElement | null;
    if (urlInput) urlInput.value = SERVER_URL;
    if (certInput) certInput.value = SERVER_CERT_HASH;
    await _net.connect(url.toString(), info.certificate_hash);
    if (generation !== _joinGeneration) return;
    await _net.sendJoin(null, username, 'Imperial Guard');
  } catch (error) {
    if (generation === _joinGeneration) throw error;
  }
}

function _leaveOnlineLobby(): void {
  setNetworkBalanceMod(null);
  _joinGeneration++;
  _net.disconnect();
  _lobbyOnly = false;
  _pendingLobby = null; _pendingSession = null; _pendingSnapshot = null;
  const gate=document.getElementById('multiplayer-loading-gate');if(gate)gate.remove();
}

async function _startOnlineMatch(): Promise<void> {
  if (_onlineBooting || !_lobbyOnly || !_pendingSession || !_pendingSnapshot || !_pendingLobby?.started) return;
  _onlineBooting = true;
  const generation = _joinGeneration;
  setLocalMatch(null);
  window._multiplayerMode = true;
  window._currentMapKey = _selectedMap?.path || 'arena';
  _setLoadingUI(true);
  try {
    await bootGame({onProgress: _updateLoadBar});
    if (generation !== _joinGeneration) return;
    if (_selectedMap) await selectMap(_selectedMap.path, _selectedMap.url);
    else await selectDefaultArena();
    if (generation !== _joinGeneration) return;
    _lobbyOnly = false;
    _onSession(_pendingSession);
    _onSnapshot(_pendingSnapshot);
    _net.sendCmd({PlayerLoaded:{}});
    const own = [...world.query('building'),...world.query('squad')].map((id: number) => (world.get(id, 'building') || world.get(id, 'squad'))).find((s: any) => s.owner === _myPlayerId);
    if (own && window.__grimCamera) (window.__grimCamera as any).target.copy(own.position);
  } catch (error) {
    _multiplayerLobbyUI?.status(`Cannot start: ${(error as Error).message}`);
  } finally { _setLoadingUI(false); _onlineBooting = false; }
}


function _handleServerBytes(bytes: Uint8Array): void {
  let message;
  try {
    message = JSON.parse(_decoder.decode(bytes));
  } catch (error) {
    return;
  }
  if (message.ServerError) { _setConnectOverlay(true); _multiplayerLobbyUI?.status(message.ServerError.message || String(message.ServerError)); return; }
  if (message.Lobby) {
    setNetworkBalanceMod(message.Lobby.balanceMod || null);
    _pendingLobby = message.Lobby;
    _multiplayerLobbyUI?.onlineLobby(message.Lobby, _myPlayerId);
    void _startOnlineMatch();
    return;
  }
  if (message.Session) {
    _onSession(message.Session);
    return;
  }
  if (message.Snapshot) {
    _onSnapshot(message.Snapshot);
    return;
  }
  if (message.Delta) {
    _onDelta(message.Delta);
    return;
  }
  if (message.CmdAck) {
    _onCmdAck(message.CmdAck);
  }
}

function _onSession(info: any): void {
  _myPlayerId = info.player_id;
  _myTeam = info.team === 'Blue' ? 'blue' : 'red';
  _pendingSession = info;
  setPlayerTeam(_myTeam);
  if (_lobbyOnly) {
    if (_pendingLobby) _multiplayerLobbyUI?.onlineLobby(_pendingLobby, _myPlayerId);
    void _startOnlineMatch(); return;
  }
  _netSquads.clear(); _localSquads.clear();
  _lastSnapshotTick = 0; _lastDeltaTick = 0;
  window._multiplayerMode = true;
  if (world) {
    for (const id of world.query('mesh')) {
      const meshComponent = world.get(id, 'mesh');
      if (meshComponent) {
        disposeMeshComponent(meshComponent);
      }
    }
  }
  const newWorld = new World();
  setWorld(newWorld);
  setSelSquads([]);setSelBuilder(null);setSelBuildings([]);setSelListeningPost(null);
  window._networkPlayerId=_myPlayerId;
  _netSchema=_pendingSnapshot?.schema===2?2:1;window._networkSchema=_netSchema;
  if(_netSchema===2)initReplicaSystems(newWorld);else _initSystems(newWorld);
  const resources = startingResources(playerFaction);
  setRequisition(resources.requisition);
  setEnergy(resources.energy);
  setKills(0);
  setGameOver(false);
  updateHUD();
  _setConnectOverlay(false);
  _setNetHudVisible(true);
  _updateNetHUD();
}

// Readiness is decided by Go; the overlay also blocks orders while peers load.
function _updateMatchGate(snapshot:any):void {
  let gate=document.getElementById('multiplayer-loading-gate');
  const waiting=snapshot.phase&&snapshot.phase!=='running';
  if(snapshot.startAt)setStartTime(snapshot.startAt);
  else if(waiting)setStartTime(Date.now());
  if(!snapshot.winner){const win=document.getElementById('win');if(win)win.style.display='none';setGameOver(false);}
  if(!waiting){if(gate)gate.style.display='none';return;}
  if(!gate){gate=document.createElement('div');gate.id='multiplayer-loading-gate';gate.style.cssText='position:fixed;inset:0;z-index:10000;background:#070d15d9;display:flex;align-items:center;justify-content:center;color:#e1edf8;font:20px sans-serif;text-align:center;white-space:pre-line';document.body.append(gate);}
  gate.style.display='flex';
  const ids=snapshot.waitingFor||[];
  const names=ids.map((id:number)=>_pendingLobby?.players?.find((p:any)=>p.player_id===id)?.username||`Player ${id}`);
  gate.textContent=snapshot.phase==='countdown'?'Все игроки готовы. Начинаем…':`Ожидание загрузки игроков${names.length?'\n'+names.join(', '):'…'}`;
}

function _onSnapshot(snapshot: any): void {
  _pendingSnapshot = snapshot;
  if (_lobbyOnly) { void _startOnlineMatch(); return; }
  if(snapshot.schema===2){
    if(!world || (_netSchema===2 && snapshot.tick < _lastSnapshotTick))return;
    _lastSnapshotTick=snapshot.tick;
    if(_netSchema!==2){
      for(const id of world.query('mesh'))disposeMeshComponent(world.get(id,'mesh'));
      const replica=new World();setWorld(replica);initReplicaSystems(replica);
      setSelSquads([]);setSelBuilder(null);setSelBuildings([]);
      _netSquads.clear();_localSquads.clear();_netSchema=2;window._networkSchema=2;
    }
    const account=snapshot.players.find((p:any)=>p.id===_myPlayerId);
    if(account){setPlayerTeam(account.team);setPlayerFaction(account.faction);}
    applySkirmishSnapshot(world,snapshot,_myPlayerId);_updateMatchGate(snapshot);return;
  }
  if(_netSchema===2 || !world || snapshot.tick < _lastSnapshotTick) return;
  _lastSnapshotTick = snapshot.tick;
  const serverIds = new Set<number>(snapshot.squads.map(([id]: any) => id));
  for (const [netId, localId] of _netSquads) {
    if (serverIds.has(netId)) continue;
    const squad = world.get(localId, 'squad');
    for (const soldierId of squad?.soldiers || []) {
      if (soldierId == null) continue;
      const mesh = world.get(soldierId, 'mesh'); if (mesh) disposeMeshComponent(mesh);
      world.destroyEntity(soldierId);
    }
    const mesh = world.get(localId, 'mesh'); if (mesh) disposeMeshComponent(mesh);
    world.destroyEntity(localId); _netSquads.delete(netId); _localSquads.delete(localId);
  }
  for (const [netId, data] of snapshot.squads) {
    const team = data.team === 'Blue' ? 'blue' : 'red';
    let localId = _netSquads.get(netId);
    if (localId == null) {
      localId = createSquadEntity(world, team, data.position.x, data.position.z, data.soldiers.length,
        data.faction === 'chaos' ? 'chaos_space_marine' : null, data.faction || 'ig');
      _netSquads.set(netId, localId!); _localSquads.set(localId!, netId);
    }
    const squad = world.get(localId, 'squad');
    if (data.owner === _myPlayerId) setPlayerFaction(data.faction || 'ig');
    Object.assign(squad, {
      team, owner: data.owner, netId,
      speed: data.speed, attackRange: data.attack_range, detectionRange: data.detection_range,
      stopped: data.stopped, autoChase: data.auto_chase,
      moveOrder: data.move_order ? _toVector3(data.move_order) : null,
      forcedTarget: _netSquads.get(data.forced_target) ?? null,
      autoReinforce: data.auto_reinforce,
    });
    squad.position.copy(_toVector3(data.position)); squad.facing.copy(_toVector3(data.facing));
    for (let i = 0; i < data.soldiers.length; i++) {
      const remote = data.soldiers[i]; let id = squad.soldiers[i + 1];
      if (!remote || remote.hp <= 0) {
        if (id != null) { const mesh = world.get(id, 'mesh'); if (mesh) disposeMeshComponent(mesh); world.destroyEntity(id); squad.soldiers[i + 1] = null; }
        continue;
      }
      if (id == null || !world.has(id, 'soldier')) {
        id = createSoldierEntity(world, localId, i + 1, squad.unitType);
        squad.soldiers[i + 1] = id;
        const mesh = world.get(id, 'mesh'); if (mesh?.root) mesh.root.position.copy(squad.position);
      }
      const soldier = world.get(id, 'soldier');
      if (soldier) { soldier.hp = remote.hp; soldier.maxHp = remote.max_hp || Math.max(100, remote.hp); }
    }
  }
  updateHUD();
}

function _onDelta(delta: any): void {
  if (_lobbyOnly || !world || _netSchema===2) return;
  if (delta.tick < _lastDeltaTick) {
    return;
  }
  _lastDeltaTick = delta.tick;
  for (const [id, x, z] of (delta.squad_pos || [])) {
    const squad = world.get(_netSquads.get(id), 'squad');
    if (squad) {
      squad.position.x = x;
      squad.position.z = z;
    }
  }
  for (const [id, facingX, facingZ] of (delta.squad_facing || [])) {
    const squad = world.get(_netSquads.get(id), 'squad');
    if (squad) {
      squad.facing.x = facingX;
      squad.facing.z = facingZ;
      squad.visualFacing.x = facingX;
      squad.visualFacing.z = facingZ;
    }
  }
}

function _onCmdAck(ack: any): void {
  if (!ack.ok) {
    console.warn('[WTNet] Command rejected:', ack.reason);
    _multiplayerLobbyUI?.status(ack.reason || 'Command rejected');
    if(window._multiplayerMode){
      let notice=document.getElementById('network-order-error');
      if(!notice){notice=document.createElement('div');notice.id='network-order-error';notice.style.cssText='position:fixed;top:85px;left:50%;transform:translateX(-50%);z-index:10001;padding:10px 18px;background:#291c16ee;border:1px solid #bb7555;color:#f5d5bc;font:13px sans-serif;pointer-events:none';document.body.append(notice);}
      notice.textContent=ack.reason||'Command rejected';notice.style.display='block';
      const text=notice.textContent;setTimeout(()=>{if(notice?.textContent===text)notice.style.display='none'},3500);
    }
  }
}

const _net = new WTNet();

export function netMoveSquads(ids: any, target: any): void {
  _net.sendCmd({ MoveSquads: { squad_ids: ids.map((id: number) => _localSquads.get(id) ?? id), target: { x: target.x, y: target.y, z: target.z } } });
}
export function netMoveBuilders(ids: any, target: any): void {
  _net.sendCmd({ MoveBuilders: { builder_ids: ids, target: { x: target.x, y: target.y, z: target.z } } });
}
export function netMoveApcs(ids: any, target: any): void {
  _net.sendCmd({ MoveApcs: { apc_ids: ids, target: { x: target.x, y: target.y, z: target.z } } });
}
export function netMoveJets(ids: any, target: any): void {
  _net.sendCmd({ MoveJets: { jet_ids: ids, target: { x: target.x, y: target.y, z: target.z } } });
}
export function netStopSquads(ids: any): void {
  _net.sendCmd({ StopSquads: { squad_ids: ids.map((id: number) => _localSquads.get(id) ?? id) } });
}
export function netAttackSquad(attackerIds: any, targetId: any): void {
  _net.sendCmd({ AttackSquad: { attacker_ids: attackerIds.map((id: number) => _localSquads.get(id) ?? id), target_squad: _localSquads.get(targetId) ?? targetId } });
}
export function netAttackSoldier(attackerIds: any, targetId: any): void {
  const squadId = world.get(targetId, 'soldier')?.squadId;
  if (squadId != null) netAttackSquad(attackerIds, squadId);
}
export function netAttackBuilding(attackerIds: any, targetId: any): void {
  _net.sendCmd({ AttackBuilding: { attacker_ids: attackerIds.map((id: number) => _localSquads.get(id) ?? id), target_building: targetId } });
}

export function netPlaceBuilding(type: any, position: any, builderId: any = selBuilder): void {
  _net.sendCmd({ PlaceBuilding: { builder_id: builderId, building_type: type, position: { x: position.x, y: position.y, z: position.z } } });
}
export function netReinforce(squadId: any, formIdx: any): void {
  _net.sendCmd({ Reinforce: { squad_id: _localSquads.get(squadId) ?? squadId, form_idx: formIdx } });
}
export function netAutoReinforce(squadId: any, enabled: any): void {
  _net.sendCmd({ AutoReinforce: { squad_id: _localSquads.get(squadId) ?? squadId, enabled } });
}
export function netSetProjectileType(squadId: any, type: any): void {
  _net.sendCmd({ SetProjectileType: { squad_id: _localSquads.get(squadId) ?? squadId, proj_type: type } });
}
export function netTrainUnit(buildingId: any, unitType: any): void {
  _net.sendCmd({ TrainUnit: { building_id: buildingId, unit_type: unitType } });
}
export function netGrenadeUpgrade(squadId: any, soldierId: any): void {
  _net.sendCmd({ GrenadeUpgrade: { squad_id: _localSquads.get(squadId) ?? squadId, sol_id: soldierId } });
}
export function netPlasmaUpgrade(squadId: any, soldierId: any): void {
  _net.sendCmd({ PlasmaUpgrade: { squad_id: _localSquads.get(squadId) ?? squadId, sol_id: soldierId } });
}
export function netDemolishBuilding(id: any): void {
  _net.sendCmd({ DemolishBuilding: { building_id: id } });
}
export function netSpendRequisition(amount: any): void {
  _net.sendCmd({ SpendRequisition: { amount } });
}

function _toVector3(vector: any): THREE.Vector3 {
  if (!vector) {
    return new THREE.Vector3(0, 0, 0);
  }
  return new THREE.Vector3(vector.x ?? 0, vector.y ?? 0, vector.z ?? 0);
}

function _buildingEntityTypeName(type: string): string {
  const mapping: Record<string, string> = {
    Barracks: 'barracks',
    InfantryCommand: 'infantry_command',
    Tower: 'tower',
    Turret: 'turret',
    ThermoGen: 'thermoGen',
    ListeningPost: 'listeningPost',
    TowerBase: 'towerBase',
    APC: 'apc',
    Airfield: 'airfield',
    GunTurret: 'gunTurret',
    PlasmaGenerator: 'plasma_generator',
    TacticaControl: 'tactica_control',
    MarsPattern: 'mars_pattern',
    Mines: 'mines',
  };
  return mapping[type] || 'barracks';
}

export function _injectConnectUI() {
  document.getElementById('webTransport-connect-overlay')?.remove();
  document.getElementById('webTransport-net-hud')?.remove();
  document.getElementById('webTransport-connect-style')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'webTransport-connect-overlay';
  overlay.innerHTML = [
    '<div class="webTransport-panel">',
    '<div id="webTransport-connect-form">',
    `<div class="webTransport-field-row webTransport-server-row"><label>SERVER</label><input id="webTransport-url" type="text" value="${SERVER_URL}"></div>`,
    `<div class="webTransport-field-row webTransport-server-row"><label>CERT&nbsp;HASH</label><input id="webTransport-cert" type="text" value="${SERVER_CERT_HASH}"></div>`,
    '<div style="display:flex;gap:8px;margin-top:6px"><button id="wt-connect-btn" class="webTransport-button">CONNECT</button></div>',
    '<div id="webTransport-connect-status" style="margin-top:8px;font-size:9px;letter-spacing:.1em;color:#ff8833;min-height:14px"></div>',
    '</div>',
    '<div id="webTransport-load-wrap" style="display:none">',
    '<div class="webTransport-load-title">LOADING</div>',
    '<div class="webTransport-load-track"><div id="webTransport-load-fill" class="webTransport-load-fill"></div></div>',
    '<div id="webTransport-load-label" class="webTransport-load-label"></div>',
    '<div id="webTransport-load-timer" class="webTransport-load-timer">⏱ 0.0s</div>',
    '</div>',
    '</div>',
  ].join('');
  const style = document.createElement('style');
  style.id = 'webTransport-connect-style';
  style.textContent = [
    '#webTransport-connect-overlay { position:fixed; inset:0; z-index:9999; background:rgba(4,8,18,0.92); display:flex; align-items:center; justify-content:center; }',
    '.webTransport-panel { background:rgba(10,18,35,0.97); border:1px solid rgba(80,200,255,0.35); padding:28px 32px; max-width:480px; width:100%; font-family:\'Courier New\',monospace; box-shadow:0 0 40px rgba(80,200,255,0.15); }',
    '.webTransport-title { font-size:18px;letter-spacing:.25em;color:#50c8ff;margin-bottom:3px; }',
    '.webTransport-subtitle { font-size:9px;letter-spacing:.2em;color:#50c8ff;opacity:.45;margin-bottom:18px; }',
    '.webTransport-field-row { display:flex;align-items:center;gap:10px;margin-bottom:10px; }',
    '.webTransport-field-row label { font-size:9px;letter-spacing:.12em;color:#50c8ff;width:72px;flex-shrink:0; }',
    '.webTransport-field-row input { flex:1; background:rgba(80,200,255,0.06); border:1px solid rgba(80,200,255,0.25); color:#fff; font-family:\'Courier New\',monospace; font-size:10px; padding:5px 8px; outline:none; }',
    '.webTransport-field-row select { flex:1; background:rgba(80,200,255,0.06); border:1px solid rgba(80,200,255,0.25); color:#fff; font-family:\'Courier New\',monospace; font-size:10px; padding:5px 8px; outline:none; }',
    '.webTransport-field-row select option { background:#0a1226; }',
    '.webTransport-button { flex:1; padding:8px; background:rgba(80,200,255,0.1); border:1px solid rgba(80,200,255,0.4); color:#50c8ff; font-family:\'Courier New\',monospace; font-size:10px; letter-spacing:.1em; cursor:pointer; }',
    '.webTransport-button:hover { background:rgba(80,200,255,0.2); }',
    '.webTransport-offline { border-color:rgba(255,200,80,0.4);color:#ffc850; background:rgba(255,200,80,0.08); }',
    '.webTransport-offline:hover { background:rgba(255,200,80,0.2); }',
    '#webTransport-net-hud { position:fixed; top:48px; right:8px; z-index:20; font-family:\'Courier New\',monospace; font-size:8px; letter-spacing:.1em; padding:3px 7px; background:rgba(5,8,18,0.8); border:1px solid rgba(80,200,255,0.15); pointer-events:none; }',
    '.webTransport-load-title { font-size:12px; letter-spacing:.25em; color:#50c8ff; margin:6px 0 10px; }',
    '.webTransport-load-track { height:10px; background:rgba(80,200,255,0.08); border:1px solid rgba(80,200,255,0.35); }',
    '.webTransport-load-fill { height:100%; width:0%; background:#50c8ff; transition:width .15s; }',
    '.webTransport-load-label { margin-top:6px; font-size:9px; letter-spacing:.1em; color:rgba(255,255,255,0.55); min-height:13px; }',
    '.webTransport-load-timer { margin-top:4px; font-size:10px; letter-spacing:.15em; color:#ffc850; min-height:14px; }',
    '.webTransport-panel.webTransport-panel-skirmish { max-width:900px; width:calc(100% - 24px); box-sizing:border-box; align-self:flex-start; margin-top:clamp(16px,5vh,48px); max-height:calc(100dvh - 176px); overflow-y:auto; }',
    '.webTransport-map-label { font-size:9px; letter-spacing:.2em; color:#50c8ff; opacity:.7; margin:2px 0 8px; }',
    '.webTransport-map-body { display:flex; gap:10px; align-items:flex-start; margin-bottom:14px; }',
    '.webTransport-map-grid { flex:1; min-width:0; display:grid; grid-template-columns:1fr; gap:8px; max-height:360px; overflow-y:auto; }',
    '.webTransport-map-detail { width:220px; flex:none; display:flex; flex-direction:column; gap:6px; padding:6px; background:rgba(80,200,255,0.05); border:1px solid rgba(80,200,255,0.25); }',
    '.webTransport-map-detail-img { width:100%; height:200px; object-fit:cover; display:block; background:#06101f; }',
    '.webTransport-map-detail-empty { display:flex; align-items:center; justify-content:center; font-size:10px; letter-spacing:.3em; color:#50c8ff; }',
    '.webTransport-map-detail-cap { font-size:9px; letter-spacing:.08em; text-transform:uppercase; color:#fff; text-align:center; }',
    '.webTransport-map-card { display:flex; flex-direction:column; gap:2px; padding:3px 6px; background:rgba(80,200,255,0.05); border:1px solid rgba(80,200,255,0.25); cursor:pointer; font-family:\'Courier New\',monospace; color:#fff; text-align:left; }',
    '.webTransport-map-card:hover { background:rgba(80,200,255,0.12); }',
    '.webTransport-map-card.active { border-color:#50c8ff; background:rgba(80,200,255,0.15); }',
    '.webTransport-map-name { font-size:9px; letter-spacing:.08em; text-transform:uppercase; }',
    '.webTransport-map-players { font-size:8px; letter-spacing:.15em; color:#ffc850; }',
    '.webTransport-lobby-label { font-size:9px; letter-spacing:.2em; color:#50c8ff; opacity:.7; margin:2px 0 8px; }',
    '.webTransport-server-list { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; max-height:150px; overflow-y:auto; }',
    '.webTransport-server-row { display:grid; grid-template-columns:1fr 1fr auto; gap:8px; align-items:center; padding:5px 8px; background:rgba(80,200,255,0.05); border:1px solid rgba(80,200,255,0.25); color:#fff; font-family:\'Courier New\',monospace; font-size:9px; letter-spacing:.06em; cursor:pointer; text-align:left; }',
    '.webTransport-server-row:hover { background:rgba(80,200,255,0.12); }',
    '.webTransport-server-row.active { border-color:#50c8ff; background:rgba(80,200,255,0.15); }',
    '.webTransport-server-map { color:rgba(255,255,255,0.6); }',
    '.webTransport-server-players { color:#ffc850; }',
    '.webTransport-server-players.full { color:#ff5555; }',
    '.webTransport-slot-panel { margin-bottom:14px; max-height:170px; overflow-y:auto; border:1px solid rgba(80,200,255,0.2); }',
    '.webTransport-slot-head, .webTransport-slot-row { display:grid; grid-template-columns:1.4fr 1fr 0.6fr 0.6fr; gap:8px; padding:4px 8px; font-size:8px; letter-spacing:.08em; }',
    '.webTransport-slot-head { color:#50c8ff; opacity:.7; border-bottom:1px solid rgba(80,200,255,0.2); }',
    '.webTransport-slot-row { color:#fff; border-bottom:1px solid rgba(80,200,255,0.08); }',
    '.webTransport-slot-team-1 { color:#50c8ff; }',
    '.webTransport-slot-team-2 { color:#ff7a50; }',
    '.webTransport-slot-empty { padding:10px; text-align:center; font-size:9px; letter-spacing:.15em; color:rgba(255,255,255,0.4); }',
  ].join(' ');
  document.head.appendChild(style);
  document.body.appendChild(overlay);

  const badge = document.createElement('div');
  badge.id = 'webTransport-net-hud';
  badge.textContent = '⚡ OFFLINE';
  document.body.appendChild(badge);

  document.getElementById('wt-connect-btn')?.addEventListener('click', webTransportConnect);
  _multiplayerLobbyUI = mountMultiplayerLobby(overlay.querySelector('.webTransport-panel') as HTMLElement, {
    back: () => { hideConnectOverlay(); window.__grimcraftShowMainMenu?.(); },
    select: (lobby, map) => {
      _selectedLobby = lobby;
      _selectedMap = map?.path ? { path: map.path, url: map.url, name: map.name } : null;
    },
    connect: () => { void webTransportConnect(); },
    startLocal: (config) => { _leaveOnlineLobby(); void webTransportPlayOffline(config); },
    joinOnline: _joinOnlineLobby,
    leaveOnline: _leaveOnlineLobby,
    startOnline: (computers, balanceMod) => { _net.sendCmd({StartGame:{computers, balanceMod}}); },
    factionOnline: (faction) => { _net.sendCmd({SetLobbyFaction:{faction}}); },
  });
  _injectSkirmishUI();
}

export function showConnectOverlay(mode = 'multiplayer'): void {
  const isSkirmish = mode === 'skirmish';
  const shell = document.querySelector<HTMLElement>('#webTransport-connect-overlay .mp-shell');
  if (shell) shell.classList.toggle('mp-offline-loading', isSkirmish);
  if (!isSkirmish) _multiplayerLobbyUI?.reset();
  const panel = document.querySelector('#webTransport-connect-overlay .webTransport-panel');
  panel?.classList.toggle('webTransport-panel-skirmish', isSkirmish);
  _setConnectOverlay(true);
}

export function hideConnectOverlay() {
  _setConnectOverlay(false);
  _setNetHudVisible(false);
}

function _setSkirmishPanel(visible: boolean): void {
  const element = document.getElementById('skirmish-panel');
  if (element) {
    element.style.display = visible ? 'flex' : 'none';
  }
}

const SKIRMISH_FACTIONS = ['Space Marines', 'Imperial Guard', 'Chaos', 'Eldar', 'Dark Eldar', 'Orks', 'Necrons', 'Tau'];
const SKIRMISH_DIFFICULTIES = ['easy', 'standard', 'advanced', 'hard'];
let _skirmishLobby: Lobby | null = null;

function _injectSkirmishUI(): void {
  if (document.getElementById('skirmish-panel')) {
    return;
  }
  const overlay = document.createElement('div');
  overlay.id = 'skirmish-panel';
  overlay.style.display = 'none';
  overlay.innerHTML = [
    '<div class="webTransport-panel webTransport-panel-skirmish mp-shell">',
    '<div id="skirmish-step-maps">',
    '<header class="mp-heading"><span class="mp-brand">GRIMCRAFT <small>SKIRMISH</small></span><h1>SELECT BATTLEFIELD</h1><span class="mp-session">OFFLINE</span></header>',
    '<div class="webTransport-map-body">',
    '<div id="skirmish-map-grid" class="webTransport-map-grid"></div>',
    '<div id="skirmish-map-detail" class="webTransport-map-detail"></div>',
    '</div>',
    '<div style="display:flex;gap:8px;margin-top:8px"><button id="skirmish-back-btn" class="webTransport-button webTransport-offline">‹ BACK</button></div>',
    '</div>',
    '<div id="skirmish-step-slots" style="display:none">',
    '<header class="mp-heading"><span class="mp-brand">GRIMCRAFT <small>SKIRMISH</small></span><h1>SKIRMISH SETUP</h1><span class="mp-session">OFFLINE</span></header>',
    '<div class="mp-columns">',
    '<section class="mp-left"><div class="mp-metal mp-list-frame"><h2 class="mp-tab">Players List</h2><div id="skirmish-slot-panel" class="mp-inset"></div></div>',
    '<footer class="mp-parchment"><div id="skirmish-actions"></div><p id="skirmish-slots-status"></p></footer>',
    '</section>',
    '<aside class="mp-right">',
    '<section class="mp-metal mp-map-panel"><h2 id="skirmish-map-title" class="mp-map-title"></h2><div class="mp-map-content"><div><div class="mp-map-stats"><span>Max Players: <b id="skirmish-max-players"></b></span><span>Map Size: <b id="skirmish-map-size"></b></span></div><p id="skirmish-map-description" class="mp-inset"></p></div><div id="skirmish-map-preview" class="mp-inset"></div></div></section>',
    '<section class="mp-metal mp-options"><div class="mp-inset"><div><h3>Game Options</h3><dl><dt>AI difficulty</dt><dd>Per Computer slot</dd><dt>Starting resources</dt><dd>Standard</dd><dt>Lock teams</dt><dd>Yes</dd><dt>Enable cheats</dt><dd>No</dd><dt>Starting location</dt><dd>Fixed</dd><dt>Game speed</dt><dd>Normal</dd><dt>Resource Sharing</dt><dd>No</dd><dt>Resource Rate</dt><dd>Standard</dd></dl></div><div><h3>Game rules</h3><p>Annihilate</p><p>Control Area</p><p>Take and Hold</p></div></div></section>',
    '</aside>',
    '</div>',
    '</div>',
    '</div>',
  ].join('');
  const style = document.createElement('style');
  style.textContent = [
    '#skirmish-panel { position:fixed; inset:0; z-index:9999; background:radial-gradient(ellipse at 12% 0%, #bd875b66, transparent 52%), radial-gradient(ellipse at 90% 70%, #4e302566, transparent 50%), linear-gradient(135deg, #151719, #26231f 50%, #111415); padding:24px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; overflow-y:auto; }',
    '#skirmish-panel .webTransport-panel-skirmish.mp-shell { width:min(1420px, 100%); max-width:1420px; }',
    '#skirmish-slot-panel { flex:1; overflow-y:visible; min-height:0; padding:2px; }',
    '#skirmish-step-slots .mp-list-frame { padding:44px 14px 12px; }',
    '#skirmish-step-slots .mp-player-row { min-height:0; padding:5px 10px; margin:3px 0; gap:8px; }',
    '#skirmish-step-slots .mp-player-empty { min-height:0; padding:5px 10px; }',
    '#skirmish-step-slots .mp-player-identity { gap:4px; }',
    '#skirmish-step-slots .mp-player-identity strong { font-size:12px; }',
    '#skirmish-step-slots .mp-player-colour { height:5px; }',
    '#skirmish-step-slots .mp-player-row select { padding:3px 6px; font-size:11px; }',
    '#skirmish-step-slots .mp-parchment { margin:0 20px; padding:8px 20px 6px; }',
    '#skirmish-step-slots .mp-map-panel { padding:8px 12px 10px; }',
    '#skirmish-step-slots #skirmish-map-description { min-height:0; padding:8px; font-size:12px; }',
    '#skirmish-step-slots .mp-options { padding:8px 12px; }',
    '#skirmish-step-slots .mp-options > .mp-inset { padding:8px 10px; gap:12px; }',
    '#skirmish-step-slots .mp-right { gap:10px; }',
    '#skirmish-map-preview { display:flex; align-items:center; justify-content:center; aspect-ratio:1; border-radius:2px; overflow:hidden; font-size:10px; letter-spacing:.15em; color:#817e6e; }',
    '#skirmish-map-preview img { width:100%; height:100%; object-fit:cover; filter:grayscale(.75) contrast(1.15); }',
  ].join(' ');
  document.head.appendChild(style);
  document.body.appendChild(overlay);
  const skirmishActions = document.getElementById('skirmish-actions');
  if (skirmishActions) {
    const start = document.createElement('button');
    start.type = 'button'; start.textContent = 'START BATTLE';
    start.addEventListener('click', () => { _startSkirmishBattle(); });
    const maps = document.createElement('button');
    maps.type = 'button'; maps.textContent = 'MAPS';
    maps.addEventListener('click', () => { _showSkirmishStep('maps'); });
    skirmishActions.append(start, maps);
  }
  document.getElementById('skirmish-back-btn')?.addEventListener('click', () => {
    hideSkirmishPanel();
    if (window.__grimcraftShowMainMenu) {
      window.__grimcraftShowMainMenu();
    }
  });
  _buildMapGrid('skirmish-map-grid', 'skirmish-map-detail');
}

function _showSkirmishStep(which: 'maps' | 'slots'): void {
  const maps = document.getElementById('skirmish-step-maps');
  const slots = document.getElementById('skirmish-step-slots');
  if (maps) maps.style.display = which === 'maps' ? '' : 'none';
  if (slots) slots.style.display = which === 'slots' ? '' : 'none';
}

function _skirmishStatus(message: string): void {
  const element = document.getElementById('skirmish-slots-status');
  if (element) element.textContent = message;
}

// Slots reuse the multiplayer lobby layout one-to-one, but stay offline:
// slot 0 is the human player, every other taken slot is a computer ally
// or enemy, and empty slots simply do not spawn. Slots start filled with
// AI following the map layout (Alvarus fills all 6 slots, 3 vs 3).
function _openSkirmishSlots(card: any): void {
  _selectedMap = card.path ? { path: card.path, url: card.url, name: card.name } : null;
  const dota = isDotaMap(card.path || 'arena');
  const layoutPositions = layoutFor(card.path || 'arena').positions;
  const lobby = createLobby({ name: 'Skirmish', map: card.name, total: card.players || layoutPositions.length || 6 });
  const factionById: Record<string, string> = Object.fromEntries(Object.entries(LOBBY_FACTIONS).map(([name, id]) => [id, name]));
  const slotTeam = (slot: number): number => {
    const team = (layoutPositions[slot] as { team?: unknown } | undefined)?.team;
    if (team === 'red') return 2;
    if (team === 'blue') return 1;
    return slot < Math.ceil(lobby.total / 2) ? 1 : 2;
  };
  const slotFaction = (slot: number): string => {
    const faction = (layoutPositions[slot] as { faction?: string } | undefined)?.faction;
    return (faction && factionById[faction]) || (slotTeam(slot) === 2 ? 'Chaos' : 'Space Marines');
  };
  setLobbySlot(lobby, 0, { username: 'You', faction: 'Imperial Guard', team: 1, ping: 0, controller: 'human', ...(dota ? { hero: 'axe' } : {}) });
  for (let slot = 1; slot < lobby.total; slot++) {
    setLobbySlot(lobby, slot, { username: `Computer ${slot + 1}`, faction: slotFaction(slot), team: slotTeam(slot), ping: 0, controller: 'computer', difficulty: 'standard', ...(dota ? { hero: 'lina' } : {}) });
  }
  _skirmishLobby = lobby;
  _skirmishStatus('');
  _renderSkirmishMapPanel(card, lobby.total);
  _renderSkirmishSlots();
  _showSkirmishStep('slots');
}

function _renderSkirmishMapPanel(card: any, total: number): void {
  const label = card.name.replace(/^\d+p\s+/i, '');
  const title = document.getElementById('skirmish-map-title');
  if (title) title.textContent = `${label} (${total})`;
  const maxPlayers = document.getElementById('skirmish-max-players');
  if (maxPlayers) maxPlayers.textContent = String(total);
  const size = document.getElementById('skirmish-map-size');
  if (size) size.textContent = card.path && /alvarus/i.test(card.path) ? '512 × 512' : card.path ? '—' : 'ARENA';
  const description = document.getElementById('skirmish-map-description');
  if (description) description.textContent = isDotaMap(card.path || '') ? 'Choose your hero before battle. Radiant and Dire fight across three lanes with melee, ranged and siege creep waves.' : `${label}. Secure strategic points, control resources and lead your army to victory.`;
  const preview = document.getElementById('skirmish-map-preview');
  if (preview) {
    preview.replaceChildren();
    if (card.previewUrl) {
      const img = document.createElement('img');
      img.src = card.previewUrl;
      img.alt = `${label} map preview`;
      img.addEventListener('error', () => { preview.textContent = 'NO PREVIEW'; });
      preview.append(img);
    } else {
      preview.textContent = card.path ? 'NO PREVIEW' : 'ARENA';
    }
  }
}

function _renderSkirmishSlots(): void {
  const panel = document.getElementById('skirmish-slot-panel');
  const lobby = _skirmishLobby;
  if (!panel || !lobby) return;
  const dota = isDotaMap(_selectedMap?.path || 'arena');
  panel.replaceChildren();
  const slots = lobbySlots(lobby);
  for (let i = 0; i < lobby.total; i++) {
    const player = slots[i];
    const row = document.createElement('div');
    row.className = 'mp-player-row mp-host-slot' + (!player ? ' mp-player-empty' : '');
    const control = document.createElement('select');
    control.className = 'mp-slot-controller';
    control.setAttribute('aria-label', `Slot ${i + 1}`);
    const options: Array<[string, string]> = [['open', 'Open slot'], ['computer', 'Computer']];
    if (i === 0) options.push(['human', 'Human (you)']);
    for (const [value, text] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      control.append(option);
    }
    control.value = player ? (player.controller === 'computer' ? 'computer' : 'human') : 'open';
    control.addEventListener('change', () => {
      if (!_skirmishLobby) return;
      setLobbySlot(_skirmishLobby, i, control.value === 'open' ? null : {
        username: control.value === 'computer' ? `Computer ${i + 1}` : 'You',
        faction: dota ? 'Imperial Guard' : player?.faction || 'Space Marines',
        ...(dota ? { hero: player?.hero || (i === 0 ? 'axe' : 'lina') } : {}),
        team: player?.team || (i === 0 ? 1 : 2),
        ping: 0,
        controller: control.value === 'computer' ? 'computer' : 'human',
        ...(control.value === 'computer' ? { difficulty: player?.difficulty || 'standard' } : {}),
      });
      _skirmishStatus('');
      _renderSkirmishSlots();
    });
    row.append(control);
    if (!player) {
      const empty = document.createElement('span');
      empty.textContent = 'Open slot';
      row.append(empty);
      panel.append(row);
      continue;
    }
    const identity = document.createElement('div');
    identity.className = 'mp-player-identity';
    const name = document.createElement('strong');
    name.textContent = player.username;
    const colour = document.createElement('span');
    colour.className = 'mp-player-colour';
    colour.style.background = player.team === 2 ? '#a83e32' : '#3e7295';
    identity.append(name, colour);
    if (player.controller === 'computer') {
      const difficulty = document.createElement('select');
      difficulty.setAttribute('aria-label', `AI difficulty for ${player.username}`);
      for (const level of SKIRMISH_DIFFICULTIES) {
        const option = document.createElement('option');
        option.value = level;
        option.textContent = level[0].toUpperCase() + level.slice(1);
        difficulty.append(option);
      }
      difficulty.value = player.difficulty || 'standard';
      player.difficulty = difficulty.value as typeof player.difficulty;
      difficulty.addEventListener('change', () => { player.difficulty = difficulty.value as typeof player.difficulty; });
      identity.append(difficulty);
    }
    row.append(identity);
    if (dota) {
      row.append(heroSlotButton(player.hero, i, player.username, hero => {
        player.hero = hero.name;
        _skirmishStatus('');
        _renderSkirmishSlots();
      }));
    } else {
      const faction = document.createElement('select');
      faction.setAttribute('aria-label', `Army for ${player.username}`);
      for (const name of SKIRMISH_FACTIONS) {
        const option = document.createElement('option');
        option.textContent = name;
        option.value = name;
        faction.append(option);
      }
      faction.value = SKIRMISH_FACTIONS.includes(player.faction) ? player.faction : SKIRMISH_FACTIONS[0];
      player.faction = faction.value;
      faction.addEventListener('change', () => { player.faction = faction.value; _skirmishStatus(''); });
      row.append(faction);
    }
    const team = document.createElement('select');
    team.className = 'mp-team';
    team.setAttribute('aria-label', `Team for ${player.username}`);
    for (const n of [1, 2]) {
      const option = document.createElement('option');
      option.value = String(n);
      option.textContent = dota ? (n === 1 ? 'Radiant' : 'Dire') : `Team ${n}`;
      team.append(option);
    }
    team.value = String(player.team);
    team.addEventListener('change', () => {
      player.team = Number(team.value);
      colour.style.background = player.team === 2 ? '#a83e32' : '#3e7295';
      _skirmishStatus('');
    });
    row.append(team);
    const ready = document.createElement('span');
    ready.className = 'mp-ready' + (player.controller === 'computer' ? ' is-ready' : '');
    ready.textContent = player.controller === 'computer' ? '✓' : '·';
    ready.title = player.controller === 'computer' ? 'Ready' : 'Not ready';
    row.append(ready);
    panel.append(row);
  }
}

function _startSkirmishBattle(): void {
  if (!_skirmishLobby) return;
  let config: LocalMatchConfig;
  try {
    config = makeLocalMatch(_skirmishLobby, _selectedMap?.path || 'arena');
  } catch (error) {
    _skirmishStatus((error as Error).message);
    return;
  }
  void webTransportPlayOffline(config);
}

export function showSkirmishPanel(): void {
  _setConnectOverlay(false);
  _buildMapGrid('skirmish-map-grid', 'skirmish-map-detail');
  _showSkirmishStep('maps');
  _setSkirmishPanel(true);
}

export function hideSkirmishPanel(): void {
  _setSkirmishPanel(false);
  _setNetHudVisible(false);
}

function _renderMapDetail(card: any, box: HTMLElement | null = document.getElementById('webTransport-map-detail')): void {
  if (!box || !card) {
    return;
  }
  box.innerHTML = '';
  if (previewState(card).kind === 'image') {
    const img = document.createElement('img');
    img.className = 'webTransport-map-detail-img';
    img.src = card.previewUrl;
    img.alt = '';
    img.addEventListener('error', () => {
      const placeholder = document.createElement('div');
      placeholder.className = 'webTransport-map-detail-img webTransport-map-detail-empty';
      placeholder.textContent = card.path ? 'NO PREVIEW' : 'ARENA';
      img.replaceWith(placeholder);
    });
    box.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'webTransport-map-detail-img webTransport-map-detail-empty';
    placeholder.textContent = card.path ? 'NO PREVIEW' : 'ARENA';
    box.appendChild(placeholder);
  }
  const cap = document.createElement('div');
  cap.className = 'webTransport-map-detail-cap';
  cap.textContent = entryLabel(card);
  box.appendChild(cap);
}

function _buildMapGrid(gridId = 'webTransport-map-grid', detailId = 'webTransport-map-detail') {
  const grid = document.getElementById(gridId);
  const detail = document.getElementById(detailId);
  if (!grid || !detail) {
    return;
  }
  grid.innerHTML = '';
  // Map list resolves to build-time glob entries in dev, or the uploaded
  // manifest over R2 in production (dist/ carries no maps/).
  void listMaps().then((entries) => {
    if (!grid.isConnected) return;
    grid.innerHTML = '';
    _buildMapGridEntries(grid, detail, skirmishMapCards(entries));
  }).catch(() => {
    if (!grid.isConnected) return;
    grid.innerHTML = '';
    _buildMapGridEntries(grid, detail, skirmishMapCards([]));
  });
}

function _buildMapGridEntries(grid: HTMLElement, detail: HTMLElement, cards: MapCard[]): void {
  if (!_selectedMap) {
    const def = defaultSkirmishMap(cards);
    if (def) {
      _selectedMap = { path: def.path, url: def.url, name: def.name };
    }
  }
  const selectedKey = _selectedMap ? _selectedMap.path : 'arena';
  for (const card of cards) {
    const key = card.path || 'arena';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'webTransport-map-card' + (key === selectedKey ? ' active' : '');
    const name = document.createElement('span');
    name.className = 'webTransport-map-name';
    name.textContent = card.name;
    btn.appendChild(name);
    if (card.players) {
      const players = document.createElement('span');
      players.className = 'webTransport-map-players';
      players.textContent = `${card.players}P`;
      btn.appendChild(players);
    }
    btn.addEventListener('click', () => {
      const key = card.path || 'arena';
      const selectedKey = _selectedMap ? _selectedMap.path : 'arena';
      // A second click on the already selected card opens the slots, so
      // slow double clicks work exactly like fast ones.
      if (key === selectedKey && btn.classList.contains('active')) {
        _openSkirmishSlots(card);
        return;
      }
      Array.from(grid.children).forEach((el) => {
        if (el.classList) {
          el.classList.toggle('active', el === btn);
        }
      });
      _selectedMap = card.path ? { path: card.path, url: card.url, name: card.name } : null;
      _renderMapDetail(card, detail);
      prefetchMapFiles(card);
    });
    btn.addEventListener('dblclick', () => {
      _openSkirmishSlots(card);
    });
    grid.appendChild(btn);
  }
  _renderMapDetail(cards.find((c) => (c.path || 'arena') === selectedKey) || null, detail);
}

function _setConnectOverlay(visible: boolean): void {
  const element = document.getElementById('webTransport-connect-overlay');
  if (element) {
    element.style.display = visible ? 'flex' : 'none';
  }
}

function _setNetHudVisible(visible: boolean): void {
  const element = document.getElementById('webTransport-net-hud');
  if (element) {
    element.style.display = visible ? '' : 'none';
  }
}

let _r2Unsubscribe: any = null;
// Peak fill percent this session: the bar is one continuous line and must
// never jump backwards when a new file registers its total mid-download.
let _r2Peak = 0;
// Stable denominator for "done / all": the manifest size known from the
// preflight, so the "all" number never increments mid-download.
let _r2ExpectedTotal = 0;
// Coalesce progress events into at most one DOM update every 150ms,
// including percent changes and fast cache hits. Keep the latest update.
let _r2LastPaint = 0;
let _r2PaintTimer: ReturnType<typeof setTimeout> | null = null;
let _r2LatestSnapshot: any = null;
let _r2Loading = false;
let _r2Session = 0;
// Set when the preflight finds every expected file already in Cache Storage:
// the download bar stays hidden, only the "already downloaded" note shows.
let _r2AllCached = false;

// Standalone R2 download bar: a fixed overlay independent of the LOADING
// panel — one continuous line for the whole download queue, with per-file
// numbering (file N of M) instead of one flashing bar per file. Created
// lazily on first START BATTLE.
function _ensureR2Bar(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.getElementById) {
    return null;
  }
  let bar = document.getElementById('r2-progress');
  if (bar) {
    return bar;
  }
  bar = document.createElement('div');
  bar.id = 'r2-progress';
  bar.style.cssText = [
    'display:none', 'position:fixed', 'left:50%', 'bottom:max(12px,env(safe-area-inset-bottom))',
    'transform:translateX(-50%)', 'width:min(640px,92vw)', 'z-index:10001',
    'pointer-events:none', 'font-family:Courier New,monospace',
    'background:rgba(5,8,18,0.88)', 'border:1px solid rgba(80,200,255,0.4)',
    'padding:8px 12px 10px',
  ].join(';');
  const title = document.createElement('div');
  title.textContent = 'R2 DOWNLOAD';
  title.style.cssText = 'font-size:10px;letter-spacing:.25em;color:#50c8ff;margin-bottom:6px';
  const track = document.createElement('div');
  track.style.cssText = 'height:10px;background:rgba(80,200,255,0.08);border:1px solid rgba(80,200,255,0.35)';
  const fill = document.createElement('div');
  fill.id = 'r2-progress-fill';
  fill.style.cssText = 'height:100%;width:0%;background:#50c8ff;transition:width .2s linear';
  track.appendChild(fill);
  const label = document.createElement('div');
  label.id = 'r2-progress-label';
  label.style.cssText = 'margin-top:6px;font-size:9px;letter-spacing:.1em;color:rgba(255,255,255,0.75);height:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  const cacheLine = document.createElement('div');
  cacheLine.id = 'r2-progress-path';
  cacheLine.style.cssText = 'margin-top:2px;font-size:8px;letter-spacing:.08em;color:rgba(80,200,255,0.6);min-height:11px';
  bar.appendChild(title);
  bar.appendChild(track);
  bar.appendChild(label);
  bar.appendChild(cacheLine);
  document.body.appendChild(bar);
  return bar;
}

function _formatR2MB(bytes: number): string {
  return `${(Math.max(0, bytes) / 1048576).toFixed(1)} MB`;
}

function _setR2CacheLine(text: string): void {
  if (typeof document === 'undefined' || !document.getElementById) {
    return;
  }
  const line = document.getElementById('r2-progress-path');
  if (line) {
    line.textContent = text;
  }
}

function _renderR2Bar(snapshot: any): void {
  if (!_r2Loading || _r2AllCached || !snapshot || snapshot.totalFiles === 0) {
    return;
  }
  _r2LatestSnapshot = snapshot;
  const remaining = 150 - (Date.now() - _r2LastPaint);
  if (_r2LastPaint > 0 && remaining > 0) {
    if (_r2PaintTimer === null) {
      _r2PaintTimer = setTimeout(() => {
        _r2PaintTimer = null;
        _paintR2Bar(_r2LatestSnapshot);
      }, remaining);
    }
    return;
  }
  if (_r2PaintTimer !== null) {
    clearTimeout(_r2PaintTimer);
    _r2PaintTimer = null;
  }
  _paintR2Bar(snapshot);
}

function _paintR2Bar(snapshot: any): void {
  if (!_r2Loading || _r2AllCached || !snapshot) return;
  const bar = _ensureR2Bar();
  if (!bar) {
    return;
  }
  const fill = document.getElementById('r2-progress-fill');
  const text = document.getElementById('r2-progress-label');
  // Stable "all files" number: the manifest size from the preflight, not the
  // growing count of registered downloads.
  const all = _r2ExpectedTotal > 0 ? _r2ExpectedTotal : snapshot.totalFiles;
  bar.style.display = 'block';
  _r2Peak = Math.max(_r2Peak, snapshot.percent);
  _r2LastPaint = Date.now();
  const total = snapshot.totalBytes > 0 ? _formatR2MB(snapshot.totalBytes) : '…';
  if (fill) {
    fill.style.width = `${_r2Peak}%`;
  }
  if (text) {
    const failed = snapshot.failedFiles > 0 ? ` · ⚠ ${snapshot.failedFiles} failed` : '';
    const ongoing = snapshot.totalFiles - snapshot.doneFiles;
    const current = snapshot.current
      ? ` · file ${snapshot.current.index}/${all} ${snapshot.current.name}`
      : '';
    text.textContent = `R2 — ${_formatR2MB(snapshot.loadedBytes)}/${total} · ${ongoing} ongoing / ${all} files${current}${failed}`;
  }
  // A snapshot only covers files registered so far. During sequential
  // loading it becomes complete between files; hide only when boot ends.
}

// Where the R2 bytes live on this device, for the "already downloaded" note.
function _r2CacheLabel(cacheName: any): string {
  return `Cache Storage › ${cacheName || 'browser cache'}`;
}

function _runR2Preflight() {
  if (typeof document === 'undefined' || !document.getElementById) {
    return;
  }
  const session = _r2Session;
  const text = document.getElementById('r2-progress-label');
  if (text) {
    text.textContent = 'Checking downloaded files…';
  }
  _setR2CacheLine('');
  let urls: string[] = [];
  try {
    urls = collectBootR2Urls(ARENA_POSITION_FACTIONS, [
      SP_MODEL_PATHS.point,
      SP_MODEL_PATHS.relic,
      SP_MODEL_PATHS.objective,
      PLASMA_BOLT_PATH,
      `${PLASMA_FX_DIR}/plasma_beam_1.dds`,
      `${PLASMA_FX_DIR}/plasma_flash_1.dds`,
      `${PLASMA_FX_DIR}/plasma_muzzle_1.dds`,
      `${PLASMA_FX_DIR}/plasma_muzzle_2.dds`,
      `${PLASMA_FX_DIR}/plasma_muzzle_3.dds`,
      LASGUN_MODEL_PATH,
    ]);
  } catch (_) {
    urls = [];
  }
  probeR2Cache(urls).then((result) => {
    if (!_r2Loading || session !== _r2Session) return;
    if (!result.checked || result.total === 0) {
      _r2ExpectedTotal = 0;
      _setR2CacheLine('');
      return;
    }
    _r2ExpectedTotal = result.total;
    if (result.missing.length === 0) {
      _r2AllCached = true;
      const bar = _ensureR2Bar();
      if (bar) {
        bar.style.display = 'block';
      }
      const label = document.getElementById('r2-progress-label');
      if (label) {
        label.textContent = `✔ Already downloaded — no download needed`;
      }
      _setR2CacheLine(`${_r2CacheLabel(result.cacheName)} · ${result.cached}/${result.total} files on this device`);
      return;
    }
    _setR2CacheLine(`${_r2CacheLabel(result.cacheName)} · ✔ ${result.cached}/${result.total} already here`);
  }).catch(() => {
    if (_r2Loading && session === _r2Session) _setR2CacheLine('');
  });
}

let _bootTimer: any = null;
let _bootTimerInterval: any = null;

function _tickBootTimer() {
  if (typeof document === 'undefined' || !document.getElementById) {
    return;
  }
  const el = document.getElementById('webTransport-load-timer');
  if (el && _bootTimer) {
    el.textContent = `⏱ ${formatBootTime(_bootTimer.elapsedMs())}`;
  }
}

function _setLoadingUI(loading: boolean): void {
  _r2Loading = loading;
  _r2Session += 1;
  if (_r2PaintTimer !== null) {
    clearTimeout(_r2PaintTimer);
    _r2PaintTimer = null;
  }
  _r2LatestSnapshot = null;
  document.querySelector('.mp-shell')?.classList.toggle('mp-is-loading', loading);
  const form = document.getElementById('webTransport-connect-form');
  const wrap = document.getElementById('webTransport-load-wrap');
  if (form) {
    form.style.display = loading ? 'none' : '';
  }
  if (wrap) {
    wrap.style.display = loading ? '' : 'none';
  }
  if (loading) {
    resetR2Progress();
    _r2Peak = 0;
    _r2ExpectedTotal = 0;
    _r2LastPaint = 0;
    _r2AllCached = false;
    _ensureR2Bar();
    if (_r2Unsubscribe) {
      _r2Unsubscribe();
    }
    _r2Unsubscribe = subscribeR2Progress(_renderR2Bar);
    _updateLoadBar({ loaded: 0, total: 0, label: '' });
    _runR2Preflight();
    _bootTimer = createBootTimer();
    _bootTimer.start();
    _tickBootTimer();
    if (typeof setInterval !== 'undefined') {
      if (_bootTimerInterval) {
        clearInterval(_bootTimerInterval);
      }
      _bootTimerInterval = setInterval(_tickBootTimer, 100);
    }
  } else {
    if (_bootTimerInterval) {
      clearInterval(_bootTimerInterval);
      _bootTimerInterval = null;
    }
    if (_bootTimer) {
      const totalMs = _bootTimer.stop();
      _bootTimer = null;
      if (typeof window !== 'undefined') {
        window._lastBootMs = totalMs;
      }
      if (typeof console !== 'undefined' && console.log) {
        console.log(`[BOOT] game loaded in ${formatBootTime(totalMs)}`);
      }
      _updateNetHUD();
    }
    if (_r2Unsubscribe) {
      _r2Unsubscribe();
      _r2Unsubscribe = null;
    }
    _r2AllCached = false;
    const bar = typeof document !== 'undefined' && document.getElementById
      ? document.getElementById('r2-progress')
      : null;
    if (bar) {
      bar.style.display = 'none';
    }
  }
}

function _updateLoadBar({ loaded, total, label }: any): void {
  const fill = document.getElementById('webTransport-load-fill');
  const text = document.getElementById('webTransport-load-label');
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  if (fill) {
    fill.style.width = `${pct}%`;
  }
  if (text) {
    text.textContent = total > 0 ? `${label} — ${loaded}/${total}` : (label || 'Preparing…');
  }
}

function _updateNetHUD() {
  const element = document.getElementById('webTransport-net-hud');
  if (!element) {
    return;
  }
  const colors = { connecting: '#ffcc44', connected: '#44ff88', error: '#ff4422', disconnected: '#888' };
  const labels = {
    connecting: '⚡ CONNECTING…',
    connected: `⚡ ${_netTransport === 'webtransport' ? 'WEBTRANSPORT' : 'WEBSOCKET'} [${(_myTeam || '').toUpperCase()}]`,
    error: '⚡ ERROR',
    disconnected: '⚡ OFFLINE',
  };
  element.style.color = colors[_netStatus as keyof typeof colors] || '#888';
  const lastBootMs = typeof window !== 'undefined' ? window._lastBootMs : null;
  const bootSuffix = typeof lastBootMs === 'number' ? ` · boot ${formatBootTime(lastBootMs)}` : '';
  element.textContent = (labels[_netStatus as keyof typeof labels] || '⚡ OFFLINE') + bootSuffix;
}

export async function webTransportConnect() {
  const urlInput = (document.getElementById('webTransport-url') as HTMLInputElement).value.trim();
  const cert = (document.getElementById('webTransport-cert') as HTMLInputElement).value.trim();
  SERVER_URL = urlInput;
  SERVER_CERT_HASH = cert;
  const statusElement = document.getElementById('webTransport-connect-status') as HTMLElement;
  statusElement.textContent = 'Connecting…';
  _setLoadingUI(true);
  try {
    const target = new URL(urlInput);
    if (_selectedLobby?.id) target.searchParams.set('lobby', _selectedLobby.id);
    const url = target.toString();
    window._currentMapKey = _selectedMap?.path || 'arena';
    setLocalMatch(null);
    window._multiplayerMode = true;
    await bootGame({ onProgress: _updateLoadBar });
    _setNetHudVisible(true);
    _setLoadingUI(false);
    statusElement.textContent = 'Connecting…';
    await _net.connect(url, cert);
    await _net.sendJoin(null);
    statusElement.textContent = 'Connected! Waiting for session…';
  } catch (error) {
    _setLoadingUI(false);
    _netStatus = 'error';
    _updateNetHUD();
    statusElement.style.color = '#ff4422';
    statusElement.textContent = `Connection failed: ${(error as any)?.message || error}`;
  }
}

export async function webTransportPlayOffline(config: LocalMatchConfig | null = null) {
  window._networkPlayerId=undefined;window._networkSchema=undefined;
  setLocalMatch(config);
  if (config) {
    const human = config.seats.find(seat => !seat.computer) || config.seats[0];
    setPlayerTeam(human.team);
    setPlayerFaction(human.faction);
  }
  window._multiplayerMode = false;
  window._currentMapKey = _selectedMap ? _selectedMap.path : 'arena';
  hideSkirmishPanel();
  showConnectOverlay('skirmish');
  _setLoadingUI(true);
  try {
    await loadDotaMatchHeroes(config, { onProgress: _updateLoadBar });
    await bootGame({ onProgress: _updateLoadBar });
    if (_selectedMap) {
      _updateLoadBar({ loaded: 0, total: 0, label: `Loading map ${_selectedMap.name}` });
      await selectMap(_selectedMap.path, _selectedMap.url);
    } else {
      await selectDefaultArena();
    }
    resetGame();
    _setLoadingUI(false);
    _setConnectOverlay(false);
    _setNetHudVisible(true);
  } catch (error) {
    _setLoadingUI(false);
    const statusElement = document.getElementById('webTransport-connect-status') as HTMLElement | null;
    if (statusElement) {
      statusElement.style.color = '#ff4422';
      statusElement.textContent = `Load failed: ${(error as any)?.message || error}`;
    }
  }
}

window._injectConnectUI = _injectConnectUI;
window.webTransportConnect = webTransportConnect;
window.webTransportPlayOffline = webTransportPlayOffline;

window._grimcraftNetStop = netStopSquads;
window._grimcraftNetAttack = netAttackSquad;

window._grimcraftSendCommand = command => _net.sendCmd(command);
