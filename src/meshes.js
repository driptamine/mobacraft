import * as THREE from 'three';
import { scene, TEAM_COLOR, PLAYER, HITBOX_SIZE, _hitboxDebug, _allHitboxes, BUILDING_BOUNDS, STRUCTURE_BOUNDS, AIRFIELD_BOUNDS } from './scene.js';
import { getMat } from './mat-cache.js';
import { factionContainers, getFactionAnimations, playerFaction, enemyFaction, resolveFactionKey } from './factions.js';
import { _assetContainer, _cloneCustomModel, _instantiateFromContainer } from './model-upload.js';
import { instantiateGltf } from './gltf-models.js';
import { mkBox, mkSphere, mkCylinder, mkTorus, mkDisc, mkPlane, mkTube, mkPoly, mkGroup, childMeshes, descendants, matchHiddenNodeName, ghostHitboxMaterial, findNodesByName } from './three-helpers.js';
import { attachGaussConduit } from './necron-conduit.js';
import { addNecronAura } from './necron-aura.js';
import { applyPlasmaGlow } from './plasma-glow.js';
import { addPlasmaPistolGlow } from './plasma-pistol-glow.js';
import { useProceduralModels } from './model-source.js';

function addTeamRing(root, isPlayerTeam) {
  const torus = mkTorus('teamRing_' + Math.random(), 1.5, 0.06, 24);
  torus.rotation.x = 0;
  torus.position.y = 0.025;
  root.add(torus);
  torus.userData.pickable = false;
  const material = new THREE.MeshBasicMaterial();
  material.color = isPlayerTeam
    ? new THREE.Color(0, 1, 0.4)
    : new THREE.Color(1, 0.15, 0.1);
  material.opacity = 0;
  material.transparent = true;
  torus.material = material;
  torus.visible = false;
  torus.visible = false;

  root._teamRing = torus;
  if (!root._selMat) root._selMat = material;
  if (!root._selDisc) root._selDisc = torus;

  return torus;
}

// ══════════════════════════════════════════════════════════════════════════════
//  MESH FACTORIES
// ══════════════════════════════════════════════════════════════════════════════
export function makeMissileMesh() {
  const root = mkGroup('missile_root');
  const body = mkCylinder('mbody', 0.1, 0.13, 1.1, 7);
  root.add(body);
  body.rotation.x = Math.PI / 2;
  body.userData.pickable = false;
  const missileMaterial = new THREE.MeshStandardMaterial();
  missileMaterial.color = new THREE.Color(0.6, 0.55, 0.4);
  missileMaterial.emissive = new THREE.Color(0.1, 0.08, 0.02);
  body.material = missileMaterial;

  // Exhaust glow
  const exhaust = mkSphere('mexh', 0.22, 4);
  exhaust.position.z = -0.7;
  root.add(exhaust);
  exhaust.userData.pickable = false;
  const exhaustMaterial = new THREE.MeshBasicMaterial();
  exhaustMaterial.color = new THREE.Color(1, 0.5, 0.1);
  exhaustMaterial.opacity = 0.9;
  exhaustMaterial.transparent = true;
  exhaust.material = exhaustMaterial;
  root._exhaustMat = exhaustMaterial;
  return root;
}

export function makeBulletMesh() {
  const mesh = mkBox('bullet', 0.04, 0.04, 0.5);
  const bulletMaterial = new THREE.MeshStandardMaterial();
  bulletMaterial.color = new THREE.Color(0.87, 0.67, 0);
  bulletMaterial.emissive = new THREE.Color(0.53, 0.4, 0);
  mesh.material = bulletMaterial;
  mesh.userData.pickable = false;
  return mesh;
}

export function makeLaserBulletMesh() {
  const mesh = mkBox('laser', 0.02, 0.02, 8.0);
  const laserMaterial = new THREE.MeshBasicMaterial();
  laserMaterial.color = new THREE.Color(1, 0, 0);
  mesh.material = laserMaterial;
  mesh.userData.pickable = false;
  return mesh;
}

export function makePlasmaBulletMesh() {
  const mesh = mkPoly('plasma', 3, 0.22);
  mesh.rotation.set(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
  );
  const plasmaMaterial = new THREE.MeshStandardMaterial();
  plasmaMaterial.color = new THREE.Color(0.55, 0.85, 1.0);
  plasmaMaterial.emissive = new THREE.Color(0.4, 0.8, 1.0);
  plasmaMaterial.roughness = 0.3;
  plasmaMaterial.metalness = 0.1;
  mesh.material = plasmaMaterial;
  mesh.userData.pickable = false;
  return mesh;
}

export function makeGrenadeMesh() {
  const root = mkGroup('grenade_root');
  const mesh = mkSphere('grenade', 0.55, 8);
  root.add(mesh);
  const grenadeMaterial = new THREE.MeshStandardMaterial();
  grenadeMaterial.color = new THREE.Color(0.4, 0.4, 0.4);
  grenadeMaterial.roughness = 0.3;
  grenadeMaterial.metalness = 0.1;
  mesh.material = grenadeMaterial;
  mesh.userData.pickable = false;

  const core = mkSphere('gcore', 0.3, 4);
  root.add(core);
  const coreMaterial = new THREE.MeshBasicMaterial();
  coreMaterial.color = new THREE.Color(0.8, 0.2, 1);
  core.material = coreMaterial;
  core.userData.pickable = false;

  return root;
}

// Empty bucket returned in procedural mode so every factory takes its
// built-in procedural branch (same path as a failed GLB load).
const _EMPTY_FACTION_BUCKET = { hq: null, worker: null, soldier: null, units: {}, structures: {}, vehicles: {} };

function _factionBucket(teamKey, metaPayload) {
  if (useProceduralModels()) {
    return _EMPTY_FACTION_BUCKET;
  }
  const fallback = teamKey === PLAYER ? playerFaction : enemyFaction;
  return factionContainers[resolveFactionKey(metaPayload?.faction, fallback)];
}

export function makeSoldierMesh(teamKey, metaPayload = {}) {
  const isBuilder = (teamKey === 'builder' || metaPayload.builderEntityId !== undefined);
  const actualTeam = isBuilder ? (metaPayload.team || PLAYER) : teamKey;

  // Try faction-specific model first
  const factionKey = resolveFactionKey(metaPayload.faction, actualTeam === PLAYER ? playerFaction : enemyFaction);
  let containerType = isBuilder ? 'worker' : 'soldier';
  const procedural = useProceduralModels();
  let container = procedural ? null : factionContainers[factionKey]?.[containerType];
  const unitContainer = (!procedural && !isBuilder && metaPayload.unitType) ? factionContainers[factionKey]?.units?.[metaPayload.unitType] : null;
  if (unitContainer) {
    container = unitContainer;
    containerType = 'soldier';
  }
  if (container) {
    return _makeFactionSoldierMesh(container, actualTeam, metaPayload, factionKey, containerType);
  }

  // Custom model only replaces player/builder units — enemies keep the default mesh
  if (_assetContainer && teamKey !== 'red') return _cloneCustomModel(teamKey, metaPayload);

  const config = TEAM_COLOR[actualTeam] || TEAM_COLOR.builder;
  const root = mkGroup('soldier_root');

  const bodyMat = new THREE.MeshStandardMaterial();
  bodyMat.color = config.diffuse.clone();
  bodyMat.emissive = config.emissive.clone();

  const darkMat = getMat(0x1e1e1e);
  const gunMat = getMat(0x1a1a1a);

  const addBox = function addBox(width, height, depth, material, x, y, z) {
    const box = mkBox('b', width, height, depth);
    box.position.set(x, y, z);
    box.material = material;
    root.add(box);
    box.userData = { ...metaPayload };
    return box;
  };

  const torso = addBox(0.5, 0.6, 0.28, bodyMat, 0, 0.92, 0);
  const head = addBox(0.34, 0.34, 0.32, bodyMat, 0, 1.5, 0);

  const helmbrim = mkCylinder('hb', 0.44, 0.48, 0.11, 8);
  helmbrim.position.set(0, 1.68, 0);
  helmbrim.material = darkMat;
  root.add(helmbrim);
  helmbrim.userData = { ...metaPayload };

  const helmtop = mkSphere('ht', 0.36, 5);
  helmtop.position.set(0, 1.76, 0);
  helmtop.material = darkMat;
  root.add(helmtop);
  helmtop.userData = { ...metaPayload };

  const legL = addBox(0.18, 0.5, 0.2, bodyMat, -0.14, 0.32, 0);
  const legR = addBox(0.18, 0.5, 0.2, bodyMat, 0.14, 0.32, 0);
  const armL = addBox(0.14, 0.46, 0.16, bodyMat, -0.34, 0.9, 0);
  const armR = addBox(0.14, 0.46, 0.16, bodyMat, 0.34, 0.9, 0);

  const gunRoot = mkGroup('gun_root');
  gunRoot.position.set(0.34, 1.02, 0.28);
  root.add(gunRoot);
  const gunBody = mkBox('gb', 0.055, 0.055, 0.65);
  gunBody.material = gunMat;
  gunRoot.add(gunBody);
  const gunRail = mkBox('gr', 0.038, 0.038, 0.32);
  gunRail.position.z = 0.48;
  gunRail.material = gunMat;
  gunRoot.add(gunRail);

  const selectionDisc = mkTorus('sel', 1.5, 0.05, 32);
  selectionDisc.rotation.x = 0;
  selectionDisc.position.y = 0.03;
  root.add(selectionDisc);
  const selectionMaterial = new THREE.MeshBasicMaterial();
  // Green for player, red for enemy
  selectionMaterial.color = (actualTeam === 'blue' || actualTeam === PLAYER)
    ? new THREE.Color(0, 1, 0.53)
    : new THREE.Color(1, 0.15, 0.1);
  selectionMaterial.opacity = 0;
  selectionMaterial.transparent = true;
  selectionDisc.material = selectionMaterial;
  selectionDisc.visible = false;
  selectionDisc.visible = false;

  const hitbox = mkCylinder('hb', HITBOX_SIZE, HITBOX_SIZE, 2.2, 12);
  hitbox.position.set(0, 1.1, 0);
  root.add(hitbox);
  hitbox.userData.pickable = true;
  hitbox.visible = true;
  if (_hitboxDebug) {
    const hitboxMaterial = new THREE.MeshBasicMaterial();
    hitboxMaterial.color = new THREE.Color(1, 0.2, 0.1);
    hitboxMaterial.wireframe = true;
    hitbox.material = hitboxMaterial;
  } else {
    hitbox.material = ghostHitboxMaterial();
  }
  hitbox.userData = { ...metaPayload };
  _allHitboxes.push(hitbox);

  const childMeshes = [torso, head, helmbrim, helmtop, legL, legR, armL, armR, gunBody, gunRail];
  childMeshes.forEach((mesh) => {
    mesh.userData = { ...metaPayload };
  });

  root._bodyMat = bodyMat;
  root._selDisc = selectionDisc;
  root._selMat = selectionMaterial;
  root._legL = legL;
  root._legR = legR;
  root._armL = armL;
  root._armR = armR;
  root._helmTopMesh = helmtop;
  root._helmBrimMesh = helmbrim;
  if (scene._registerShadows) {
    childMeshes.forEach((mesh) => {
      scene._registerShadows(mesh);
    });
  }
  const blob = mkDisc('blobshadow', 0.52, 16, false);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.015;
  root.add(blob);
  blob.userData.pickable = false;
  blob.frustumCulled = false;
  const blobMaterial = new THREE.MeshBasicMaterial();
  blobMaterial.color = new THREE.Color(0, 0, 0);
  blobMaterial.opacity = 0.55;
  blobMaterial.transparent = true;
  blobMaterial.polygonOffset = true;
  blobMaterial.polygonOffsetFactor = -1;
  blob.material = blobMaterial;
  root._blobShadow = blob;
  return root;
}

