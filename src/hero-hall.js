// Hero hall: a procedural barracks building placed in the heroes-only scene.
// Clicking it toggles a grid view of the batch-1 roster; clicking a hero card
// loads (if needed) and spawns that hero next to the hall.
import * as THREE from 'three';
import { makeBarracksMesh } from './meshes.js';
import {
  HERO_BATCH_1, heroConfig, heroLoaded, heroClips,
  loadHero, spawnHero, getHero, selectHero, allHeroes,
} from './hero.js';

let _hall = null;
let _gridEl = null;

export function heroGridData() {
  return HERO_BATCH_1.map((key) => {
    const config = heroConfig(key) || {};
    return {
      key,
      title: config.title || key,
      loaded: heroLoaded(key),
      clips: heroLoaded(key) ? heroClips(key).length : 0,
      spawned: !!getHero(key),
    };
  });
}

export function getHeroHall() {
  return _hall;
}

export function spawnHeroHall(parent, position) {
  despawnHeroHall();
  const root = makeBarracksMesh(position.clone(), 'blue', { faction: 'ig' });
  root.traverse((child) => {
    if (child.isMesh) {
      child.userData.pickable = true;
      child.userData.heroHall = true;
    }
  });
  parent.add(root);
  _hall = { root, position: position.clone(), parent };
  return _hall;
}

export function despawnHeroHall() {
  closeHeroGrid();
  if (!_hall) {
    return;
  }
  if (_hall.root.parent) {
    _hall.root.parent.remove(_hall.root);
  }
  _hall = null;
}

export function isHeroGridOpen() {
  return !!_gridEl;
}

function gridDoc() {
  return globalThis.document;
}

export function openHeroGrid() {
  const doc = gridDoc();
  if (!doc || !doc.createElement || _gridEl) {
    return _gridEl;
  }
  const panel = doc.createElement('div');
  panel.id = 'hero-grid';
  panel.style.cssText = 'position:fixed;top:12px;right:12px;width:300px;max-height:80vh;overflow:auto;background:#101319ee;color:#eee;border:1px solid #333;border-radius:10px;padding:12px;z-index:50;font-family:sans-serif;';
  const head = doc.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
  const title = doc.createElement('b');
  title.textContent = 'Heroes — batch 1';
  const close = doc.createElement('button');
  close.textContent = '✕';
  close.addEventListener('click', () => closeHeroGrid());
  head.appendChild(title);
  head.appendChild(close);
  panel.appendChild(head);
  const grid = doc.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
  for (const hero of heroGridData()) {
    const card = doc.createElement('button');
    card.dataset.hero = hero.key;
    card.style.cssText = 'background:#1c222c;color:#eee;border:1px solid #2c3542;border-radius:8px;padding:8px;cursor:pointer;text-align:left;';
    const name = doc.createElement('div');
    name.style.cssText = 'font-weight:bold;margin-bottom:4px;';
    name.textContent = hero.title;
    const status = doc.createElement('div');
    status.style.cssText = 'font-size:12px;color:#9fb3c8;';
    status.textContent = hero.loaded
      ? `${hero.clips} clips${hero.spawned ? ' • in scene' : ''}`
      : 'not loaded';
    card.appendChild(name);
    card.appendChild(status);
    card.addEventListener('click', () => heroCardClick(hero.key));
    grid.appendChild(card);
  }
  panel.appendChild(grid);
  doc.body.appendChild(panel);
  _gridEl = panel;
  return panel;
}

export function closeHeroGrid() {
  if (_gridEl && _gridEl.remove) {
    _gridEl.remove();
  }
  _gridEl = null;
}

export function toggleHeroGrid() {
  if (isHeroGridOpen()) {
    closeHeroGrid();
    return false;
  }
  openHeroGrid();
  return true;
}

// Card click: ensure the model is in, spawn it by the hall, select it.
export async function heroCardClick(key, hooks = {}) {
  if (!heroLoaded(key)) {
    try {
      const { loadModel } = hooks;
      await loadHero(key, loadModel ? { loadModel } : {});
    } catch (error) {
      console.warn(`[HERO] ${key} failed to load from grid`, error);
      return null;
    }
  }
  if (!_hall) {
    return null;
  }
  const n = allHeroes().length;
  const state = spawnHero(
    _hall.parent,
    new THREE.Vector3(_hall.position.x + 3 + n * 2, 0, _hall.position.z + 3),
    key,
  );
  if (state) {
    selectHero(key);
  }
  if (isHeroGridOpen()) {
    closeHeroGrid();
    openHeroGrid();
  }
  return state;
}
