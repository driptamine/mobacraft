import * as THREE from 'three';

import { World } from './ecs.js';
import {
  scene, renderer, camera, canvas, world, setWorld, PLAYER, ARENA, COSTS, TAG,
  JET_ALT, JET_SPEED, JET_ATTACK_RANGE, selSquads, setSelSquads, selBuildings,
  setSelBuildings, selBuilder, setSelBuilder, requisition, setRequisition, energy, setEnergy,
  kills, setKills, startTime, setStartTime, gameOver, setGameOver, counters,
  particles, grenadeCallbacks, SQUAD_MAX, _gridVisible, createScene, setStructuresHidden,
  clearResearchedTech, updateCamera, runBeforeRender, setDeltaTime, handleResize,
  getRenderBackend, isBackendSwitching, supportsWebGPU, createBackendRenderer,
  createFreshCanvas, adoptCanvasElement, setRendererInstance, setBackendState,
} from './scene.js';
import { updateMixers } from './gltf-models.js';
import { updateNecronConduits } from './necron-conduit.js';
import { updatePlasmaGlow } from './plasma-glow.js';
import { updatePlasmaPistolGlow } from './plasma-pistol-glow.js';
import { preloadPlasmaBoltModel, updatePlasmaBoltFx } from './plasma-bolt.js';
import { updateBlasterBoltFx } from './blaster-bolt.js';
import { updateReaperBoltFx } from './reaper-bolt.js';
import { updateNecronAura } from './necron-aura.js';
import { loadFactionModels, factionContainers, ARENA_POSITION_FACTIONS } from './factions.js';
import { useProceduralModels } from './model-source.js';
import { preloadStrategicPointModel, preloadRelicModel } from './meshes.js';
import { startPositionsFor, strategicPointsFor, factionsFor, startingGuardsmenSpawns, startingNecronSpawns, startingTauSpawns, startingOrkSpawns, startingEldarSpawns, startingMarineSpawns, startingDarkEldarSpawns, factionBasePosition } from './map-layout.js';
import {
  updateHUD, updateTopBar, updateMinimap, updateCaptureProgressBars,
} from './hud.js';
import { tickFps, hudDue } from './hud/store.js';
import { toggleNodesPanel } from './nodes-panel.js';
import {
  toggleEntitiesPanel, entitiesFilter, entitiesRefresh, initEntitiesPanelAutoRefresh,
} from './entities-panel.js';
import {
  initInput, setupPointerEvents, tickCamera, cancelBuild, _rangeCirclesVisible, _showRangeCircles,
  clearAirfieldRallyMarker, clearRallyMarker,
} from './input.js';
import { rebindDecalPointerActions } from './sgb-decals.js';
import { nextBackend } from './render-backend.js';
import {
  createSoldierEntity, createSquadEntity, createBuilderEntity,
  createBuildingEntity, createStructureEntity, createStrategicPointEntity,
} from './entities.js';
import {
  _initSystems, systemAI, systemWinCheck, disposeMeshComponent,
} from './systems.js';
import {
  loadHero, spawnHero, despawnAllHeroes, tickHeroes, HERO_BATCH_1, HERO_AUTOLOAD, heroLoaded,
  HERO_TEAMS, setHeroTeam,
} from './hero.js';
import { buildDotaMap, clearDotaMap, tickDota, dotaHeroSlots } from './dota.js';
import { spawnHeroHall, despawnHeroHall } from './hero-hall.js';
import { disposeObj, childMeshes } from './three-helpers.js';