function _makeFactionSoldierMesh(container, teamKey, metaPayload, factionKey, role = 'soldier') {
  const config = TEAM_COLOR[teamKey] || TEAM_COLOR.builder;
  const instance = instantiateGltf(container);
  instance.animationGroups.forEach((animationGroup) => animationGroup.stop());

  const root = mkGroup('faction_soldier_root');

  instance.rootNodes.forEach((rootNode) => {
    root.add(rootNode);
    rootNode.visible = true;
  });

  (container._hiddenNodes || []).forEach((nodeName) => {
    instance.rootNodes.forEach((rootNode) => {
      descendants(rootNode).forEach((child) => {
        if (matchHiddenNodeName(child.name, nodeName)) {
          child.visible = false;
          child.visible = false;
          child.userData.pickable = false;
        }
      });
    });
  });

  childMeshes(root).forEach((mesh) => {
    mesh.userData.pickable = true;
    mesh.userData = { ...metaPayload };
    if (scene._registerShadows) {
      scene._registerShadows(mesh);
    }
  });

  const bodyMat = new THREE.MeshStandardMaterial();
  bodyMat.color = config.diffuse.clone();
  bodyMat.emissive = config.emissive.clone();
  root._bodyMat = bodyMat;

  const selDisc = mkTorus('sel_faction', 1.5, 0.05, 32);
  selDisc.rotation.x = 0;
  selDisc.position.y = 0.03;
  root.add(selDisc);
  const selMat = new THREE.MeshBasicMaterial();
  selMat.color = (teamKey === PLAYER)
    ? new THREE.Color(0, 1, 0.53)
    : new THREE.Color(1, 0.15, 0.1);
  selMat.opacity = 0;
  selMat.transparent = true;
  selDisc.material = selMat;
  selDisc.visible = false;
  selDisc.visible = false;
  selDisc.userData = { ...metaPayload };
  root._selDisc = selDisc;
  root._selMat = selMat;

  const _dummy = () => {
    const node = mkGroup('dummy_faction');
    root.add(node);
    return node;
  };
  root._legL = _dummy();
  root._legR = _dummy();
  root._armL = _dummy();
  root._armR = _dummy();
  root._helmTopMesh = null;
  root._helmBrimMesh = null;

  root._animGroups = {};
  root._currentAnim = null;
  root._shootDone = false;

  const animName = (g) => g.name.toLowerCase();
  const isMeleeName = (name) => /(melee|attack|slash|swing|punch|stab|combat|knife|damage|thrown)/.test(name);
  const isFiringName = (name) => /(fir|shoot|gun|weapon)/.test(name) && !name.startsWith('vis_');
  const findAnim = (pred) => instance.animationGroups.find((g) => pred(animName(g)));
  const animConfig = getFactionAnimations(factionKey, role) || {};
  const findByName = (wantedName) => {
    if (!wantedName) return null;
    const wanted = wantedName.toLowerCase();
    return findAnim((n) => n.startsWith(wanted));
  };

  const idleAnim = findByName(animConfig.idle)
    || findAnim((n) => !isFiringName(n) && !isMeleeName(n) && /^(idle|stand)/.test(n))
    || findAnim((n) => !isMeleeName(n) && /^(idle|stand)/.test(n));
  const idleTrackingAnim = findByName(animConfig.idle_tracking)
    || findAnim((n) => !isMeleeName(n) && /idle[_-]?tracking/.test(n));
  const moveTrackingAnim = findByName(animConfig.moveTracking)
    || findAnim((n) => !isMeleeName(n) && /move[_-]?tracking/.test(n));
  const runAnim = findByName(animConfig.run)
    || findAnim((n) => !isFiringName(n) && !isMeleeName(n) && /^(run|walk|jog|move_run)/.test(n))
    || findAnim((n) => !isMeleeName(n) && /(^run|^walk|^jog)/.test(n));
  const shootMoveAnim = findByName(animConfig.moveFiring)
    || findAnim((n) => isFiringName(n) && !isMeleeName(n) && /^(move|run|walk|jog)_?(fir|shoot)/.test(n));
  const shootAnim = findByName(animConfig.firing)
    || findAnim((n) => isFiringName(n) && !isMeleeName(n) && /^(idle|stand)_?(fir|shoot)/.test(n))
    || findAnim((n) => isFiringName(n) && !isMeleeName(n));
  const buildAnim = findByName(animConfig.build)
    || findAnim((n) => !isMeleeName(n) && /^build/.test(n))
    || null;
  const repairAnim = findByName(animConfig.repair)
    || findAnim((n) => !isMeleeName(n) && /^repair/.test(n))
    || null;
  const flagPlant1Anim = findByName(animConfig.flagPlant1)
    || findAnim((n) => /^flag_plant_1/.test(n))
    || null;
  const flagPlant2Anim = findByName(animConfig.flagPlant2)
    || findAnim((n) => /^flag_plant_2/.test(n))
    || null;
  const capture1Anim = findByName(animConfig.capture1)
    || findAnim((n) => /^capture_strategic_point_1/.test(n))
    || null;
  const capture2Anim = findByName(animConfig.capture2)
    || findAnim((n) => /^capture_strategic_point_2/.test(n))
    || null;
  const dieAnims = [];
  const safeFind = (name) => (name ? findAnim((n) => n.toLowerCase().startsWith(name.toLowerCase())) : null);
  ['die_normal_1', 'die_normal_2'].forEach((key) => {
    const ag = findByName(animConfig[key])
      || safeFind(key)
      || findAnim((n) => new RegExp('^' + key).test(n.toLowerCase()));
    if (ag) dieAnims.push(ag);
  });
  if (!dieAnims.length) {
    ['die', 'death'].forEach((prefix) => {
      const ag = findAnim((n) => n.toLowerCase().startsWith(prefix));
      if (ag) dieAnims.push(ag);
    });
  }

  if (idleAnim) root._animGroups.idle = idleAnim;
  if (idleTrackingAnim) root._animGroups.idle_tracking = idleTrackingAnim;
  if (moveTrackingAnim) root._animGroups.move_tracking = moveTrackingAnim;
  if (runAnim) root._animGroups.run = runAnim;
  if (shootAnim) root._animGroups.shoot = shootAnim;
  if (shootMoveAnim) root._animGroups.shootMove = shootMoveAnim;
  if (buildAnim) root._animGroups.build = buildAnim;
  if (repairAnim) root._animGroups.repair = repairAnim;
  if (flagPlant1Anim) root._animGroups.flagPlant1 = flagPlant1Anim;
  if (flagPlant2Anim) root._animGroups.flagPlant2 = flagPlant2Anim;
  if (capture1Anim) root._animGroups.capture1 = capture1Anim;
  if (capture2Anim) root._animGroups.capture2 = capture2Anim;
  if (dieAnims.length) root._dieAnims = dieAnims;

  const firstNonMelee = () => instance.animationGroups.find((g) => !isMeleeName(animName(g))) || null;
  if (!root._animGroups.idle) root._animGroups.idle = firstNonMelee();
  if (!root._animGroups.run) root._animGroups.run = firstNonMelee() || root._animGroups.idle;
  if (!root._animGroups.shoot) root._animGroups.shoot = firstNonMelee() || root._animGroups.idle;

  root._playAnim = function (name, loop) {
    if (loop === undefined) loop = (name !== 'shoot' && name !== 'shootMove');
    const firingAnims = ['shoot', 'shootMove'];
    if (firingAnims.includes(root._currentAnim) && !root._shootDone && name !== root._currentAnim) return;
    let resolvedName = name;
    if (name === 'idle' && root._animGroups.idle_tracking) {
      if (root._shootJustEnded || root._currentAnim === 'idle_tracking') {
        resolvedName = 'idle_tracking';
      }
      root._shootJustEnded = false;
    }
    if (name === 'run' && root._animGroups.move_tracking) {
      if (root._shootJustEnded || root._currentAnim === 'move_tracking') {
        resolvedName = 'move_tracking';
      }
      root._shootJustEnded = false;
    }
    if (root._currentAnim === resolvedName && loop) return;
    if (root._currentAnim === resolvedName && !loop) return;
    if (!root._animGroups[resolvedName]) {
      const fallbackOrder = name === 'idle' ? ['run', 'shoot', 'shootMove']
        : name === 'run' ? ['idle', 'shoot', 'shootMove']
          : name === 'shootMove' ? ['shoot', 'idle', 'run']
            : ['idle', 'run', 'shoot', 'shootMove'];
      const found = fallbackOrder.find((s) => root._animGroups[s]);
      if (found) resolvedName = found;
      else return;
    }
    const resolvedLoop = loop && resolvedName !== 'shoot' && resolvedName !== 'shootMove';
    Object.values(root._animGroups).forEach((ag) => {
      try { ag.stop(); } catch (e) { /* ignore */ }
    });
    root._currentAnim = resolvedName;
    root._shootDone = (resolvedName !== 'shoot') && (resolvedName !== 'shootMove');
    const ag = root._animGroups[resolvedName];
    if (!ag) return;
    try {
      ag.loopAnimation = resolvedLoop;
      ag.onAnimationGroupEndObservable.clear();
      ag.reset();
      ag.start(resolvedLoop, 1.0);
      if (!resolvedLoop) {
        ag.onAnimationGroupEndObservable.addOnce(() => {
          root._shootDone = true;
          root._shootJustEnded = root._currentAnim === 'shoot' || root._currentAnim === 'shootMove';
          root._currentAnim = null;
        });
      }
    } catch (e) {
      console.warn('_playAnim error', resolvedName, e);
    }
  };

  addTeamRing(root, teamKey === PLAYER);

  const blob = mkDisc('blobshadow_faction', 0.52, 16, false);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.015;
  root.add(blob);
  blob.userData.pickable = false;
  blob.frustumCulled = false;
  const blobMat = new THREE.MeshBasicMaterial();
  blobMat.color = new THREE.Color(0, 0, 0);
  blobMat.opacity = 0.55;
  blobMat.transparent = true;
  blobMat.polygonOffset = true;
  blobMat.polygonOffsetFactor = -1;
  blob.material = blobMat;
  root._blobShadow = blob;

  const hitbox = mkCylinder('hb_faction', HITBOX_SIZE, HITBOX_SIZE, 2.2, 12);
  hitbox.position.set(0, 1.1, 0);
  root.add(hitbox);
  hitbox.userData.pickable = true;
  hitbox.visible = true;
  if (_hitboxDebug) {
    const hbMat = new THREE.MeshBasicMaterial();
    hbMat.color = new THREE.Color(1, 0.2, 0.1);
    hbMat.wireframe = true;
    hitbox.material = hbMat;
  } else {
    hitbox.material = ghostHitboxMaterial();
  }
  hitbox.userData = { ...metaPayload };
  _allHitboxes.push(hitbox);

  if (factionKey === 'necrons' && role === 'soldier') {
    try {
      attachGaussConduit(root);
    } catch (_) {
      // Older/alternate warrior models without gun markers stay conduit-free.
    }
    try {
      addNecronAura(root);
    } catch (_) {
      // Aura is decorative; never break a spawn.
    }
  }

  try {
    applyPlasmaGlow(root);
  } catch (_) {
    // Models without a plasmagun stay untouched.
  }

  try {
    addPlasmaPistolGlow(root);
  } catch (_) {
    // Models without a plasma pistol stay untouched.
  }

  return root;
}

