import * as THREE from 'three';

import { scene, canvas, pickAt } from './scene.js';
import { mkPlane, mkLines, mkGroup, disposeObj, loadTexture } from './three-helpers.js';
import { decalBaseSize } from './decal-size.js';

const DECAL_GLOB = import.meta.glob('/maps/6p_alvarus/decals/**/*.{png,jpg,jpeg,webp,tga,dds}', {
  as: 'url',
  eager: true,
});

let _decalRoot = null;
let _decalMeshes = [];
let _decalTextureCache = new Map();
let _decalScale = 12;
// Temporarily disabled: decals stay hidden until the user toggles them on.
let _decalVisible = false;
let _hiddenGroups = new Set();

const DECAL_FILTER = '__NONE__';
const DECAL_MAX_HANG = 4;

let _hoverDecal = null;
let _hoverOutline = null;
let _selectedDecal = null;
let _selectedOutline = null;
let _decalPointerReady = false;

const OUTLINE_HOVER = new THREE.Color(1, 0.9, 0.2);
const OUTLINE_SELECT = new THREE.Color(1, 0.3, 0.3);

function _makeOutline(mesh, color) {
  const half = mesh.userData?.side / 2 || 8;
  const z = -0.15;
  const points = [
    new THREE.Vector3(-half, -half, z),
    new THREE.Vector3(half, -half, z),
    new THREE.Vector3(half, half, z),
    new THREE.Vector3(-half, half, z),
    new THREE.Vector3(-half, -half, z),
  ];
  const lines = mkLines('decal-outline-' + mesh.name, points, color, 1);
  mesh.add(lines);
  return lines;
}

function _disposeOutline(outline) {
  if (outline && !(outline.userData.disposed === true)) {
    disposeObj(outline);
  }
}

function _clearHover() {
  _disposeOutline(_hoverOutline);
  _hoverOutline = null;
  _hoverDecal = null;
}

function _clearSelected() {
  _disposeOutline(_selectedOutline);
  _selectedOutline = null;
  _selectedDecal = null;
}