// ══════════════════════════════════════════════════════════════════════════════
export function resetGame(mapKey = window._currentMapKey || 'arena') {
  if (world) {
    const tags = ['squad', 'builder', 'building', 'structure', 'bullet', 'grenade', 'strategicPoint', 'apc', 'vehicle', 'laserBullet', 'plasmaBullet', 'airfield', 'jet', 'missile', 'soldier'];
    for (const tag of tags) {
      for (const id of world.query(tag)) {
        const meshComponent = world.get(id, 'mesh');
        if (meshComponent) {
          disposeMeshComponent(meshComponent);
        }
        const strategicPoint = world.get(id, 'strategicPoint');
        if (strategicPoint?.lpMesh) {
          childMeshes(strategicPoint.lpMesh).forEach((child) => disposeObj(child));
          disposeObj(strategicPoint.lpMesh);
        }
      }
    }
  }
  particles.forEach((particle) => disposeObj(particle.mesh));
  particles.length = 0;
  grenadeCallbacks.length = 0;

  setRequisition(1500);
  setEnergy(100);
  setKills(0);
  setStartTime(Date.now());
  setGameOver(false);
  setSelBuildings([]);
  setSelBuilder(null);
  setSelSquads([]);
  clearResearchedTech();

  // Capture bars are React-managed now — let the component re-render on reset
  updateCaptureProgressBars();

  cancelBuild();
  const winEl = document.getElementById('win');
  if (winEl) {
    winEl.style.display = 'none';
  }

  const entityWorld = new World();
  setWorld(entityWorld);
  _initSystems(entityWorld);
  entityWorld.addSystem(systemAI);

  // Heroes-only scene: no strategic points, buildings, builders or squads are
  // spawned — only the batch-1 hero lineup below. (The removed blocks are kept
  // in history; restore them to bring the RTS back.)
  const igBase = factionBasePosition(mapKey, PLAYER, 'ig');
  if (igBase) {
    camera.target.set(igBase.x, 0, igBase.z);
  }

  // Hero lineup next to the player base, re-spawned per reset. Only loaded
  // heroes take a slot, so rows stay compact. Team fighters spawn in two
  // facing battle rows and hold until ordered to attack; everyone else lines
  // up by the hall as a neutral showcase.
  despawnHeroHall();
  despawnAllHeroes();
  const teamKeys = new Set([...HERO_TEAMS.radiant, ...HERO_TEAMS.dire]);
  const anchorX = igBase ? igBase.x : 0;
  const anchorZ = (igBase ? igBase.z : 0) + 7;
  spawnHeroHall(scene, new THREE.Vector3(anchorX - 10, 0, anchorZ));
  const neutrals = HERO_BATCH_1.filter((key) => heroLoaded(key) && !teamKeys.has(key));
  neutrals.forEach((key, i) => {
    spawnHero(
      scene,
      new THREE.Vector3(anchorX + (i - (neutrals.length - 1) / 2) * 4, 0, anchorZ),
      key,
    );
  });
  // Battle rows stand 40 apart: far enough that ordered fighters cross real
  // ground before contact instead of starting blade-to-blade.
  const BATTLE_ROW_OFFSET = 20;
  // The procedural Dota map lives on its own map pick; the default arena
  // stays a clean hero showcase.
  clearDotaMap();
  if (mapKey === 'dota') {
    buildDotaMap(scene, new THREE.Vector3(anchorX, 0, anchorZ));
  }
  // Team fighters take lane slots 2-1-2 behind their outer towers on the
  // Dota map, or battle rows on other maps.
  const laneSlots = mapKey === 'dota' ? dotaHeroSlots(new THREE.Vector3(anchorX, 0, anchorZ)) : null;
  for (const team of ['radiant', 'dire']) {
    const row = HERO_TEAMS[team].filter((key) => heroLoaded(key));
    row.forEach((key, i) => {
      const slot = laneSlots?.[team]?.[i]?.pos;
      const pos = slot || new THREE.Vector3(anchorX + (i - (row.length - 1) / 2) * 4, 0, anchorZ);
      const id = spawnHero(scene, pos, key)?.id;
      if (id) {
        setHeroTeam(id, team);
      }
    });
  }

  // Temporary: hide all structures until restored via toggleStructures().
  setStructuresHidden(true);

  updateHUD();
}

let lastTime = performance.now();
let _gameBooted = false;
let _frameNo = 0;
let _frameTick = () => {};