export function makeHpBar(width, teamKey) {
  const group = mkGroup('hpgrp_' + Math.random());
  const border = mkPlane('hpborder', width + 0.07, 0.22 + 0.07, true);
  border.rotation.x = -Math.PI / 2;
  border.position.y = -0.002;
  group.add(border);
  const borderMaterial = new THREE.MeshBasicMaterial();
  borderMaterial.color = new THREE.Color(0, 0, 0);
  borderMaterial.depthTest = false;
  border.renderOrder = 2;
  border.material = borderMaterial;
  const backgroundPlane = mkPlane('hpbg', width, 0.22, true);
  backgroundPlane.rotation.x = -Math.PI / 2;
  group.add(backgroundPlane);
  const backgroundMaterial = new THREE.MeshBasicMaterial();
  backgroundMaterial.color = new THREE.Color(0.16, 0.16, 0.16);
  backgroundMaterial.depthTest = false;
  backgroundPlane.renderOrder = 2;
  backgroundPlane.material = backgroundMaterial;

  const foregroundPlane = mkPlane('hpfg', width, 0.22, true);
  foregroundPlane.rotation.x = -Math.PI / 2;
  foregroundPlane.position.y = 0.005;
  group.add(foregroundPlane);
  const foregroundMaterial = new THREE.MeshBasicMaterial();
  const color = (teamKey === PLAYER) ? new THREE.Color(0.27, 1, 0.53) : new THREE.Color(1, 0.27, 0.2);
  foregroundMaterial.color = color;
  foregroundMaterial.depthTest = false;
  foregroundPlane.renderOrder = 2;
  foregroundPlane.material = foregroundMaterial;

  group._fg = foregroundPlane;
  group._bg = backgroundPlane;
  group._width = width;
  return group;
}

export function updateHpBar(group, percentage) {
  group._fg.scale.x = Math.max(0.001, percentage);
  // Anchor the full end at +X: three.js mirrors the old left-handed view, so
  // +X is screen-left and the bar depletes from screen-right like before.
  group._fg.position.x = ((1 - percentage) * group._width) / 2;
}

export function makeHQMesh(position, teamKey, metaPayload) {
  const container = _factionBucket(teamKey, metaPayload).hq;
  if (!container) {
    const root = mkGroup('hq_fallback');
    root.position.copy(position);
    const box = mkBox('hq_box', 6, 6, 6);
    box.position.y = 3;
    root.add(box);
    const ring = makeSquareSelRing(root, BUILDING_BOUNDS.hq, 0.16);
    root._ring = ring;
    root._ringMat = ring._material;
    return root;
  }

  const root = _instantiateFromContainer(container, metaPayload);
  root.position.copy(position);
  root.rotation.y = Math.PI / 2;
  // Ensure metadata is applied to all child meshes for picking
  childMeshes(root).forEach((mesh) => {
    mesh.userData = { ...metaPayload };
  });
  const ring = makeSquareSelRing(root, BUILDING_BOUNDS.hq, 0.16);
  root._ring = ring;
  root._ringMat = ring._material;
  if (scene._registerShadows) scene._registerShadows(root);
  return root;
}

export function makeBarracksMesh(position, teamKey, metaPayload) {
  const faction = _factionBucket(teamKey, metaPayload);
  const container = faction.structures.infantry_command || faction.structures.barracks;

  if (container) {
    const root = _instantiateFromContainer(container, metaPayload);
    root.position.copy(position);
    const ring = makeSquareSelRing(root, BUILDING_BOUNDS.barracks, 0.13);
    root._ring = ring;
    root._ringMat = ring._material;
    if (scene._registerShadows) scene._registerShadows(root);
    return root;
  }

  const root = mkGroup('barracks');
  root.position.copy(position);
  const config = TEAM_COLOR[teamKey] || TEAM_COLOR.blue;
  const addBox = function addBox(width, height, depth, color, emissiveColor, x, y, z) {
    const box = mkBox('b', width, height, depth);
    box.position.set(x, y, z);
    root.add(box);
    box.castShadow = true;
    const boxMaterial = new THREE.MeshStandardMaterial();
    boxMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      boxMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    } else {
      boxMaterial.emissive = new THREE.Color(0, 0, 0);
    }

    box.material = boxMaterial;
    box.userData = { ...metaPayload };
    return box;
  };
  addBox(5, 0.4, 5, 0x443322, 0, 0, 0.2, 0);
  addBox(4.4, 2.5, 4.4, 0x665544, 0, 0, 1.65, 0);
  addBox(5, 0.35, 5, 0x332211, 0, 0, 3.1, 0);
  addBox(0.9, 1.6, 0.15, 0x221100, 0, 0, 0.8, 2.3);
  [-1.4, 1.4].forEach((x) => {
    const windowBox = mkBox('w', 0.7, 0.7, 0.12);
    windowBox.position.set(x, 2, 2.3);
    root.add(windowBox);
    const windowMaterial = new THREE.MeshStandardMaterial();
    windowMaterial.color = new THREE.Color(0.2, 0.27, 0.53);
    windowMaterial.emissive = new THREE.Color(0, 0.07, 0.2);
    windowBox.material = windowMaterial;
    windowBox.userData = { ...metaPayload };
  });
  const flagPole = mkBox('fp', 0.1, 3, 0.1);
  flagPole.position.set(2, 1.5, -2);
  root.add(flagPole);
  const flagPoleMaterial = new THREE.MeshStandardMaterial();
  flagPoleMaterial.color = new THREE.Color(0.33, 0.2, 0.07);
  flagPole.material = flagPoleMaterial;
  const flagBanner = mkBox('fb', 1.2, 0.65, 0.05);
  flagBanner.position.set(0.6 + 2, 3.1, -2);
  root.add(flagBanner);
  const flagBannerMaterial = new THREE.MeshStandardMaterial();
  flagBannerMaterial.color = config.diffuse.clone();
  flagBannerMaterial.emissive = config.emissive.clone();
  flagBanner.material = flagBannerMaterial;

  // Note: makeSquareSelRing will be imported or exported from here if needed
  // I'll keep it here for now as it's used by multiple factories.
  const ring = makeSquareSelRing(root, BUILDING_BOUNDS.barracks, 0.13);
  root._ring = ring;
  root._ringMat = ring._material;
  if (scene._registerShadows) {
    scene._registerShadows(root);
  }
  // Ensure metadata is applied to all child meshes for picking
  childMeshes(root).forEach((mesh) => {
    if (!mesh._isSelRingBar) {
      mesh.userData = { ...metaPayload };
    }
  });
  return root;
}

export function makeSquareSelRing(parent, size, thickness = 0.12, y = 0.06) {
  const ringThickness = thickness;
  const ringSize = size;
  const bars = [
    [ringSize * 2 + ringThickness, ringThickness, 0, ringSize],
    [ringSize * 2 + ringThickness, ringThickness, 0, -ringSize],
    [ringThickness, ringSize * 2, ringSize, 0],
    [ringThickness, ringSize * 2, -ringSize, 0],
  ];
  const node = mkGroup('selRingNode');
  parent.add(node);
  node.position.y = y;
  node.userData.pickable = false;
  const material = new THREE.MeshBasicMaterial();
  material.color = new THREE.Color(0, 1, 0.53);
  material.opacity = 0;
  material.transparent = true;
  node.userData.pickable = false;
  node.visible = false;
  node.visible = false;
  bars.forEach(([w, d, x, z]) => {
    const box = mkBox('srb', w, ringThickness, d);
    node.add(box);
    box.position.set(x, 0, z);
    box.material = material;
    box.userData.pickable = false;
    box._isSelRingBar = true;
  });
  node._material = material;
  return node;
}

export function makeTowerMesh(position, teamKey, metaPayload) {
  const faction = _factionBucket(teamKey, metaPayload);
  const container = faction.structures.turret;

  if (container) {
    const root = _instantiateFromContainer(container, metaPayload);
    root.position.copy(position);
    const turretNode = descendants(root).find((n) => n.name.toLowerCase().includes('turret')) || root;
    root._turret = turretNode;
    const ring = makeSquareSelRing(root, STRUCTURE_BOUNDS.tower, 0.14, 0.05);
    root._ring = ring;
    root._ringMat = ring._material;
    if (scene._registerShadows) scene._registerShadows(root);
    return root;
  }

  const root = mkGroup('tower');
  root.position.copy(position);
  const config = TEAM_COLOR[teamKey] || TEAM_COLOR.blue;
  const addCyl = function addCyl(diameterTop, diameterBottom, height, color, emissiveColor, x, y, z) {
    const cylinder = mkCylinder('c', diameterTop, diameterBottom, height, 8);
    cylinder.position.set(x, y, z);
    root.add(cylinder);
    cylinder.castShadow = true;
    const cylinderMaterial = new THREE.MeshStandardMaterial();
    cylinderMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      cylinderMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    cylinder.material = cylinderMaterial;
    cylinder.userData = { ...metaPayload };
    return cylinder;
  };
  const addBox = function addBox(width, height, depth, color, emissiveColor, x, y, z) {
    const box = mkBox('b', width, height, depth);
    box.position.set(x, y, z);
    root.add(box);
    box.castShadow = true;
    const boxMaterial = new THREE.MeshStandardMaterial();
    boxMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      boxMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    box.material = boxMaterial;
    box.userData = { ...metaPayload };
    return box;
  };
  addCyl(4, 4.8, 0.5, 0x334433, 0, 0, 0.25, 0);
  addCyl(1.2, 1.6, 5, 0x445544, 0, 0, 3, 0);
  addBox(2.4, 0.4, 2.4, 0x3a4a3a, 0, 0, 5.7, 0);
  const turretNode = mkGroup('turret');
  root.add(turretNode);
  turretNode.position.set(0, 6.2, 0);
  const turretHead = mkBox('th', 1.4, 0.7, 1.4);
  turretNode.add(turretHead);
  const turretHeadMaterial = new THREE.MeshStandardMaterial();
  turretHeadMaterial.color = config.diffuse.clone();
  turretHeadMaterial.emissive = config.emissive.clone();
  turretHead.material = turretHeadMaterial;
  const barrel = addCyl(0.2, 0.2, 1.4, 0x111111, 0, 0, 0.1, 0);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 1.0;
  turretNode.add(barrel);
  root._turret = turretNode;

  const coinMesh = mkPoly('coin', 1, 0.3);
  coinMesh.position.set(0, 7.2, 0);
  root.add(coinMesh);
  const coinMaterial = new THREE.MeshStandardMaterial();
  coinMaterial.color = new THREE.Color(1, 0.8, 0);
  coinMaterial.emissive = new THREE.Color(0.53, 0.4, 0);
  coinMesh.material = coinMaterial;
  root._coin = coinMesh;

  const ring = makeSquareSelRing(root, STRUCTURE_BOUNDS.tower, 0.14, 0.05);
  root._ring = ring;
  root._ringMat = ring._material;
  if (scene._registerShadows) {
    scene._registerShadows(root);
  }
  // Ensure metadata is applied to all child meshes for picking
  childMeshes(root).forEach((mesh) => {
    if (!mesh._isSelRingBar) {
      mesh.userData = { ...metaPayload };
    }
  });
  return root;
}

