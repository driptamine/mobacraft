import * as THREE from 'three';
import { applyZoom } from './camera-zoom.js';
import { preloadCursors, resolveCursor, cursorCss, getModalCursor } from './cursors.js';
import {
  scene,
  camera,
  canvas,
  pickAt,
  projectToScreen,
  addBeforeRender,
  removeBeforeRender,
  getDeltaTime,
  world,
  PLAYER,
  canCommand,
  currentBounds,
  COSTS,
  JET_ALT,
  JET_ATTACK_RANGE,
  selSquads,
  setSelSquads,
  selBuildings,
  setSelBuildings,
  selBuilder,
  setSelBuilder,
  selListeningPost,
  setSelListeningPost,
  hoveredEnemySquad,
  setHoveredEnemySquad,
  _hoverEnemySquad,
  set_hoverEnemySquad,
  buildMode,
  setBuildMode,
  _stopTargetPulse,
  _startTargetPulse,
  requisition,
  setRequisition,
  setMapRevealed,
} from './scene.js';
import { makeGhostMesh, canPlaceListeningPost } from './meshes.js';
import { updateHUD } from './hud.js';
import { buildMenuOpen, setBuildMenuOpen } from './hud/store.js';
import { FACTIONS, playerFaction, resolveFactionKey } from './factions.js';
import {
  createBuildingEntity,
  createStructureEntity,
  createAirfieldEntity,
} from './entities.js';
import { disposeMeshComponent, _apcEjectPassengers, spawnParticles } from './systems.js';
import { isHeroSelected, selectHero, deselectHero, orderHeroMove, orderHeroAttack, getHero, getSelectedHeroIds, allHeroes } from './hero.js';
import { toggleHeroGrid } from './hero-hall.js';
import { netPlaceBuilding } from './multiplayer.js';
import { mkBox, mkCylinder, mkTorus, mkLines, mkLineSystem, mkGroup, disposeObj, childMeshes, spPingFrame, isGroundMesh } from './three-helpers.js';

// ══════════════════════════════════════════════════════════════════════════════
//  RANGE CIRCLES (A key)
// ══════════════════════════════════════════════════════════════════════════════
export let _rangeCirclesVisible = false;
const _rangeCircles = [];

export function _hideRangeCircles() {
  _rangeCircles.forEach((circle) => {
    if (circle.material) {
      circle.material.dispose();
    }
    disposeObj(circle);
  });
  _rangeCircles.length = 0;
}