function _selectedLabel() {
  if (!_selectedDecal) {
    return '';
  }
  const meta = _selectedDecal.userData || {};
  const size = Math.round((meta.baseSize || 10) * _decalScale);
  const name = String(meta.decalPath || '').replace(/^art\/decals\//, '') || 'decal';
  return 'SELECTED: ' + name + ' · ' + size + '×' + size;
}

function _notifySelection() {
  window.dispatchEvent(
    new CustomEvent('decal-selected', {
      detail: {
        path: _selectedDecal?.userData?.decalPath || '',
        index: _selectedDecal ? _decalMeshes.indexOf(_selectedDecal) : -1,
      },
    }),
  );
}

export function getSelectedDecalPath() {
  return _selectedDecal?.userData?.decalPath || '';
}

export function getSelectedDecalIndex() {
  if (!_selectedDecal) return -1;
  return _decalMeshes.indexOf(_selectedDecal);
}

export function getPlacedDecalList() {
  const byPath = new Map();
  _decalMeshes.forEach((mesh) => {
    const path = mesh.userData?.decalPath || '';
    if (!path) {
      return;
    }
    const entry = byPath.get(path) || {
      path,
      url: mesh.userData?.decalUrl || '',
      count: 0,
    };
    entry.count += 1;
    byPath.set(path, entry);
  });
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export function getDecalGroups() {
  const byPath = new Map();
  _decalMeshes.forEach((mesh, idx) => {
    const path = mesh.userData?.decalPath || '';
    if (!path) return;
    let g = byPath.get(path);
    if (!g) {
      g = { path, url: mesh.userData?.decalUrl || '', count: 0, instances: [] };
      byPath.set(path, g);
    }
    g.count += 1;
    g.instances.push({
      index: idx,
      mesh,
      x: mesh.userData?.x ?? mesh.position.x,
      z: mesh.userData?.z ?? mesh.position.z,
      sizeRaw: mesh.userData?.sizeRaw ?? 0,
      angle: mesh.userData?.angle ?? 0,
      baseSize: mesh.userData?.baseSize ?? 0,
    });
  });
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export function selectDecalByPath(path) {
  const decal = _decalMeshes.find((mesh) => mesh.userData?.decalPath === path) || null;
  if (!decal) {
    return;
  }
  _clearSelected();
  _selectedDecal = decal;
  _selectedOutline = _makeOutline(decal, OUTLINE_SELECT);
  _clearHover();
  setSgbDecalStatus(_selectedLabel(), 'ok');
  _notifySelection();
}

export function selectDecalAt(index) {
  const decal = _decalMeshes[index] || null;
  if (!decal) return;
  _clearSelected();
  _selectedDecal = decal;
  _selectedOutline = _makeOutline(decal, OUTLINE_SELECT);
  _clearHover();
  setSgbDecalStatus(_selectedLabel(), 'ok');
  _notifySelection();
}

export function selectDecal(mesh) {
  if (!mesh || !_decalMeshes.includes(mesh)) return;
  _clearSelected();
  _selectedDecal = mesh;
  _selectedOutline = _makeOutline(mesh, OUTLINE_SELECT);
  _clearHover();
  setSgbDecalStatus(_selectedLabel(), 'ok');
  _notifySelection();
}

export function getSelectedDecal() {
  return _selectedDecal;
}

export function getSelectedDecalPosition() {
  if (!_selectedDecal) return null;
  return { x: _selectedDecal.position.x, y: _selectedDecal.position.y, z: _selectedDecal.position.z };
}

export function setSelectedDecalPosition({ x, y, z }) {
  if (!_selectedDecal) return false;
  if (typeof x === 'number' && Number.isFinite(x)) {
    _selectedDecal.position.x = x;
    _selectedDecal.userData.x = x;
  }
  if (typeof y === 'number' && Number.isFinite(y)) {
    _selectedDecal.position.y = y;
    _selectedDecal.userData.y = y;
  }
  if (typeof z === 'number' && Number.isFinite(z)) {
    _selectedDecal.position.z = z;
    _selectedDecal.userData.z = z;
  }
  setSgbDecalStatus(_selectedLabel(), 'ok');
  window.dispatchEvent(
    new CustomEvent('decal-moved', {
      detail: {
        x: _selectedDecal.position.x,
        y: _selectedDecal.position.y,
        z: _selectedDecal.position.z,
        index: _decalMeshes.indexOf(_selectedDecal),
        path: _selectedDecal.userData?.decalPath || '',
      },
    }),
  );
  return true;
}

function _decalForPicked(picked) {
  if (!picked) {
    return null;
  }
  if (_decalMeshes.includes(picked)) {
    return picked;
  }
  const owner = String(picked.name || '').startsWith('decal-outline-')
    ? picked.parent
    : null;
  if (owner && _decalMeshes.includes(owner)) {
    return owner;
  }
  return null;
}

function setupDecalPointerActions() {
  if (_decalPointerReady) {
    return;
  }
  _decalPointerReady = true;
  const pickDecal = (event) => {
    const hit = pickAt(event.clientX, event.clientY, (mesh) => _decalMeshes.includes(mesh));
    return _decalForPicked(hit.pickedMesh || null);
  };
  canvas.addEventListener('pointermove', (event) => {
    const decal = pickDecal(event);
    if (decal && _hoverDecal !== decal) {
      _clearHover();
      if (decal !== _selectedDecal) {
        _hoverDecal = decal;
        _hoverOutline = _makeOutline(decal, OUTLINE_HOVER);
      }
    } else if (!decal) {
      _clearHover();
    }
  });
  canvas.addEventListener('click', (event) => {
    const decal = pickDecal(event);
    if (!decal) {
      _clearSelected();
      _notifySelection();
      return;
    }
    if (_selectedDecal === decal) {
      _clearSelected();
      _notifySelection();
      return;
    }
    _clearSelected();
    _selectedDecal = decal;
    _selectedOutline = _makeOutline(decal, OUTLINE_SELECT);
    _clearHover();
    setSgbDecalStatus(_selectedLabel(), 'ok');
    _notifySelection();
  });
}

// Re-attach canvas listeners after a render-backend swap replaces the canvas.
export function rebindDecalPointerActions() {
  _decalPointerReady = false;
  setupDecalPointerActions();
}

function setSgbDecalStatus(msg, className = '') {
  const element = document.getElementById('terrain-decal-status');
  if (!element) {
    return;
  }
  element.textContent = msg;
  element.className = 'terrain-status' + (className ? ' ' + className : '');
}

function fileUrlForDecalPath(path) {
  const rel = String(path || '')
    .replace(/^art\/decals\//, '')
    .replace(/\.(tga|dds|png|jpe?g|webp)$/i, '');
  const candidates = [
    '/maps/6p_alvarus/decals/' + rel + '.png',
    '/maps/6p_alvarus/decals/' + rel + '.tga',
    '/maps/6p_alvarus/decals/' + rel + '.dds',
    '/maps/6p_alvarus/decals/' + rel + '.jpg',
    '/maps/6p_alvarus/decals/' + rel + '.webp',
  ];
  for (const c of candidates) {
    if (DECAL_GLOB[c]) return DECAL_GLOB[c];
  }
  // fallback for dev where glob may not include (e.g. loose files) — use direct /maps/ path
  return '/maps/6p_alvarus/decals/' + rel + '.png';
}

function _createDecalMaterial(url, idx) {
  const mat = new THREE.MeshBasicMaterial();
  // Do not tint the texture — unlit white base; transparent alpha-blend just
  // like the old ALPHABLEND path so semi-transparent PNG pixels survive.
  mat.color = new THREE.Color(1, 1, 1);
  mat.side = THREE.DoubleSide;
  let texture = _decalTextureCache.get(url);
  if (!texture) {
    texture = loadTexture(url, {
      onError: (msg) => {
        console.warn('[decal] texture failed', url, msg);
      },
    });
    _decalTextureCache.set(url, texture);
  }
  // Layering like chaos_taint_02 — alpha-blend over the PNG alpha channel,
  // otherwise alpha-test eats 60% of semi-transparent pixels and the decals
  // look washed out / shifted.
  mat.map = texture;
  mat.transparent = true;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  return mat;
}

export function clearSgbDecals() {
  _clearHover();
  _clearSelected();
  (_decalMeshes || []).forEach((mesh) => {
    if (!(mesh.userData.disposed === true)) {
      disposeObj(mesh, true);
    }
  });
  _decalMeshes = [];
  _hiddenGroups.clear();
  _decalTextureCache.forEach((t) => disposeObj(t));
  _decalTextureCache = new Map();
  if (_decalRoot && !(_decalRoot.userData.disposed === true)) {
    disposeObj(_decalRoot);
  }
  _decalRoot = null;
}

export function isDecalGroupVisible(path) {
  return !_hiddenGroups.has(path);
}

export function setDecalGroupVisible(path, visible) {
  if (!path) return;
  if (visible) _hiddenGroups.delete(path);
  else _hiddenGroups.add(path);
  const effectiveVisible = visible && _decalVisible;
  _decalMeshes.forEach((m) => {
    if (m.userData?.decalPath === path) m.visible = effectiveVisible;
  });
  window.dispatchEvent(
    new CustomEvent('decal-group-visibility', { detail: { path, visible } }),
  );
}

export function toggleDecalGroup(path) {
  const next = !isDecalGroupVisible(path);
  setDecalGroupVisible(path, next);
  return next;
}

export function updateSgbDecalScale(value) {
  _decalScale = parseFloat(value) || 300;
  const el = document.getElementById('terrain-decal-scale-val');
  if (el) {
    el.textContent = Math.round(_decalScale);
  }
  _decalMeshes.forEach((mesh) => {
    mesh.scale.setScalar(1);
    const base = mesh.userData?.baseSize || 10;
    const size = base * _decalScale;
    mesh.scale.x = size / mesh.userData.side;
    mesh.scale.y = size / mesh.userData.side;
  });
  setSgbDecalStatus('DECAL SCALE ' + Math.round(_decalScale), '');
}

function setDecalButtonLabel() {
  const button = document.querySelector('[data-decal-toggle]');
  if (button) {
    button.textContent = _decalVisible ? '👁 DECALS: HIDE' : '👁 DECALS: SHOW';
  }
}

export function areSgbDecalsVisible() {
  return _decalVisible;
}

export function toggleSgbDecals() {
  _decalVisible = !_decalVisible;
  if (_decalRoot && !(_decalRoot.userData.disposed === true)) {
    _decalRoot.visible = _decalVisible;
  }
  _decalMeshes.forEach((m) => {
    const path = m.userData?.decalPath || '';
    const groupVisible = !_hiddenGroups.has(path);
    m.visible = _decalVisible && groupVisible;
  });
  if (!_decalVisible) {
    _clearHover();
    _clearSelected();
  } else if (_selectedDecal) {
    _selectedOutline = _makeOutline(_selectedDecal, OUTLINE_SELECT);
  }
  setSgbDecalStatus(
    _decalVisible ? 'DECALS ON' : 'DECALS OFF',
    _decalVisible ? '' : '',
  );
  setDecalButtonLabel();
}

export function buildSgbDecals(root, mapData, sampleHeight) {
  clearSgbDecals();
  const linkById = new Map(
    (mapData?.decalLinks || []).map((link) => [link.id, link.path]),
  );
  const decals = (mapData?.decals || [])
    .filter((decal) => {
      const path = linkById.get(decal.decalIdx) || '';
      return path.includes(DECAL_FILTER);
    });
  if (!root || !decals || !decals.length) {
    setSgbDecalStatus(
      decals && decals.length ? 'NO DECAL TEXTURES' : 'NO DECALS IN THIS SGB',
      'err',
    );
    return;
  }
  _decalRoot = mkGroup('SGB_Decals');
  root.add(_decalRoot);
  _decalRoot.visible = _decalVisible;

  const materialByPath = new Map();

  decals.forEach((decal, i) => {
    const path = linkById.get(decal.decalIdx) || '';
    const url = fileUrlForDecalPath(path);
    let material = materialByPath.get(url);
    if (!material) {
      material = _createDecalMaterial(url, i);
      materialByPath.set(url, material);
    }
    // Per-decal SGB size respected; chaos keeps the legacy flat size.
    const baseSize = decalBaseSize(path, decal.size);
    const side = 16;
    const size = baseSize * _decalScale;
    const half = size / 2;
    if (sampleHeight) {
      const center = sampleHeight(decal.x, decal.z);
      const corners = [
        sampleHeight(decal.x - half, decal.z - half),
        sampleHeight(decal.x + half, decal.z - half),
        sampleHeight(decal.x - half, decal.z + half),
        sampleHeight(decal.x + half, decal.z + half),
      ];
      const hang = center - Math.min(...corners);
      if (hang > DECAL_MAX_HANG) {
        return;
      }
    }
    const plane = mkPlane('SGB_Decal_' + i, side, side, true);
    _decalRoot.add(plane);
    plane.material = material;
    plane.userData = { baseSize, side, decalPath: path, decalUrl: url, x: decal.x, z: decal.z, sizeRaw: decal.size, angle: decal.angle };
    // nestle just above ground so decal looks layered onto surface like chaos_taint_02 ground sheet (zOffset handles z-fighting)
    plane.position.set(decal.x, sampleHeight(decal.x, decal.z) + 0.08, decal.z);
    plane.rotation.x = -Math.PI / 2;
    plane.rotation.y = decal.angle + Math.PI;

    plane.scale.x = size / side;
    plane.scale.y = size / side;
    _decalMeshes.push(plane);
  });

  const byType = new Map();
  _decalMeshes.forEach((mesh) => {
    byType.set(mesh.material?.name, (byType.get(mesh.material?.name) || 0) + 1);
  });
  setSgbDecalStatus(
    '✓ ' + _decalMeshes.length + ' ' + DECAL_FILTER + ' DECALS PLACED · SCALE ' + Math.round(_decalScale),
    'ok',
  );
  setDecalButtonLabel();
  setupDecalPointerActions();
  window.dispatchEvent(new CustomEvent('decal-list-changed'));
}

/**
 * Layout-driven decals — placed from maps/*_layout_upd.json (world x/z,
 * size_raw, rotation_rad) so they share the same surface attachment as the
 * per-map ground sheet (terrain.ground_texture). Scale follows the same
 * _decalScale slider; at the default 12 a size_raw of 0.05 ≈ 50 world units.
 */
export function buildSgbDecalsFromLayout(root, layout, sampleHeight) {
  clearSgbDecals();
  const decals = (layout?.decals || []).map((d) => {
    const path = d.ref || '';
    return {
      path,
      url: fileUrlForDecalPath(path),
      x: d.x,
      z: d.z,
      sizeRaw: d.size_raw,
      angle: d.rotation_rad,
    };
  });
  if (!root || !decals.length) {
    setSgbDecalStatus('NO DECALS IN LAYOUT', 'err');
    return;
  }
  _decalRoot = mkGroup('SGB_Decals');
  root.add(_decalRoot);
  _decalRoot.visible = _decalVisible;

  const materialByUrl = new Map();

  decals.forEach((decal, i) => {
    let material = materialByUrl.get(decal.url);
    if (!material) {
      material = _createDecalMaterial(decal.url, i);
      materialByUrl.set(decal.url, material);
    }
    const side = 16;
    const baseSize = decal.sizeRaw * 1000 / 12;
    const size = baseSize * _decalScale;
    // позиции из maps/6p_alvarus/6p_alvarus_preview.png (x,z) — прямые мировые, без смещения; наслоение как у chaos_taint_02 — плоскость 0.08 над землёй
    const plane = mkPlane(`SGB_Decal_${i}`, side, side, true);
    _decalRoot.add(plane);
    plane.material = material;
    plane.userData = { baseSize, side, decalPath: decal.path, decalUrl: decal.url, x: decal.x, z: decal.z, sizeRaw: decal.sizeRaw, angle: decal.angle };
    const y = sampleHeight ? sampleHeight(decal.x, decal.z) + 0.08 : 0.08;
    plane.position.set(decal.x, y, decal.z);
    plane.rotation.x = -Math.PI / 2;
    plane.rotation.y = decal.angle + Math.PI;

    plane.scale.x = size / side;
    plane.scale.y = size / side;
    _decalMeshes.push(plane);
  });

  const byType = new Map();
  _decalMeshes.forEach((mesh) => {
    byType.set(mesh.material?.name, (byType.get(mesh.material?.name) || 0) + 1);
  });
  setSgbDecalStatus(
    '✓ ' + _decalMeshes.length + ' LAYOUT DECALS PLACED · SCALE ' + Math.round(_decalScale),
    'ok',
  );
  setDecalButtonLabel();
  setupDecalPointerActions();
  window.dispatchEvent(new CustomEvent('decal-list-changed'));
}