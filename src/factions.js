import { modelUrl } from './assets.js';
import { loadGltf } from './gltf-models.js';

import chaos from './factions/chaos.js';
import darkEldar from './factions/dark-eldar.js';
import eldar from './factions/eldar.js';
import ig from './factions/ig.js';
import necrons from './factions/necrons.js';
import orks from './factions/orks.js';
import sob from './factions/sob.js';
import spaceMarines from './factions/space-marines.js';
import tau from './factions/tau.js';

export const FACTIONS = {
  chaos,
  'dark eldar': darkEldar,
  eldar,
  ig,
  necrons,
  orks,
  sob,
  'space marines': spaceMarines,
  tau,
};

export let playerFaction = 'ig';
export let enemyFaction = 'chaos';

// Start positions 1-6 in game.js resetGame, in order.
export const POSITION_FACTIONS = ['orks', 'ig', 'necrons', 'chaos', 'space marines', 'eldar'];

// Default Arena adds a 7th start position (Tau, blue side) and an 8th
// (Dark Eldar, red side). SGB maps keep the base 6 positions. Model
// loading always covers the union.
export const ARENA_POSITION_FACTIONS = [...POSITION_FACTIONS, 'tau', 'dark eldar'];

function _emptyBucket() {
  return { hq: null, worker: null, soldier: null, units: {}, structures: {}, vehicles: {} };
}

export const factionContainers = {};
for (const key of ARENA_POSITION_FACTIONS) {
  factionContainers[key] = _emptyBucket();
}

export function resolveFactionKey(faction, fallback = playerFaction) {
  if (faction && factionContainers[faction]) {
    return faction;
  }
  if (fallback && factionContainers[fallback]) {
    return fallback;
  }
  return POSITION_FACTIONS[0];
}

export function getFactionAnimations(factionKey, role = 'soldier') {
  const key = FACTIONS[factionKey] ? factionKey : (factionKey === 'player' ? playerFaction : enemyFaction);
  const idx = role === 'worker' ? 0 : 1;
  return FACTIONS[key]?.infantry?.[idx]?.animations || null;
}

export function getStructureConfig(factionKey, type) {
  return FACTIONS[factionKey]?.structures?.find((s) => s.type === type) || null;
}



function _collectUnitModels(config) {
  const models = new Set();
  for (const unit of config?.units || []) {
    if (unit.model) {
      models.add(unit.model);
    }
  }
  return models;
}

function _collectVehicleModels(config) {
  const models = new Set();
  for (const structure of config?.structures || []) {
    for (const item of structure.production || []) {
      if (item.model) {
        models.add(item.model);
      }
    }
  }
  return models;
}

export function countFactionModels(config) {
  if (!config) {
    return 0;
  }
  let total = 0;
  if (config.hq) {
    total += 1;
  }
  if (config.infantry?.[0]?.model) {
    total += 1;
  }
  if (config.infantry?.[1]?.model) {
    total += 1;
  }
  total += (config.units || []).filter((u) => u.model).length;
  total += (config.structures || []).filter((s) => s.model).length;
  total += _collectVehicleModels(config).size;
  return total;
}

export async function loadFactionModels(scene, factionKeys = POSITION_FACTIONS, hooks = {}) {
  console.log('[FACTION] START LOADING MODELS...');
  const { loadModel = loadGltf, onProgress = null } = hooks;
  let total = 0;
  for (const key of factionKeys) {
    total += countFactionModels(FACTIONS[key]);
  }
  let loaded = 0;

  function reportProgress(label) {
    loaded += 1;
    if (onProgress) {
      try {
        onProgress({ loaded, total, label });
      } catch (_) {}
    }
  }

  async function safeLoad(path, label, hiddenNodes) {
    if (!path) return null;
    try {
      const url = modelUrl(path);
      console.log(`[FACTION] Loading ${label}: ${url}`);
      const container = await loadModel(url);
      if (container && hiddenNodes) container._hiddenNodes = hiddenNodes;
      return container;
    } catch (error) {
      console.warn(`[FACTION] Failed to load model (${label}): ${path}`, error);
      return null;
    } finally {
      reportProgress(label);
    }
  }

  async function loadUnitContainers(config, target, label) {
    for (const unit of config?.units || []) {
      target[unit.name] = await safeLoad(unit.model, `${label} Unit ${unit.name}`, unit.hiddenNodes);
    }
  }

  for (const key of factionKeys) {
    const config = FACTIONS[key];
    if (!config) {
      continue;
    }
    if (!factionContainers[key]) {
      factionContainers[key] = _emptyBucket();
    }
    const target = factionContainers[key];
    target.hq = await safeLoad(config.hq, `${config.name} HQ`, getStructureConfig(key, 'hq')?.hiddenNodes);
    target.worker = await safeLoad(config.infantry?.[0]?.model, `${config.name} Worker`, config.infantry?.[0]?.hiddenNodes);
    target.soldier = await safeLoad(config.infantry?.[1]?.model, `${config.name} Soldier`, config.infantry?.[1]?.hiddenNodes);
    await loadUnitContainers(config, target.units, config.name);
    for (const s of config.structures || []) {
      target.structures[s.type] = await safeLoad(s.model, `${config.name} Structure ${s.type}`, s.hiddenNodes);
    }
    for (const model of _collectVehicleModels(config)) {
      target.vehicles[model] = await safeLoad(model, `${config.name} Vehicle`);
    }
  }

  console.log('[FACTION] ALL MODELS LOADED.');
}