export function _showRangeCircles() {
  _hideRangeCircles();
  const addCircle = (position, radius, r, g, b) => {
    const ring = mkTorus('rangecircle', radius * 2, 0.18, 64);
    ring.position.set(position.x, 0.12, position.z);
    ring.userData.pickable = false;
    const material = new THREE.MeshBasicMaterial();
    material.color = new THREE.Color(r, g, b);
    ring.material = material;
    _rangeCircles.push(ring);
  };

  selSquads.forEach((sid) => {
    const squad = world.get(sid, 'squad');
    if (squad) {
      addCircle(squad.position, squad.attackRange, 0.3, 0.8, 1);
    }
  });

  selBuildings.forEach((id) => {
    const structure = world.get(id, 'structure');
    if (structure && structure.attackRange > 0) {
      addCircle(structure.position, structure.attackRange, 1, 0.8, 0.2);
    }
  });

  world.query('apc').forEach((id) => {
    const apc = world.get(id, 'apc');
    if (apc && apc.selected) {
      addCircle(apc.position, apc.attackRange, 0.2, 1, 0.4);
    }
  });

  world.query('jet').forEach((id) => {
    const jet = world.get(id, 'jet');
    if (jet && canCommand(jet.team) && jet.selected) {
      addCircle(jet.position, JET_ATTACK_RANGE, 0.9, 0.5, 1.0);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  CAMERA CONTROL
// ══════════════════════════════════════════════════════════════════════════════
export const keys = {};
let rightDown = false;
let rightDragStartPos = { x: 0, y: 0 };
let rightLastPos = { x: 0, y: 0 };
let isOrbiting = false;
let isSelecting = false;
let selStart = { x: 0, y: 0 };
let selEnd = { x: 0, y: 0 };
let altDown = false;
let altOrbitLast = { x: 0, y: 0 };
let isAltOrbiting = false;

let _mouseX = window.innerWidth / 2;
let _mouseY = window.innerHeight / 2;
let _mouseEntered = false;
let _lastHoverPickT = 0;

const CAM_SPD = 64;
const EDGE_ZONE = 40;

export function tickCamera(deltaTime) {
  const theta = -camera.alpha - Math.PI / 2;
  // three.js renders the same camera numbers as a left-right mirror of the old
  // left-handed view (screen-right is -X here, +X there), so the horizontal
  // pan axis is negated; the toward/away axis is unaffected by mirroring.
  const rx = -Math.cos(theta);
  const rz = Math.sin(theta);
  const fx = Math.sin(theta);
  const fz = Math.cos(theta);
  const speed = CAM_SPD * deltaTime;
  let dx = 0;
  let dz = 0;

  if (_mouseEntered && !isSelecting && !isOrbiting && !isAltOrbiting && !rightDown && document.hasFocus()) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (_mouseX < EDGE_ZONE) {
      const factor = 1 - (_mouseX / EDGE_ZONE);
      dx -= rx * speed * factor;
      dz -= rz * speed * factor;
    } else if (_mouseX > width - EDGE_ZONE) {
      const factor = 1 - ((width - _mouseX) / EDGE_ZONE);
      dx += rx * speed * factor;
      dz += rz * speed * factor;
    }
    if (_mouseY < EDGE_ZONE) {
      const factor = 1 - (_mouseY / EDGE_ZONE);
      dx += fx * speed * factor;
      dz += fz * speed * factor;
    } else if (_mouseY > height - EDGE_ZONE) {
      const factor = 1 - ((height - _mouseY) / EDGE_ZONE);
      dx -= fx * speed * factor;
      dz -= fz * speed * factor;
    }
  }

  if (!isSelecting && !isOrbiting && !isAltOrbiting && !rightDown && document.hasFocus()) {
    if (keys['ArrowUp']) {
      dx += fx * speed;
      dz += fz * speed;
    }
    if (keys['ArrowDown']) {
      dx -= fx * speed;
      dz -= fz * speed;
    }
    if (keys['ArrowLeft']) {
      dx -= rx * speed;
      dz -= rz * speed;
    }
    if (keys['ArrowRight']) {
      dx += rx * speed;
      dz += rz * speed;
    }
  }

  if (dx || dz) {
    const panBound = currentBounds() / 2;
    camera.target.x = Math.max(-panBound, Math.min(panBound, camera.target.x + dx));
    camera.target.z = Math.max(-panBound, Math.min(panBound, camera.target.z + dz));
    camera.target.y = 0;
  }
}

export function raycastGround(sx, sy) {
  if (!scene || !camera) return null;
  const hit = pickAt(sx, sy, (m) => isGroundMesh(m, scene._ground));
  return hit.hit ? hit.pickedPoint.clone() : null;
}

export function pickMesh(sx, sy) {
  if (!scene || !camera) return null;
  const hit = pickAt(sx, sy, (m) => {
    if (m === scene._ground || m.name === 'grid' || m.name.startsWith('hp') || m.name.startsWith('capring') || m.name.startsWith('sel')) {
      return false;
    }
    return true;
  });
  return hit.hit ? { mesh: hit.pickedMesh, meta: hit.pickedMesh?.userData } : null;
}

export function clearEnemySelection() {
  _stopTargetPulse();
  if (hoveredEnemySquad !== null && world.has(hoveredEnemySquad, 'squad')) {
    const squad = world.get(hoveredEnemySquad, 'squad');
    squad?.soldiers.forEach((sid) => {
      if (sid === null) return;
      const mesh = world.get(sid, 'mesh');
      if (mesh?.root?._selMat) mesh.root._selMat.opacity = 0; mesh.root._selMat.transparent = true;
      if (mesh?.root?._selDisc) {
        mesh.root._selDisc.visible = false;
        mesh.root._selDisc.visible = false;
      }
    });
  }
  setHoveredEnemySquad(null);
}

export function clearSelection() {
  deselectHero();
  if (selBuilder !== null) {
    const builderMesh = world.get(selBuilder, 'mesh');
    if (builderMesh?.root?._selMat) builderMesh.root._selMat.opacity = 0; builderMesh.root._selMat.transparent = true;
    if (builderMesh?.root?._selDisc) {
      builderMesh.root._selDisc.visible = false;
      builderMesh.root._selDisc.visible = false;
    }
  }
  setSelBuilder(null);

  selBuildings.forEach((id) => {
    if (world.has(id, 'airfield')) _setAirfieldSelected(world, id, false);
    else setBuildingSelected(world, id, false);
  });
  setSelBuildings([]);

  selSquads.forEach((sid) => {
    if (world.has(sid, 'squad')) setSquadSelected(world, sid, false);
    if (world.has(sid, 'apc')) setApcSelected(world, sid, false);
    if (world.has(sid, 'vehicle')) setVehicleSelected(world, sid, false);
    if (world.has(sid, 'jet')) setJetSelected(world, sid, false);
  });
  setSelSquads([]);
  setSelListeningPost(null);

  clearEnemySelection();
}

export function setSquadSelected(worldRef, sid, value) {
  const squad = worldRef.get(sid, 'squad');
  if (!squad) return;
  squad.selected = value;
  squad.soldiers.forEach((sid2) => {
    if (sid2) {
      const smc = worldRef.get(sid2, 'mesh');
      if (smc) {
        smc.root._selMat.opacity = value ? 0.9 : 0;
        smc.root._selMat.transparent = true;
        if (smc.root._selDisc) {
          smc.root._selDisc.visible = value;
          smc.root._selDisc.visible = value;
        }
      }
    }
  });
}

export function setBuildingSelected(worldRef, id, value) {
  const building = worldRef.get(id, 'building') || worldRef.get(id, 'structure');
  if (!building) return;
  building.selected = value;
  const mc = worldRef.get(id, 'mesh');
  if (mc?.root?._ringMat) mc.root._ringMat.opacity = value ? 0.9 : 0; mc.root._ringMat.transparent = true;
  if (mc?.root?._ring) {
    mc.root._ring.visible = value;
    mc.root._ring.visible = value;
  }
  if (value) {
    // eslint-disable-next-line no-use-before-define
    if (building.rallyPoint) updateRallyMarker(id, building);
  } else {
    // eslint-disable-next-line no-use-before-define
    clearRallyMarker(id);
  }
}

export function setApcSelected(worldRef, id, value) {
  const apc = worldRef.get(id, 'apc');
  if (!apc) return;
  apc.selected = value;
  const mc = worldRef.get(id, 'mesh');
  if (mc?.root?._selMat) {
    mc.root._selMat.opacity = value ? 0.5 : 0;
    mc.root._selMat.transparent = true;
  }
  if (mc?.root?._selDisc) {
    mc.root._selDisc.visible = value;
    mc.root._selDisc.visible = value;
  }
}

export function setVehicleSelected(worldRef, id, value) {
  const vehicle = worldRef.get(id, 'vehicle');
  if (!vehicle) return;
  vehicle.selected = value;
  const mc = worldRef.get(id, 'mesh');
  if (mc?.root?._selMat) {
    mc.root._selMat.opacity = value ? 0.5 : 0;
    mc.root._selMat.transparent = true;
  }
  if (mc?.root?._selDisc) {
    mc.root._selDisc.visible = value;
    mc.root._selDisc.visible = value;
  }
}

export function setJetSelected(worldRef, id, value) {
  const jet = worldRef.get(id, 'jet');
  if (!jet) return;
  jet.selected = value;
  const mc = worldRef.get(id, 'mesh');
  if (mc?.root?._selMat) {
    mc.root._selMat.opacity = value ? 0.9 : 0;
    mc.root._selMat.transparent = true;
  }
  if (mc?.root?._selRing) {
    mc.root._selRing.visible = value;
    mc.root._selRing.visible = value;
  }
}

export function _setAirfieldSelected(worldRef, id, value) {
  const airfield = worldRef.get(id, 'airfield');
  if (!airfield) return;
  airfield.selected = value;
  const mc = worldRef.get(id, 'mesh');
  if (mc?.root?._ringMat) mc.root._ringMat.opacity = value ? 0.9 : 0; mc.root._ringMat.transparent = true;
  if (mc?.root?._ring) {
    mc.root._ring.visible = value;
    mc.root._ring.visible = value;
  }
  if (value) {
    // eslint-disable-next-line no-use-before-define
    if (airfield.rallyPoint) updateAirfieldRallyMarker(id, airfield);
  } else {
    // eslint-disable-next-line no-use-before-define
    clearAirfieldRallyMarker(id);
  }
}

const _rallyMeshes = new Map();
export function updateRallyMarker(bid, building) {
  if (_rallyMeshes.has(bid)) {
    const old = _rallyMeshes.get(bid);
    disposeObj(old.flag);
    disposeObj(old.line);
  }
  if (!building.rallyPoint) {
    _rallyMeshes.delete(bid);
    return;
  }
  const { rallyPoint } = building;
  const bp = building.position;
  const pole = mkCylinder(`rally_pole_${bid}`, 0.08, 0.08, 1.4, 6);
  pole.position.set(rallyPoint.x, 0.7, rallyPoint.z);
  const poleMat = new THREE.MeshBasicMaterial();
  poleMat.color = new THREE.Color(0.5, 0.5, 0.5);
  pole.material = poleMat;
  pole.userData.pickable = false;
  const flag = mkBox(`rally_flag_${bid}`, 0.55, 0.32, 0.04);
  flag.position.set(rallyPoint.x + 0.27, 1.55, rallyPoint.z);
  const flagMat = new THREE.MeshBasicMaterial();
  flagMat.color = new THREE.Color(0, 0.6, 0.15);
  flag.material = flagMat;
  flag.userData.pickable = false;
  const lines = [];
  const cols = [];
  const dashColor = new THREE.Color(0.1, 0.9, 0.3);
  for (let i = 0; i < 12; i += 1) {
    const t0 = (i + 0.1) / 12;
    const t1 = (i + 0.6) / 12;
    lines.push([
      new THREE.Vector3(bp.x + (rallyPoint.x - bp.x) * t0, 0.06, bp.z + (rallyPoint.z - bp.z) * t0),
      new THREE.Vector3(bp.x + (rallyPoint.x - bp.x) * t1, 0.06, bp.z + (rallyPoint.z - bp.z) * t1),
    ]);
    cols.push([dashColor, dashColor]);
  }
  const line = mkLineSystem(`rally_line_${bid}`, lines, cols, 0.7);
  line.userData.pickable = false;
  _rallyMeshes.set(bid, { pole, flag, line });
}

export function clearRallyMarker(bid) {
  if (_rallyMeshes.has(bid)) {
    const m = _rallyMeshes.get(bid);
    disposeObj(m.pole);
    disposeObj(m.flag);
    disposeObj(m.line);
    _rallyMeshes.delete(bid);
  }
}

const _afRallyMeshes = new Map();
export function updateAirfieldRallyMarker(afid, airfield) {
  if (_afRallyMeshes.has(afid)) {
    const old = _afRallyMeshes.get(afid);
    disposeObj(old.pole);
    disposeObj(old.flag);
    disposeObj(old.line);
  }
  if (!airfield.rallyPoint) {
    _afRallyMeshes.delete(afid);
    return;
  }
  const { rallyPoint } = airfield;
  const bp = airfield.position;
  const pole = mkCylinder(`afr_pole_${afid}`, 0.08, 0.08, 1.4, 6);
  pole.position.set(rallyPoint.x, 0.7, rallyPoint.z);
  const poleMat = new THREE.MeshBasicMaterial();
  poleMat.color = new THREE.Color(0.5, 0.5, 0.5);
  pole.material = poleMat;
  pole.userData.pickable = false;
  const flag = mkBox(`afr_flag_${afid}`, 0.55, 0.32, 0.04);
  flag.position.set(rallyPoint.x + 0.27, 1.55, rallyPoint.z);
  const flagMat = new THREE.MeshBasicMaterial();
  flagMat.color = new THREE.Color(0, 0.25, 0.6);
  flag.material = flagMat;
  flag.userData.pickable = false;
  const dashColor = new THREE.Color(0.1, 0.6, 1);
  const lines = [];
  const cols = [];
  for (let i = 0; i < 12; i += 1) {
    const t0 = (i + 0.1) / 12;
    const t1 = (i + 0.6) / 12;
    lines.push([
      new THREE.Vector3(bp.x + (rallyPoint.x - bp.x) * t0, 0.06, bp.z + (rallyPoint.z - bp.z) * t0),
      new THREE.Vector3(bp.x + (rallyPoint.x - bp.x) * t1, 0.06, bp.z + (rallyPoint.z - bp.z) * t1),
    ]);
    cols.push([dashColor, dashColor]);
  }
  const line = mkLineSystem(`afr_line_${afid}`, lines, cols, 0.7);
  line.userData.pickable = false;
  _afRallyMeshes.set(afid, { pole, flag, line });
}

export function clearAirfieldRallyMarker(afid) {
  if (_afRallyMeshes.has(afid)) {
    const m = _afRallyMeshes.get(afid);
    disposeObj(m.pole);
    disposeObj(m.flag);
    disposeObj(m.line);
    _afRallyMeshes.delete(afid);
  }
}

export function doClickSelect(sx, sy, additive) {
  const hit = pickMesh(sx, sy);
  if (!additive) clearSelection();

  if (!hit || !hit.meta) {
    updateHUD();
    return;
  }

  const { meta } = hit;

  // ── HERO HALL (batch-1 grid view) ──────────────────────────────────────────
  if (meta.heroHall) {
    if (!additive) {
      clearSelection();
    }
    toggleHeroGrid();
    updateHUD();
    return;
  }

  // ── HERO ───────────────────────────────────────────────────────────────────
  if (meta.heroEntityId !== undefined) {
    if (additive) {
      if (isHeroSelected(meta.heroEntityId)) deselectHero(meta.heroEntityId);
      else selectHero(meta.heroEntityId);
    } else {
      clearSelection();
      selectHero(meta.heroEntityId);
    }
    updateHUD();
    return;
  }

  // ── BUILDER ────────────────────────────────────────────────────────────────
  if (meta.builderEntityId !== undefined) {
    const id = meta.builderEntityId;
    setSelListeningPost(null);
    if (additive) {
      if (selBuilder === id) {
        setSelBuilder(null);
        const mc = world.get(id, 'mesh');
        if (mc?.root?._selMat) mc.root._selMat.opacity = 0; mc.root._selMat.transparent = true;
        if (mc?.root?._selDisc) {
          mc.root._selDisc.visible = false;
          mc.root._selDisc.visible = false;
        }
      } else {
        setSelBuilder(id);
        const mc = world.get(id, 'mesh');
        if (mc?.root?._selMat) mc.root._selMat.opacity = 0.9; mc.root._selMat.transparent = true;
        if (mc?.root?._selDisc) {
          mc.root._selDisc.visible = true;
          mc.root._selDisc.visible = true;
        }
      }
    } else {
      setSelBuilder(id);
      const mc = world.get(id, 'mesh');
      if (mc?.root?._selMat) mc.root._selMat.opacity = 0.9; mc.root._selMat.transparent = true;
      if (mc?.root?._selDisc) {
        mc.root._selDisc.visible = true;
        mc.root._selDisc.visible = true;
      }
    }
  }

  // ── BUILDINGS & STRUCTURES ─────────────────────────────────────────────────
  else if (meta.buildingEntityId !== undefined || meta.structureEntityId !== undefined || meta.airfieldEntityId !== undefined) {
    const id = meta.buildingEntityId ?? meta.structureEntityId ?? meta.airfieldEntityId;
    const isAirfield = meta.airfieldEntityId !== undefined;
    setSelListeningPost(null);

    if (additive) {
      const idx = selBuildings.indexOf(id);
      if (idx >= 0) {
        if (isAirfield) _setAirfieldSelected(world, id, false);
        else setBuildingSelected(world, id, false);
        selBuildings.splice(idx, 1);
      } else {
        if (isAirfield) _setAirfieldSelected(world, id, true);
        else setBuildingSelected(world, id, true);
        selBuildings.push(id);
      }
    } else {
      setSelBuildings([id]);
      if (isAirfield) _setAirfieldSelected(world, id, true);
      else setBuildingSelected(world, id, true);
    }
  }

  // ── JETS, APCs, VEHICLES & SQUADS ──────────────────────────────────────────
  else if (meta.jetEntityId !== undefined || meta.apcEntityId !== undefined || meta.vehicleEntityId !== undefined || meta.squadEntityId !== undefined || meta.soldierEntityId !== undefined) {
    let sid = meta.jetEntityId ?? meta.apcEntityId ?? meta.vehicleEntityId ?? meta.squadEntityId;
    if (sid === undefined && meta.soldierEntityId !== undefined) {
      sid = world.get(meta.soldierEntityId, 'soldier')?.squadId;
    }

    if (sid !== undefined) {
      const isJet = world.has(sid, 'jet');
      const isApc = world.has(sid, 'apc');
      const isVehicle = world.has(sid, 'vehicle');
      const isSquad = world.has(sid, 'squad');
      const entity = world.get(sid, 'jet') ?? world.get(sid, 'apc') ?? world.get(sid, 'vehicle') ?? world.get(sid, 'squad');
      setSelListeningPost(null);

      if (entity && canCommand(entity.team)) {
        if (additive) {
          const idx = selSquads.indexOf(sid);
          if (idx >= 0) {
            if (isJet) setJetSelected(world, sid, false);
            else if (isApc) setApcSelected(world, sid, false);
            else if (isVehicle) setVehicleSelected(world, sid, false);
            else if (isSquad) setSquadSelected(world, sid, false);
            selSquads.splice(idx, 1);
          } else {
            if (isJet) setJetSelected(world, sid, true);
            else if (isApc) setApcSelected(world, sid, true);
            else if (isVehicle) setVehicleSelected(world, sid, true);
            else if (isSquad) setSquadSelected(world, sid, true);
            selSquads.push(sid);
          }
        } else {
          setSelSquads([sid]);
          if (isJet) setJetSelected(world, sid, true);
          else if (isApc) setApcSelected(world, sid, true);
          else if (isVehicle) setVehicleSelected(world, sid, true);
          else if (isSquad) setSquadSelected(world, sid, true);
        }
      } else if (entity && !canCommand(entity.team) && isSquad) {
        // Enemy squad selection (only squads for now)
        clearEnemySelection();
        setHoveredEnemySquad(sid);
        entity.soldiers.forEach((soldierId) => {
          if (!soldierId) return;
          const mc = world.get(soldierId, 'mesh');
          if (mc?.root?._selMat) mc.root._selMat.opacity = 0.85; mc.root._selMat.transparent = true;
          if (mc?.root?._selDisc) {
            mc.root._selDisc.visible = true;
            mc.root._selDisc.visible = true;
          }
        });
      }
    }
  }

  // ── LISTENING POST ──────────────────────────────────────────────────────────
  else if (meta.listeningPostEntityId !== undefined) {
    const spId = meta.listeningPostEntityId;
    const sp = world.get(spId, 'strategicPoint');
    if (sp && sp.hasListeningPost && canCommand(sp.owner)) {
      if (additive && selListeningPost === spId) {
        setSelListeningPost(null);
      } else {
        setSelListeningPost(spId);
      }
    }
  }

  // ── STRATEGIC POINTS ───────────────────────────────────────────────────────
  else if (meta.strategicPointEntityId !== undefined) {
    const spId = meta.strategicPointEntityId;
    const sp = world.get(spId, 'strategicPoint');
    // If a builder is selected, right-click (or regular click if we want) could order it
    if (selBuilder !== null && world.has(selBuilder, 'builder') && canCommand(sp?.owner) && !sp.hasListeningPost) {
      const bld = world.get(selBuilder, 'builder');
      bld.buildTargetSP = spId;
      bld.moveTarget = sp.position.clone().add(new THREE.Vector3(3, 0, 0));
      bld.isBuilding = false;
    }
  }

  updateHUD();
}

export function doBoxSelect() {
  if (!world) return;
  const x0 = Math.min(selStart.x, selEnd.x);
  const x1 = Math.max(selStart.x, selEnd.x);
  const y0 = Math.min(selStart.y, selEnd.y);
  const y1 = Math.max(selStart.y, selEnd.y);
  clearSelection();

  const proj = (wpos, yoff = 1) => projectToScreen(wpos.x, wpos.y + yoff, wpos.z);

  const foundBuilders = [];
  world.query('builder', 'mesh').forEach((id) => {
    const mc = world.get(id, 'mesh');
    if (!mc) return;
    const { sx, sy } = proj(mc.root.position);
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) foundBuilders.push(id);
  });

  const foundSquads = [];
  world.query('squad', 'mesh').forEach((sid) => {
    const squad = world.get(sid, 'squad');
    if (!squad || !canCommand(squad.team)) return;
    const inApc = world.query('apc').some((aid) => world.get(aid, 'apc')?.passengers.includes(sid));
    if (inApc) return;

    let hit = false;
    const alive = squad.soldiers.filter((sid2) => sid2 !== null && world.has(sid2, 'soldier'));
    if (alive.length > 0) {
      for (let i = 0; i < alive.length; i += 1) {
        const sid2 = alive[i];
        const mc = world.get(sid2, 'mesh');
        if (mc) {
          const { sx, sy } = proj(mc.root.position, 0);
          if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
            hit = true;
            break;
          }
        }
      }
    } else {
      const { sx, sy } = proj(squad.position);
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) hit = true;
    }
    if (hit) foundSquads.push(sid);
  });

  const foundApcs = [];
  world.query('apc', 'mesh').forEach((id) => {
    const apc = world.get(id, 'apc');
    const mc = world.get(id, 'mesh');
    if (!apc || !canCommand(apc.team) || !mc) return;
    const { sx, sy } = proj(apc.position, 2);
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) foundApcs.push(id);
  });

  const foundVehicles = [];
  world.query('vehicle', 'mesh').forEach((id) => {
    const vehicle = world.get(id, 'vehicle');
    const mc = world.get(id, 'mesh');
    if (!vehicle || !canCommand(vehicle.team) || !mc) return;
    const { sx, sy } = proj(vehicle.position, 2);
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) foundVehicles.push(id);
  });

  const foundJets = [];
  world.query('jet', 'mesh').forEach((id) => {
    const jet = world.get(id, 'jet');
    const mc = world.get(id, 'mesh');
    if (!jet || !canCommand(jet.team) || !mc) return;
    const { sx, sy } = proj(jet.position, 2);
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) foundJets.push(id);
  });

  const foundHeroes = [];
  for (const hero of allHeroes()) {
    const { sx, sy } = proj(hero.root.position, 1);
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) foundHeroes.push(hero.id);
  }

  // Prioritization: if any units are found, ignore buildings
  if (foundSquads.length > 0 || foundBuilders.length > 0 || foundApcs.length > 0 || foundVehicles.length > 0 || foundJets.length > 0 || foundHeroes.length > 0) {
    foundBuilders.forEach((id) => {
      setSelBuilder(id);
      const mc = world.get(id, 'mesh');
      if (mc) {
        mc.root._selMat.opacity = 0.9;
        mc.root._selMat.transparent = true;
        if (mc.root._selDisc) {
          mc.root._selDisc.visible = true;
          mc.root._selDisc.visible = true;
        }
      }
    });
    foundSquads.forEach((sid) => {
      setSquadSelected(world, sid, true);
      selSquads.push(sid);
    });
    foundApcs.forEach((id) => {
      const apc = world.get(id, 'apc');
      const mc = world.get(id, 'mesh');
      if (apc) apc.selected = true;
      if (mc?.root?._selMat) mc.root._selMat.opacity = 0.5; mc.root._selMat.transparent = true;
      selSquads.push(id);
    });
    foundVehicles.forEach((id) => {
      const vehicle = world.get(id, 'vehicle');
      const mc = world.get(id, 'mesh');
      if (vehicle) vehicle.selected = true;
      if (mc?.root?._selMat) mc.root._selMat.opacity = 0.5; mc.root._selMat.transparent = true;
      selSquads.push(id);
    });
    foundJets.forEach((id) => {
      const jet = world.get(id, 'jet');
      const mc = world.get(id, 'mesh');
      if (jet) jet.selected = true;
      if (mc?.root?._selMat) mc.root._selMat.opacity = 0.9; mc.root._selMat.transparent = true;
      selSquads.push(id);
    });
    foundHeroes.forEach((hid) => {
      selectHero(hid);
    });
    updateHUD();
    return;
  }

  // If no units, look for buildings/structures
  world.query('building', 'mesh').forEach((id) => {
    const bld = world.get(id, 'building');
    if (!bld) return;
    const { sx, sy } = proj(bld.position, 2);
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
      setBuildingSelected(world, id, true);
      selBuildings.push(id);
    }
  });

  world.query('structure', 'mesh').forEach((id) => {
    const str = world.get(id, 'structure');
    if (!str) return;
    const { sx, sy } = proj(str.position, 2);
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
      setBuildingSelected(world, id, true);
      selBuildings.push(id);
    }
  });

  updateHUD();
}