export function makeThermoMesh(position, teamKey, metaPayload) {
  const faction = _factionBucket(teamKey, metaPayload);
  const container = faction.structures.thermo_generator;

  if (container) {
    const root = _instantiateFromContainer(container, metaPayload);
    root.position.copy(position);
    const ring = makeSquareSelRing(root, STRUCTURE_BOUNDS.thermoGen, 0.14, 0.05);
    root._ring = ring;
    root._ringMat = ring._material;
    if (scene._registerShadows) scene._registerShadows(root);
    return root;
  }

  const root = mkGroup('powerplant');
  root.position.copy(position);
  const config = TEAM_COLOR[teamKey] || TEAM_COLOR.blue;

  const addBox = function addBox(width, height, depth, color, emissiveColor, x, y, z) {
    const box = mkBox('ppb', width, height, depth);
    box.position.set(x, y, z);
    root.add(box);
    box.castShadow = true;
    const boxMaterial = new THREE.MeshStandardMaterial();
    boxMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      boxMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    box.material = boxMaterial;
    box.userData = { ...metaPayload };
    return box;
  };
  const addCyl = function addCyl(diameterTop, diameterBottom, height, color, emissiveColor, x, y, z, tess = 12) {
    const cylinder = mkCylinder('ppc', diameterTop, diameterBottom, height, tess);
    cylinder.position.set(x, y, z);
    root.add(cylinder);
    cylinder.castShadow = true;
    const cylinderMaterial = new THREE.MeshStandardMaterial();
    cylinderMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      cylinderMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    cylinder.material = cylinderMaterial;
    cylinder.userData = { ...metaPayload };
    return cylinder;
  };

  addBox(6.5, 0.3, 6.5, 0x2a2a2a, 0, 0, 0.15, 0);
  addBox(4.8, 2.2, 4.2, 0x3a4040, 0, 0, 1.4, 0);
  addBox(5.0, 0.25, 4.4, 0x2e3535, 0, 0, 2.62, 0);

  const dome = mkSphere('ppdome', 2.6, 8);
  dome.scale.y = 0.65;
  dome.position.set(0, 3.2, 0);
  root.add(dome);
  dome.castShadow = true;
  const domeMaterial = new THREE.MeshStandardMaterial();
  domeMaterial.color = new THREE.Color(0.55, 0.62, 0.55);
  dome.material = domeMaterial;
  dome.userData = { ...metaPayload };

  const domeRing = mkTorus('ppdring', 2.2, 0.18, 24);
  domeRing.rotation.x = Math.PI / 2;
  domeRing.position.set(0, 2.55, 0);
  root.add(domeRing);
  const domeRingMaterial = new THREE.MeshStandardMaterial();
  domeRingMaterial.color = config.diffuse.clone();
  domeRingMaterial.emissive = config.emissive.clone();
  domeRing.material = domeRingMaterial;
  root._coreGlowMat = domeRingMaterial;

  [
    [-2.0, 0, 1.8],
    [2.0, 0, 1.8],
  ].forEach(([positionX, , positionZ]) => {
    addCyl(1.05, 1.3, 3.8, 0x4a5050, 0, positionX, 1.9, positionZ, 16);
    addCyl(1.2, 1.05, 0.5, 0x4a5050, 0, positionX, 3.95, positionZ, 16);
    addCyl(0.7, 0.7, 3.8, 0x1a1a1a, 0, positionX, 1.9, positionZ, 12);
    addCyl(1.22, 1.22, 0.12, 0x5a6060, 0, positionX, 4.22, positionZ, 16);
  });

  [
    [-2.0, 4.5, 1.8],
    [2.0, 4.5, 1.8],
  ].forEach(([positionX, positionY, positionZ], index) => {
    const steam = mkCylinder('ppsteam' + index, 1.4, 0.5, 0.9, 10);
    steam.position.set(positionX, positionY, positionZ);
    root.add(steam);
    const steamMaterial = new THREE.MeshBasicMaterial();
    steamMaterial.color = new THREE.Color(0.15, 0.2, 0.15);
    steamMaterial.opacity = 0.45;
    steamMaterial.transparent = true;
    steam.material = steamMaterial;
  });

  addBox(1.8, 1.4, 1.2, 0x2e3030, 0, -3.2, 0.9, -1.0);
  [-3.6, -2.8].forEach((x) => {
    addCyl(0.18, 0.18, 0.9, 0x555555, 0, x, 1.6, -1.0);
    addCyl(0.28, 0.28, 0.12, 0x444444, 0, x, 2.1, -1.0);
  });
  addBox(0.1, 2.2, 0.1, 0x444444, 0, -3.2, 1.5, 0.4);
  addBox(1.2, 0.08, 0.08, 0x444444, 0, -3.2, 2.65, 0.4);
  addBox(4.82, 0.3, 0.08, 0xffcc00, 0xaa8800, 0, 0.85, 2.12);

  const meter = mkBox('ppmeter', 0.14, 1.8, 0.14);
  meter.position.set(0, 5.0, 0);
  root.add(meter);
  const meterMaterial = new THREE.MeshStandardMaterial();
  meterMaterial.color = new THREE.Color(0, 1, 0.53);
  meterMaterial.emissive = new THREE.Color(0, 0.67, 0.27);
  meterMaterial.opacity = 0.85;
  meterMaterial.transparent = true;
  meter.material = meterMaterial;
  root._meter = meter;

  const warnLight = mkSphere('ppwl', 0.22, 5);
  warnLight.position.set(0, 6.0, 0);
  root.add(warnLight);
  const warningLightMaterial = new THREE.MeshStandardMaterial();
  warningLightMaterial.color = new THREE.Color(1, 0.2, 0.1);
  warningLightMaterial.emissive = new THREE.Color(0.8, 0, 0);
  warnLight.material = warningLightMaterial;

  const ring = makeSquareSelRing(root, STRUCTURE_BOUNDS.thermoGen, 0.14, 0.05);
  root._ring = ring;
  root._ringMat = ring._material;
  if (scene._registerShadows) {
    scene._registerShadows(root);
  }
  // Ensure metadata is applied to all child meshes for picking
  childMeshes(root).forEach((mesh) => {
    if (!mesh._isSelRingBar) {
      mesh.userData = { ...metaPayload };
    }
  });
  return root;
}

const SP_MODEL_PATHS = {
  point: 'models/points/strategic_point.glb',
  relic: 'models/points/relic.glb',
};
const SP_MODEL_SCALES = { point: 1.0, relic: 0.8 };
// Faction banners/flags/poles inside the point model stay hidden: the point
// is neutral until captured (capture ring + gem show the owner instead).
export const STRATEGIC_POINT_HIDDEN_NODES = [
  'chaos_banner',
  'chaos_banner_rod',
  'dark_eldar_banner',
  'dark_eldar_flag_pole',
  'eldar_flag',
  'eldar_flag_pole',
  'guard_banner',
  'guard_banner_rod',
  'marine_sergeant_banner',
  'marine_sergeant_banner_rod',
  'necron_flag_east',
  'necron_flag_north',
  'necron_flag_south',
  'necron_flag_west',
  'ork_flag',
  'ork_flag_pole',
  'sisters_banner',
  'sisters_flag_pole',
  'tau_banner',
  'tau_banner_rod',
];

// Listening Posts build only on player-owned points/relics without one.
export function canPlaceListeningPost(sp, team) {
  return !!sp && sp.owner === team && !sp.hasListeningPost;
}

// Capture flag: per-faction banner nodes shown for the capturing/owning
// faction. The rise itself is clip-driven — captured_raise lifts the
// centerpost/console/banner assembly (the banner meshes are skinned, so
// node offsets would not move them); this only gates visibility.
export const STRATEGIC_POINT_BANNERS = {
  ig: ['guard_banner', 'guard_banner_rod'],
  chaos: ['chaos_banner', 'chaos_banner_rod'],
  'space marines': ['marine_sergeant_banner', 'marine_sergeant_banner_rod'],
  orks: ['ork_flag', 'ork_flag_pole'],
  eldar: ['eldar_flag', 'eldar_flag_pole'],
  tau: ['tau_banner', 'tau_banner_rod'],
  sob: ['sisters_banner', 'sisters_flag_pole'],
  necrons: ['necron_flag_north', 'necron_flag_south', 'necron_flag_east', 'necron_flag_west'],
  'dark eldar': ['dark_eldar_banner', 'dark_eldar_flag_pole'],
};
export function shouldShowCaptureFlag({ engaged, owner, progress }) {
  return engaged || owner != null || Math.abs(progress || 0) > 0.001;
}

export function _wirePointFlagNodes(model) {
  const banners = {};
  for (const [faction, names] of Object.entries(STRATEGIC_POINT_BANNERS)) {
    banners[faction] = [];
    for (const name of names) {
      for (const node of findNodesByName(model, [name])) {
        if (node.isMesh) {
          banners[faction].push(node);
        }
      }
    }
  }
  model._flagNodes = { banners };
}

export function updatePointFlag(model, { faction, show }) {
  const wired = model ? model._flagNodes : null;
  if (!wired) {
    return;
  }
  for (const [key, nodes] of Object.entries(wired.banners)) {
    const visible = show && key === faction;
    for (const node of nodes) {
      node.visible = !!visible;
    }
  }
}

// Capture-state clips per point kind: neutral points loop `idle` (assembly
// buried); on capture start `open` plays once, then the native `raise` clip
// lifts the centerpost/console/banner assembly, then `captured` loops raised.
export const STRATEGIC_POINT_CLIPS = {
  point: { idle: 'uncaptured_idle', open: 'uncaptured_open', raise: 'captured_raise', captured: 'captured_idle' },
  relic: { idle: 'ol_uncaptured_idle', open: 'ol_uncaptured_open', raise: 'ol_captured_raise', captured: 'ol_captured_idle' },
};