// Live WebGL <-> WebGPU switch: the replacement renderer is built and
// initialized off-DOM first, so a failure keeps the old backend running.
export async function switchRenderBackend() {
  const from = getRenderBackend();
  if (!renderer || isBackendSwitching()) {
    return from;
  }
  const target = nextBackend(from, supportsWebGPU());
  if (target === from) {
    return from;
  }
  setBackendState(from, true);
  try {
    const freshCanvas = createFreshCanvas();
    const next = await createBackendRenderer(target, freshCanvas);
    const prev = renderer;
    if (prev && prev.setAnimationLoop) {
      prev.setAnimationLoop(null);
    }
    try {
      prev.dispose();
    } catch (_) {}
    adoptCanvasElement(freshCanvas);
    setRendererInstance(next);
    setupPointerEvents();
    rebindDecalPointerActions();
    next.setAnimationLoop(_frameTick);
    setBackendState(target, false);
    return target;
  } catch (error) {
    console.warn(`[backend] switch to ${target} failed, staying on ${from}`, error);
    setBackendState(from, false, String(error?.message || error));
    return from;
  }
}

export async function bootGame(loadHooks = {}) {
  if (_gameBooted) {
    return;
  }
  _gameBooted = true;

  await createScene();
  initInput();

  // Heroes-only scene: faction GLBs, strategic-point, relic and plasma-bolt
  // models stay on disk and never load — only the registered heroes below.
  // (Restore the calls to bring the RTS assets back.)

  // Hero models ship outside models/ (axe-final/, batches/), so they load in
  // every mode. Each hero loads independently — one broken file skips itself.
  // Progress is reported per hero so the skirmish loading bar actually moves
  // (faction loads are skipped in heroes-only mode, so nothing else reports).
  const { onProgress = null } = loadHooks;
  for (let i = 0; i < HERO_AUTOLOAD.length; i++) {
    const key = HERO_AUTOLOAD[i];
    try {
      await loadHero(key);
    } catch (error) {
      console.warn(`[HERO] ${key} model failed to load, skipping`, error);
    }
    if (onProgress) {
      onProgress({ loaded: i + 1, total: HERO_AUTOLOAD.length, label: `Loading ${key}` });
    }
  }
  if (onProgress) {
    onProgress({ loaded: HERO_AUTOLOAD.length, total: HERO_AUTOLOAD.length, label: 'Ready' });
  }

  if (!window._multiplayerMode) {
    resetGame();
  }

  _frameTick = () => {
    const now = performance.now();
    const deltaTime = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    setDeltaTime(deltaTime);
    tickFps(now);

    if (!gameOver && world) {
      world.tick(deltaTime);
      for (let i = grenadeCallbacks.length - 1; i >= 0; i--) {
        if (grenadeCallbacks[i](deltaTime)) {
          grenadeCallbacks.splice(i, 1);
        }
      }

      // Auto-reinforce
      {
        const cost = COSTS.reinforce;
        let changed = false;
        for (const sid of world.query('squad')) {
          const squadComponent = world.get(sid, 'squad');
          if (!squadComponent || !squadComponent.autoReinforce || squadComponent.team !== PLAYER || squadComponent.reinforceQueue.length > 0 || requisition < cost) {
            continue;
          }
          const alive = squadComponent.soldiers.filter((soldierId) => soldierId !== null && world.has(soldierId, 'soldier'));
          const occupied = new Set(alive.map((soldierId) => world.get(soldierId, 'soldier')?.formIdx));
          for (let i = 1; i < SQUAD_MAX; i++) {
            if (!occupied.has(i)) {
              setRequisition(requisition - cost);
              squadComponent.reinforceQueue.push({ formIdx: i });
              changed = true;
              break;
            }
          }
        }
        if (changed) {
          updateHUD();
        }
      }

      const hasQueue = world.query('building').some((id) => (world.get(id, 'building')?.queue.length || 0) > 0);
      const hasReinforce = selSquads.some((id) => {
        const squadComponent = world.get(id, 'squad');
        return squadComponent && (squadComponent.reinforceQueue.length > 0 || squadComponent.grenadeQueue.length > 0);
      });
      if (hasQueue || hasReinforce) {
        updateHUD();
      }

      // Disabled: heroes-only scene has no player units, so the win check
      // would end the game on the first tick. (Restore with the RTS spawns.)
      // systemWinCheck(world);
    }

    tickCamera(deltaTime);

    if (scene._gridMicroMesh && _gridVisible) {
      const radius = camera.radius;
      const factor = Math.max(0, Math.min(1, (45 - radius) / 10));
      const terrainAlpha = scene._terrainMicroAlpha ?? 0.1;
      scene._gridMicroMesh.material.opacity = Math.min(1, factor * (terrainAlpha / 0.1));
    }
    _frameNo += 1;
    if (hudDue(_frameNo)) {
      updateTopBar();
      updateCaptureProgressBars();
    }
    if (world && _rangeCirclesVisible) {
      _showRangeCircles();
    }
    updateCamera();
    updateMixers(deltaTime);
    tickHeroes(deltaTime);
    tickDota(deltaTime);
    updateNecronConduits(deltaTime);
    updatePlasmaGlow(deltaTime);
    updatePlasmaPistolGlow(performance.now() / 1000);
    updatePlasmaBoltFx(performance.now() / 1000);
    updateBlasterBoltFx(performance.now() / 1000);
    updateReaperBoltFx(performance.now() / 1000);
    updateNecronAura(performance.now() / 1000);
    runBeforeRender();
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(_frameTick);

  window.addEventListener('resize', () => handleResize());
}

// Start the game when loaded
window.addEventListener('DOMContentLoaded', () => {
  // Bind UI functions to window for HTML onclick handlers
  window.resetGame = resetGame;
  window.bootGame = bootGame;
  window.switchRenderBackend = switchRenderBackend;
  window.toggleGrid = () => import('./scene.js').then((module) => module.toggleGrid());
  window.toggleGridVariant = () => import('./scene.js').then((module) => module.toggleGridVariant());
  window.toggleNodesPanel = toggleNodesPanel;
  window.toggleScatterPanel = () => import('./scene.js').then((module) => module.toggleScatterPanel());
  window.resetGame = resetGame;
  window.onScatterInput = (value) => import('./scene.js').then((module) => module.onScatterInput(value));
  window.onHitboxInput = (value) => import('./scene.js').then((module) => module.onHitboxInput(value));
  window.toggleHitboxDebug = () => import('./scene.js').then((module) => module.toggleHitboxDebug());
  window.toggleStructures = () => import('./scene.js').then((module) => module.toggleStructures());
  window.setStructuresHidden = (value) => import('./scene.js').then((module) => module.setStructuresHidden(value));
  window.heroPlay = (id, name, loop, fade) => import('./hero.js').then((module) => module.playHeroAnim(id, name, loop, fade));
  window.heroClips = (key) => import('./hero.js').then((module) => module.heroClips(key));
  window.heroStop = (id) => import('./hero.js').then((module) => module.stopHero(id));
  window.setTerrain = (value) => import('./scene.js').then((module) => module.setTerrain(value));
  window.setAttackMode = (value) => import('./scene.js').then((module) => module.setAttackMode(value));
  window.toggleControlBoth = () => import('./scene.js').then((scene) => {
    scene.setControlBoth(!scene.controlBoth);
    return import('./input.js').then((input) => input.clearSelection());
  });
  window.startBuild = (value) => import('./input.js').then((module) => module.startBuild(value));

  window.filterNodes = (value) => import('./nodes-panel.js').then((module) => module.filterNodes(value));
  window.nodesShowAll = () => import('./nodes-panel.js').then((module) => module.nodesShowAll());
  window.nodesHideAll = () => import('./nodes-panel.js').then((module) => module.nodesHideAll());
  window.nodesRefresh = () => import('./nodes-panel.js').then((module) => module.nodesRefresh());

  window.toggleEntitiesPanel = toggleEntitiesPanel;
  window.entitiesFilter = entitiesFilter;
  window.entitiesRefresh = entitiesRefresh;
  initEntitiesPanelAutoRefresh();

  window.toggleDecalsPanel = () => import('./decals-panel.js').then((module) => module.toggleDecalsPanel());

  window.toggleTerrainPanel = () => import('./terrain-upload.js').then((module) => module.toggleTerrainPanel());
  window.handleTerrainMeshDrop = (e) => import('./terrain-upload.js').then((module) => module.handleTerrainMeshDrop(e));
  window.handleTerrainMeshFiles = (files) => import('./terrain-upload.js').then((module) => module.handleTerrainMeshFiles(files));
  window.updateTerrainMeshScale = (value) => import('./terrain-upload.js').then((module) => module.updateTerrainMeshScale(value));
  window.updateTerrainMeshY = (value) => import('./terrain-upload.js').then((module) => module.updateTerrainMeshY(value));
  window.updateTerrainMapRotate = (value) => import('./sgb-upload.js').then((module) => module.updateTerrainMapRotate(value));
  window.updateSgbDecalScale = (value) => import('./sgb-decals.js').then((module) => module.updateSgbDecalScale(value));
  window.toggleSgbDecals = () => import('./sgb-decals.js').then((module) => module.toggleSgbDecals());
  window.clearTerrainMesh = () => import('./terrain-upload.js').then((module) => module.clearTerrainMesh());
  window.handleTerrainTexDrop = (e) => import('./terrain-upload.js').then((module) => module.handleTerrainTexDrop(e));
  window.loadTerrainTexture = (files) => import('./terrain-upload.js').then((module) => module.loadTerrainTexture(files));
  window.updateTexTiling = () => import('./terrain-upload.js').then((module) => module.updateTexTiling());
  window.rotateTerrainLayers = () => import('./terrain-upload.js').then((module) => module.rotateTerrainLayers());
  window.handleTerrainPropDrop = (e) => import('./terrain-upload.js').then((module) => module.handleTerrainPropDrop(e));
  window.handleTerrainPropFiles = (files) => import('./terrain-upload.js').then((module) => module.handleTerrainPropFiles(files));
  window.updatePropScale = (value) => import('./terrain-upload.js').then((module) => module.updatePropScale(value));
  window.rescatterProps = () => import('./terrain-upload.js').then((module) => module.rescatterProps());
  window.clearAllTerrain = () => import('./terrain-upload.js').then((module) => module.clearAllTerrain());
  window.setBrightness = (value) => import('./terrain-upload.js').then((module) => module.setBrightness(value));

  import('./maps-menu.js').then((module) => module.buildMapsMenu());
  import('./decals-menu.js').then((module) => module.buildDecalsMenu());
  window.filterDecals = (value) => import('./decals-menu.js').then((module) => module.filterDecals(value));

  window.toggleModelPanel = () => import('./model-upload.js').then((module) => module.toggleModelPanel());
  window.handleModelDrop = (e) => import('./model-upload.js').then((module) => module.handleModelDrop(e));
  window.handleModelFiles = (files) => import('./model-upload.js').then((module) => module.handleModelFiles(files));
  window.updateModelScaleFromNum = (value) => import('./model-upload.js').then((module) => module.updateModelScaleFromNum(value));
  window.updateModelScaleFromSlider = (value) => import('./model-upload.js').then((module) => module.updateModelScaleFromSlider(value));
  window.updateModelOffset = (axis, value) => import('./model-upload.js').then((module) => module.updateModelOffset(axis, value));
  window.updateModelRotation = (axis, value) => import('./model-upload.js').then((module) => module.updateModelRotation(axis, value));
  window.clearCustomModel = () => import('./model-upload.js').then((module) => module.clearCustomModel());
  window.toggleInspector = () => {
    console.warn('[grimcraft] scene inspector was removed with the three.js migration; use the Nodes panel instead.');
  };
  window.toggleSliderSection = (name) => import('./model-upload.js').then((module) => module.toggleSliderSection(name));
  window.assignAnimFromList = (idx, slot) => import('./model-upload.js').then((module) => module.assignAnimFromList(idx, slot));
  // Add other UI bindings as needed...

  import('./main-menu.js').then((module) => module.injectMainMenu());
});