export function spawnMoveMarker(sx, sy) {
  const point = raycastGround(sx, sy);
  if (!point) return;
  const ping = mkTorus('moveping', 1.4, 0.12, 32);
  ping.position.set(point.x, point.y + 0.05, point.z);
  const material = new THREE.MeshBasicMaterial();
  material.color = new THREE.Color(0, 1, 0.53);
  ping.material = material;
  ping.userData.pickable = false;
  let time = 0;
  const observer = addBeforeRender(() => {
    time += getDeltaTime();
    const scale = 0.3 + time * 4.5;
    ping.scale.setScalar(scale);
    material.opacity = Math.max(0, 1 - time * 2);
    material.transparent = true;
    if (time >= 0.5) {
      disposeObj(ping);
      material.dispose();
      removeBeforeRender(observer);
    }
  });
}

export function spawnAttackMarker(sx, sy) {
  const point = raycastGround(sx, sy);
  if (!point) return;
  const ping = mkTorus('attackping', 1.8, 0.15, 32);
  ping.position.set(point.x, point.y + 0.05, point.z);
  const material = new THREE.MeshBasicMaterial();
  material.color = new THREE.Color(1, 0.2, 0.1);
  ping.material = material;
  ping.userData.pickable = false;
  let time = 0;
  const observer = addBeforeRender(() => {
    time += getDeltaTime();
    const scale = 0.3 + time * 4.5;
    ping.scale.setScalar(scale);
    material.opacity = Math.max(0, 1 - time * 2);
    material.transparent = true;
    if (time >= 0.5) {
      disposeObj(ping);
      material.dispose();
      removeBeforeRender(observer);
    }
  });
}