// Capture progress (-1..1, either side) mapped onto the raise clip (0..1),
// remapped so the rise spans from the plant mark to full capture.
export function raiseScrubProgress(progress, raiseFrom = 0) {
  const m = Math.min(1, Math.abs(progress || 0));
  const from = Math.min(0.999, Math.max(0, raiseFrom || 0));
  return Math.min(1, Math.max(0, (m - from) / (1 - from)));
}

// Capture-state machine for the point model. Returns { play, loop, state,
// scrub }: 'idle' loops the idle clip, 'opening' plays the open clip once,
// 'raising' scrubs the raise clip by capture progress (plant mark to 100%),
// 'raised' loops the captured clip. Owned points go straight to the raised
// loop; a contested raised point re-enters 'raising'. Nothing rises before
// the planter finished flag_plant_2 (planted=false holds the open frame).
export function nextStrategicPointAnim({ owner, beingCaptured, animState, currentAnim, progress, planted, raiseFrom }) {
  if (owner != null && animState !== 'raised') {
    return { play: 'captured', loop: true, state: 'raised', scrub: null };
  }
  if (owner != null) {
    return { play: null, loop: false, state: 'raised', scrub: null };
  }
  if (beingCaptured && (animState == null || animState === 'idle')) {
    return { play: 'open', loop: false, state: 'opening', scrub: null };
  }
  if (beingCaptured && planted && animState === 'opening' && currentAnim == null) {
    return { play: 'raise', loop: false, state: 'raising', scrub: raiseScrubProgress(progress, raiseFrom) };
  }
  if (beingCaptured && planted && (animState === 'raising' || animState === 'raised')) {
    return { play: 'raise', loop: false, state: 'raising', scrub: raiseScrubProgress(progress, raiseFrom) };
  }
  if (!beingCaptured && animState !== 'idle') {
    return { play: 'idle', loop: true, state: 'idle', scrub: null };
  }
  return { play: null, loop: false, state: animState ?? null, scrub: null };
}

// Wire the capture-state clips onto an instantiated point model. Slots are
// 'idle'/'captured' (looped), 'open' (one-shot), and 'raise' (scrubbed by
// capture progress); one-shot end clears _currentAnim.
export function _wirePointAnims(model, kind) {
  const clips = STRATEGIC_POINT_CLIPS[kind] || STRATEGIC_POINT_CLIPS.point;
  const groups = model._animationGroups || [];
  const find = (wanted) => groups.find((g) => String(g.name || '').toLowerCase() === wanted) || null;
  model._animGroups = {};
  const idle = find(clips.idle);
  const open = find(clips.open);
  const raise = find(clips.raise);
  const captured = find(clips.captured);
  if (idle) model._animGroups.idle = idle;
  if (open) model._animGroups.open = open;
  if (raise) model._animGroups.raise = raise;
  if (captured) model._animGroups.captured = captured;
  model._currentAnim = null;
  model._scrubAnim = function (name, progress) {
    const ag = model._animGroups[name];
    if (!ag || typeof ag.scrub !== 'function') {
      return;
    }
    if (model._currentAnim !== name) {
      Object.values(model._animGroups).forEach((other) => {
        try { other.stop(); } catch (e) { /* ignore */ }
      });
      model._currentAnim = name;
    }
    try {
      ag.scrub(progress);
    } catch (e) {
      console.warn('_scrubAnim error', name, e);
    }
  };
  model._playAnim = function (name, loop) {
    if (loop === undefined) loop = true;
    if (model._currentAnim === name) {
      return;
    }
    const ag = model._animGroups[name];
    if (!ag) {
      return;
    }
    Object.values(model._animGroups).forEach((other) => {
      try { other.stop(); } catch (e) { /* ignore */ }
    });
    model._currentAnim = name;
    try {
      ag.loopAnimation = !!loop;
      ag.onAnimationGroupEndObservable.clear();
      ag.reset();
      ag.start(!!loop, 1.0);
      if (!loop) {
        ag.onAnimationGroupEndObservable.addOnce(() => {
          model._currentAnim = null;
        });
      }
    } catch (e) {
      console.warn('_playAnim error', name, e);
    }
  };
}

const _strategicPointContainers = { point: null, relic: null };

async function _loadPointContainer(kind) {
  if (_strategicPointContainers[kind]) {
    return _strategicPointContainers[kind];
  }
  try {
    const [{ loadGltf }, { modelUrl }] = await Promise.all([
      import('./gltf-models.js'),
      import('./assets.js'),
    ]);
    const container = await loadGltf(modelUrl(SP_MODEL_PATHS[kind]));
    if (container) {
      container._hiddenNodes = STRATEGIC_POINT_HIDDEN_NODES;
      _strategicPointContainers[kind] = container;
    }
  } catch (err) {
    console.warn(`[points] ${kind} model failed to load, using procedural fallback`, err);
  }
  return _strategicPointContainers[kind];
}

export async function preloadStrategicPointModel() {
  return _loadPointContainer('point');
}

export async function preloadRelicModel() {
  return _loadPointContainer('relic');
}

export function makeStrategicPointMesh(x, z, kind = 'point') {
  const position = new THREE.Vector3(x, 0, z);
  const root = mkGroup('sp');
  root.position.copy(position);
  const container = useProceduralModels() ? null : (_strategicPointContainers[kind] || null);
  const model = container ? _instantiateFromContainer(container, {}) : null;
  if (model) {
    _wirePointAnims(model, kind);
    _wirePointFlagNodes(model);
    model.scale.setScalar(SP_MODEL_SCALES[kind] || SP_MODEL_SCALES.point);
    root.add(model);
  } else {
    const base = mkCylinder('spbase', 2.8, 2.8, 0.3, 16);
    base.position.y = 0.15;
    root.add(base);
    const baseMaterial = new THREE.MeshStandardMaterial();
    baseMaterial.color = new THREE.Color(0.2, 0.27, 0.2);
    base.material = baseMaterial;
  }

  return {
    group: root,
    model: model || null,
    gem: null,
    gemMat: null,
    capRing: null,
    capRingMat: null,
    pillar: null,
  };
}

export function buildListeningPostMesh(position, teamKey = PLAYER, metaPayload = {}) {
  const faction = _factionBucket(teamKey, metaPayload);
  const container = faction.structures.listening_post;

  if (container) {
    const root = _instantiateFromContainer(container, metaPayload);
    root.position.copy(position);
    if (scene._registerShadows) scene._registerShadows(root);
    return root;
  }

  const root = mkGroup('lp');
  root.position.copy(position);
  const addBox = function addBox(width, height, depth, color, emissiveColor, x, y, z) {
    const box = mkBox('lb', width, height, depth);
    box.position.set(x, y, z);
    root.add(box);
    box.userData = { ...metaPayload };
    const boxMaterial = new THREE.MeshStandardMaterial();
    boxMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      boxMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    box.material = boxMaterial;
    return box;
  };
  addBox(1.2, 2.5, 1.2, 0x2244aa, 0x000033, 0, 1.25, 0);
  const cap = mkCylinder('lpcap', 0, 1.6, 1, 8);
  cap.position.set(0, 3, 0);
  root.add(cap);
  cap.userData = { ...metaPayload };
  const capMaterial = new THREE.MeshStandardMaterial();
  capMaterial.color = new THREE.Color(0.07, 0.2, 0.67);
  cap.material = capMaterial;
  addBox(0.08, 0.08, 2, 0x888888, 0, 0, 4.2, 0);
  const dish = mkSphere('dish', 0.8, 4);
  dish.position.set(0.6, 3.8, 0);
  root.add(dish);
  dish.userData = { ...metaPayload };
  const dishMaterial = new THREE.MeshStandardMaterial();
  dishMaterial.color = new THREE.Color(0.6, 0.6, 0.6);
  dish.material = dishMaterial;
  if (scene._registerShadows) {
    scene._registerShadows(root);
  }
  return root;
}

export function makeTowerBaseMesh(position, teamKey = PLAYER, metaPayload = {}) {
  const faction = _factionBucket(teamKey, metaPayload);
  const container = faction.structures.armoury;

  if (container) {
    const root = _instantiateFromContainer(container, metaPayload);
    root.position.copy(position);
    const ring = makeSquareSelRing(root, STRUCTURE_BOUNDS.towerBase, 0.13, 0.05);
    root._ring = ring;
    root._ringMat = ring._material;
    if (scene._registerShadows) scene._registerShadows(root);
    return root;
  }

  const root = mkGroup('towerbase');
  root.position.copy(position);
  const addBox = function addBox(width, height, depth, color, emissiveColor, x, y, z) {
    const box = mkBox('tb', width, height, depth);
    box.position.set(x, y, z);
    root.add(box);
    box.castShadow = true;
    const boxMaterial = new THREE.MeshStandardMaterial();
    boxMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      boxMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    box.material = boxMaterial;
    box.userData = { ...metaPayload };
    return box;
  };
  const addCyl = function addCyl(diameterTop, diameterBottom, height, color, emissiveColor, x, y, z) {
    const cylinder = mkCylinder('tc', diameterTop, diameterBottom, height, 8);
    cylinder.position.set(x, y, z);
    root.add(cylinder);
    cylinder.castShadow = true;
    const cylinderMaterial = new THREE.MeshStandardMaterial();
    cylinderMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      cylinderMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    cylinder.material = cylinderMaterial;
    cylinder.userData = { ...metaPayload };
    return cylinder;
  };
  addBox(3.5, 0.5, 3.5, 0x223322, 0, 0, 0.25, 0);
  [-1.2, 1.2].forEach((x) => {
    [-1.2, 1.2].forEach((z) => {
      addCyl(0.3, 0.35, 2.5, 0x334433, 0, x, 1.5, z);
    });
  });
  addBox(2, 0.4, 2, 0x1a2a1a, 0, 0, 2.7, 0);
  const turretNode = mkGroup('tbturret');
  root.add(turretNode);
  turretNode.position.set(0, 3.1, 0);
  const turretHead = mkBox('tbth', 1.8, 0.6, 1.8);
  turretNode.add(turretHead);
  const turretHeadMaterial = new THREE.MeshStandardMaterial();
  turretHeadMaterial.color = new THREE.Color(0.1, 0.25, 0.1);
  turretHeadMaterial.emissive = new THREE.Color(0, 0.08, 0);
  turretHead.material = turretHeadMaterial;
  turretHead.userData = { ...metaPayload };
  [-0.35, 0.35].forEach((offsetX) => {
    const barrel = mkCylinder('tbb', 0.18, 0.22, 1.8, 8);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(offsetX, 0.0, 1.2);
    turretNode.add(barrel);
    const barrelMaterial = new THREE.MeshStandardMaterial();
    barrelMaterial.color = new THREE.Color(0.07, 0.07, 0.07);
    barrel.material = barrelMaterial;
  });
  root._turret = turretNode;
  const ring = makeSquareSelRing(root, STRUCTURE_BOUNDS.towerBase, 0.13, 0.05);
  root._ring = ring;
  root._ringMat = ring._material;
  if (scene._registerShadows) {
    scene._registerShadows(root);
  }
  // Ensure metadata is applied to all child meshes for picking
  childMeshes(root).forEach((mesh) => {
    if (!mesh._isSelRingBar) {
      mesh.userData = { ...metaPayload };
    }
  });
  return root;
}