const SP_PING_DURATION = 0.9;
const SP_PING_MAX_SCALE = 8;
const SP_PING_PEAK_GLOW = 1.6;
let _spPingToken = 0;

// Right-click ping on a strategic point / relic: a red torus expands from
// the center and fades as it reaches full radius, while the point model
// glows red and fades back with the same easing.
export function spawnSpPing(spId) {
  const strategicPoint = world.get(spId, 'strategicPoint');
  const meshComponent = world.get(spId, 'mesh');
  if (!strategicPoint || !meshComponent?.root) {
    return;
  }
  const token = ++_spPingToken;
  const ping = mkTorus('spping', 1.2, 0.12, 40);
  ping.position.set(strategicPoint.position.x, 0.08, strategicPoint.position.z);
  const material = new THREE.MeshBasicMaterial();
  material.color = new THREE.Color(1, 0.12, 0.08);
  material.transparent = true;
  ping.material = material;
  ping.userData.pickable = false;
  // Instances share materials, so tint clones and restore the originals at
  // the end; the token keeps overlapping pings from restoring early.
  const tinted = [];
  childMeshes(meshComponent.root).forEach((mesh) => {
    if (!mesh.visible || !mesh.material || Array.isArray(mesh.material) || !mesh.material.emissive) {
      return;
    }
    if (!mesh.userData._pingOrig) {
      mesh.userData._pingOrig = mesh.material;
      mesh.material = mesh.material.clone();
    }
    mesh.userData._pingToken = token;
    mesh.material.emissive.setRGB(1, 0.06, 0.04);
    mesh.material.emissiveIntensity = SP_PING_PEAK_GLOW;
    tinted.push(mesh);
  });
  let time = 0;
  const observer = addBeforeRender(() => {
    time += getDeltaTime();
    const frame = spPingFrame(time, SP_PING_DURATION, SP_PING_MAX_SCALE);
    ping.scale.setScalar(frame.scale);
    material.opacity = frame.opacity;
    for (const mesh of tinted) {
      if (mesh.userData._pingToken === token) {
        mesh.material.emissiveIntensity = SP_PING_PEAK_GLOW * frame.opacity;
      }
    }
    if (time >= SP_PING_DURATION) {
      disposeObj(ping);
      material.dispose();
      for (const mesh of tinted) {
        if (mesh.userData._pingToken === token) {
          mesh.material.dispose();
          mesh.material = mesh.userData._pingOrig;
          mesh.userData._pingOrig = null;
          mesh.userData._pingToken = 0;
        }
      }
      removeBeforeRender(observer);
    }
  });
}

export function issueRightClick(sx, sy) {
  const hit = pickMesh(sx, sy);
  if (hit?.meta) {
    if (hit.meta.strategicPointEntityId !== undefined) {
      spawnSpPing(hit.meta.strategicPointEntityId);
    }
    const { soldierEntityId } = hit.meta;
    const sid = hit.meta.squadEntityId !== undefined
      ? hit.meta.squadEntityId
      : (soldierEntityId !== undefined ? world.get(soldierEntityId, 'soldier')?.squadId : undefined);

    if (sid !== undefined) {
      const squad = world.get(sid, 'squad');
      if (squad && selSquads.length > 0 && !selSquads.includes(sid)) {
        // Attackers: selected units whose team differs from the clicked
        // squad. In normal play this is exactly the PLAYER selection vs an
        // enemy squad; in control-both mode each side attacks the other.
        const teamOf = (id) => (world.get(id, 'jet') ?? world.get(id, 'apc') ?? world.get(id, 'vehicle') ?? world.get(id, 'squad'))?.team;
        const attackers = selSquads.filter((id) => {
          const t = teamOf(id);
          return t && t !== squad.team;
        });
        if (attackers.length > 0) {
          const targetSoldierId = soldierEntityId !== undefined && world.has(soldierEntityId, 'soldier') ? soldierEntityId : null;
          clearEnemySelection();
          setHoveredEnemySquad(sid);
          if (targetSoldierId) {
            squad.soldiers.forEach((soldierId) => {
              if (soldierId === null) return;
              const mc = world.get(soldierId, 'mesh');
              if (mc?.root?._selMat) {
                mc.root._selMat.opacity = (soldierId === targetSoldierId) ? 1 : 0.25;
                mc.root._selMat.transparent = true;
              }
            });
            _startTargetPulse(targetSoldierId);
          } else {
            squad.soldiers.forEach((soldierId) => {
              if (soldierId === null) return;
              const mc = world.get(soldierId, 'mesh');
              if (mc?.root?._selMat) mc.root._selMat.opacity = 0.85; mc.root._selMat.transparent = true;
            });
          }
          const attackerJets = attackers.filter((id) => world.get(id, 'jet') != null);
          attackerJets.forEach((id) => {
            const jet = world.get(id, 'jet');
            if (jet) {
              jet.forcedTargetSqId = sid;
              jet.strafe = null;
              jet.strafeCd = 0;
              jet.moveOrder = null;
              jet.waitOrders = false;
              jet.patrolMode = 'attack';
            }
          });
          attackers.forEach((id) => {
            const psq = world.get(id, 'squad');
            if (psq) {
              psq.forcedTarget = sid;
              psq.forcedSoldierId = targetSoldierId;
              psq.moveOrder = null;
              psq.stopped = false;
            }
          });
          const attackerVehicles = attackers.filter((id) => world.get(id, 'vehicle') != null);
          attackerVehicles.forEach((id) => {
            const vehicle = world.get(id, 'vehicle');
            if (vehicle) {
              vehicle.moveOrder = new THREE.Vector3(squad.position.x, 0, squad.position.z);
            }
          });
          spawnAttackMarker(sx, sy);
          updateHUD();
          return;
        }
      }
    }
    if (hit.meta.apcEntityId !== undefined) {
      const apc = world.get(hit.meta.apcEntityId, 'apc');
      if (apc && canCommand(apc.team)) {
        let boarded = false;
        for (const sid of selSquads) {
          boarded = _boardSquadOntoApc(apc, sid) || boarded;
        }
        if (boarded) {
          spawnMoveMarker(sx, sy);
          updateHUD();
          return;
        }
      }
    }
    // Right-click on an enemy hero: selected team fighters focus it down.
    // (Clicking a teammate or neutral falls through to a ground move order.)
    if (hit.meta.heroEntityId !== undefined) {
      const target = getHero(hit.meta.heroEntityId);
      if (target && target.team && target.alive) {
        const attackers = getSelectedHeroIds().filter((hid) => {
          const state = getHero(hid);
          return state && state.alive && state.team && state.team !== target.team;
        });
        if (attackers.length > 0) {
          attackers.forEach((hid) => orderHeroAttack(hid, target.id));
          spawnAttackMarker(sx, sy);
          updateHUD();
          return;
        }
      }
    }
    if (selBuilder !== null && world.has(selBuilder, 'builder')) {
      const builder = world.get(selBuilder, 'builder');
      let targetEntityId;
      let targetComponent;
      let targetPosition;
      let targetType;
      if (hit.meta.buildingEntityId !== undefined) {
        const eid = hit.meta.buildingEntityId;
        const component = world.get(eid, 'building');
        if (component && component.constructProgress < component.constructTime) {
          targetEntityId = eid;
          targetComponent = component;
          targetPosition = component.position;
          targetType = component.type;
        }
      } else if (hit.meta.structureEntityId !== undefined) {
        const eid = hit.meta.structureEntityId;
        const component = world.get(eid, 'structure');
        if (component && component.constructProgress < component.constructTime) {
          targetEntityId = eid;
          targetComponent = component;
          targetPosition = component.position;
          targetType = component.type;
        }
      } else if (hit.meta.airfieldEntityId !== undefined) {
        const eid = hit.meta.airfieldEntityId;
        const component = world.get(eid, 'airfield');
        if (component && component.constructProgress < component.constructTime) {
          targetEntityId = eid;
          targetComponent = component;
          targetPosition = component.position;
          targetType = 'airfield';
        }
      }
      if (targetEntityId !== undefined && targetComponent !== undefined) {
        builder.buildTarget = { type: targetType, position: targetPosition.clone(), pendingEntityId: targetEntityId };
        builder.buildTargetSP = null;
        builder.moveTarget = targetPosition.clone().add(new THREE.Vector3(4, 0, 0));
        builder.isBuilding = false;
        spawnMoveMarker(sx, sy);
        updateHUD();
        return;
      }
    }
  }
  const point = raycastGround(sx, sy);
  if (!point) return;

  const selectedApcs = selSquads.filter((id) => world.get(id, 'apc') != null);
  if (selectedApcs.length) {
    selectedApcs.forEach((id) => {
      const apc = world.get(id, 'apc');
      if (apc) apc.moveOrder = new THREE.Vector3(point.x, 0, point.z);
    });
    spawnMoveMarker(sx, sy);
    return;
  }
  const selectedVehicles = selSquads.filter((id) => world.get(id, 'vehicle') != null);
  if (selectedVehicles.length) {
    selectedVehicles.forEach((id) => {
      const vehicle = world.get(id, 'vehicle');
      if (vehicle) vehicle.moveOrder = new THREE.Vector3(point.x, 0, point.z);
    });
    spawnMoveMarker(sx, sy);
    return;
  }
  const selectedJets = selSquads.filter((id) => world.get(id, 'jet') != null);
  if (selectedJets.length) {
    selectedJets.forEach((id, i) => {
      const jet = world.get(id, 'jet');
      if (jet) {
        const c = (i % 2) - (selectedJets.length > 1 ? 0.5 : 0);
        const r = Math.floor(i / 2);
        jet.moveOrder = new THREE.Vector3(point.x + c * 6, JET_ALT, point.z + r * 6);
        jet.waitOrders = false;
        jet.strafe = null;
      }
    });
    spawnMoveMarker(sx, sy);
    return;
  }
  const selectedBarracks = selBuildings.filter((id) => world.has(id, 'building'));
  if (selectedBarracks.length && selSquads.length === 0 && selBuilder === null) {
    selectedBarracks.forEach((id) => {
      const bld = world.get(id, 'building');
      bld.rallyPoint = new THREE.Vector3(point.x, 0, point.z);
      updateRallyMarker(id, bld);
    });
    spawnMoveMarker(sx, sy);
    return;
  }
  const selectedAirfields = selBuildings.filter((id) => world.has(id, 'airfield'));
  if (selectedAirfields.length && selSquads.length === 0 && selBuilder === null) {
    selectedAirfields.forEach((id) => {
      const airfield = world.get(id, 'airfield');
      if (airfield) {
        airfield.rallyPoint = new THREE.Vector3(point.x, 0, point.z);
        updateAirfieldRallyMarker(id, airfield);
      }
    });
    spawnMoveMarker(sx, sy);
    return;
  }
  spawnMoveMarker(sx, sy);
  if (selBuilder !== null && world.has(selBuilder, 'builder')) {
    const builder = world.get(selBuilder, 'builder');
    builder.buildTargetSP = null;
    builder.moveTarget = new THREE.Vector3(point.x, 0, point.z);
    builder.isBuilding = false;
  }
  const selectedHeroes = getSelectedHeroIds();
  selectedHeroes.forEach((hid, i) => {
    const off = (i - (selectedHeroes.length - 1) / 2) * 2;
    orderHeroMove(hid, new THREE.Vector3(point.x + off, 0, point.z));
  });
  const active = selSquads.filter((sid) => world.has(sid, 'squad'));
  if (active.length) {
    const cols = Math.ceil(Math.sqrt(active.length));
    active.forEach((sid, i) => {
      const squad = world.get(sid, 'squad');
      if (!squad) return;
      const c = (i % cols) - (cols - 1) / 2;
      const r = Math.floor(i / cols);
      const destination = new THREE.Vector3(point.x + c * 7, 0, point.z + r * 7);
      destination.x = Math.max(-currentBounds(), Math.min(currentBounds(), destination.x));
      destination.z = Math.max(-currentBounds(), Math.min(currentBounds(), destination.z));
      squad.moveOrder = destination;
      squad.stopped = false;
      squad.forcedTarget = null;
      squad.forcedSoldierId = null;
    });
  }
  const activeApcs = selSquads.filter((sid) => world.has(sid, 'apc'));
  activeApcs.forEach((id, i) => {
    const apc = world.get(id, 'apc');
    if (apc) {
      const c = (i % 2) - (activeApcs.length > 1 ? 0.5 : 0);
      const r = Math.floor(i / 2);
      const destination = new THREE.Vector3(point.x + c * 5, 0, point.z + r * 5);
      destination.x = Math.max(-currentBounds(), Math.min(currentBounds(), destination.x));
      destination.z = Math.max(-currentBounds(), Math.min(currentBounds(), destination.z));
      apc.moveOrder = destination;
    }
  });
  const activeVehicles = selSquads.filter((sid) => world.has(sid, 'vehicle'));
  activeVehicles.forEach((id, i) => {
    const vehicle = world.get(id, 'vehicle');
    if (vehicle) {
      const c = (i % 2) - (activeVehicles.length > 1 ? 0.5 : 0);
      const r = Math.floor(i / 2);
      const destination = new THREE.Vector3(point.x + c * 5, 0, point.z + r * 5);
      destination.x = Math.max(-currentBounds(), Math.min(currentBounds(), destination.x));
      destination.z = Math.max(-currentBounds(), Math.min(currentBounds(), destination.z));
      vehicle.moveOrder = destination;
    }
  });
}

export function demolishBuilding(id) {
  if (world.has(id, 'airfield')) {
    _setAirfieldSelected(world, id, false);
  } else {
    setBuildingSelected(world, id, false);
  }
  const idx = selBuildings.indexOf(id);
  if (idx >= 0) {
    selBuildings.splice(idx, 1);
  }
  clearRallyMarker(id);
  clearAirfieldRallyMarker(id);
  const component = world.get(id, 'building') || world.get(id, 'structure') || world.get(id, 'airfield');
  if (component) {
    spawnParticles(new THREE.Vector3(component.position.x, 2, component.position.z), new THREE.Color(1, 0.4, 0.1), 28);
  }
  const meshComponent = world.get(id, 'mesh');
  if (meshComponent) {
    disposeMeshComponent(meshComponent);
  }
  world.destroyEntity(id);
  updateHUD();
}

let _buildGhost = null;
let _buildGhostObserver = null;
let _buildGhostT = 0;
let _buildFootprint = null;
function _disposeGhostMeshTree(node) {
  if (!node) return;
  childMeshes(node).forEach((mesh) => {
    if (mesh.material) mesh.material.dispose();
    disposeObj(mesh);
  });
  disposeObj(node);
}