export function makeGunTurretMesh(position, teamKey, metaPayload) {
  const faction = _factionBucket(teamKey, metaPayload);
  const container = faction.structures.gun_turret || faction.structures.turret;

  if (container) {
    const root = _instantiateFromContainer(container, metaPayload);
    root.position.copy(position);
    const ring = makeSquareSelRing(root, STRUCTURE_BOUNDS.gunTurret, 0.13, 0.05);
    root._ring = ring;
    root._ringMat = ring._material;
    if (scene._registerShadows) scene._registerShadows(root);
    return root;
  }

  const root = mkGroup('gunTurret');
  root.position.copy(position);
  const config = TEAM_COLOR[teamKey] || TEAM_COLOR.blue;

  const addBox = function addBox(width, height, depth, color, emissiveColor, x, y, z) {
    const box = mkBox('gtb', width, height, depth);
    box.position.set(x, y, z);
    root.add(box);
    box.castShadow = true;
    const boxMaterial = new THREE.MeshStandardMaterial();
    boxMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      boxMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    box.material = boxMaterial;
    box.userData = { ...metaPayload };
    return box;
  };
  const addCyl = function addCyl(diameterTop, diameterBottom, height, color, emissiveColor, x, y, z, tess = 8) {
    const cylinder = mkCylinder('gtc', diameterTop, diameterBottom, height, tess);
    cylinder.position.set(x, y, z);
    root.add(cylinder);
    cylinder.castShadow = true;
    const cylinderMaterial = new THREE.MeshStandardMaterial();
    cylinderMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      cylinderMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    cylinder.material = cylinderMaterial;
    cylinder.userData = { ...metaPayload };
    return cylinder;
  };

  for (let index = 0; index < 8; index++) {
    const angle = (index / 8) * Math.PI * 2;
    const loopX = Math.sin(angle) * 2.1;
    const loopZ = Math.cos(angle) * 2.1;
    const bagBox = addBox(1.2, 0.55, 0.55, 0x5a4a2a, 0x2a1f0a, loopX, 0.28, loopZ);
    bagBox.rotation.y = angle;
  }
  addBox(3.2, 0.18, 3.2, 0x2a2218, 0, 0, 0.09, 0);
  [-1.4, 1.4].forEach((x) => {
    [-1.4, 1.4].forEach((z) => {
      addCyl(0.14, 0.16, 0.85, 0x3a3228, 0, x, 0.48, z, 6);
    });
  });

  addCyl(0.7, 0.85, 0.75, 0x1e2218, 0, 0, 0.75, 0, 12);

  const turretNode = mkGroup('gtturret');
  root.add(turretNode);
  turretNode.position.set(0, 1.22, 0);

  const housingMat = new THREE.MeshStandardMaterial();
  housingMat.color = config.diffuse.clone();
  housingMat.emissive = config.emissive.clone();

  const housing = mkBox('gthouse', 1.6, 0.65, 1.4);
  turretNode.add(housing);
  housing.castShadow = true;
  housing.material = housingMat;
  housing.userData = { ...metaPayload };

  const frontPlate = mkBox('gtfp', 1.6, 0.55, 0.22);
  frontPlate.position.set(0, 0.05, 0.72);
  frontPlate.rotation.x = 0.35;
  turretNode.add(frontPlate);
  frontPlate.castShadow = true;
  const frontPlateMaterial = new THREE.MeshStandardMaterial();
  frontPlateMaterial.color = new THREE.Color(0.15, 0.18, 0.10);
  frontPlateMaterial.emissive = new THREE.Color(0.04, 0.06, 0.01);
  frontPlate.material = frontPlateMaterial;
  frontPlate.userData = { ...metaPayload };

  [-0.85, 0.85].forEach((offsetX) => {
    const shield = mkBox('gtshield', 0.14, 0.52, 1.1);
    shield.position.set(offsetX, 0.04, 0.12);
    turretNode.add(shield);
    shield.castShadow = true;
    const shieldMaterial = new THREE.MeshStandardMaterial();
    shieldMaterial.color = new THREE.Color(0.10, 0.12, 0.08);
    shieldMaterial.emissive = new THREE.Color(0.02, 0.03, 0.01);
    shield.material = shieldMaterial;
    shield.userData = { ...metaPayload };
  });

  [-0.38, 0.38].forEach((offsetX) => {
    const jacket = mkCylinder('gtjacket', 0.22, 0.28, 2.4, 10);
    jacket.rotation.x = Math.PI / 2;
    jacket.position.set(offsetX, -0.02, 1.4);
    turretNode.add(jacket);
    jacket.castShadow = true;
    const jacketMaterial = new THREE.MeshStandardMaterial();
    jacketMaterial.color = new THREE.Color(0.08, 0.08, 0.08);
    jacket.material = jacketMaterial;
    const support = mkCylinder('gtsupp', 0.28, 0.22, 0.22, 8);
    support.rotation.x = Math.PI / 2;
    support.position.set(offsetX, -0.02, 2.56);
    turretNode.add(support);
    support.castShadow = true;
    const supportMaterial = new THREE.MeshStandardMaterial();
    supportMaterial.color = new THREE.Color(0.06, 0.06, 0.06);
    support.material = supportMaterial;
    const muzzle = mkSphere('gtmuzzle_' + offsetX, 0.20, 12);
    muzzle.position.set(offsetX, -0.02, 2.7);
    turretNode.add(muzzle);
    const muzzleMaterial = new THREE.MeshBasicMaterial();
    muzzleMaterial.color = new THREE.Color(0.6, 0.3, 0);
    muzzleMaterial.opacity = 0;
    muzzleMaterial.transparent = true;
    muzzle.material = muzzleMaterial;
    if (offsetX < 0) {
      root._muzzleMatL = muzzleMaterial;
    } else {
      root._muzzleMatR = muzzleMaterial;
    }
  });

  const ammoBox = mkBox('gtammo', 0.55, 0.42, 0.45);
  ammoBox.position.set(-0.62, 0.38, -0.35);
  turretNode.add(ammoBox);
  const ammoBoxMaterial = new THREE.MeshStandardMaterial();
  ammoBoxMaterial.color = new THREE.Color(0.25, 0.20, 0.08);
  ammoBoxMaterial.emissive = new THREE.Color(0.06, 0.05, 0.01);
  ammoBox.material = ammoBoxMaterial;
  ammoBox.userData = { ...metaPayload };

  const stripe = mkBox('gtstripe', 3.2, 0.04, 0.35);
  stripe.position.set(0, 0.19, -1.35);
  root.add(stripe);
  const stripeMaterial = new THREE.MeshBasicMaterial();
  stripeMaterial.color = new THREE.Color(0.9, 0.6, 0.0);
  stripeMaterial.opacity = 0.7;
  stripeMaterial.transparent = true;
  stripe.material = stripeMaterial;
  stripe.userData.pickable = false;

  root._turret = turretNode;
  const ring = makeSquareSelRing(root, STRUCTURE_BOUNDS.gunTurret, 0.13, 0.05);
  root._ring = ring;
  root._ringMat = ring._material;

  if (scene._registerShadows) {
    scene._registerShadows(root);
  }
  return root;
}

export function makeApcMesh(position, teamKey, metaPayload) {
  const faction = _factionBucket(teamKey, metaPayload);
  const container = faction.structures.mechanized || faction.structures.apc;

  if (container) {
    const root = _instantiateFromContainer(container, metaPayload);
    root.position.copy(position);
    const turretNode = descendants(root).find((n) => n.name.toLowerCase().includes('turret')) || root;
    root._turret = turretNode;
    root._laserTip = null;
    root._laserTipMat = null;
    const selectionMaterial = new THREE.MeshBasicMaterial();
    selectionMaterial.color = new THREE.Color(0, 1, 0.53);
    selectionMaterial.opacity = 0;
    selectionMaterial.transparent = true;
    const selectionRing = mkTorus('apcselring', 7.0, 0.12, 32);
    selectionRing.position.set(0, 0.08, 0);
    root.add(selectionRing);
    selectionRing.material = selectionMaterial;
    selectionRing.visible = false;
    selectionRing.visible = false;
    root._selDisc = selectionRing;
    root._selMat = selectionMaterial;
    root._ring = selectionRing;
    root._ringMat = selectionMaterial;
    if (scene._registerShadows) {
      scene._registerShadows(root);
    }
    return root;
  }

  const root = mkGroup('apc');
  root.position.copy(position);
  const config = TEAM_COLOR[teamKey] || TEAM_COLOR.blue;
  const addBox = function addBox(width, height, depth, color, emissiveColor, x, y, z) {
    const box = mkBox('apcb', width, height, depth);
    box.position.set(x, y, z);
    root.add(box);
    box.castShadow = true;
    const boxMaterial = new THREE.MeshStandardMaterial();
    boxMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      boxMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    box.material = boxMaterial;
    box.userData = { ...metaPayload };
    return box;
  };
  const addCyl = function addCyl(diameterTop, diameterBottom, height, color, emissiveColor, x, y, z) {
    const cylinder = mkCylinder('apcc', diameterTop, diameterBottom, height, 10);
    cylinder.position.set(x, y, z);
    root.add(cylinder);
    cylinder.castShadow = true;
    const cylinderMaterial = new THREE.MeshStandardMaterial();
    cylinderMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      cylinderMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    cylinder.material = cylinderMaterial;
    cylinder.userData = { ...metaPayload };
    return cylinder;
  };
  addBox(3.5, 1.4, 5.5, 0x1a3020, 0, 0, 0.7, 0);
  const hullTop = addBox(2.8, 1.0, 3.5, 0x223828, 0, 1.7, 0.5);
  const hullTopMaterial = new THREE.MeshStandardMaterial();
  hullTopMaterial.color = config.diffuse.clone();
  hullTopMaterial.emissive = config.emissive.clone();
  hullTop.material = hullTopMaterial;

  addBox(3.6, 0.5, 1, 0x1a2a1a, 0, 0, 1.35, -2.5);
  [-1.6, 1.6].forEach((x) => {
    addCyl(0.6, 0.6, 5.5, 0x111111, 0, x, 0.5, 0).rotation.z = Math.PI / 2;
    addCyl(0.5, 0.5, 5.5, 0x222222, 0, x, 0.5, 0).rotation.z = Math.PI / 2;
  });
  const turretNode = mkGroup('apc_turret');
  root.add(turretNode);
  turretNode.position.set(0, 2.3, 0.5);
  const turretHead = mkBox('apcth', 1.8, 0.7, 1.8);
  turretNode.add(turretHead);
  const turretHeadMaterial = new THREE.MeshStandardMaterial();
  turretHeadMaterial.color = config.diffuse.clone();
  turretHeadMaterial.emissive = config.emissive.clone();
  turretHead.material = turretHeadMaterial;
  turretNode.add(turretHead);
  turretHead.userData = { ...metaPayload };
  const cannon = mkCylinder('apccannon', 0.12, 0.18, 2.2, 8);
  cannon.rotation.x = Math.PI / 2;
  cannon.position.set(0, 0.1, 1.3);
  turretNode.add(cannon);
  const cannonMaterial = new THREE.MeshStandardMaterial();
  cannonMaterial.color = new THREE.Color(0.1, 0.1, 0.1);
  cannon.material = cannonMaterial;
  const tip = mkSphere('apctip', 0.22, 12);
  tip.position.set(0, 0.1, 2.4);
  turretNode.add(tip);
  const tipMaterial = new THREE.MeshStandardMaterial();
  tipMaterial.color = new THREE.Color(0, 1, 0.4);
  tipMaterial.emissive = new THREE.Color(0, 0.67, 0.27);
  tip.material = tipMaterial;
  root._laserTip = tip;
  root._laserTipMat = tipMaterial;
  root._turret = turretNode;
  const selectionMaterial = new THREE.MeshBasicMaterial();
  selectionMaterial.color = new THREE.Color(0, 1, 0.53);
  selectionMaterial.opacity = 0;
  selectionMaterial.transparent = true;
  const selectionRing = mkTorus('apcselring', 7.0, 0.12, 32);
  selectionRing.rotation.x = 0;
  selectionRing.position.set(0, 0.08, 0);
  root.add(selectionRing);
  selectionRing.material = selectionMaterial;
  selectionRing.visible = false;
  selectionRing.visible = false;
  root._selDisc = selectionRing;
  root._selMat = selectionMaterial;
  if (scene._registerShadows) {
    scene._registerShadows(root);
  }
  return root;
}