function _getFootprintDiameter(type) {
  return (type === 'thermoGen' || type === 'thermo_generator' || type === 'plasma_generator') ? 7
    : (type === 'barracks' || type === 'infantry_command' || type === 'mechanized' || type === 'mars_pattern' || type === 'tactica_control') ? 7
    : (type === 'towerBase') ? 6
    : (type === 'gunTurret') ? 5.5
    : (type === 'mines') ? 4
    : 5.5;
}

export function _stopBuildGhost() {
  if (_buildGhostObserver) {
    removeBeforeRender(_buildGhostObserver);
    _buildGhostObserver = null;
  }
  if (_buildGhost) {
    _disposeGhostMeshTree(_buildGhost);
    _buildGhost = null;
  }
  if (_buildFootprint) {
    childMeshes(_buildFootprint).forEach((mesh) => {
      if (mesh.material) mesh.material.dispose();
    });
    disposeObj(_buildFootprint.material);
    disposeObj(_buildFootprint);
    _buildFootprint = null;
  }
}

export function _startBuildGhost(type) {
  _stopBuildGhost();
  const dummy = new THREE.Vector3(0, -999, 0);
  const builder = selBuilder !== null && world ? world.get(selBuilder, 'builder') : null;
  _buildGhost = makeGhostMesh(type, dummy, builder?.faction ? { faction: builder.faction } : {});
  _buildGhostT = 0;
  const footprintDiameter = _getFootprintDiameter(type);
  _buildFootprint = mkBox('bfp_fill', footprintDiameter * 1.15, 5.5, footprintDiameter * 1.15);
  _buildFootprint.position.set(0, 2.75, 0);
  const fillMaterial = new THREE.MeshBasicMaterial();
  fillMaterial.color = new THREE.Color(0.05, 0.35, 0.8);
  fillMaterial.opacity = 0.3;
  fillMaterial.transparent = true;
  fillMaterial.depthWrite = false;
  _buildFootprint.material = fillMaterial;
  _buildFootprint.userData.pickable = false;
  const wireGroup = mkGroup('bfp_wire');
  const half = (footprintDiameter * 1.15) / 2;
  const yBot = -2.75;
  const yTop = 2.75;
  const seg = (ax, ay, az, bx, by, bz) => {
    const line = mkLines('bfp_wire_seg', [new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)], new THREE.Color(0.15, 0.75, 1), 0.2);
    line.userData.pickable = false;
    wireGroup.add(line);
  };
  seg(-half, yBot, -half, half, yBot, -half);
  seg(half, yBot, -half, half, yBot, half);
  seg(half, yBot, half, -half, yBot, half);
  seg(-half, yBot, half, -half, yBot, -half);
  seg(-half, yTop, -half, half, yTop, -half);
  seg(half, yTop, -half, half, yTop, half);
  seg(half, yTop, half, -half, yTop, half);
  seg(-half, yTop, half, -half, yTop, -half);
  seg(-half, yBot, -half, -half, yTop, -half);
  seg(half, yBot, -half, half, yTop, -half);
  seg(half, yBot, half, half, yTop, half);
  seg(-half, yBot, half, -half, yTop, half);
  _buildFootprint.add(wireGroup);
  _buildGhostObserver = addBeforeRender(() => {
    if (!_buildGhost) return;
    _buildGhostT += getDeltaTime();
    const alpha = 0.18 + 0.06 * Math.sin(_buildGhostT * 3.5);
    childMeshes(_buildGhost).forEach((mesh) => {
      if (mesh.material) mesh.material.opacity = alpha; mesh.material.transparent = true;
    });
    if (_buildFootprint) {
      _buildFootprint.position.x = _buildGhost.position.x;
      _buildFootprint.position.z = _buildGhost.position.z;
    }
  });
}

export function _moveBuildGhost(sx, sy) {
  if (!_buildGhost) return;
  if (buildMode === 'listening_post') {
    const hit = pickMesh(sx, sy);
    const spId = hit?.meta?.strategicPointEntityId;
    const sp = spId !== undefined ? world.get(spId, 'strategicPoint') : null;
    if (sp) {
      _buildGhost.position.set(sp.position.x, 0, sp.position.z);
      return;
    }
  }
  const point = raycastGround(sx, sy);
  if (!point) return;
  point.x = Math.max(-currentBounds() + 4, Math.min(currentBounds() - 4, point.x));
  point.z = Math.max(-currentBounds() + 4, Math.min(currentBounds() - 4, point.z));
  _buildGhost.position.set(point.x, 0, point.z);
}

export function startBuild(type) {
  if (requisition < COSTS[type]) return;
  setBuildMode(type);
  canvas.style.cursor = 'crosshair';
  _startBuildGhost(type);
}

export function cancelBuild() {
  setBuildMode(null);
  canvas.style.cursor = '';
  _stopBuildGhost();
}

export function buildAddon(buildingId, addonKey) {
  const building = world.get(buildingId, 'building');
  if (!building || !canCommand(building.team)) return false;
  const factionKey = resolveFactionKey(building.faction, playerFaction);
  const structureConfig = FACTIONS[factionKey]?.structures?.find((s) => s.type === building.type);
  const addonConfig = structureConfig?.addons?.find((a) => a.name === addonKey);
  if (!addonConfig) return false;
  if (building.addons.includes(addonKey)) return false;
  if (building.constructing) return false;
  if (addonConfig.requiresTier && building.tier < addonConfig.requiresTier) return false;
  if (requisition < addonConfig.cost) return false;
  setRequisition(requisition - addonConfig.cost);
  building.addons.push(addonKey);
  if (addonConfig.tier) building.tier = Math.max(building.tier, addonConfig.tier);
  if (addonConfig.scanner) setMapRevealed(true);
  updateHUD();
  return true;
}

/* ── Builder command mode (Tech-Priest control grid) ────────────────── */

export let _pendingBuilderCommand = null;

export function setBuilderCommand(cmd) {
  _pendingBuilderCommand = cmd;
  canvas.style.cursor = cmd ? 'crosshair' : '';
}

export function clearBuilderCommand() {
  _pendingBuilderCommand = null;
  canvas.style.cursor = '';
}

export function setBuilderStance(stance) {
  if (selBuilder === null || !world.has(selBuilder, 'builder')) {
    return;
  }
  const builder = world.get(selBuilder, 'builder');
  builder.stance = stance;
  builder.attackMove = false;
  clearBuilderCommand();
  updateHUD();
}

function _issueBuilderCommand(cmd, sx, sy, point, hit) {
  if (selBuilder === null || !world.has(selBuilder, 'builder')) {
    return;
  }
  const builder = world.get(selBuilder, 'builder');
  builder.buildTargetSP = null;
  builder.buildTarget = null;
  builder.isBuilding = false;
  if (cmd === 'move') {
    builder.moveTarget = point.clone();
    builder.attackMove = false;
    builder.meleeOrder = false;
    builder.repairTarget = null;
  } else if (cmd === 'attackmove') {
    builder.moveTarget = point.clone();
    builder.attackMove = true;
    builder.meleeOrder = false;
    builder.repairTarget = null;
  } else if (cmd === 'melee') {
    builder.moveTarget = point.clone();
    builder.attackMove = true;
    builder.meleeOrder = true;
    builder.repairTarget = null;
  } else if (cmd === 'repair') {
    builder.attackMove = false;
    builder.meleeOrder = false;
    builder.repairTarget = null;
    let targetId;
    if (hit?.meta) {
      if (hit.meta.buildingEntityId !== undefined) {
        targetId = hit.meta.buildingEntityId;
      } else if (hit.meta.structureEntityId !== undefined) {
        targetId = hit.meta.structureEntityId;
      } else if (hit.meta.vehicleEntityId !== undefined) {
        targetId = hit.meta.vehicleEntityId;
      } else if (hit.meta.airfieldEntityId !== undefined) {
        targetId = hit.meta.airfieldEntityId;
      }
    }
    if (targetId !== undefined) {
      builder.repairTarget = targetId;
      const comp = world.get(targetId, 'building') || world.get(targetId, 'structure') || world.get(targetId, 'vehicle') || world.get(targetId, 'airfield');
      if (comp) {
        builder.moveTarget = comp.position.clone();
      }
    } else {
      builder.moveTarget = point.clone();
    }
  }
  spawnMoveMarker(sx, sy);
  updateHUD();
}

function _tryBuilderCommandClick(sx, sy) {
  if (_pendingBuilderCommand === null) {
    return false;
  }
  const cmd = _pendingBuilderCommand;
  clearBuilderCommand();
  if (selBuilder === null || !world.has(selBuilder, 'builder')) {
    return true;
  }
  const hit = pickMesh(sx, sy);
  const point = raycastGround(sx, sy);
  if (point) {
    _issueBuilderCommand(cmd, sx, sy, point, hit);
  }
  return true;
}

export function placeListeningPost(sx, sy) {
  const hit = pickMesh(sx, sy);
  const spId = hit?.meta?.strategicPointEntityId;
  const sp = spId !== undefined ? world.get(spId, 'strategicPoint') : null;
  const builder = selBuilder !== null && world.has(selBuilder, 'builder') ? world.get(selBuilder, 'builder') : null;
  if (!canPlaceListeningPost(sp, builder?.team) || !builder) {
    return;
  }
  if (requisition < COSTS.listening_post) return;
  builder.buildTargetSP = spId;
  builder.buildTarget = null;
  builder.moveTarget = sp.position.clone().add(new THREE.Vector3(3, 0, 0));
  builder.isBuilding = false;
  cancelBuild();
  updateHUD();
}

export function placeBuild(pt) {
  if (!buildMode) return;
  const type = buildMode;
  _stopBuildGhost();
  setBuildMode(null);
  canvas.style.cursor = '';

  if (window._multiplayerMode) {
    const typeMap = {
      barracks: 'Barracks',
      infantry_command: 'InfantryCommand',
      hq: 'HQ',
      tower: 'Tower',
      turret: 'Tower',
      thermoGen: 'ThermoGen',
      thermo_generator: 'ThermoGen',
      listeningPost: 'ListeningPost',
      listening_post: 'ListeningPost',
      towerBase: 'TowerBase',
      apc: 'APC',
      mechanized: 'APC',
      airfield: 'Airfield',
      gunTurret: 'GunTurret',
      plasma_generator: 'PlasmaGenerator',
      tactica_control: 'TacticaControl',
      mars_pattern: 'MarsPattern',
      mines: 'Mines',
    };
    const serverType = typeMap[type] || 'Barracks';
    netPlaceBuilding(serverType, pt);
    return;
  }

  if (requisition < COSTS[type] || selBuilder === null || !world.has(selBuilder, 'builder')) return;
  const point = pt.clone();
  point.x = Math.max(-currentBounds() + 4, Math.min(currentBounds() - 4, point.x));
  point.z = Math.max(-currentBounds() + 4, Math.min(currentBounds() - 4, point.z));

  if (type === 'airfield') {
    const entityId = createAirfieldEntity(world, point, world.get(selBuilder, 'builder')?.faction);
    const component = world.get(entityId, 'airfield');
    if (component) {
      component.constructing = false;
      component.constructProgress = 0;
    }
    const builder = world.get(selBuilder, 'builder');
    builder.buildTarget = { type: 'airfield', position: point, pendingEntityId: entityId };
    builder.buildTargetSP = null;
    builder.moveTarget = point.clone().add(new THREE.Vector3(5, 0, 0));
    builder.isBuilding = false;
    updateHUD();
    return;
  }

  let entityId;
  if (type === 'barracks' || type === 'infantry_command' || type === 'hq' || type === 'mechanized') {
    entityId = createBuildingEntity(world, type, point, world.get(selBuilder, 'builder')?.team ?? PLAYER, world.get(selBuilder, 'builder')?.faction);
  } else {
    entityId = createStructureEntity(world, type, point, world.get(selBuilder, 'builder')?.faction, world.get(selBuilder, 'builder')?.team ?? PLAYER);
  }

  const component = world.get(entityId, 'building') || world.get(entityId, 'structure');
  if (component) {
    component.constructing = false;
    component.constructProgress = 0;
  }
  const builder = world.get(selBuilder, 'builder');
  builder.buildTarget = { type, position: point, pendingEntityId: entityId };
  builder.buildTargetSP = null;
  builder.moveTarget = point.clone().add(new THREE.Vector3(4, 0, 0));
  builder.isBuilding = false;
}

const selBoxEl = document.getElementById('selBox');
export function updateSelBoxCSS() {
  const x = Math.min(selStart.x, selEnd.x);
  const y = Math.min(selStart.y, selEnd.y);
  selBoxEl.style.left = `${x}px`;
  selBoxEl.style.top = `${y}px`;
  selBoxEl.style.width = `${Math.abs(selEnd.x - selStart.x)}px`;
  selBoxEl.style.height = `${Math.abs(selEnd.y - selStart.y)}px`;
}

function _boardSquadOntoApc(apc, sid) {
  const squad = world.get(sid, 'squad');
  if (!squad || !canCommand(squad.team) || squad.team !== apc?.team || world.has(sid, 'apc') || world.has(sid, 'vehicle')) {
    return false;
  }
  if (!apc || apc.passengers.includes(sid)) {
    return false;
  }
  if (apc.passengers.length >= apc.maxPassengers) {
    return false;
  }
  if (squad.position.distanceTo(apc.position) > 10) {
    return false;
  }
  apc.passengers.push(sid);
  squad.soldiers.forEach((soldierId) => {
    if (soldierId) {
      const mc = world.get(soldierId, 'mesh');
      if (mc) mc.root.visible = false;
    }
  });
  const sqmc = world.get(sid, 'mesh');
  if (sqmc?.hpBar) sqmc.hpBar.visible = false;
  squad.stopped = true;
  return true;
}

function _updateHoverCursor(hit) {
  const meta = hit?.meta;
  const repairMode = _pendingBuilderCommand === 'repair';
  let hover = null;
  let hoverApc = null;
  if (meta) {
    if (repairMode) {
      const rid = meta.buildingEntityId ?? meta.structureEntityId ?? meta.vehicleEntityId ?? meta.airfieldEntityId;
      if (rid !== undefined) {
        const comp = world.get(rid, 'building') || world.get(rid, 'structure') || world.get(rid, 'vehicle') || world.get(rid, 'airfield');
        if (comp) {
          hover = { kind: 'repairable', damaged: comp.hp < (comp.maxHp || comp.hp) };
        }
      }
    } else if (meta.strategicPointEntityId !== undefined) {
      hover = { kind: 'sp' };
    } else if (meta.apcEntityId !== undefined) {
      const apc = world.get(meta.apcEntityId, 'apc');
      if (apc && canCommand(apc.team) && apc.passengers.length < apc.maxPassengers) {
        hover = { kind: 'loadable' };
        hoverApc = apc;
      }
    }
  }
  const infantrySelected = !!hoverApc && selSquads.some((sid) => {
    const squad = world.get(sid, 'squad');
    return squad && canCommand(squad.team) && squad.team === hoverApc.team
      && !world.has(sid, 'apc') && !world.has(sid, 'vehicle')
      && !hoverApc.passengers.includes(sid)
      && squad.position.distanceTo(hoverApc.position) <= 10;
  });
  const name = resolveCursor({
    modal: getModalCursor(),
    buildMode,
    pendingCommand: _pendingBuilderCommand,
    hover,
    infantrySelected,
  });
  canvas.style.cursor = name ? cursorCss(name, 'auto') : ((buildMode || _pendingBuilderCommand) ? 'crosshair' : cursorCss('default', ''));
}

// Enemy hover highlight relative to the current selection: a hovered squad
// counts as hostile when at least one selected unit sits on another team.
// With no selection this is exactly the non-commandable teams.
export function isHostileToSelection(world, hoveredId, hoveredTeam) {
  if (selSquads.length === 0) {
    return !canCommand(hoveredTeam);
  }
  if (selSquads.includes(hoveredId)) {
    return false;
  }
  return selSquads.some((id) => {
    const t = (world.get(id, 'jet') ?? world.get(id, 'apc') ?? world.get(id, 'vehicle') ?? world.get(id, 'squad'))?.team;
    return t && t !== hoveredTeam;
  });
}