export function makeVehicleMesh(model, position, teamKey, metaPayload) {
  const faction = _factionBucket(teamKey, metaPayload);
  const container = faction?.vehicles?.[model];
  if (container) {
    const root = _instantiateFromContainer(container, metaPayload);
    root.position.copy(position);
    const turretNode = descendants(root).find((n) => n.name.toLowerCase().includes('turret')) || root;
    root._turret = turretNode;
    root._laserTip = null;
    root._laserTipMat = null;
    const selectionMaterial = new THREE.MeshBasicMaterial();
    selectionMaterial.color = new THREE.Color(0, 1, 0.53);
    selectionMaterial.opacity = 0;
    selectionMaterial.transparent = true;
    const selectionRing = mkTorus('vselring', 5.0, 0.12, 32);
    selectionRing.rotation.x = 0;
    selectionRing.position.set(0, 0.08, 0);
    root.add(selectionRing);
    selectionRing.material = selectionMaterial;
    selectionRing.visible = false;
    selectionRing.visible = false;
    root._selDisc = selectionRing;
    root._selMat = selectionMaterial;
    if (scene._registerShadows) {
      scene._registerShadows(root);
    }
    return root;
  }

  const root = mkGroup('vehicle');
  root.position.copy(position);
  const config = TEAM_COLOR[teamKey] || TEAM_COLOR.blue;
  const box = mkBox('vbox', 2.2, 1.2, 3.4);
  box.position.y = 0.6;
  root.add(box);
  box.material = getMat('vboxmat', {
    diffuseColor: new THREE.Color('#' + config.diffuse.toString(16).padStart(6, '0')),
    emissiveColor: config.emissive,
    specularColor: new THREE.Color(0, 0, 0),
  });
  box.userData = { ...metaPayload };
  const top = mkBox('vturret', 1.0, 0.6, 1.4);
  top.position.set(0, 1.3, -0.2);
  root.add(top);
  top.material = getMat('vturretmat', {
    diffuseColor: new THREE.Color('#' + config.diffuse.toString(16).padStart(6, '0')),
    emissiveColor: config.emissive,
    specularColor: new THREE.Color(0, 0, 0),
  });
  top.userData = { ...metaPayload };
  root._turret = top;
  return root;
}

export function makeAirfieldMesh(position, teamKey, metaPayload) {
  const faction = _factionBucket(teamKey, metaPayload);
  const container = faction.structures.airfield || faction.structures.mechanized;

  if (container) {
    const root = _instantiateFromContainer(container, metaPayload);
    root.position.copy(position);
    const ring = makeSquareSelRing(root, AIRFIELD_BOUNDS, 0.16, 0.05);
    root._ring = ring;
    root._ringMat = ring._material;
    if (scene._registerShadows) scene._registerShadows(root);
    return root;
  }

  const root = mkGroup('airfield');
  root.position.copy(position);
  const config = TEAM_COLOR[teamKey] || TEAM_COLOR.blue;

  const addBox = function addBox(width, height, depth, color, emissiveColor, x, y, z) {
    const box = mkBox('afb', width, height, depth);
    box.position.set(x, y, z);
    root.add(box);
    const boxMaterial = new THREE.MeshStandardMaterial();
    boxMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      boxMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    box.material = boxMaterial;
    box.userData = { ...metaPayload };
    return box;
  };
  const addCyl = function addCyl(diameterTop, diameterBottom, height, color, emissiveColor, x, y, z, tess = 8) {
    const cylinder = mkCylinder('afc', diameterTop, diameterBottom, height, tess);
    cylinder.position.set(x, y, z);
    root.add(cylinder);
    const cylinderMaterial = new THREE.MeshStandardMaterial();
    cylinderMaterial.color = new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emissiveColor) {
      cylinderMaterial.emissive = new THREE.Color('#' + emissiveColor.toString(16).padStart(6, '0'));
    }

    cylinder.material = cylinderMaterial;
    cylinder.userData = { ...metaPayload };
    return cylinder;
  };

  addBox(14, 0.22, 7, 0x1a1a1f, 0, 0, 0.11, 0);
  addBox(12, 0.01, 0.18, 0xddcc00, 0xaa9900, 0, 0.22, 0);
  [-3.2, 3.2].forEach((z) => {
    const stripe = addBox(12, 0.01, 0.12, 0xffffff, 0, 0, 0.22, z);
    const stripeMaterial = new THREE.MeshStandardMaterial();
    stripeMaterial.color = config.diffuse.clone();
    stripeMaterial.emissive = config.emissive.clone();
    stripe.material = stripeMaterial;
  });
  [-5.8, 5.8].forEach((x) => {
    [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].forEach((z) => {
      addBox(0.9, 0.01, 0.32, 0xffffff, 0xaaaaaa, x, 0.22, z);
    });
  });

  addBox(1.8, 0.28, 1.8, 0x2a2a35, 0, 0, 0.25, -4.8);
  addBox(1.4, 3.0, 1.4, 0x363650, 0, 0, 1.78, -4.8);
  addBox(2.4, 0.5, 2.4, 0x252540, 0, 0, 3.53, -4.8);
  addBox(2.2, 0.65, 2.2, 0x1c2040, 0x080820, 0, 4.05, -4.8);
  addBox(2.25, 0.3, 2.25, 0x332200, 0x664400, 0, 4.05, -4.8);
  addCyl(0.05, 0.05, 1.8, 0x888888, 0, 0, 5.25, -4.8);
  const beacon = mkSphere('afbeacon', 0.22, 5);
  beacon.position.set(0, 6.18, -4.8);
  root.add(beacon);
  const beaconMaterial = new THREE.MeshStandardMaterial();
  beaconMaterial.color = new THREE.Color(1, 0.3, 0.1);
  beaconMaterial.emissive = new THREE.Color(1, 0.1, 0.0);
  beacon.material = beaconMaterial;
  root._beacon = beacon;
  root._beaconMat = beaconMaterial;

  addBox(5.5, 0.18, 3.8, 0x222228, 0, -5.5, 0.09, 1.5);
  addBox(0.18, 2.8, 3.8, 0x2a2a35, 0, -8.4, 1.4, 1.5);
  addBox(5.5, 0.18, 0.18, 0x2a2a35, 0, -5.5, 2.8, -0.3);
  [-0.55, 0, 0.55].forEach((z) => {
    addBox(5.5, 0.32, 1.5, 0x252535, 0, -5.5, 2.88, z * 2.2);
  });
  [-0.3, 3.3].forEach((z) => {
    addBox(0.18, 2.8, 3.8, 0x242430, 0, -5.5, 1.4, z);
  });

  [0.8, -0.8].forEach((z) => {
    addCyl(0.7, 0.7, 2.0, 0x33332a, 0, -9.4, 1.0, z, 10);
    addCyl(0.72, 0.72, 0.14, 0x444438, 0, -9.4, 2.1, z, 10);
  });
  addBox(0.1, 0.1, 1.8, 0x555548, 0, -9.4, 0.95, 0);

  const parkedRoot = mkGroup('parked_jet');
  root.add(parkedRoot);
  parkedRoot.position.set(-5.5, 0.22, 1.5);
  parkedRoot.rotation.y = Math.PI / 2;
  parkedRoot.scale.setScalar(0.55);
  _buildJetGeometry(parkedRoot, {
    diffuse: new THREE.Color('#1a2a3a'),
    emissive: new THREE.Color('#112233'),
  }, metaPayload);

  const ring = makeSquareSelRing(root, AIRFIELD_BOUNDS, 0.16, 0.05);
  root._ring = ring;
  root._ringMat = ring._material;

  if (scene._registerShadows) {
    scene._registerShadows(root);
  }
  return root;
}

export function _buildJetGeometry(root, config, metaPayload) {
  const bodyColor = ('#' + config.diffuse.getHexString());
  const emissiveColor = ('#' + config.emissive.getHexString());
  const material = function material(color, emis, alpha) {
    const jetMaterial = new THREE.MeshStandardMaterial();
    jetMaterial.color = (typeof color === 'string')
      ? new THREE.Color(color)
      : new THREE.Color('#' + color.toString(16).padStart(6, '0'));
    if (emis) {
      jetMaterial.emissive = (typeof emis === 'string')
        ? new THREE.Color(emis)
        : new THREE.Color('#' + emis.toString(16).padStart(6, '0'));
    }

    if (alpha !== undefined) {
      jetMaterial.opacity = alpha;
      jetMaterial.transparent = true;
    }
    return jetMaterial;
  };
  const box = function box(width, height, depth, color, emis, x, y, z, rx = 0, ry = 0, rz = 0) {
    const jetBox = mkBox('jb', width, height, depth);
    jetBox.position.set(x, y, z);
    jetBox.rotation.set(rx, ry, rz);
    root.add(jetBox);
    jetBox.userData.pickable = false;
    jetBox.material = material(color, emis);
    if (metaPayload) {
      jetBox.userData = { ...metaPayload };
    }
    return jetBox;
  };
  const cyl = function cyl(diameterTop, diameterBottom, height, color, emis, x, y, z, rx = 0, ry = 0, rz = 0, tess = 8) {
    const cylinder = mkCylinder('jc', diameterTop, diameterBottom, height, tess);
    cylinder.position.set(x, y, z);
    cylinder.rotation.set(rx, ry, rz);
    root.add(cylinder);
    cylinder.userData.pickable = false;
    cylinder.material = material(color, emis);
    if (metaPayload) {
      cylinder.userData = { ...metaPayload };
    }
    return cylinder;
  };

  box(0.55, 0.42, 5.2, bodyColor, 0, 0, 0, 0);
  box(0.38, 0.28, 1.6, bodyColor, 0, 0, 0, 2.8);
  cyl(0.0, 0.26, 0.8, 0x222233, 0, 0, 0, 3.6, Math.PI / 2, 0, 0, 6);
  box(0.36, 0.24, 0.9, 0x0a1a2a, 0x001830, 0, 0.28, 1.8, 0, 0, 0);
  box(0.28, 0.16, 0.72, 0x0d2a44, 0x002244, 0, 0.38, 1.8);

  const wingAngle = 0.38;
  [
    [-1, 1],
    [1, -1],
  ].forEach(([signX]) => {
    const wingPlane = mkBox('jwing', 1.9, 0.06, 2.8);
    wingPlane.position.set(signX * 1.05, -0.05, -0.4);
    wingPlane.rotation.set(0, signX * wingAngle * -1, 0);
    root.add(wingPlane);
    wingPlane.userData.pickable = false;
    wingPlane.material = material(bodyColor, emissiveColor);
    if (metaPayload) {
      wingPlane.userData = { ...metaPayload };
    }
    const wingTip = mkBox('jwt', 0.4, 0.05, 1.0);
    wingTip.position.set(signX * 1.92, -0.04, -1.1);
    root.add(wingTip);
    wingTip.userData.pickable = false;
    wingTip.material = material(0x222222, 0);
    if (metaPayload) {
      wingTip.userData = { ...metaPayload };
    }
    const navLight = mkSphere('jntl', 0.12, 4);
    navLight.position.set(signX * 2.1, -0.02, -1.5);
    root.add(navLight);
    navLight.userData.pickable = false;
    const navLightMaterial = new THREE.MeshBasicMaterial();
    navLightMaterial.color = (signX < 0)
      ? new THREE.Color(1, 0.1, 0.1)
      : new THREE.Color(0.1, 1, 0.1);
    navLight.material = navLightMaterial;
  });

  [
    [-1, 1],
    [1, -1],
  ].forEach(([signX]) => {
    const canardFin = mkBox('jcf', 0.55, 0.04, 0.55);
    canardFin.position.set(signX * 0.42, 0.0, 2.1);
    canardFin.rotation.set(0, signX * 0.2, 0);
    root.add(canardFin);
    canardFin.userData.pickable = false;
    canardFin.material = material(bodyColor, 0);
    if (metaPayload) {
      canardFin.userData = { ...metaPayload };
    }
  });

  [-0.55, 0.55].forEach((engineX) => {
    cyl(0.22, 0.28, 1.8, 0x222222, 0, engineX, -0.1, -1.0, Math.PI / 2, 0, 0, 10);
    cyl(0.26, 0.24, 0.12, 0x111111, 0, engineX, -0.1, 0.0, Math.PI / 2, 0, 0, 10);
    const nozzle = mkCylinder('jnoz', 0.14, 0.22, 0.55, 10);
    nozzle.position.set(engineX, -0.1, -2.05);
    nozzle.rotation.x = Math.PI / 2;
    root.add(nozzle);
    nozzle.userData.pickable = false;
    const nozzleMaterial = new THREE.MeshStandardMaterial();
    nozzleMaterial.color = new THREE.Color(0.08, 0.08, 0.08);
    nozzleMaterial.emissive = new THREE.Color(0.04, 0.04, 0.04);
    nozzle.material = nozzleMaterial;
    const flame = mkSphere('jflame', 0.28, 5);
    flame.position.set(engineX, -0.1, -2.4);
    flame.scale.z = 2.2;
    root.add(flame);
    flame.userData.pickable = false;
    const flameMaterial = new THREE.MeshBasicMaterial();
    flameMaterial.color = new THREE.Color(1, 0.3, 0.0);
    flameMaterial.opacity = 0.85;
    flameMaterial.transparent = true;
    flame.material = flameMaterial;
    root['_flame_' + engineX] = flame;
    root['_flameMat_' + engineX] = flameMaterial;
  });

  const verticalFin = mkBox('jvfin', 0.06, 0.7, 1.4);
  verticalFin.position.set(0, 0.38, -1.6);
  root.add(verticalFin);
  verticalFin.userData.pickable = false;
  verticalFin.material = material(0x222222, 0);
  if (metaPayload) {
    verticalFin.userData = { ...metaPayload };
  }

  [-1.1, -0.55, 0.55, 1.1].forEach((missileX, index) => {
    const missile = mkCylinder('jhp', 0.06, 0.08, 0.7, 6);
    missile.position.set(missileX, -0.14, -0.2 + (index % 2) * 0.3);
    missile.rotation.x = Math.PI / 2;
    root.add(missile);
    missile.userData.pickable = false;
    const hardpointMaterial = new THREE.MeshStandardMaterial();
    hardpointMaterial.color = new THREE.Color(0.55, 0.55, 0.45);
    missile.material = hardpointMaterial;
  });
}

export function makeJetMesh(position, teamKey, metaPayload) {
  const root = mkGroup('jet');
  root.position.copy(position);
  const config = TEAM_COLOR[teamKey] || TEAM_COLOR.blue;
  _buildJetGeometry(root, config, metaPayload);

  const selectionRing = makeSquareSelRing(root, 3.5, 0.15, -0.3);
  root._selRing = selectionRing;
  root._selMat = selectionRing._material;

  if (scene._registerShadows) {
    scene._registerShadows(root);
  }
  return root;
}

export function makeConfigStructureMesh(type, position, teamKey, metaPayload) {
  const faction = _factionBucket(teamKey, metaPayload);
  const container = faction?.structures?.[type];
  if (container) {
    const root = _instantiateFromContainer(container, metaPayload);
    if (root) {
      root.position.copy(position);
      const ring = makeSquareSelRing(root, STRUCTURE_BOUNDS[type] ?? 3.5, 0.14, 0.05);
      root._ring = ring;
      root._ringMat = ring._material;
      if (scene._registerShadows) scene._registerShadows(root);
      childMeshes(root).forEach((mesh) => {
        if (!mesh._isSelRingBar) {
          mesh.userData = { ...metaPayload };
        }
      });
      return root;
    }
  }
  return _makeProceduralStructureMesh(type, position, teamKey, metaPayload);
}

function _makeProceduralStructureMesh(type, position, teamKey, metaPayload) {
  const root = mkGroup(`struct_${type}`);
  root.position.copy(position);
  const config = TEAM_COLOR[teamKey] || TEAM_COLOR.blue;
  const mat = new THREE.MeshStandardMaterial();
  mat.color = config.diffuse.clone();
  mat.emissive = config.emissive.clone();
  const darkMat = getMat(0x222222);
  const addBox = function addBox(w, h, d, material, x, y, z) {
    const box = mkBox('sb', w, h, d);
    box.position.set(x, y, z);
    root.add(box);
    box.material = material;
    box.castShadow = true;
    box.userData = { ...metaPayload };
    return box;
  };

  if (type === 'mines') {
    addBox(2.6, 0.14, 2.6, darkMat, 0, 0.08, 0);
    for (let i = 0; i < 5; i += 1) {
      const mx = (Math.random() - 0.5) * 1.8;
      const mz = (Math.random() - 0.5) * 1.8;
      const mine = mkCylinder('mine', 0.5, 0.5, 0.24, 8);
      mine.position.set(mx, 0.24, mz);
      root.add(mine);
      mine.material = darkMat;
      mine.userData = { ...metaPayload };
      const spike = mkCylinder('spike', 0, 0.08, 0.28, 8);
      spike.position.set(mx, 0.5, mz);
      root.add(spike);
      spike.material = getMat(0x888888);
      spike.userData = { ...metaPayload };
    }
  } else {
    const small = type === 'thermo_generator' || type === 'plasma_generator';
    const w = small ? 3.2 : 4.5;
    const h = small ? 2.2 : 3.2;
    addBox(w, 0.4, w, darkMat, 0, 0.2, 0);
    addBox(w * 0.7, h, w * 0.7, mat, 0, 0.2 + h / 2, 0);
    const core = mkSphere('core', 0.7, 8);
    core.position.set(0, 0.2 + h + 0.35, 0);
    root.add(core);
    const coreMat = new THREE.MeshBasicMaterial();
    coreMat.color = new THREE.Color(0, 0.67, 0.27);
    core.material = coreMat;
    core.userData = { ...metaPayload };
    root._coreGlowMat = coreMat;
    root._meter = core;
  }

  const ring = makeSquareSelRing(root, STRUCTURE_BOUNDS[type] ?? 3.5, 0.14, 0.05);
  root._ring = ring;
  root._ringMat = ring._material;
  if (scene._registerShadows) scene._registerShadows(root);
  return root;
}

const LEGACY_GHOST_TYPES = new Set([
  'barracks', 'infantry_command', 'hq', 'tower', 'turret', 'towerBase',
  'thermoGen', 'gunTurret', 'apc', 'mechanized', 'airfield',
]);

// Placement/scaffold ghosts use the real structure model for every
// config-driven type; only legacy procedural types keep bespoke ghosts.
export function ghostUsesConfigModel(type) {
  return !LEGACY_GHOST_TYPES.has(type);
}

export function makeGhostMesh(type, pos, meta, teamKey = PLAYER) {
  let root;

  if (ghostUsesConfigModel(type)) {
    root = makeConfigStructureMesh(type, pos, teamKey, meta);
  } else if (type === 'barracks' || type === 'infantry_command') {
    root = makeBarracksMesh(pos, teamKey, meta);
  } else if (type === 'hq') {
    root = makeHQMesh(pos, teamKey, meta);
  } else if (type === 'tower' || type === 'turret') {
    root = makeTowerMesh(pos, teamKey, meta);
  } else if (type === 'towerBase') {
    root = makeTowerBaseMesh(pos, teamKey, meta);
  } else if (type === 'thermoGen') {
    root = makeThermoMesh(pos, teamKey, meta);
  } else if (type === 'gunTurret') {
    root = makeGunTurretMesh(pos, teamKey, meta);
  } else if (type === 'apc') {
    root = makeApcMesh(pos, teamKey, meta);
  } else if (type === 'mechanized') {
    root = makeApcMesh(pos, teamKey, meta);
  } else if (type === 'airfield') {
    root = makeAirfieldMesh(pos, teamKey, meta);
  }

  const ghostEmissive = new THREE.Color(0.2, 0.7, 1.0);
  childMeshes(root).forEach((mesh) => {
    if (!mesh.material) {
      return;
    }
    const ghostMaterial = mesh.material.clone();
    ghostMaterial.name = 'ghost_mat_' + Math.random();
    if (ghostMaterial.isMeshStandardMaterial) {
      ghostMaterial.color.setRGB(0, 0, 0);
      ghostMaterial.emissive.copy(ghostEmissive);
    } else if (ghostMaterial.color) {
      ghostMaterial.color.copy(ghostEmissive);
    }
    ghostMaterial.opacity = 0.2;
    ghostMaterial.transparent = true;
    mesh.material = ghostMaterial;
    mesh.userData.pickable = false;
  });
  if (root._ring) {
    root._ring.visible = true;
    root._ring.visible = true;
    if (root._ringMat) root._ringMat.opacity = 0.35; root._ringMat.transparent = true;
  }
  root._isGhost = true;
  return root;
}