export function setupPointerEvents() {
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 0) {
      if (buildMode) return;
      if (altDown) {
        isAltOrbiting = true;
        altOrbitLast = { x: event.clientX, y: event.clientY };
        canvas.style.cursor = 'grabbing';
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      isSelecting = true;
      canvas.setPointerCapture(event.pointerId);
      selStart = { x: event.clientX, y: event.clientY };
      selEnd = { x: event.clientX, y: event.clientY };
      selBoxEl.style.display = 'block';
      updateSelBoxCSS();
    } else if (event.button === 2) {
      if (_pendingBuilderCommand) {
        clearBuilderCommand();
      }
      if (buildMode) {
        cancelBuild();
        return;
      }
      rightDown = true;
      canvas.setPointerCapture(event.pointerId);
      isOrbiting = false;
      rightDragStartPos = { x: event.clientX, y: event.clientY };
      rightLastPos = { x: event.clientX, y: event.clientY };
      const selectedApcs = selSquads.filter((id) => world.get(id, 'apc') != null);
      if (selectedApcs.length) {
        const point = raycastGround(event.clientX, event.clientY);
        if (point) {
          selectedApcs.forEach((id) => {
            const apc = world.get(id, 'apc');
            if (apc) apc.moveOrder = new THREE.Vector3(point.x, 0, point.z);
          });
        }
      }
      const selectedVehicles = selSquads.filter((id) => world.get(id, 'vehicle') != null);
      if (selectedVehicles.length) {
        const point = raycastGround(event.clientX, event.clientY);
        if (point) {
          selectedVehicles.forEach((id) => {
            const vehicle = world.get(id, 'vehicle');
            if (vehicle) vehicle.moveOrder = new THREE.Vector3(point.x, 0, point.z);
          });
        }
      }
    }
  });
  function _updateCursorCoords(sx, sy) {
    const el = document.getElementById('cursorCoords');
    if (!el) return;
    const pt = raycastGround(sx, sy);
    if (pt) {
      el.textContent = `x: ${Math.round(pt.x)}  z: ${Math.round(pt.z)}   (${pt.x.toFixed(1)}, ${pt.z.toFixed(1)})`;
    } else {
      el.textContent = 'x: –  z: –';
    }
  }
  let _decalHoverEl = null;
  function _decalHoverTip() {
    if (!_decalHoverEl) {
      _decalHoverEl = document.getElementById('decalHoverTip');
    }
    return _decalHoverEl;
  }
  function _updateDecalHover(hit, sx, sy) {
    const tip = _decalHoverTip();
    if (!tip) return;
    let name = '';
    if (hit?.mesh) {
      const n = hit.mesh.name || '';
      if (n.startsWith('SGB_Decal') && hit.mesh.userData?.decalPath) {
        name = hit.mesh.userData.decalPath.replace(/^art\/decals\//, '');
      }
    }
    if (!name) {
      tip.style.display = 'none';
      return;
    }
    tip.textContent = '◈ ' + name;
    tip.style.display = 'block';
    tip.style.left = (sx + 14) + 'px';
    tip.style.top = (sy + 14) + 'px';
  }
  canvas.addEventListener('pointermove', (event) => {
    _mouseX = event.clientX;
    _mouseY = event.clientY;
    _mouseEntered = true;
    // Hover raycasts (coords readout + mesh hover below) run at most once
    // per frame: high-frequency mice would otherwise fire several full-scene
    // raycasts between renders. Clicks raycast synchronously, unaffected.
    const hoverNow = performance.now();
    const hoverDue = hoverNow - _lastHoverPickT >= 16;
    if (hoverDue) {
      _lastHoverPickT = hoverNow;
    }
    if (_mouseEntered && hoverDue) _updateCursorCoords(event.clientX, event.clientY);
    if (buildMode) _moveBuildGhost(event.clientX, event.clientY);
    if (isAltOrbiting) {
      camera.alpha -= (event.clientX - altOrbitLast.x) * 0.007;
      camera.beta = Math.max(0.15, Math.min(1.4, camera.beta + (event.clientY - altOrbitLast.y) * 0.007));
      altOrbitLast = { x: event.clientX, y: event.clientY };
      return;
    }
    if (isSelecting) {
      selEnd = { x: event.clientX, y: event.clientY };
      updateSelBoxCSS();
    }
    if (rightDown) rightLastPos = { x: event.clientX, y: event.clientY };
    if (!isSelecting && !rightDown && hoverDue) {
      const hit = pickMesh(event.clientX, event.clientY);
      _updateDecalHover(hit, event.clientX, event.clientY);
      _updateHoverCursor(hit);
      let hoveredSquadId = null;
      if (hit?.meta) {
        const sid = hit.meta.squadEntityId !== undefined ? hit.meta.squadEntityId : world.get(hit.meta.soldierEntityId, 'soldier')?.squadId;
        if (sid !== undefined) {
          const squad = world.get(sid, 'squad');
          if (squad && isHostileToSelection(world, sid, squad.team)) hoveredSquadId = sid;
        }
      }
      if (hoveredSquadId !== _hoverEnemySquad) {
        if (_hoverEnemySquad !== null && _hoverEnemySquad !== hoveredEnemySquad && world.has(_hoverEnemySquad, 'squad')) {
          const previousSquad = world.get(_hoverEnemySquad, 'squad');
          previousSquad?.soldiers.forEach((sid) => {
            if (!sid) return;
            const mc = world.get(sid, 'mesh');
            if (mc?.root?._selMat) mc.root._selMat.opacity = 0; mc.root._selMat.transparent = true;
          });
        }
        set_hoverEnemySquad(hoveredSquadId);
        if (hoveredSquadId !== null && hoveredSquadId !== hoveredEnemySquad) {
          const hsq = world.get(hoveredSquadId, 'squad');
          hsq?.soldiers.forEach((sid) => {
            if (!sid) return;
            const mc = world.get(sid, 'mesh');
            if (mc?.root?._selMat) mc.root._selMat.opacity = 0.4; mc.root._selMat.transparent = true;
          });
        }
      }
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId !== undefined) {
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
    }
    if (event.button === 0) {
      if (isAltOrbiting) {
        isAltOrbiting = false;
        canvas.style.cursor = altDown ? 'grab' : '';
        return;
      }
      if (buildMode) {
        if (buildMode === 'listening_post') {
          placeListeningPost(event.clientX, event.clientY);
        } else {
          const point = raycastGround(event.clientX, event.clientY);
          if (point) placeBuild(point);
        }
        return;
      }
      if (_tryBuilderCommandClick(event.clientX, event.clientY)) {
        isSelecting = false;
        selBoxEl.style.display = 'none';
        return;
      }
      if (!isSelecting) return;
      isSelecting = false;
      selBoxEl.style.display = 'none';
      if (Math.abs(selEnd.x - selStart.x) < 5 && Math.abs(selEnd.y - selStart.y) < 5) {
        doClickSelect(event.clientX, event.clientY, event.shiftKey);
      } else {
        doBoxSelect();
      }
      updateHUD();
    } else if (event.button === 2) {
      if (!isOrbiting) issueRightClick(event.clientX, event.clientY);
      rightDown = false;
      isOrbiting = false;
    }
  });
  canvas.addEventListener('wheel', (event) => {
    camera.radius = applyZoom(camera.radius, event.deltaY, camera.lowerRadiusLimit, camera.upperRadiusLimit);
    event.preventDefault();
  }, { passive: false });
}

export function initInput() {
  preloadCursors();
  window.addEventListener('keydown', (event) => {
    keys[event.code] = true;
    if (event.code.startsWith('Arrow')) {
      event.preventDefault();
    }
    if (event.code === 'Escape') {
      if (buildMenuOpen) {
        setBuildMenuOpen(false);
        event.preventDefault();
      }
    }
    if (event.code === 'AltLeft' || event.code === 'AltRight') {
      altDown = true;
      event.preventDefault();
      if (!buildMode) canvas.style.cursor = 'grab';
    }
    if (event.code === 'KeyQ') {
      selSquads.forEach((sid) => {
        const squad = world.get(sid, 'squad');
        if (squad) {
          squad.moveOrder = null;
          squad.stopped = true;
        }
      });
    }
    if (event.code === 'KeyL') {
      selSquads.filter((id) => world.has(id, 'apc')).forEach((apcId) => {
        const apc = world.get(apcId, 'apc');
        if (!apc) return;
        world.query('squad').forEach((sid) => {
          _boardSquadOntoApc(apc, sid);
        });
        updateHUD();
      });
    }
    if (event.code === 'KeyU') {
      selSquads.filter((id) => world.has(id, 'apc')).forEach((apcId) => {
        const apc = world.get(apcId, 'apc');
        if (apc) {
          _apcEjectPassengers(world, apc);
          updateHUD();
        }
      });
    }
    if (event.code === 'KeyA') {
      _rangeCirclesVisible = !_rangeCirclesVisible;
      if (!_rangeCirclesVisible) _hideRangeCircles();
    }
    if (event.code === 'Space') {
      event.preventDefault();
      const prevBuilder = selBuilder;
      clearSelection();
      const builders = world.query('builder', 'mesh').filter((id) => canCommand(world.get(id, 'builder')?.team));
      if (builders.length > 0) {
        const curIdx = prevBuilder !== null ? builders.indexOf(prevBuilder) : -1;
        const builderId = builders[(curIdx + 1) % builders.length];
        setSelBuilder(builderId);
        const mc = world.get(builderId, 'mesh');
        if (mc?.root?._selMat) mc.root._selMat.opacity = 0.9; mc.root._selMat.transparent = true;
        if (mc?.root?._selDisc) {
          mc.root._selDisc.visible = true;
          mc.root._selDisc.visible = true;
        }
      }
      updateHUD();
    }
    if (selBuilder !== null && world.has(selBuilder, 'builder')) {
      if (event.code === 'KeyM') {
        setBuilderCommand('move');
        updateHUD();
      } else if (event.code === 'KeyR') {
        setBuilderCommand('repair');
        updateHUD();
      } else if (event.code === 'KeyT') {
        setBuilderCommand('melee');
        updateHUD();
      } else if (event.code === 'KeyB') {
        setBuildMenuOpen(!buildMenuOpen);
        updateHUD();
      }
    }
  });
  window.addEventListener('keyup', (event) => {
    keys[event.code] = false;
    if (event.code === 'AltLeft' || event.code === 'AltRight') {
      altDown = false;
      isAltOrbiting = false;
      if (!buildMode) canvas.style.cursor = '';
    }
  });
  window.addEventListener('blur', () => {
    isSelecting = false;
    rightDown = false;
    isAltOrbiting = false;
    altDown = false;
    canvas.style.cursor = '';
    selBoxEl.style.display = 'none';
  });

  window.addEventListener('mousemove', (event) => {
    _mouseX = event.clientX;
    _mouseY = event.clientY;
    _mouseEntered = true;
  });
  window.addEventListener('mouseenter', () => {
    _mouseEntered = true;
  });
  setupPointerEvents();
}
