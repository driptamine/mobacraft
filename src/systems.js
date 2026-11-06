import * as THREE from 'three';

import {
  scene,
  world,
  PLAYER,
  controlBoth,
  currentBounds,
  COSTS,
  TEAM_COLOR,
  TAG,
  JET_ALT,
  JET_SPEED,
  JET_ATTACK_RANGE,
  selSquads,
  setSelSquads,
  attackMode,
  requisition,
  setRequisition,
  energy,
  setEnergy,
  kills,
  setKills,
  gameOver,
  setGameOver,
  particles,
  grenadeCallbacks,
  FORMATION,
  SQUAD_SCATTER,
  SQUAD_MAX,
  counters,
  researchedTech,
  setResearchedTech,
  getRequisitionRate,
  gainRequisition,
  PLASMA_RATE_PER,
  BUILDING_BOUNDS,
  STRUCTURE_BOUNDS,
  AIRFIELD_BOUNDS,
  addBeforeRender,
  removeBeforeRender,
  getDeltaTime,
  structuresHidden,
} from './scene.js';
import { updateHpBar, buildListeningPostMesh, nextStrategicPointAnim, updatePointFlag, shouldShowCaptureFlag } from './meshes.js';
import { updateHUD } from './hud.js';
import {
  createSoldierEntity,
  createSquadEntity,
  createBuilderEntity,
  createBuildingEntity,
  createStructureEntity,
  createStrategicPointEntity,
  createBulletEntity,
  createPlasmaBulletEntity,
  createBlasterBulletEntity,
  createReaperBulletEntity,
  createVehicleEntity,
  createLaserBulletEntity,
  createBeamEntity,
  createLightningEntity,
  getSoldierMuzzlePos,
  createGrenadeEntity,
  upgradeToGrenadier,
  _finishConstruction,
} from './entities.js';
import { FACTIONS, playerFaction, resolveFactionKey } from './factions.js';
import { infantryImmortal } from './hud/store.js';
import { mkBox, mkDisc, disposeObj, childMeshes, findNodesByName } from './three-helpers.js';
import { updatePlasmaBoltCrackle } from './plasma-bolt.js';
const _boltLookTarget = new THREE.Vector3();
const _boltFlashWhite = new THREE.Color(1, 1, 1);
import { computeSoldierYaw, nextCaptureStage, captureSlotTarget, isFleeingMove, shouldHoldForCapture, isCaptureEngaged, PLANTER_SPEED_MULT, guardCaptureAnim, captureClipDone, CAPTURE_SEQUENCE, isPointCapturedBy, nextGuardCaptureStage, isPlantingDone, isPlanterFinished, planterStandTarget } from './soldier-aim.js';

export function findClosestEnemySoldier(world, team, fromPos) {
  let closest = null;
  let minDistance = Infinity;
  for (const squadEntityId of world.query('squad')) {
    const squadComponent = world.get(squadEntityId, 'squad');
    if (!squadComponent || squadComponent.team === team) {
      continue;
    }
    for (const soldierEntityId of squadComponent.soldiers) {
      if (soldierEntityId === null) {
        continue;
      }
      const soldierComponent = world.get(soldierEntityId, 'soldier');
      if (!soldierComponent) {
        continue;
      }
      if (soldierComponent.cloaked && soldierComponent.revealTimer <= 0) {
        continue;
      }
      const meshComponent = world.get(soldierEntityId, 'mesh');
      if (!meshComponent) {
        continue;
      }
      const distance = fromPos.distanceTo(meshComponent.root.position);
      if (distance < minDistance) {
        minDistance = distance;
        closest = {
          soldierEntityId,
          squad: squadComponent,
          squadEntityId,
          distance,
        };
      }
    }
  }
  return closest;
}

export function disposeMeshComponent(meshComponent) {
  if (!meshComponent) {
    return;
  }
  if (meshComponent.root) {
    if (meshComponent.root._animGroups) {
      Object.values(meshComponent.root._animGroups).forEach((ag) => {
        try {
          ag.stop();
          ag.dispose();
        } catch (e) {
          // Intentionally empty
        }
      });
      meshComponent.root._animGroups = {};
    }
    if (meshComponent.root._instanceData) {
      try {
        meshComponent.root._instanceData.animationGroups.forEach((ag) => {
          try {
            ag.stop();
            ag.dispose();
          } catch (e) {
            // Intentionally empty
          }
        });
        meshComponent.root._instanceData.rootNodes.forEach((n) => {
          try {
            childMeshes(n).forEach((m) => disposeObj(m));
            disposeObj(n);
          } catch (e) {
            // Intentionally empty
          }
        });
      } catch (e) {
        // Intentionally empty
      }
      meshComponent.root._instanceData = null;
    }
    childMeshes(meshComponent.root).forEach((m) => disposeObj(m));
    disposeObj(meshComponent.root);
  }
  if (meshComponent.hpBar) {
    childMeshes(meshComponent.hpBar).forEach((m) => disposeObj(m));
    disposeObj(meshComponent.hpBar);
  }
  if (meshComponent.prodBar) {
    childMeshes(meshComponent.prodBar).forEach((m) => disposeObj(m));
    disposeObj(meshComponent.prodBar);
  }
  if (meshComponent.selRing) {
    if (meshComponent.selRing.material) {
      meshComponent.selRing.material.dispose();
    }
    disposeObj(meshComponent.selRing);
  }
  if (meshComponent.reinBar) {
    childMeshes(meshComponent.reinBar).forEach((m) => disposeObj(m));
    disposeObj(meshComponent.reinBar);
  }
  if (meshComponent.grenadeSetupBar) {
    childMeshes(meshComponent.grenadeSetupBar).forEach((m) => disposeObj(m));
    disposeObj(meshComponent.grenadeSetupBar);
  }
  if (meshComponent.group) {
    childMeshes(meshComponent.group).forEach((m) => disposeObj(m));
    disposeObj(meshComponent.group);
  }
  if (meshComponent.capRing) {
    disposeObj(meshComponent.capRing);
  }
  if (meshComponent.lpMesh) {
    childMeshes(meshComponent.lpMesh).forEach((m) => disposeObj(m));
    disposeObj(meshComponent.lpMesh);
  }
}

export function spawnParticles(position, color, count) {
  for (let i = 0; i < count; i++) {
    const particleMesh = mkBox('pt', .1, .1, .1);
    particleMesh.position.copy(position);
    const particleMaterial = new THREE.MeshBasicMaterial();
    particleMaterial.color = color.clone();
    particleMaterial.opacity = 1;
    particleMesh.material = particleMaterial;
    const vx = (Math.random() - .5) * 8;
    const vy = Math.random() * 6 + 1;
    const vz = (Math.random() - .5) * 8;
    particles.push({
      mesh: particleMesh,
      material: particleMaterial,
      vx,
      vy,
      vz,
      life: .45 + Math.random() * .35,
      age: 0,
    });
  }
}

export function systemSoldier(world, deltaTime) {
  for (const id of world.query('soldier', 'mesh')) {
    const soldierComponent = world.get(id, 'soldier');
    const meshComponent = world.get(id, 'mesh');
    if (!soldierComponent || !meshComponent || !meshComponent.root) {
      continue;
    }

    const squadComponent = world.get(soldierComponent.squadId, 'squad');
    const teamColor = TEAM_COLOR[squadComponent?.team || 'blue'].emissive;

    if (soldierComponent.shootTimer > 0) {
      soldierComponent.shootTimer -= deltaTime;
    }
    if (soldierComponent.revealTimer > 0) {
      soldierComponent.revealTimer -= deltaTime;
    }
    if (soldierComponent.flashTimer > 0) {
      soldierComponent.flashTimer -= deltaTime;
      const flashColor = new THREE.Color(0.8, 0.8, 0.2);
      if (meshComponent.root._bodyMat) {
        meshComponent.root._bodyMat.emissive.copy(flashColor);
      } else {
        childMeshes(meshComponent.root).forEach((m) => {
          if (m.material && m.material.emissive) {
            m.material.emissive.copy(flashColor);
          }
        });
      }
    } else {
      if (meshComponent.root._bodyMat) {
        meshComponent.root._bodyMat.emissive.copy(teamColor);
      } else {
        childMeshes(meshComponent.root).forEach((m) => {
          if (m.material && m.material.emissive && !m._isSelRingBar && !m._isTeamRing) {
            m.material.emissive.copy(teamColor);
          }
        });
      }
    }
    meshComponent.hpBar.position.copy(meshComponent.root.position);
    meshComponent.hpBar.position.y = 0.06;
    meshComponent.hpBar.position.z = meshComponent.root.position.z - 1.1;
    updateHpBar(meshComponent.hpBar, soldierComponent.hp / soldierComponent.maxHp);
    if (meshComponent.reloadBar) {
      meshComponent.reloadBar.position.copy(meshComponent.root.position);
      meshComponent.reloadBar.position.y = 0.14;
      meshComponent.reloadBar.position.z = meshComponent.root.position.z - 1.1;
      const reloadTime = squadComponent ? squadComponent.grenadeReloadTime : 8;
      const cd = squadComponent ? squadComponent.grenadeCd : 0;
      const percentage = reloadTime > 0 ? Math.max(0, Math.min(1, 1 - cd / reloadTime)) : 1;
      updateHpBar(meshComponent.reloadBar, percentage);
      meshComponent.reloadBar.visible = percentage < 0.999;
    }
  }
}

// Guard banner props stay hidden at spawn; the planter on capture duty
// carries them until flag_plant_2 finishes, then the point's own rising
// assembly takes over as the flag.
const PLANTER_BANNER_NODES = ['guard_banner', 'guard_banner_rod'];

function _planterHasPlantAnims(root) {
  return !!root._animGroups?.flagPlant1 && !!root._animGroups?.flagPlant2;
}

function _setPlanterBannerVisible(soldierComponent, root, visible) {
  if (!soldierComponent || !root) {
    return;
  }
  if (!!soldierComponent._bannerShown === !!visible) {
    return;
  }
  soldierComponent._bannerShown = !!visible;
  if (!root._bannerNodes) {
    root._bannerNodes = findNodesByName(root, PLANTER_BANNER_NODES);
  }
  for (const node of root._bannerNodes) {
    node.visible = !!visible;
  }
}

function _playPlanterSequence(soldierComponent, root) {
  if (soldierComponent._captureDone) {
    _setPlanterBannerVisible(soldierComponent, root, false);
    root._playAnim('idle');
    return;
  }
  const { stage, want } = nextCaptureStage(
    soldierComponent.captureStage,
    root._currentAnim,
    soldierComponent._capturePrev,
  );
  soldierComponent.captureStage = stage;
  const planted = isPlantingDone({ captureStage: stage, hasPlantAnims: _planterHasPlantAnims(root) });
  _setPlanterBannerVisible(soldierComponent, root, !planted);
  if (!root._animGroups?.[want]) {
    root._playAnim('idle');
    return;
  }
  const last = CAPTURE_SEQUENCE.length - 1;
  if (stage >= last && captureClipDone(want, soldierComponent._capturePrev, root._currentAnim)) {
    soldierComponent._captureDone = true;
    root._playAnim('idle');
    return;
  }
  if (root._currentAnim !== want) {
    root._playAnim(want, false);
  }
  soldierComponent._capturePrev = root._currentAnim;
}

function _captureHoldTarget(world, squadComponent) {
  if (!squadComponent.moveOrder) {
    return null;
  }
  for (const spId of world.query('strategicPoint')) {
    const sp = world.get(spId, 'strategicPoint');
    if (!sp) {
      continue;
    }
    if (shouldHoldForCapture({
      orderX: squadComponent.moveOrder.x,
      orderZ: squadComponent.moveOrder.z,
      squadX: squadComponent.position.x,
      squadZ: squadComponent.position.z,
      spX: sp.position.x,
      spZ: sp.position.z,
      captureRadius: sp.captureRadius,
    })) {
      return sp;
    }
  }
  return null;
}

export function systemSquad(world, deltaTime) {
  for (const squadEntityId of world.query('squad', 'mesh')) {
    const squadComponent = world.get(squadEntityId, 'squad');
    const meshComponent = world.get(squadEntityId, 'mesh');
    if (!squadComponent || !meshComponent) {
      continue;
    }
    const aliveSols = squadComponent.soldiers.filter((s) => s !== null && world.has(s, 'soldier'));
    if (aliveSols.length === 0) {
      childMeshes(meshComponent.hpBar).forEach((m) => disposeObj(m));
      disposeObj(meshComponent.hpBar);
      if (meshComponent.reinBar) {
        childMeshes(meshComponent.reinBar).forEach((m) => disposeObj(m));
        disposeObj(meshComponent.reinBar);
      }
      if (meshComponent.grenadeSetupBar) {
        childMeshes(meshComponent.grenadeSetupBar).forEach((m) => disposeObj(m));
        disposeObj(meshComponent.grenadeSetupBar);
      }
      if (selSquads.includes(squadEntityId)) {
        setSelSquads(selSquads.filter((s) => s !== squadEntityId));
        updateHUD();
      }
      world.destroyEntity(squadEntityId);
      continue;
    }
    let moving = false;
    let enemy;
    if (squadComponent.forcedSoldierId && world.has(squadComponent.forcedSoldierId, 'soldier')) {
      const enemyMeshComponent = world.get(squadComponent.forcedSoldierId, 'mesh');
      if (enemyMeshComponent) {
        const distance = squadComponent.position.distanceTo(enemyMeshComponent.root.position);
        enemy = { soldierEntityId: squadComponent.forcedSoldierId, distance };
        const dx = enemyMeshComponent.root.position.x - squadComponent.position.x;
        const dz = enemyMeshComponent.root.position.z - squadComponent.position.z;
        const length = Math.hypot(dx, dz) || 1;
        if (squadComponent.team !== PLAYER) {
          if (distance > squadComponent.attackRange && !squadComponent.moveOrder) {
            squadComponent.facing.set(dx / length, 0, dz / length);
            squadComponent.position.x += squadComponent.facing.x * squadComponent.speed * deltaTime;
            squadComponent.position.z += squadComponent.facing.z * squadComponent.speed * deltaTime;
            squadComponent.position.x = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.x));
            squadComponent.position.z = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.z));
            moving = true;
          }
        } else if (attackMode === 'melee') {
          if (distance > squadComponent.attackRange && !squadComponent.moveOrder) {
            squadComponent.facing.set(dx / length, 0, dz / length);
            squadComponent.position.x += squadComponent.facing.x * squadComponent.speed * deltaTime;
            squadComponent.position.z += squadComponent.facing.z * squadComponent.speed * deltaTime;
            squadComponent.position.x = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.x));
            squadComponent.position.z = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.z));
            moving = true;
          }
        } else {
          squadComponent.facing.set(dx / length, 0, dz / length);
          if (distance > squadComponent.attackRange) {
            squadComponent.position.x += squadComponent.facing.x * squadComponent.speed * deltaTime;
            squadComponent.position.z += squadComponent.facing.z * squadComponent.speed * deltaTime;
            squadComponent.position.x = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.x));
            squadComponent.position.z = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.z));
            moving = true;
          }
        }
      }
    } else if (squadComponent.forcedSoldierId) {
      squadComponent.forcedSoldierId = null;
    }
    if (!enemy && !squadComponent.forcedSoldierId && squadComponent.forcedTarget && world.has(squadComponent.forcedTarget, 'squad')) {
      const forcedTargetSquad = world.get(squadComponent.forcedTarget, 'squad');
      const forcedTargetSoldiers = forcedTargetSquad?.soldiers?.filter((soldierId) => soldierId !== null && world.has(soldierId, 'soldier')) ?? [];
      if (forcedTargetSoldiers.length > 0) {
        let best = null;
        let bestDistance = Infinity;
        forcedTargetSoldiers.forEach((soldierId) => {
          const meshComponent = world.get(soldierId, 'mesh');
          if (!meshComponent) {
            return;
          }
          const distance = squadComponent.position.distanceTo(meshComponent.root.position);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = { soldierEntityId: soldierId, distance };
          }
        });
        enemy = best;
        if (enemy) {
          const enemyMeshComponent = world.get(enemy.soldierEntityId, 'mesh');
          if (enemyMeshComponent) {
            const dx = enemyMeshComponent.root.position.x - squadComponent.position.x;
            const dz = enemyMeshComponent.root.position.z - squadComponent.position.z;
            const length = Math.hypot(dx, dz) || 1;
            if (squadComponent.team !== PLAYER) {
              if (enemy.distance > squadComponent.attackRange && !squadComponent.moveOrder) {
                squadComponent.facing.set(dx / length, 0, dz / length);
                squadComponent.position.x += squadComponent.facing.x * squadComponent.speed * deltaTime;
                squadComponent.position.z += squadComponent.facing.z * squadComponent.speed * deltaTime;
                squadComponent.position.x = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.x));
                squadComponent.position.z = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.z));
                moving = true;
              }
            } else if (attackMode === 'melee') {
              if (enemy.distance > squadComponent.attackRange && !squadComponent.moveOrder) {
                squadComponent.facing.set(dx / length, 0, dz / length);
                squadComponent.position.x += squadComponent.facing.x * squadComponent.speed * deltaTime;
                squadComponent.position.z += squadComponent.facing.z * squadComponent.speed * deltaTime;
                squadComponent.position.x = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.x));
                squadComponent.position.z = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.z));
                moving = true;
              }
            } else {
              squadComponent.facing.set(dx / length, 0, dz / length);
              if (enemy.distance > squadComponent.attackRange) {
                squadComponent.position.x += squadComponent.facing.x * squadComponent.speed * deltaTime;
                squadComponent.position.z += squadComponent.facing.z * squadComponent.speed * deltaTime;
                squadComponent.position.x = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.x));
                squadComponent.position.z = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.z));
                moving = true;
              }
            }
          }
        }
      } else {
        squadComponent.forcedTarget = null;
        enemy = findClosestEnemySoldier(world, squadComponent.team, squadComponent.position);
      }
    } else if (!enemy) {
      enemy = findClosestEnemySoldier(world, squadComponent.team, squadComponent.position);
    }
    if (!window._multiplayerMode) {
      if (squadComponent.moveOrder && !squadComponent.stopped) {
        const dx = squadComponent.moveOrder.x - squadComponent.position.x;
        const dz = squadComponent.moveOrder.z - squadComponent.position.z;
        const distance = Math.hypot(dx, dz);
        const holdSp = _captureHoldTarget(world, squadComponent);
        if (distance < .6) {
          squadComponent.moveOrder = null;
        } else if (holdSp) {
          const hx = holdSp.position.x - squadComponent.position.x;
          const hz = holdSp.position.z - squadComponent.position.z;
          const hlen = Math.hypot(hx, hz) || 1;
          squadComponent.facing.set(hx / hlen, 0, hz / hlen);
        } else {
          moving = true;
          const inverse = 1 / distance;
          squadComponent.facing.set(dx * inverse, 0, dz * inverse);
          squadComponent.position.x += squadComponent.facing.x * squadComponent.speed * deltaTime;
          squadComponent.position.z += squadComponent.facing.z * squadComponent.speed * deltaTime;
          squadComponent.position.x = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.x));
          squadComponent.position.z = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.z));
        }
      } else if (enemy && !squadComponent.stopped && enemy.distance <= squadComponent.detectionRange && enemy.distance > squadComponent.attackRange && squadComponent.autoChase && (squadComponent.team !== PLAYER || attackMode === 'melee')) {
        moving = true;
        const enemyPosition = world.get(enemy.soldierEntityId, 'mesh')?.root.position;
        if (enemyPosition) {
          const dx = enemyPosition.x - squadComponent.position.x;
          const dz = enemyPosition.z - squadComponent.position.z;
          const length = Math.hypot(dx, dz) || 1;
          squadComponent.facing.set(dx / length, 0, dz / length);
          squadComponent.position.x += squadComponent.facing.x * squadComponent.speed * deltaTime;
          squadComponent.position.z += squadComponent.facing.z * squadComponent.speed * deltaTime;
          squadComponent.position.x = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.x));
          squadComponent.position.z = Math.max(-currentBounds(), Math.min(currentBounds(), squadComponent.position.z));
        }
      } else if (enemy && !squadComponent.stopped && enemy.distance <= squadComponent.detectionRange && !squadComponent.autoChase && enemy.distance <= squadComponent.attackRange) {
        const enemyPosition = world.get(enemy.soldierEntityId, 'mesh')?.root.position;
        if (enemyPosition) {
          const dx = enemyPosition.x - squadComponent.position.x;
          const dz = enemyPosition.z - squadComponent.position.z;
          const length = Math.hypot(dx, dz) || 1;
          squadComponent.facing.set(dx / length, 0, dz / length);
        }
      } else if (enemy && !squadComponent.stopped && enemy.distance <= squadComponent.detectionRange && enemy.distance > squadComponent.attackRange && attackMode === 'ranged') {
        const enemyPosition = world.get(enemy.soldierEntityId, 'mesh')?.root.position;
        if (enemyPosition) {
          const dx = enemyPosition.x - squadComponent.position.x;
          const dz = enemyPosition.z - squadComponent.position.z;
          const length = Math.hypot(dx, dz) || 1;
          squadComponent.facing.set(dx / length, 0, dz / length);
        }
      }
    } else {
      moving = squadComponent.speed > 0.1 && (squadComponent.moveOrder !== null || !squadComponent.stopped);
    }
    if (enemy && enemy.distance <= squadComponent.attackRange) {
      const enemyPosition = world.get(enemy.soldierEntityId, 'mesh')?.root.position;
      if (enemyPosition) {
        const dx = enemyPosition.x - squadComponent.position.x;
        const dz = enemyPosition.z - squadComponent.position.z;
        const length = Math.hypot(dx, dz) || 1;
        squadComponent.facing.set(dx / length, 0, dz / length);
      }
      if (!window._multiplayerMode) {
        _squadFireAll(world, squadEntityId, squadComponent, aliveSols, deltaTime, enemy);
      }
    } else {
      for (const soldierId of aliveSols) {
        const soldierComponent = world.get(soldierId, 'soldier');
        if (soldierComponent) {
          soldierComponent.attackCooldown = Math.max(0, soldierComponent.attackCooldown - deltaTime);
        }
      }
    }
    if (!window._multiplayerMode) {
      squadComponent.grenadeCd = Math.max(0, squadComponent.grenadeCd - deltaTime);
      if (moving) {
        squadComponent.idleTime = 0;
      } else {
        squadComponent.idleTime += deltaTime;
      }
      const grenadierSolIds = aliveSols.filter((soldierId) => {
        const soldierComponent = world.get(soldierId, 'soldier');
        return soldierComponent && soldierComponent.isGrenadier;
      });
      if (squadComponent.idleTime >= 1 && squadComponent.grenadeCd <= 0 && grenadierSolIds.length > 0 && enemy && enemy.distance <= squadComponent.attackRange + 8) {
        const enemyMesh = world.get(enemy.soldierEntityId, 'mesh')?.root;
        if (enemyMesh) {
          squadComponent.grenadeCd = squadComponent.grenadeReloadTime;
          squadComponent.idleTime = 0;
          for (const grenadierSolId of grenadierSolIds) {
            const target = enemyMesh.position.clone();
            target.x += (Math.random() - 0.5) * 2.5;
            target.z += (Math.random() - 0.5) * 2.5;
            createGrenadeEntity(world, grenadierSolId, target);
          }
        }
      }
      squadComponent.capturingSpId = null;
      for (const spId of world.query('strategicPoint')) {
        const strategicPoint = world.get(spId, 'strategicPoint');
        if (!strategicPoint) {
          continue;
        }
        const distance = squadComponent.position.distanceTo(strategicPoint.position);
        const squadInside = distance < strategicPoint.captureRadius;
        let soldierInside = false;
        for (const soldierId of aliveSols) {
          const soldierMesh = world.get(soldierId, 'mesh');
          if (soldierMesh && soldierMesh.root.position.distanceTo(strategicPoint.position) < strategicPoint.captureRadius) {
            soldierInside = true;
            break;
          }
        }
        const orderedHold = squadComponent.moveOrder != null && shouldHoldForCapture({
          orderX: squadComponent.moveOrder.x,
          orderZ: squadComponent.moveOrder.z,
          squadX: squadComponent.position.x,
          squadZ: squadComponent.position.z,
          spX: strategicPoint.position.x,
          spZ: strategicPoint.position.z,
          captureRadius: strategicPoint.captureRadius,
        });
        if (squadInside || soldierInside) {
          const speed = (1 / 20) * deltaTime;
          if (squadComponent.team === PLAYER) {
            strategicPoint.captureProgress = Math.min(1, strategicPoint.captureProgress + speed);
          } else {
            strategicPoint.captureProgress = Math.max(-1, strategicPoint.captureProgress - speed);
          }
          _strategicPointUpdateOwner(world, spId, strategicPoint, squadComponent.faction);
          if (strategicPoint.owner === squadComponent.team
            && squadComponent.moveOrder != null
            && squadComponent.moveOrder.distanceTo(strategicPoint.position) < strategicPoint.captureRadius) {
            squadComponent.moveOrder = null;
          }
        }
        if (isCaptureEngaged({ squadInside, soldierInside, orderedHold })) {
          squadComponent.capturingSpId = spId;
        }
      }
    }
    {
      const visualFacing = squadComponent.visualFacing;
      const targetFacing = squadComponent.facing;
      const curAngle = Math.atan2(visualFacing.x, visualFacing.z);
      const targetAngle = Math.atan2(targetFacing.x, targetFacing.z);
      let difference = targetAngle - curAngle;
      while (difference > Math.PI) {
        difference -= Math.PI * 2;
      }
      while (difference < -Math.PI) {
        difference += Math.PI * 2;
      }
      if (moving) {
        visualFacing.set(targetFacing.x, 0, targetFacing.z);
      } else {
        const rotSpeed = 4.5;
        const step = difference * Math.min(1, rotSpeed * deltaTime);
        const newAngle = curAngle + step;
        visualFacing.set(Math.sin(newAngle), 0, Math.cos(newAngle));
      }
    }
    const visualFacing = squadComponent.visualFacing;
    const yawAngle = Math.atan2(visualFacing.x, visualFacing.z);
    const engagedSp = squadComponent.capturingSpId != null
      ? world.get(squadComponent.capturingSpId, 'strategicPoint')
      : null;
    const engagedOwner = engagedSp ? engagedSp.owner : null;
    for (const soldierId of aliveSols) {
      const soldierComponent = world.get(soldierId, 'soldier');
      const soldierMeshComponent = world.get(soldierId, 'mesh');
      if (!soldierComponent || !soldierMeshComponent) {
        continue;
      }
      const f = FORMATION[soldierComponent.formIdx];
      if (soldierComponent.scatter) {
        const scatter = soldierComponent.scatter;
        scatter.vy -= 18 * deltaTime;
        soldierMeshComponent.root.position.x += scatter.vx * deltaTime;
        soldierMeshComponent.root.position.y += scatter.vy * deltaTime;
        soldierMeshComponent.root.position.z += scatter.vz * deltaTime;
        soldierMeshComponent.root.rotation.x += 3 * deltaTime;
        soldierMeshComponent.root.rotation.z += 2 * deltaTime;
        if (soldierMeshComponent.root._blobShadow) {
          soldierMeshComponent.root._blobShadow.visible = false;
        }
        scatter.time += deltaTime;
        if (soldierMeshComponent.root.position.y <= 0 && scatter.time > .12) {
          soldierMeshComponent.root.position.y = 0;
          soldierComponent.scatter = null;
          soldierComponent.stagger = 0.9 + Math.random() * .4;
          soldierMeshComponent.root.rotation.y = Math.random() * Math.PI * 2;
          soldierMeshComponent.hpBar.visible = true;
          if (soldierMeshComponent.root._blobShadow) {
            soldierMeshComponent.root._blobShadow.visible = true;
          }
        }
        continue;
      }
      if (soldierComponent.stagger > 0) {
        soldierComponent.stagger -= deltaTime;
        const rise = Math.min(1, deltaTime * 6);
        soldierMeshComponent.root.rotation.x *= (1 - rise);
        soldierMeshComponent.root.rotation.z *= (1 - rise);
        continue;
      }
      const onCaptureDuty = squadComponent.capturingSpId != null && !moving;
      const isPlanter = onCaptureDuty && aliveSols.indexOf(soldierId) === 0;
      let tx = squadComponent.position.x + f.x * SQUAD_SCATTER;
      let tz = squadComponent.position.z + f.z * SQUAD_SCATTER;
      if (onCaptureDuty) {
        const strategicPoint = world.get(squadComponent.capturingSpId, 'strategicPoint');
        if (strategicPoint) {
          const planterLeaves = isPlanter && isPlanterFinished({
            captureDone: soldierComponent._captureDone,
            hasCaptureAnims: _planterHasPlantAnims(soldierMeshComponent.root)
              || !!soldierMeshComponent.root._animGroups?.capture1,
          });
          if (planterLeaves) {
            const target = planterStandTarget({
              centerX: strategicPoint.position.x,
              centerZ: strategicPoint.position.z,
              squadX: squadComponent.position.x,
              squadZ: squadComponent.position.z,
            });
            tx = target.x;
            tz = target.z;
          } else {
            const target = captureSlotTarget({
              isPlanter,
              slotX: tx,
              slotZ: tz,
              centerX: strategicPoint.position.x,
              centerZ: strategicPoint.position.z,
              soldierX: soldierMeshComponent.root.position.x,
              soldierZ: soldierMeshComponent.root.position.z,
            });
            tx = target.x;
            tz = target.z;
          }
        }
      }
      const MAX_LAG = 5.0;
      const rawLag = Math.hypot(tx - soldierMeshComponent.root.position.x, tz - soldierMeshComponent.root.position.z);
      if (rawLag > MAX_LAG) {
        const lagInv = 1 / rawLag;
        tx = soldierMeshComponent.root.position.x + (tx - soldierMeshComponent.root.position.x) * lagInv * MAX_LAG;
        tz = soldierMeshComponent.root.position.z + (tz - soldierMeshComponent.root.position.z) * lagInv * MAX_LAG;
      }
      const distanceToSlot = Math.hypot(tx - soldierMeshComponent.root.position.x, tz - soldierMeshComponent.root.position.z);
      const pace = isPlanter ? PLANTER_SPEED_MULT : Math.min(2.0, 0.3 + distanceToSlot * 0.6);
      const soldierRunSpeed = soldierComponent.moveSpeed * pace;
      const soldierMoving = distanceToSlot > 0.04;
      let moveAngle = 0;
      if (soldierMoving) {
        const inverse = 1 / distanceToSlot;
        const mdx = (tx - soldierMeshComponent.root.position.x) * inverse;
        const mdz = (tz - soldierMeshComponent.root.position.z) * inverse;
        const step = Math.min(distanceToSlot, soldierRunSpeed * deltaTime);
        soldierMeshComponent.root.position.x += mdx * step;
        soldierMeshComponent.root.position.z += mdz * step;
        moveAngle = Math.atan2(mdx, mdz);
      }
      soldierComponent._fleeing = moving && soldierMoving && isFleeingMove(moveAngle, yawAngle);
      soldierMeshComponent.root.rotation.y = computeSoldierYaw({
        shooting: soldierComponent.shootTimer > 0,
        moving: soldierMoving,
        moveAngle,
        aimAngle: yawAngle + soldierComponent.idleYawOffset,
        currentYaw: soldierMeshComponent.root.rotation.y,
        deltaTime,
        fleeing: soldierComponent._fleeing,
      });
      soldierMeshComponent.root.position.y = 0;
      const isWalking = soldierMoving || moving;
      if (soldierMeshComponent.root._playAnim) {
        const isShooting = soldierComponent.shootTimer > 0;
        const capturing = squadComponent.capturingSpId != null && !isShooting && !isWalking;
        if (squadComponent.capturingSpId == null) {
          soldierComponent.captureStage = 0;
          soldierComponent._guardStage = 0;
          soldierComponent._capturePrev = null;
          soldierComponent._captureDone = false;
          soldierComponent._captureKey = null;
          _setPlanterBannerVisible(soldierComponent, soldierMeshComponent.root, false);
        } else {
          const effortKey = `${squadComponent.capturingSpId}|${engagedOwner}|${isPlanter ? 'p' : 'g'}`;
          if (soldierComponent._captureKey !== effortKey && engagedOwner !== squadComponent.team) {
            soldierComponent.captureStage = 0;
            soldierComponent._guardStage = 0;
            soldierComponent._capturePrev = null;
            soldierComponent._captureDone = false;
          }
          soldierComponent._captureKey = effortKey;
          if (!capturing) {
            soldierComponent._capturePrev = null;
          }
        }
        if (isShooting) {
          if (isWalking) {
            soldierMeshComponent.root._playAnim('shootMove', false);
          } else {
            soldierMeshComponent.root._playAnim('shoot', false);
          }
        } else if (isWalking) {
          soldierMeshComponent.root._playAnim('run');
          if (isPlanter) {
            const planted = isPlantingDone({
              captureStage: soldierComponent.captureStage,
              hasPlantAnims: _planterHasPlantAnims(soldierMeshComponent.root),
            });
            _setPlanterBannerVisible(soldierComponent, soldierMeshComponent.root, !planted);
          }
        } else if (capturing && !isPlanter) {
          const guardRoot = soldierMeshComponent.root;
          if (engagedSp != null && isPointCapturedBy(engagedSp.owner, squadComponent.team)) {
            soldierComponent._captureDone = true;
            guardRoot._playAnim('idle');
          } else {
            let { stage, want } = nextGuardCaptureStage(
              soldierComponent._guardStage,
              guardRoot._currentAnim,
              soldierComponent._capturePrev,
            );
            if (stage === 0 && !guardRoot._animGroups?.[want] && guardRoot._animGroups?.[guardCaptureAnim(1)]) {
              stage = 1;
              want = guardCaptureAnim(aliveSols.indexOf(soldierId));
            }
            soldierComponent._guardStage = stage;
            if (!guardRoot._animGroups?.[want]) {
              guardRoot._playAnim('idle');
            } else {
              if (guardRoot._currentAnim !== want) {
                guardRoot._playAnim(want, false);
              }
              soldierComponent._capturePrev = guardRoot._currentAnim;
            }
          }
        } else if (capturing) {
          _playPlanterSequence(soldierComponent, soldierMeshComponent.root);
          if (isPlanter && engagedSp && engagedSp.raiseFrom == null
            && isPlantingDone({
              captureStage: soldierComponent.captureStage,
              hasPlantAnims: _planterHasPlantAnims(soldierMeshComponent.root),
            })) {
            engagedSp.raiseFrom = Math.min(1, Math.abs(engagedSp.captureProgress || 0));
          }
        } else {
          soldierMeshComponent.root._playAnim('idle');
        }
      }
      soldierComponent.walkTime += deltaTime * (isWalking ? 9 : 1.8);
      if (isWalking) {
        const sway = Math.sin(soldierComponent.walkTime) * 0.33;
        if (soldierMeshComponent.root._legL) {
          soldierMeshComponent.root._legL.rotation.x = sway;
          soldierMeshComponent.root._legR.rotation.x = -sway;
        }
        if (soldierMeshComponent.root._armL) {
          soldierMeshComponent.root._armL.rotation.x = -sway * 0.8;
          soldierMeshComponent.root._armR.rotation.x = sway * 0.4;
        }
        soldierMeshComponent.root.position.y = Math.abs(Math.sin(soldierComponent.walkTime)) * 0.06;
      } else {
        const breathe = Math.sin(soldierComponent.walkTime + soldierComponent.idlePhase) * 0.04;
        const sway = Math.sin(soldierComponent.walkTime * 0.7 + soldierComponent.idlePhase) * 0.015;
        if (soldierMeshComponent.root._legL) {
          soldierMeshComponent.root._legL.rotation.x *= (1 - Math.min(1, deltaTime * 6));
          soldierMeshComponent.root._legR.rotation.x *= (1 - Math.min(1, deltaTime * 6));
        }
        if (soldierMeshComponent.root._armL) {
          soldierMeshComponent.root._armL.rotation.x = breathe - 0.05;
          soldierMeshComponent.root._armR.rotation.x = -breathe * 0.6 + 0.03;
          soldierMeshComponent.root._armL.rotation.z = sway + 0.08;
          soldierMeshComponent.root._armR.rotation.z = -sway - 0.08;
        }
        soldierMeshComponent.root.position.y = breathe * 0.3;
      }
      if (soldierMeshComponent.root._blobShadow) {
        soldierMeshComponent.root._blobShadow.position.y = 0.015 - soldierMeshComponent.root.position.y;
      }
    }
    if (squadComponent.reinforceQueue.length > 0) {
      squadComponent.reinforceProgress += deltaTime;
      if (squadComponent.reinforceProgress >= 7.0) {
        squadComponent.reinforceProgress = 0;
        const { formIdx } = squadComponent.reinforceQueue.shift();
        if (squadComponent.soldiers[formIdx] === null || !world.has(squadComponent.soldiers[formIdx], 'soldier')) {
          const soldierId = createSoldierEntity(world, squadEntityId, formIdx);
          const soldierMeshComponent = world.get(soldierId, 'mesh');
          const f = FORMATION[formIdx];
          soldierMeshComponent.root.position.set(squadComponent.position.x + f.x * SQUAD_SCATTER, 0, squadComponent.position.z + f.z * SQUAD_SCATTER);
          squadComponent.soldiers[formIdx] = soldierId;
          if (squadComponent.selected) {
            soldierMeshComponent.root._selMat.opacity = .9;
            soldierMeshComponent.root._selMat.transparent = true;
          }
        }
        if (squadComponent.reinforceQueue.length === 0) {
          squadComponent.reinforceProgress = 0;
        }
        updateHUD();
      }
      if (meshComponent.reinBar) {
        meshComponent.reinBar.visible = true;
        meshComponent.reinBar.position.copy(squadComponent.position);
        meshComponent.reinBar.position.y = 3.48;
        updateHpBar(meshComponent.reinBar, squadComponent.reinforceProgress / 7.0);
      }
    } else {
      if (meshComponent.reinBar) {
        meshComponent.reinBar.visible = false;
      }
    }
    const hasGrenadier = aliveSols.some((soldierId) => {
      const soldierComponent = world.get(soldierId, 'soldier');
      return soldierComponent && soldierComponent.isGrenadier;
    });
    const enemyNearby = enemy && enemy.distance <= squadComponent.attackRange + 8;
    const showSetupBar = hasGrenadier && !moving && squadComponent.grenadeCd <= 0 && squadComponent.idleTime < 1 && enemyNearby;
    if (meshComponent.grenadeSetupBar) {
      if (showSetupBar) {
        meshComponent.grenadeSetupBar.visible = true;
        meshComponent.grenadeSetupBar.position.copy(squadComponent.position);
        meshComponent.grenadeSetupBar.position.y = squadComponent.reinforceQueue.length > 0 ? 3.72 : 3.48;
        updateHpBar(meshComponent.grenadeSetupBar, squadComponent.idleTime / 1.0);
      } else {
        meshComponent.grenadeSetupBar.visible = false;
      }
    }
    if (squadComponent.grenadeQueue.length > 0) {
      squadComponent.grenadeProgress += deltaTime;
      if (squadComponent.grenadeProgress >= 2.0) {
        squadComponent.grenadeProgress = 0;
        const { solId: soldierEntityId } = squadComponent.grenadeQueue.shift();
        if (soldierEntityId !== null && world.has(soldierEntityId, 'soldier')) {
          upgradeToGrenadier(world, soldierEntityId);
        }
        if (squadComponent.grenadeQueue.length === 0) {
          squadComponent.grenadeProgress = 0;
        }
        updateHUD();
      }
    }
  }
}

function _squadFireAll(world, squadEntityId, squadComponent, aliveSols, deltaTime, enemy) {
  for (const soldierId of aliveSols) {
    const soldierComponent = world.get(soldierId, 'soldier');
    if (!soldierComponent) {
      continue;
    }
    if (soldierComponent._fleeing) {
      continue;
    }
    soldierComponent.attackCooldown = Math.max(0, soldierComponent.attackCooldown - deltaTime);
    if (soldierComponent.attackCooldown <= 0) {
      const soldierMeshComponent = world.get(soldierId, 'mesh');
      if (soldierMeshComponent && world.has(enemy.soldierEntityId, 'soldier')) {
        const damageMult = soldierComponent.damageMult || 1;
        if (soldierComponent.cloaked) {
          soldierComponent.revealTimer = 2.5;
        }
        const projectileType = squadComponent.projectileType || 'bullet';
        if (projectileType === 'beam') {
          createBeamEntity(world, soldierMeshComponent.root.position, squadComponent.team, soldierId, enemy.soldierEntityId, damageMult);
        } else if (projectileType === 'lightning') {
          const muzzlePos = getSoldierMuzzlePos(world, soldierId);
          createLightningEntity(world, muzzlePos, squadComponent.team, soldierId, enemy.soldierEntityId, damageMult);
        } else if (projectileType === 'laser') {
          createLaserBulletEntity(world, soldierMeshComponent.root.position, squadComponent.team, soldierId, enemy.soldierEntityId, damageMult);
        } else if (projectileType === 'plasma') {
          createPlasmaBulletEntity(world, soldierMeshComponent.root.position, squadComponent.team, soldierId, enemy.soldierEntityId, damageMult);
        } else if (projectileType === 'blaster') {
          createBlasterBulletEntity(world, soldierMeshComponent.root.position, squadComponent.team, soldierId, enemy.soldierEntityId, damageMult);
        } else if (projectileType === 'reaper') {
          createReaperBulletEntity(world, soldierMeshComponent.root.position, squadComponent.team, soldierId, enemy.soldierEntityId, damageMult);
        } else {
          createBulletEntity(world, soldierMeshComponent.root.position, squadComponent.team, soldierId, enemy.soldierEntityId, damageMult);
        }
        soldierComponent.flashTimer = .06;
        soldierComponent.shootTimer = 0.4;
      }
      const ptRate = squadComponent.projectileType === 'laser' ? 2.5 : squadComponent.projectileType === 'beam' ? 2.5 : squadComponent.projectileType === 'lightning' ? 2.5 : 1;
      soldierComponent.attackCooldown = (1 / soldierComponent.attackRate) * ptRate;
    }
  }
}

export function systemBuilder(world, deltaTime) {
  for (const id of world.query('builder', 'mesh')) {
    const builderComponent = world.get(id, 'builder');
    const meshComponent = world.get(id, 'mesh');
    if (!builderComponent || !meshComponent) {
      continue;
    }
    if (builderComponent.buildTargetSP !== null && !builderComponent.isBuilding) {
      const strategicPoint = world.get(builderComponent.buildTargetSP, 'strategicPoint');
      if (strategicPoint) {
        const distance = meshComponent.root.position.distanceTo(strategicPoint.position);
        if (distance < 5) {
          builderComponent.isBuilding = true;
          builderComponent.moveTarget = null;
        }
      }
    }
    if (builderComponent.buildTarget && !builderComponent.isBuilding) {
      const distance = meshComponent.root.position.distanceTo(builderComponent.buildTarget.position);
      if (distance < 5) {
        builderComponent.isBuilding = true;
        builderComponent.moveTarget = null;
      }
    }
    if (!builderComponent.isBuilding) {
      _builderCombat(world, builderComponent, meshComponent, deltaTime);
      _builderRepair(world, builderComponent, meshComponent, deltaTime);
    }
    if (builderComponent.isBuilding) {
      builderComponent.buildProgress += deltaTime;
      if (meshComponent.root._playAnim) {
        meshComponent.root._playAnim('build');
      }
      const totalTime = builderComponent.buildTargetSP !== null ? 2 : 3;
      if (builderComponent.buildProgress >= totalTime) {
        _builderFinish(world, id, builderComponent);
      }
      continue;
    }
    if (builderComponent.moveTarget) {
      const dx = builderComponent.moveTarget.x - meshComponent.root.position.x;
      const dz = builderComponent.moveTarget.z - meshComponent.root.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < .3) {
        builderComponent.moveTarget = null;
        if ((builderComponent.buildTarget || builderComponent.buildTargetSP !== null) && !builderComponent.isBuilding) {
          builderComponent.isBuilding = true;
        }
      } else {
        const inverse = 1 / distance;
        meshComponent.root.position.x += dx * inverse * builderComponent.speed * deltaTime;
        meshComponent.root.position.z += dz * inverse * builderComponent.speed * deltaTime;
        meshComponent.root.position.x = Math.max(-currentBounds(), Math.min(currentBounds(), meshComponent.root.position.x));
        meshComponent.root.position.z = Math.max(-currentBounds(), Math.min(currentBounds(), meshComponent.root.position.z));
        meshComponent.root.rotation.y = Math.atan2(dx, dz);
        if (meshComponent.root._playAnim) {
          meshComponent.root._playAnim('run');
        }
        builderComponent.walkTime += deltaTime * 8;
        const sway = Math.sin(builderComponent.walkTime) * .32;
        if (meshComponent.root._legL) {
          meshComponent.root._legL.rotation.x = sway;
          meshComponent.root._legR.rotation.x = -sway;
        }
        if (meshComponent.root._armL) {
          meshComponent.root._armL.rotation.x = -sway;
          meshComponent.root._armR.rotation.x = sway * .5;
        }
      }
    } else {
      if (meshComponent.root._playAnim) {
        meshComponent.root._playAnim('idle');
      }
      if (meshComponent.root._legL) {
        meshComponent.root._legL.rotation.x *= .85;
        meshComponent.root._legR.rotation.x *= .85;
      }
      if (meshComponent.root._armL) {
        meshComponent.root._armL.rotation.x *= .85;
        meshComponent.root._armR.rotation.x *= .85;
      }
    }
  }
}

function _builderCombat(world, b, m, deltaTime) {
  if (b.attackCd === undefined) b.attackCd = 0;
  b.attackCd = Math.max(0, b.attackCd - deltaTime);
  if (b.repairTarget !== null) {
    return;
  }
  const autoEngage = b.attackMove || b.stance === 'ranged';
  if (!autoEngage) {
    return;
  }
  let enemyId = null;
  let minDist = Infinity;
  const aggroRange = b.meleeOrder ? 8 : 14;
  for (const squadId of world.query('squad')) {
    const esq = world.get(squadId, 'squad');
    if (!esq || esq.team === PLAYER) {
      continue;
    }
    const dist = m.root.position.distanceTo(esq.position);
    if (dist < minDist && dist < aggroRange) {
      minDist = dist;
      enemyId = squadId;
    }
  }
  if (enemyId === null) {
    return;
  }
  const esq = world.get(enemyId, 'squad');
  const range = b.meleeOrder ? Math.min(b.attackRange, 3.5) : b.attackRange;
  if (minDist <= range) {
    b.moveTarget = null;
    m.root.rotation.y = Math.atan2(esq.position.x - m.root.position.x, esq.position.z - m.root.position.z);
    if (b.attackCd <= 0) {
      const soldierId = esq.soldiers.find((sid) => sid !== null && world.has(sid, 'soldier'));
      if (soldierId !== undefined) {
        _soldierTakeDamage(world, soldierId, b.attackDamage);
        const smc = world.get(soldierId, 'mesh');
        if (smc) {
          spawnParticles(smc.root.position, new THREE.Color(1, 0.5, 0), 4);
        }
        b.attackCd = 1.0;
      }
    }
  } else if (b.moveTarget === null) {
    b.moveTarget = esq.position.clone();
  }
}

function _builderRepair(world, b, m, deltaTime) {
  if (b.repairTarget === null) {
    return;
  }
  const comp = world.get(b.repairTarget, 'building') || world.get(b.repairTarget, 'structure') || world.get(b.repairTarget, 'vehicle') || world.get(b.repairTarget, 'airfield');
  if (!comp) {
    b.repairTarget = null;
    return;
  }
  const maxHp = comp.maxHp || comp.hp;
  const dist = m.root.position.distanceTo(comp.position);
  if (dist > 3.5) {
    b.moveTarget = comp.position.clone();
    return;
  }
  b.moveTarget = null;
  b.attackMove = false;
  if (b.repairPulseT === undefined) b.repairPulseT = 0;
  b.repairPulseT += deltaTime;
  if (m.root._playAnim) {
    m.root._playAnim('repair');
  }
  if (b.repairPulseT >= 0.2) {
    b.repairPulseT = 0;
    comp.hp = Math.min(maxHp, comp.hp + 10);
    spawnParticles(comp.position.clone().add(new THREE.Vector3(0, 1.2, 0)), new THREE.Color(0.3, 1, 0.4), 2);
    if (comp.hp >= maxHp) {
      b.repairTarget = null;
    }
  }
}

function _builderFinish(world, id, builderComponent) {
  if (builderComponent.buildTargetSP !== null) {
    const strategicPoint = world.get(builderComponent.buildTargetSP, 'strategicPoint');
    if (strategicPoint && strategicPoint.owner === builderComponent.team && !strategicPoint.hasListeningPost) {
      setRequisition(requisition - COSTS.listeningPost);
      strategicPoint.hasListeningPost = true;
      strategicPoint.lpTier = 1;
      strategicPoint.faction = builderComponent.faction;
      strategicPoint.lpMesh = buildListeningPostMesh(strategicPoint.position, builderComponent.team, { listeningPostEntityId: builderComponent.buildTargetSP, faction: builderComponent.faction });
    }
    builderComponent.buildTargetSP = null;
  } else if (builderComponent.buildTarget) {
    const { type, position, pendingEntityId } = builderComponent.buildTarget;
    if (pendingEntityId !== undefined) {
      const comp = world.get(pendingEntityId, 'building') || world.get(pendingEntityId, 'structure') || world.get(pendingEntityId, 'airfield');
      if (comp) {
        if (!comp.constructing) {
          setRequisition(requisition - COSTS[type]);
          comp.constructProgress = 0;
        }
        comp.constructing = true;
      }
    } else {
      if (type === 'barracks' || type === 'infantry_command') {
        createBuildingEntity(world, type, position, builderComponent.team, builderComponent.faction);
      } else if (['tower', 'turret', 'thermoGen', 'towerBase', 'gunTurret', 'plasma_generator', 'tactica_control', 'mars_pattern', 'thermo_generator', 'mines'].includes(type)) {
        createStructureEntity(world, type, position, builderComponent.faction, builderComponent.team);
      } else if (type === 'mechanized') {
        createBuildingEntity(world, type, position, builderComponent.team, builderComponent.faction);
      }
    }
    builderComponent.buildTarget = null;
  }
  builderComponent.buildProgress = 0;
  builderComponent.isBuilding = false;
  updateHUD();
}

export function systemBuilding(world, deltaTime) {
  for (const id of world.query('building', 'mesh')) {
    const buildingComponent = world.get(id, 'building');
    const meshComponent = world.get(id, 'mesh');
    if (!buildingComponent || !meshComponent) {
      continue;
    }
    if (buildingComponent.constructing) {
      buildingComponent.constructProgress += deltaTime;
      if (meshComponent.root && meshComponent.scaffold) {
        const pulse = 0.85 + 0.15 * Math.sin(buildingComponent.constructProgress * 6);
        childMeshes(meshComponent.root).forEach((m) => {
          if (m.material && !m._isSelRingBar) {
            m.material.opacity = pulse * 0.38;
            m.material.transparent = true;
          }
        });
      }
      if (meshComponent.constructBar) {
        meshComponent.constructBar.visible = !structuresHidden;
        meshComponent.constructBar.position.copy(buildingComponent.position);
        meshComponent.constructBar.position.y = 5.5;
        updateHpBar(meshComponent.constructBar, Math.min(1, buildingComponent.constructProgress / buildingComponent.constructTime));
      }
      if (buildingComponent.constructProgress >= buildingComponent.constructTime) {
        if (!window._multiplayerMode) {
          _finishConstruction(world, id, buildingComponent, 'building');
        }
      }
      continue;
    }
    if (buildingComponent.type === 'mechanized' && buildingComponent.researchQueue && buildingComponent.researchQueue.length > 0) {
      const item = buildingComponent.researchQueue[0];
      item.progress += deltaTime;
      if (item.progress >= item.total) {
        buildingComponent.researchQueue.shift();
        setResearchedTech(item.key);
        updateHUD();
      }
    }
    if (buildingComponent.queue.length > 0) {
      buildingComponent.queue[0].progress += deltaTime;
      if (buildingComponent.queue[0].progress >= buildingComponent.queue[0].total) {
        if (!window._multiplayerMode) {
          const type = buildingComponent.queue[0].type;
          buildingComponent.queue.shift();
          const spawnPt = new THREE.Vector3(buildingComponent.position.x - 6, 0, buildingComponent.position.z);
          if (type === 'squad') {
            const squadId = createSquadEntity(world, buildingComponent.team, spawnPt.x, spawnPt.z, 5, null, buildingComponent.faction);
            if (buildingComponent.rallyPoint) {
              const squadComponent = world.get(squadId, 'squad');
              if (squadComponent) {
                squadComponent.moveOrder = buildingComponent.rallyPoint.clone();
              }
            }
          } else if (type === 'builder') {
            const builderId = createBuilderEntity(world, spawnPt.x, spawnPt.z, buildingComponent.team, buildingComponent.faction);
            if (buildingComponent.rallyPoint) {
              const builderComponent = world.get(builderId, 'builder');
              if (builderComponent) {
                builderComponent.moveTarget = buildingComponent.rallyPoint.clone();
              }
            }
          } else if (buildingComponent.type === 'mechanized') {
            const item = (buildingComponent.production || []).find((p) => p.name === type);
            if (item?.model) {
              const vehicleId = createVehicleEntity(world, buildingComponent.team, item.name, item.model, item.icon, spawnPt, item.projectileType, buildingComponent.faction);
              if (buildingComponent.rallyPoint) {
                const vehicleComponent = world.get(vehicleId, 'vehicle');
                if (vehicleComponent) {
                  vehicleComponent.moveOrder = buildingComponent.rallyPoint.clone();
                }
              }
            }
          } else {
            const unitConfig = FACTIONS[resolveFactionKey(buildingComponent.faction, playerFaction)]?.units?.find((u) => u.name === type);
            const squadId = unitConfig
              ? createSquadEntity(world, buildingComponent.team, spawnPt.x, spawnPt.z, unitConfig.size || 1, type, buildingComponent.faction)
              : createSquadEntity(world, buildingComponent.team, spawnPt.x, spawnPt.z, 5, null, buildingComponent.faction);
            if (buildingComponent.rallyPoint) {
              const squadComponent = world.get(squadId, 'squad');
              if (squadComponent) {
                squadComponent.moveOrder = buildingComponent.rallyPoint.clone();
              }
            }
          }
          updateHUD();
        }
      }
    }
    if (!buildingComponent.constructing) {
      meshComponent.hpBar.position.copy(buildingComponent.position);
      meshComponent.hpBar.position.y = 4.5;
      updateHpBar(meshComponent.hpBar, buildingComponent.hp / buildingComponent.maxHp);
    }
  }
}

export function systemStructure(world, deltaTime) {
  for (const id of world.query('structure', 'mesh')) {
    const structureComponent = world.get(id, 'structure');
    const meshComponent = world.get(id, 'mesh');
    if (!structureComponent || !meshComponent) {
      continue;
    }
    if (structureComponent.constructing) {
      structureComponent.constructProgress += deltaTime;
      if (meshComponent.root && meshComponent.scaffold) {
        const pulse = 0.85 + 0.15 * Math.sin(structureComponent.constructProgress * 6);
        childMeshes(meshComponent.root).forEach((m) => {
          if (m.material && !m._isSelRingBar) {
            m.material.opacity = pulse * 0.38;
            m.material.transparent = true;
          }
        });
      }
      if (meshComponent.constructBar) {
        meshComponent.constructBar.visible = !structuresHidden;
        meshComponent.constructBar.position.copy(structureComponent.position);
        meshComponent.constructBar.position.y = 5.5;
        updateHpBar(meshComponent.constructBar, Math.min(1, structureComponent.constructProgress / structureComponent.constructTime));
      }
      if (structureComponent.constructProgress >= structureComponent.constructTime) {
        _finishConstruction(world, id, structureComponent, 'structure');
      }
      continue;
    }
    if (['tower', 'turret', 'towerBase', 'gunTurret'].includes(structureComponent.type)) {
      structureComponent.attackCd = Math.max(0, structureComponent.attackCd - deltaTime);
      let closest = null;
      let minDistance = Infinity;
      for (const squadId of world.query('squad')) {
        const squadComponent = world.get(squadId, 'squad');
        if (!squadComponent || squadComponent.team === structureComponent.team) {
          continue;
        }
        for (const soldierId of squadComponent.soldiers) {
          if (soldierId === null || !world.has(soldierId, 'soldier')) {
            continue;
          }
          const soldierMeshComponent = world.get(soldierId, 'mesh');
          if (!soldierMeshComponent) {
            continue;
          }
          const distance = structureComponent.position.distanceTo(soldierMeshComponent.root.position);
          if (distance < minDistance && distance <= structureComponent.attackRange) {
            minDistance = distance;
            closest = soldierId;
          }
        }
      }
      if (closest) {
        const enemyMeshComponent = world.get(closest, 'mesh');
        if (enemyMeshComponent) {
          const dx = enemyMeshComponent.root.position.x - structureComponent.position.x;
          const dz = enemyMeshComponent.root.position.z - structureComponent.position.z;
          if (meshComponent.root._turret) {
            meshComponent.root._turret.rotation.y = Math.atan2(dx, dz);
          }
          if (structureComponent.attackCd <= 0) {
            const fakeFiringPos = meshComponent.root._turret ? meshComponent.root._turret.absolutePosition.clone() : structureComponent.position.clone();
            if (structureComponent.type === 'gunTurret') {
              const angle = meshComponent.root._turret ? meshComponent.root._turret.rotation.y : 0;
              const px = Math.cos(angle);
              const pz = -Math.sin(angle);
              const leftPosition = fakeFiringPos.clone();
              leftPosition.x -= px * 0.38;
              leftPosition.z -= pz * 0.38;
              const rightPosition = fakeFiringPos.clone();
              rightPosition.x += px * 0.38;
              rightPosition.z += pz * 0.38;
              createBulletEntity(world, leftPosition, structureComponent.team, id, closest);
              createBulletEntity(world, rightPosition, structureComponent.team, id, closest);
              if (meshComponent.root._muzzleMatL) {
                meshComponent.root._muzzleMatL.opacity = 0.9;
                meshComponent.root._muzzleMatL.transparent = true;
                meshComponent.root._muzzleMatL.color.setRGB(1, 0.6, 0);
              }
              if (meshComponent.root._muzzleMatR) {
                meshComponent.root._muzzleMatR.opacity = 0.9;
                meshComponent.root._muzzleMatR.transparent = true;
                meshComponent.root._muzzleMatR.color.setRGB(1, 0.6, 0);
              }
              setTimeout(() => {
                if (meshComponent.root._muzzleMatL) {
                  meshComponent.root._muzzleMatL.opacity = 0;
                  meshComponent.root._muzzleMatL.transparent = true;
                }
                if (meshComponent.root._muzzleMatR) {
                  meshComponent.root._muzzleMatR.opacity = 0;
                  meshComponent.root._muzzleMatR.transparent = true;
                }
              }, 60);
            } else {
              createBulletEntity(world, fakeFiringPos, PLAYER, id, closest);
            }
            structureComponent.attackCd = 1 / structureComponent.attackRate;
          }
        }
      }
      if (meshComponent.root._coin) {
        meshComponent.root._coin.rotation.y += deltaTime * 2;
      }
      const hpBarY = structureComponent.type === 'towerBase' ? 6 : structureComponent.type === 'gunTurret' ? 4.5 : 8.5;
      meshComponent.hpBar.position.copy(structureComponent.position);
      meshComponent.hpBar.position.y = hpBarY;
      updateHpBar(meshComponent.hpBar, structureComponent.hp / structureComponent.maxHp);
    } else {
      structureComponent.pulseT += deltaTime;
      const pulse = Math.sin(structureComponent.pulseT * 3) * .5 + .5;
      if (meshComponent.root._coreGlowMat) {
        // HQ glow is a lit material (emissive), plasma-generator core is unlit (color).
        const coreGlowMat = meshComponent.root._coreGlowMat;
        if (coreGlowMat.isMeshStandardMaterial) {
          coreGlowMat.emissive.setRGB(0, 0.67 + pulse * .33, 0.27 + pulse * .27);
        } else if (coreGlowMat.color) {
          coreGlowMat.color.setRGB(0, 0.67 + pulse * .33, 0.27 + pulse * .27);
        }
      }
      if (meshComponent.root._meter) {
        meshComponent.root._meter.material.opacity = .4 + pulse * .6;
        meshComponent.root._meter.material.transparent = true;
        meshComponent.root._meter.rotation.y += deltaTime * 2;
      }
      if (['thermoGen', 'thermo_generator', 'plasma_generator'].includes(structureComponent.type)) {
        structureComponent.energyTimer += deltaTime * (PLASMA_RATE_PER * 0.1);
        if (structureComponent.energyTimer >= 1) {
          const gained = Math.floor(structureComponent.energyTimer);
          structureComponent.energyTimer -= gained;
          setEnergy(Math.min(10000, energy + gained));
        }
      }
      if (structureComponent.type === 'tactica_control' && structureComponent.researchQueue && structureComponent.researchQueue.length > 0) {
        const item = structureComponent.researchQueue[0];
        item.progress += deltaTime;
        if (item.progress >= item.total) {
          structureComponent.researchQueue.shift();
          setResearchedTech(item.key);
          updateHUD();
        }
      }
      meshComponent.hpBar.position.copy(structureComponent.position);
      meshComponent.hpBar.position.y = 6.5;
      updateHpBar(meshComponent.hpBar, structureComponent.hp / structureComponent.maxHp);
    }
  }
}

export function systemStrategicPoint(world, deltaTime) {
  const capturingSpIds = new Set();
  const capturingFactions = new Map();
  for (const squadId of world.query('squad')) {
    const squad = world.get(squadId, 'squad');
    if (squad?.capturingSpId != null) {
      capturingSpIds.add(squad.capturingSpId);
      if (!capturingFactions.has(squad.capturingSpId)) {
        capturingFactions.set(squad.capturingSpId, squad.faction);
      }
    }
  }
  for (const id of world.query('strategicPoint', 'mesh')) {
    const strategicPoint = world.get(id, 'strategicPoint');
    const meshComponent = world.get(id, 'mesh');
    if (!strategicPoint || !meshComponent) {
      continue;
    }
    const beingCaptured = capturingSpIds.has(id);
    if (strategicPoint.owner == null && !beingCaptured) {
      strategicPoint.raiseFrom = null;
    }
    if (meshComponent.model && meshComponent.model._playAnim) {
      const decision = nextStrategicPointAnim({
        owner: strategicPoint.owner,
        beingCaptured,
        animState: strategicPoint._animState,
        currentAnim: meshComponent.model._currentAnim,
        progress: strategicPoint.captureProgress,
        planted: strategicPoint.raiseFrom != null,
        raiseFrom: strategicPoint.raiseFrom,
      });
      strategicPoint._animState = decision.state;
      if (decision.scrub != null && meshComponent.model._scrubAnim) {
        meshComponent.model._scrubAnim(decision.play, decision.scrub);
      } else if (decision.play) {
        meshComponent.model._playAnim(decision.play, decision.loop);
      }
    }
    if (meshComponent.model) {
      updatePointFlag(meshComponent.model, {
        faction: capturingFactions.get(id) ?? strategicPoint.faction ?? null,
        show: shouldShowCaptureFlag({
          engaged: capturingSpIds.has(id),
          owner: strategicPoint.owner,
          progress: strategicPoint.captureProgress,
        }),
      });
    }
    if (strategicPoint.researchQueue && strategicPoint.researchQueue.length > 0) {
      const item = strategicPoint.researchQueue[0];
      item.progress += deltaTime;
      if (item.progress >= item.total) {
        strategicPoint.researchQueue.shift();
        if (item.key === 'fortified_position') {
          strategicPoint.lpTier = 2;
        } else if (item.key === 'heavily_fortified_position') {
          strategicPoint.lpTier = 3;
        }
        updateHUD();
      }
    }
  }
}

function _strategicPointUpdateOwner(world, spId, strategicPoint, faction = null) {
  let newOwner = null;
  if (strategicPoint.captureProgress >= 1) {
    newOwner = PLAYER;
  } else if (strategicPoint.captureProgress <= -1) {
    newOwner = 'red';
  }
  if (newOwner !== strategicPoint.owner) {
    strategicPoint.owner = newOwner;
    strategicPoint.faction = newOwner == null ? null : faction;
    const meshComponent = world.get(spId, 'mesh');
    if (meshComponent && meshComponent.gemMat) {
      if (strategicPoint.owner === PLAYER) {
        meshComponent.gemMat.color.setRGB(.13, .4, 1);
        meshComponent.gemMat.emissive.setRGB(0, 0.07, .27);
        meshComponent.gemMat.emissiveIntensity = 2;
      } else if (strategicPoint.owner === 'red') {
        meshComponent.gemMat.color.setRGB(.87, .13, .07);
        meshComponent.gemMat.emissive.setRGB(.33, 0, 0);
        meshComponent.gemMat.emissiveIntensity = 2;
      } else {
        meshComponent.gemMat.color.setRGB(1, 1, 1);
        meshComponent.gemMat.emissive.setRGB(.2, .2, .2);
        meshComponent.gemMat.emissiveIntensity = 1;
      }
    }
  }
  const meshComponent = world.get(spId, 'mesh');
  if (meshComponent && meshComponent.capRing && meshComponent.capRingMat) {
    const time = (strategicPoint.captureProgress + 1) / 2;
    const r = time > .5 ? 0.13 : 0.87;
    const g = time > .5 ? 0.4 : 0.13;
    const b = time > .5 ? 1 : 0.07;
    meshComponent.capRingMat.color.setRGB(r, g, b);
    meshComponent.capRingMat.opacity = .35 + .45 * Math.abs(strategicPoint.captureProgress);
    meshComponent.capRingMat.transparent = true;
    const scale = .3 + .7 * Math.abs(strategicPoint.captureProgress);
    meshComponent.capRing.scale.set(scale, 1, scale);
  }
}

export function systemBullet(world, deltaTime) {
  if (window._multiplayerMode) {
    return;
  }
  for (const id of world.query('bullet', 'mesh')) {
    const bulletComponent = world.get(id, 'bullet');
    const meshComponent = world.get(id, 'mesh');
    if (!bulletComponent || !meshComponent) {
      continue;
    }
    // Plasma (and any future typed projectile sharing the 'bullet' component)
    // is owned by its own system; processing it here too would age/move it
    // twice per frame and kill it mid-flight with gravity it never should take.
    if (bulletComponent.projectileType && bulletComponent.projectileType !== 'bullet') {
      continue;
    }
    bulletComponent.age += deltaTime;
    if (bulletComponent.age > 2) {
      _bulletDestroy(world, id, meshComponent);
      continue;
    }
    bulletComponent.vy -= 6 * deltaTime;
    meshComponent.root.position.x += bulletComponent.vx * deltaTime;
    meshComponent.root.position.y += bulletComponent.vy * deltaTime;
    meshComponent.root.position.z += bulletComponent.vz * deltaTime;
    meshComponent.root.rotation.y = Math.atan2(bulletComponent.vx, bulletComponent.vz);
    const targetMeshComponent = world.get(bulletComponent.targetId, 'mesh');
    if (targetMeshComponent && world.has(bulletComponent.targetId, 'soldier')) {
      const distance = meshComponent.root.position.distanceTo(targetMeshComponent.root.position);
      if (distance < .6) {
        _soldierTakeDamage(world, bulletComponent.targetId, bulletComponent.damage);
        spawnParticles(meshComponent.root.position, new THREE.Color(.87, .67, 0), 3);
        _bulletDestroy(world, id, meshComponent);
        continue;
      }
    }
    if (meshComponent.root.position.y < .05) {
      _bulletDestroy(world, id, meshComponent);
    }
    if (bulletComponent.team !== PLAYER) {
      for (const apcId of world.query('apc')) {
        const apc = world.get(apcId, 'apc');
        if (!apc || apc.team !== PLAYER) {
          continue;
        }
        const distance = meshComponent.root.position.distanceTo(apc.position);
        if (distance < 2.5) {
          apc.hp -= bulletComponent.damage * 0.4;
          _bulletDestroy(world, id, meshComponent);
          break;
        }
      }
      for (const vehicleId of world.query('vehicle')) {
        const vehicle = world.get(vehicleId, 'vehicle');
        if (!vehicle || vehicle.team !== PLAYER) {
          continue;
        }
        const distance = meshComponent.root.position.distanceTo(vehicle.position);
        if (distance < 2.5) {
          vehicle.hp -= bulletComponent.damage * 0.4;
          _bulletDestroy(world, id, meshComponent);
          break;
        }
      }
    }
  }
}

function _bulletDestroy(world, id, meshComponent) {
  disposeObj(meshComponent.root);
  world.destroyEntity(id);
}

function _soldierTakeDamage(world, soldierId, damage) {
  const soldierComponent = world.get(soldierId, 'soldier');
  if (!soldierComponent) {
    return;
  }
  if (infantryImmortal) {
    const squadComponent = world.get(soldierComponent.squadId, 'squad');
    if (squadComponent && squadComponent.team === PLAYER) {
      return;
    }
  }
  soldierComponent.hp -= damage;
  soldierComponent.flashTimer = .12;
  if (soldierComponent.hp <= 0) {
    _soldierDie(world, soldierId, true);
  }
}

function disposeSoldierHud(meshComponent) {
  try {
    childMeshes(meshComponent.hpBar).forEach((m) => disposeObj(m));
    disposeObj(meshComponent.hpBar);
  } catch (e) { /* ignore */ }
  if (meshComponent.reloadBar) {
    try {
      childMeshes(meshComponent.reloadBar).forEach((m) => disposeObj(m));
      disposeObj(meshComponent.reloadBar);
    } catch (e) { /* ignore */ }
  }
  if (meshComponent.root) {
    ['_selDisc', '_teamRing', '_selRing'].forEach((key) => {
      const ring = meshComponent.root[key];
      if (ring) {
        try {
          ring.visible = false;
          ring.visible = false;
          disposeObj(ring);
        } catch (e) { /* ignore */ }
      }
    });
    if (meshComponent.root._blobShadow) {
      try {
        meshComponent.root._blobShadow.visible = false;
      } catch (e) { /* ignore */ }
    }
  }
}

function disposeSoldierMeshes(meshComponent) {
  try {
    childMeshes(meshComponent.root).forEach((m) => disposeObj(m));
    disposeObj(meshComponent.root);
  } catch (e) { /* ignore */ }
  disposeSoldierHud(meshComponent);
}

function _soldierDie(world, soldierId, countKill) {
  const soldierComponent = world.get(soldierId, 'soldier');
  const meshComponent = world.get(soldierId, 'mesh');
  if (!soldierComponent) {
    return;
  }
  if (countKill === undefined) {
    countKill = false;
  }
  if (countKill) {
    setKills(kills + 1);
  }
  const team = world.get(soldierComponent.squadId, 'squad')?.team || 'blue';
  if (meshComponent) {
    spawnParticles(meshComponent.root.position, TEAM_COLOR[team].projectile, 8);
    disposeSoldierHud(meshComponent);
    if (meshComponent.root._dieAnims && meshComponent.root._dieAnims.length) {
      const ag = meshComponent.root._dieAnims[Math.floor(Math.random() * meshComponent.root._dieAnims.length)];
      try {
        Object.values(meshComponent.root._animGroups).forEach((g) => {
          try {
            g.stop();
          } catch (e) { /* ignore */ }
        });
        ag.loopAnimation = false;
        ag.onAnimationGroupEndObservable.clear();
        ag.reset();
        ag.start(false, 1.0);
        let disposed = false;
        const disposeAfter = () => {
          if (disposed) {
            return;
          }
          disposed = true;
          disposeSoldierMeshes(meshComponent);
        };
        ag.onAnimationGroupEndObservable.addOnce(disposeAfter);
        setTimeout(disposeAfter, (ag.getDuration() + 1) * 1000);
      } catch (e) {
        console.warn('die anim error', e);
      }
    } else {
      disposeSoldierMeshes(meshComponent);
    }
  }
  const squad = world.get(soldierComponent.squadId, 'squad');
  if (squad) {
    const idx = squad.soldiers.indexOf(soldierId);
    if (idx >= 0) {
      squad.soldiers[idx] = null;
    }
  }
  world.destroyEntity(soldierId);
}

export function systemGrenade(world, deltaTime) {
  for (const id of world.query('grenade', 'mesh')) {
    const grenadeComponent = world.get(id, 'grenade');
    const meshComponent = world.get(id, 'mesh');
    if (!grenadeComponent || !meshComponent) {
      continue;
    }
    grenadeComponent.age += deltaTime;
    meshComponent.root.rotation.x += deltaTime * 7;
    meshComponent.root.rotation.z += deltaTime * 5;
    if (window._multiplayerMode) {
      continue;
    }
    if (grenadeComponent.age > 6) {
      _grenadeExplode(world, id, grenadeComponent, meshComponent);
      continue;
    }
    grenadeComponent.vy -= 16 * deltaTime;
    meshComponent.root.position.x += grenadeComponent.vx * deltaTime;
    meshComponent.root.position.y += grenadeComponent.vy * deltaTime;
    meshComponent.root.position.z += grenadeComponent.vz * deltaTime;
    const smokeTrailTimer = grenadeComponent.smokeAcc !== undefined ? (grenadeComponent.smokeAcc += deltaTime) : (grenadeComponent.smokeAcc = 0);
    if (smokeTrailTimer >= 0.03) {
      grenadeComponent.smokeAcc = 0;
      const smokePos = meshComponent.root.position.clone();
      const smokeMesh = mkBox('smoke', .18, .18, .18);
      smokeMesh.position.copy(smokePos);
      const smokeMat = new THREE.MeshBasicMaterial();
      smokeMat.color = new THREE.Color(.5, .5, .5);
      smokeMat.opacity = .75;
      smokeMat.transparent = true;
      smokeMesh.material = smokeMat;
      particles.push({
        mesh: smokeMesh,
        material: smokeMat,
        vx: (Math.random() - .5) * .5,
        vy: .15 + Math.random() * .35,
        vz: (Math.random() - .5) * .5,
        life: 1.6 + Math.random() * .8,
        age: 0,
        alpha: .75,
        grow: .5 + Math.random() * .4,
        noGravity: true,
      });
    }
    if (meshComponent.root.position.y <= .1) {
      meshComponent.root.position.y = .1;
      _grenadeExplode(world, id, grenadeComponent, meshComponent);
    }
  }
}

function _grenadeExplode(world, id, grenadeComponent, meshComponent) {
  const pos = meshComponent.root.position.clone();
  disposeObj(meshComponent.root);
  world.destroyEntity(id);
  spawnParticles(pos, new THREE.Color(1, .53, 0), 40);
  spawnParticles(pos, new THREE.Color(1, .87, .27), 18);
  spawnParticles(new THREE.Vector3(pos.x, .5, pos.z), new THREE.Color(1, 1, 1), 12);
  [.6, .35].forEach((dur, ri) => {
    const ring = mkDisc('explosion_ring', .45, 32, true);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos);
    ring.position.y = .05;
    const rm = new THREE.MeshBasicMaterial();
    rm.color = ri ? new THREE.Color(1, 1, 1) : new THREE.Color(1, .53, 0);
    rm.opacity = .85;
    rm.transparent = true;
    ring.material = rm;
    let age = 0;
    grenadeCallbacks.push((dt2) => {
      age += dt2;
      const time = age / dur;
      const scale = 1 + time * (ri ? 6 : 12);
      ring.scale.set(scale, scale, scale);
      rm.opacity = .85 * (1 - time);
      rm.transparent = true;
      if (age >= dur) {
        disposeObj(ring);
        return true;
      }
      return false;
    });
  });
  for (const squadId of world.query('squad')) {
    const squadComponent = world.get(squadId, 'squad');
    if (!squadComponent) {
      continue;
    }
    for (const soldierId of squadComponent.soldiers) {
      if (soldierId === null || !world.has(soldierId, 'soldier')) {
        continue;
      }
      const soldierMeshComponent = world.get(soldierId, 'mesh');
      if (!soldierMeshComponent) {
        continue;
      }
      const distance = pos.distanceTo(soldierMeshComponent.root.position);
      if (distance <= grenadeComponent.blastR) {
        const damageAmount = grenadeComponent.blastDmg * (1 - distance / grenadeComponent.blastR);
        _soldierTakeDamage(world, soldierId, damageAmount);
        const soldier = world.get(soldierId, 'soldier');
        if (soldier && soldier.hp > 0) {
          const dx = soldierMeshComponent.root.position.x - pos.x;
          const dz = soldierMeshComponent.root.position.z - pos.z;
          const len = Math.hypot(dx, dz) || 0.01;
          const force = grenadeComponent.scatterF * (1 - distance / grenadeComponent.blastR * .5);
          soldier.scatter = {
            vx: (dx / len) * force,
            vy: 4 + Math.random() * 4,
            vz: (dz / len) * force,
            time: 0,
          };
          soldier.stagger = 0;
          soldierMeshComponent.hpBar.visible = false;
        }
      }
    }
  }
}

export function systemApc(world, deltaTime) {
  for (const id of world.query('apc', 'mesh')) {
    const apc = world.get(id, 'apc');
    const meshComponent = world.get(id, 'mesh');
    if (!apc || !meshComponent) {
      continue;
    }
    apc.selected = selSquads.includes(id);
    if (apc.queue && apc.queue.length > 0) {
      apc.queue[0].progress += deltaTime;
      if (apc.queue[0].progress >= apc.queue[0].total) {
        apc.queue.shift();
        updateHUD();
      }
    }
    if (apc.moveOrder) {
      const dx = apc.moveOrder.x - apc.position.x;
      const dz = apc.moveOrder.z - apc.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 1) {
        apc.moveOrder = null;
      } else {
        const inverse = 1 / distance;
        apc.position.x += dx * inverse * apc.speed * deltaTime;
        apc.position.z += dz * inverse * apc.speed * deltaTime;
        apc.position.x = Math.max(-currentBounds(), Math.min(currentBounds(), apc.position.x));
        apc.position.z = Math.max(-currentBounds(), Math.min(currentBounds(), apc.position.z));
        meshComponent.root.rotation.y = Math.atan2(dx * inverse, dz * inverse);
      }
    }
    meshComponent.root.position.copy(apc.position);
    for (const passId of apc.passengers) {
      const squadComponent = world.get(passId, 'squad');
      const builderComponent = world.get(passId, 'builder');
      if (squadComponent) {
        squadComponent.position.copy(apc.position);
      }
      if (builderComponent) {
        const builderMeshComponent = world.get(passId, 'mesh');
        if (builderMeshComponent?.root) {
          builderMeshComponent.root.position.copy(apc.position);
        }
      }
    }
    apc.attackCd = Math.max(0, apc.attackCd - deltaTime);
    let closest = null;
    let minDistance = Infinity;
    for (const squadId of world.query('squad')) {
      const squadComponent = world.get(squadId, 'squad');
      if (!squadComponent || squadComponent.team === apc.team) {
        continue;
      }
      for (const soldierId of squadComponent.soldiers) {
        if (soldierId === null || !world.has(soldierId, 'soldier')) {
          continue;
        }
        const soldierMeshComponent = world.get(soldierId, 'mesh');
        if (!soldierMeshComponent) {
          continue;
        }
        const distance = apc.position.distanceTo(soldierMeshComponent.root.position);
        if (distance < minDistance && distance <= apc.attackRange) {
          minDistance = distance;
          closest = soldierId;
        }
      }
    }
    if (closest) {
      const enemyMeshComponent = world.get(closest, 'mesh');
      if (enemyMeshComponent && meshComponent.root._turret) {
        const dx = enemyMeshComponent.root.position.x - apc.position.x;
        const dz = enemyMeshComponent.root.position.z - apc.position.z;
        meshComponent.root._turret.rotation.y = Math.atan2(dx, dz);
        if (minDistance > apc.attackRange * .85 && !apc.moveOrder && !apc.selected) {
          const enemyPosition = enemyMeshComponent.root.position;
          apc.moveOrder = new THREE.Vector3(enemyPosition.x, 0, enemyPosition.z);
        }
      }
      if (apc.attackCd <= 0) {
        const projectileType = apc.projectileType || 'laser';
        if (projectileType === 'bullet') {
          createBulletEntity(world, apc.position, apc.team, id, closest);
        } else if (projectileType === 'plasma') {
          createPlasmaBulletEntity(world, apc.position, apc.team, id, closest);
        } else {
          createLaserBulletEntity(world, apc.position, apc.team, id, closest);
        }
        const laserSlowdown = projectileType === 'laser' ? 2.5 : 1;
        apc.attackCd = (1 / apc.attackRate) * laserSlowdown;
        apc.laserPulse = 0.08;
      }
    }
    if (apc.laserPulse > 0) {
      apc.laserPulse -= deltaTime;
      if (meshComponent.root._laserTipMat) {
        meshComponent.root._laserTipMat.emissive.setRGB(1, 0, 0);
      }
    } else {
      if (meshComponent.root._laserTipMat) {
        meshComponent.root._laserTipMat.emissive.setRGB(.4, 0, 0);
      }
    }
    meshComponent.hpBar.position.copy(apc.position);
    meshComponent.hpBar.position.y = 3.5;
    updateHpBar(meshComponent.hpBar, apc.hp / apc.maxHp);
    if (apc.hp <= 0) {
      _apcEjectPassengers(world, apc);
      spawnParticles(apc.position.clone(), new THREE.Color(1, .53, 0), 30);
      disposeMeshComponent(meshComponent);
      if (selSquads.includes(id)) {
        setSelSquads(selSquads.filter((s) => s !== id));
      }
      world.destroyEntity(id);
    }
  }
}

export function systemVehicle(world, deltaTime) {
  for (const id of world.query('vehicle', 'mesh')) {
    const vehicle = world.get(id, 'vehicle');
    const meshComponent = world.get(id, 'mesh');
    if (!vehicle || !meshComponent) {
      continue;
    }
    vehicle.selected = selSquads.includes(id);
    if (vehicle.moveOrder) {
      const dx = vehicle.moveOrder.x - vehicle.position.x;
      const dz = vehicle.moveOrder.z - vehicle.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 1) {
        vehicle.moveOrder = null;
      } else {
        const inverse = 1 / distance;
        vehicle.position.x += dx * inverse * vehicle.speed * deltaTime;
        vehicle.position.z += dz * inverse * vehicle.speed * deltaTime;
        vehicle.position.x = Math.max(-currentBounds(), Math.min(currentBounds(), vehicle.position.x));
        vehicle.position.z = Math.max(-currentBounds(), Math.min(currentBounds(), vehicle.position.z));
        meshComponent.root.rotation.y = Math.atan2(dx * inverse, dz * inverse);
      }
    }
    meshComponent.root.position.copy(vehicle.position);
    vehicle.attackCd = Math.max(0, vehicle.attackCd - deltaTime);
    let closest = null;
    let minDistance = Infinity;
    for (const squadId of world.query('squad')) {
      const squadComponent = world.get(squadId, 'squad');
      if (!squadComponent || squadComponent.team === vehicle.team) {
        continue;
      }
      for (const soldierId of squadComponent.soldiers) {
        if (soldierId === null || !world.has(soldierId, 'soldier')) {
          continue;
        }
        const soldierMeshComponent = world.get(soldierId, 'mesh');
        if (!soldierMeshComponent) {
          continue;
        }
        const distance = vehicle.position.distanceTo(soldierMeshComponent.root.position);
        if (distance < minDistance && distance <= vehicle.attackRange) {
          minDistance = distance;
          closest = soldierId;
        }
      }
    }
    if (closest) {
      const enemyMeshComponent = world.get(closest, 'mesh');
      if (enemyMeshComponent && meshComponent.root._turret) {
        const dx = enemyMeshComponent.root.position.x - vehicle.position.x;
        const dz = enemyMeshComponent.root.position.z - vehicle.position.z;
        meshComponent.root._turret.rotation.y = Math.atan2(dx, dz);
      }
      if (vehicle.attackCd <= 0) {
        const projectileType = vehicle.projectileType || 'laser';
        if (projectileType === 'beam') {
          createBeamEntity(world, vehicle.position, vehicle.team, id, closest);
        } else if (projectileType === 'bullet') {
          createBulletEntity(world, vehicle.position, vehicle.team, id, closest);
        } else {
          createLaserBulletEntity(world, vehicle.position, vehicle.team, id, closest);
        }
        const laserSlowdown = (projectileType === 'laser' || projectileType === 'beam') ? 2.5 : 1;
        vehicle.attackCd = (1 / vehicle.attackRate) * laserSlowdown;
        vehicle.laserPulse = 0.08;
      }
    }
    if (vehicle.laserPulse > 0) {
      vehicle.laserPulse -= deltaTime;
      if (meshComponent.root._laserTipMat) {
        meshComponent.root._laserTipMat.emissive.setRGB(1, 0, 0);
      }
    } else if (meshComponent.root._laserTipMat) {
      meshComponent.root._laserTipMat.emissive.setRGB(.4, 0, 0);
    }
    meshComponent.hpBar.position.copy(vehicle.position);
    meshComponent.hpBar.position.y = 3.5;
    updateHpBar(meshComponent.hpBar, vehicle.hp / vehicle.maxHp);
    if (vehicle.hp <= 0) {
      spawnParticles(vehicle.position.clone(), new THREE.Color(1, .53, 0), 30);
      disposeMeshComponent(meshComponent);
      if (selSquads.includes(id)) {
        setSelSquads(selSquads.filter((s) => s !== id));
      }
      world.destroyEntity(id);
    }
  }
}

export function systemStructureCollision(world, deltaTime) {
  const blockers = [];
  for (const id of world.query('building')) {
    const b = world.get(id, 'building');
    if (b) {
      const h = BUILDING_BOUNDS[b.type] ?? 3.5;
      blockers.push([b.position.x, b.position.z, h, h]);
    }
  }
  for (const id of world.query('structure')) {
    const s = world.get(id, 'structure');
    if (s) {
      const h = STRUCTURE_BOUNDS[s.type] ?? 3.5;
      blockers.push([s.position.x, s.position.z, h, h]);
    }
  }
  for (const id of world.query('airfield')) {
    const a = world.get(id, 'airfield');
    if (a) blockers.push([a.position.x, a.position.z, AIRFIELD_BOUNDS, AIRFIELD_BOUNDS]);
  }
  if (blockers.length === 0) {
    return;
  }
  const resolve = (px, pz, r) => {
    for (let i = 0; i < blockers.length; i++) {
      const bx = blockers[i][0];
      const bz = blockers[i][1];
      const hx = blockers[i][2];
      const hz = blockers[i][3];
      const dx = px - bx;
      const dz = pz - bz;
      const ox = hx + r - Math.abs(dx);
      const oz = hz + r - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        if (ox < oz) {
          px += dx > 0 ? ox : -ox;
        } else {
          pz += dz > 0 ? oz : -oz;
        }
      }
    }
    return [px, pz];
  };
  for (const id of world.query('squad')) {
    const s = world.get(id, 'squad');
    if (!s) continue;
    const [nx, nz] = resolve(s.position.x, s.position.z, 0.5);
    s.position.x = nx;
    s.position.z = nz;
  }
  for (const id of world.query('builder', 'mesh')) {
    const b = world.get(id, 'builder');
    const m = world.get(id, 'mesh');
    if (!b || !m || b.isBuilding) continue;
    const [nx, nz] = resolve(m.root.position.x, m.root.position.z, 0.5);
    m.root.position.x = nx;
    m.root.position.z = nz;
  }
  for (const id of world.query('apc')) {
    const a = world.get(id, 'apc');
    if (!a) continue;
    const [nx, nz] = resolve(a.position.x, a.position.z, 1.2);
    a.position.x = nx;
    a.position.z = nz;
  }
  for (const id of world.query('vehicle')) {
    const v = world.get(id, 'vehicle');
    if (!v) continue;
    const [nx, nz] = resolve(v.position.x, v.position.z, 1);
    v.position.x = nx;
    v.position.z = nz;
  }
}

export function _apcEjectPassengers(world, apc) {
  const toUnload = [...apc.passengers];
  apc.passengers = [];
  toUnload.forEach((uid, i) => {
    const squadComponent = world.get(uid, 'squad');
    const builderComponent = world.get(uid, 'builder');
    const offset = new THREE.Vector3((i - (toUnload.length - 1) / 2) * 5, 0, 3);
    if (squadComponent) {
      squadComponent.position.set(apc.position.x + offset.x, 0, apc.position.z + offset.z);
      squadComponent.stopped = false;
      squadComponent.soldiers.forEach((soldierId) => {
        if (soldierId) {
          const soldierMeshComponent = world.get(soldierId, 'mesh');
          if (soldierMeshComponent) {
            soldierMeshComponent.root.visible = true;
            soldierMeshComponent.root.position.copy(squadComponent.position);
          }
        }
      });
      const squadMeshComponent = world.get(uid, 'mesh');
      if (squadMeshComponent?.hpBar) {
        squadMeshComponent.hpBar.visible = true;
      }
    }
    if (builderComponent) {
      const builderMeshComponent = world.get(uid, 'mesh');
      if (builderMeshComponent?.root) {
        builderMeshComponent.root.visible = true;
        builderMeshComponent.root.position.set(apc.position.x + offset.x, 0, apc.position.z + offset.z);
      }
    }
  });
}

export function systemLaserBullet(world, deltaTime) {
  if (window._multiplayerMode) {
    return;
  }
  for (const id of world.query('laserBullet', 'mesh')) {
    const bulletComponent = world.get(id, 'laserBullet');
    const meshComponent = world.get(id, 'mesh');
    if (!bulletComponent || !meshComponent) {
      continue;
    }
    bulletComponent.age += deltaTime;
    if (bulletComponent.age > 1.5) {
      disposeObj(meshComponent.root);
      world.destroyEntity(id);
      continue;
    }
    meshComponent.root.position.x += bulletComponent.vx * deltaTime;
    meshComponent.root.position.y += bulletComponent.vy * deltaTime;
    meshComponent.root.position.z += bulletComponent.vz * deltaTime;
    meshComponent.root.rotation.y = Math.atan2(bulletComponent.vx, bulletComponent.vz);
    const targetMeshComponent = world.get(bulletComponent.targetId, 'mesh');
    if (targetMeshComponent && world.has(bulletComponent.targetId, 'soldier')) {
      const distance = meshComponent.root.position.distanceTo(targetMeshComponent.root.position);
      if (distance < .8) {
        _soldierTakeDamage(world, bulletComponent.targetId, bulletComponent.damage);
        spawnParticles(meshComponent.root.position, new THREE.Color(1, 0, 0), 5);
        disposeObj(meshComponent.root);
        world.destroyEntity(id);
        continue;
      }
    }
  }
}

export function systemBeam(world, deltaTime) {
  for (const id of world.query('beam', 'mesh')) {
    const beamComponent = world.get(id, 'beam');
    const meshComponent = world.get(id, 'mesh');
    if (!beamComponent || !meshComponent) {
      continue;
    }
    beamComponent.age += deltaTime;
    if (!beamComponent.hit) {
      const targetMeshComponent = world.get(beamComponent.targetId, 'mesh');
      if (targetMeshComponent && world.has(beamComponent.targetId, 'soldier')) {
        _soldierTakeDamage(world, beamComponent.targetId, beamComponent.damage);
        // spawnParticles(meshComponent.root.position, new THREE.Color(1, 0, 0), 5);
        beamComponent.hit = true;
      }
    }
    if (meshComponent.lightning) {
      if (!meshComponent.lightning.update(deltaTime)) {
        meshComponent.lightning.dispose();
        world.destroyEntity(id);
      }
      continue;
    }
    const fade = Math.max(0, 1 - beamComponent.age / 0.18);
    if (meshComponent.root.material) {
      meshComponent.root.material.opacity = fade * 0.92;
      meshComponent.root.material.transparent = true;
    }
    if (beamComponent.age > 0.18) {
      disposeObj(meshComponent.root);
      world.destroyEntity(id);
    }
  }
}

export function systemReaperBullet(world, deltaTime) {
  for (const id of world.query('bullet', 'mesh')) {
    const bulletComponent = world.get(id, 'bullet');
    if (!bulletComponent || bulletComponent.projectileType?.toLowerCase() !== 'reaper') {
      continue;
    }
    const meshComponent = world.get(id, 'mesh');
    if (!meshComponent) {
      continue;
    }
    bulletComponent.age += deltaTime;
    _boltLookTarget.set(
      meshComponent.root.position.x + bulletComponent.vx,
      meshComponent.root.position.y + bulletComponent.vy,
      meshComponent.root.position.z + bulletComponent.vz,
    );
    meshComponent.root.lookAt(_boltLookTarget);
    if (window._multiplayerMode) {
      continue;
    }
    if (bulletComponent.age > 2.5) {
      disposeObj(meshComponent.root);
      world.destroyEntity(id);
      continue;
    }
    meshComponent.root.position.x += bulletComponent.vx * deltaTime;
    meshComponent.root.position.y += bulletComponent.vy * deltaTime;
    meshComponent.root.position.z += bulletComponent.vz * deltaTime;
    const targetMeshComponent = world.get(bulletComponent.targetId, 'mesh');
    if (targetMeshComponent && world.has(bulletComponent.targetId, 'soldier')) {
      // Troops anchor at the feet while the bolt flies at chest height: test
      // the hit against the chest or every shot sails through the body.
      _boltLookTarget.copy(targetMeshComponent.root.position);
      _boltLookTarget.y += 1.0;
      const distance = meshComponent.root.position.distanceTo(_boltLookTarget);
      if (distance < 1.0) {
        _soldierTakeDamage(world, bulletComponent.targetId, bulletComponent.damage);
        spawnParticles(meshComponent.root.position, _boltFlashWhite, 6);
        spawnParticles(meshComponent.root.position, new THREE.Color(0.9, 0.95, 1.0), 10);
        disposeObj(meshComponent.root);
        world.destroyEntity(id);
        continue;
      }
    }
  }
}

export function systemBlasterBullet(world, deltaTime) {
  for (const id of world.query('bullet', 'mesh')) {
    const bulletComponent = world.get(id, 'bullet');
    if (!bulletComponent || bulletComponent.projectileType?.toLowerCase() !== 'blaster') {
      continue;
    }
    const meshComponent = world.get(id, 'mesh');
    if (!meshComponent) {
      continue;
    }
    bulletComponent.age += deltaTime;
    // Long thin bolt flies nose-first along its velocity.
    _boltLookTarget.set(
      meshComponent.root.position.x + bulletComponent.vx,
      meshComponent.root.position.y + bulletComponent.vy,
      meshComponent.root.position.z + bulletComponent.vz,
    );
    meshComponent.root.lookAt(_boltLookTarget);
    if (window._multiplayerMode) {
      continue;
    }
    if (bulletComponent.age > 2.5) {
      disposeObj(meshComponent.root);
      world.destroyEntity(id);
      continue;
    }
    meshComponent.root.position.x += bulletComponent.vx * deltaTime;
    meshComponent.root.position.y += bulletComponent.vy * deltaTime;
    meshComponent.root.position.z += bulletComponent.vz * deltaTime;
    const targetMeshComponent = world.get(bulletComponent.targetId, 'mesh');
    if (targetMeshComponent && world.has(bulletComponent.targetId, 'soldier')) {
      // Troops anchor at the feet while the bolt flies at chest height: test
      // the hit against the chest or every shot sails through the body.
      _boltLookTarget.copy(targetMeshComponent.root.position);
      _boltLookTarget.y += 1.0;
      const distance = meshComponent.root.position.distanceTo(_boltLookTarget);
      if (distance < 1.0) {
        _soldierTakeDamage(world, bulletComponent.targetId, bulletComponent.damage);
        spawnParticles(meshComponent.root.position, _boltFlashWhite, 4);
        spawnParticles(meshComponent.root.position, new THREE.Color(0.4, 0.7, 1.0), 10);
        disposeObj(meshComponent.root);
        world.destroyEntity(id);
        continue;
      }
    }
  }
}

export function systemPlasmaBullet(world, deltaTime) {
  for (const id of world.query('bullet', 'mesh')) {
    const bulletComponent = world.get(id, 'bullet');
    if (!bulletComponent || bulletComponent.projectileType?.toLowerCase() !== 'plasma') {
      continue;
    }
    const meshComponent = world.get(id, 'mesh');
    if (!meshComponent) {
      continue;
    }
    bulletComponent.age += deltaTime;
    // Elongated bolt flies nose-first along its velocity; filaments swirl.
    _boltLookTarget.set(
      meshComponent.root.position.x + bulletComponent.vx,
      meshComponent.root.position.y + bulletComponent.vy,
      meshComponent.root.position.z + bulletComponent.vz,
    );
    meshComponent.root.lookAt(_boltLookTarget);
    const filaments = meshComponent.root.userData.filaments;
    if (filaments) {
      filaments.rotation.z += deltaTime * 6;
    }
    updatePlasmaBoltCrackle(meshComponent.root, bulletComponent.age);
    if (window._multiplayerMode) {
      continue;
    }
    if (bulletComponent.age > 2.5) {
      disposeObj(meshComponent.root);
      world.destroyEntity(id);
      continue;
    }
    meshComponent.root.position.x += bulletComponent.vx * deltaTime;
    meshComponent.root.position.y += bulletComponent.vy * deltaTime;
    meshComponent.root.position.z += bulletComponent.vz * deltaTime;
    const targetMeshComponent = world.get(bulletComponent.targetId, 'mesh');
    if (targetMeshComponent && world.has(bulletComponent.targetId, 'soldier')) {
      // Troops anchor at the feet while the bolt flies at chest height: test
      // the hit against the chest or every shot sails through the body.
      _boltLookTarget.copy(targetMeshComponent.root.position);
      _boltLookTarget.y += 1.0;
      const distance = meshComponent.root.position.distanceTo(_boltLookTarget);
      if (distance < 1.0) {
        _soldierTakeDamage(world, bulletComponent.targetId, bulletComponent.damage);
        spawnParticles(meshComponent.root.position, _boltFlashWhite, 5);
        spawnParticles(meshComponent.root.position, new THREE.Color(0.45, 0.7, 1.0), 12);
        disposeObj(meshComponent.root);
        world.destroyEntity(id);
        continue;
      }
    }
  }
}

export function systemParticle(world, deltaTime) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += deltaTime;
    if (!p.noGravity) p.vy -= 12 * deltaTime;
    p.mesh.position.x += p.vx * deltaTime;
    p.mesh.position.y += p.vy * deltaTime;
    p.mesh.position.z += p.vz * deltaTime;
    p.material.opacity = Math.max(0, (p.alpha ?? 1) * (1 - p.age / p.life));
    p.material.transparent = true;
    if (p.grow) {
      const s = 1 + p.grow * (p.age / p.life);
      p.mesh.scale.set(s, s, s);
    }
    p.mesh.rotation.x += deltaTime * 10;
    p.mesh.rotation.y += deltaTime * 7;
    if (p.age >= p.life) {
      disposeObj(p.mesh);
      particles.splice(i, 1);
    }
  }
}

export function systemAirfield(world, deltaTime) {
  for (const id of world.query('airfield', 'mesh')) {
    const airfield = world.get(id, 'airfield');
    const meshComponent = world.get(id, 'mesh');
    if (!airfield || !meshComponent) {
      continue;
    }
    if (airfield.constructing) {
      airfield.constructProgress += deltaTime;
      if (meshComponent.root && meshComponent.scaffold) {
        const pulse = 0.85 + 0.15 * Math.sin(airfield.constructProgress * 6);
        childMeshes(meshComponent.root).forEach((m) => {
          if (m.material && !m._isSelRingBar) {
            m.material.opacity = pulse * 0.38;
            m.material.transparent = true;
          }
        });
      }
      if (meshComponent.constructBar) {
        meshComponent.constructBar.visible = true;
        meshComponent.constructBar.position.copy(airfield.position);
        meshComponent.constructBar.position.y = 5.5;
        updateHpBar(meshComponent.constructBar, Math.min(1, airfield.constructProgress / airfield.constructTime));
      }
      if (airfield.constructProgress >= airfield.constructTime && !window._multiplayerMode && !meshComponent._realMeshBuilt) {
        if (meshComponent.scaffold) {
          childMeshes(meshComponent.scaffold).forEach((m) => {
            if (m.material) {
              m.material.dispose();
            }
            disposeObj(m);
          });
          disposeObj(meshComponent.scaffold);
          meshComponent.scaffold = null;
        }
        if (meshComponent.constructBar) {
          childMeshes(meshComponent.constructBar).forEach((m) => {
            if (m.material) {
              m.material.dispose();
            }
            disposeObj(m);
          });
          disposeObj(meshComponent.constructBar);
          meshComponent.constructBar = null;
        }
        meshComponent.root = meshComponent._meshFactory();
        meshComponent._realMeshBuilt = true;
        airfield.constructing = false;
        if (meshComponent.hpBar) {
          meshComponent.hpBar.visible = true;
        }
        updateHUD();
      }
      continue;
    }
    airfield.beaconT += deltaTime;
    if (meshComponent.root && meshComponent.root._beaconMat) {
      const on = Math.sin(airfield.beaconT * 5) > 0.2;
      meshComponent.root._beaconMat.emissive.setRGB(on ? 1 : 0.1, on ? 0.1 : 0, 0);
    }
    if (airfield.queue.length > 0) {
      airfield.queue[0].progress += deltaTime;
      if (meshComponent.prodBar) {
        meshComponent.prodBar.visible = true;
        meshComponent.prodBar.position.copy(airfield.position);
        meshComponent.prodBar.position.y = 8.5;
        if (meshComponent.prodBar._fg?.material) {
          meshComponent.prodBar._fg.material.color.setRGB(0.2, 0.7, 1);
        }
        updateHpBar(meshComponent.prodBar, airfield.queue[0].progress / airfield.queue[0].total);
      }
      if (airfield.queue[0].progress >= airfield.queue[0].total && !window._multiplayerMode) {
        airfield.queue.shift();
        const spawnPt = new THREE.Vector3(airfield.position.x + 8, JET_ALT, airfield.position.z);
        const jetId = createJetEntity(world, spawnPt);
        if (airfield.rallyPoint) {
          const jet = world.get(jetId, 'jet');
          if (jet) {
            jet.moveOrder = new THREE.Vector3(airfield.rallyPoint.x, JET_ALT, airfield.rallyPoint.z);
            jet.waitOrders = false;
          }
        }
        if (airfield.queue.length === 0 && meshComponent.prodBar) {
          meshComponent.prodBar.visible = false;
        }
        if (airfield.rallyPoint) {
          airfield.rallyPoint = null;
        }
        updateHUD();
      }
    } else if (meshComponent.prodBar) {
      meshComponent.prodBar.visible = false;
    }
    if (!airfield.constructing) {
      meshComponent.hpBar.position.copy(airfield.position);
      meshComponent.hpBar.position.y = 7;
      updateHpBar(meshComponent.hpBar, airfield.hp / airfield.maxHp);
    }
  }
}

export function systemJet(world, deltaTime) {
  for (const id of world.query('jet', 'mesh')) {
    const jet = world.get(id, 'jet');
    const meshComponent = world.get(id, 'mesh');
    if (!jet || !meshComponent) {
      continue;
    }
    jet.flameT += deltaTime;
    jet.attackCd = Math.max(0, jet.attackCd - deltaTime);
    jet.strafeCd = Math.max(0, jet.strafeCd - deltaTime);
    if (jet.shootFlashT > 0) {
      jet.shootFlashT = Math.max(0, jet.shootFlashT - deltaTime);
    }
    const isShooting = jet.shootFlashT > 0;
    [-0.55, 0.55].forEach((ex) => {
      const fm = meshComponent.root[`_flameMat_${ex}`];
      if (!fm) {
        return;
      }
      if (isShooting) {
        fm.opacity = 0.15;
        fm.transparent = true;
      } else {
        fm.opacity = 0.65 + 0.25 * Math.sin(jet.flameT * 18 + ex * 3);
        fm.transparent = true;
      }
    });
    meshComponent.hpBar.position.set(jet.position.x, jet.position.y + 2.5, jet.position.z);
    updateHpBar(meshComponent.hpBar, jet.hp / jet.maxHp);
    if (jet.moveOrder) {
      const dx = jet.moveOrder.x - jet.position.x;
      const dz = jet.moveOrder.z - jet.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 3) {
        jet.holdPos = jet.position.clone();
        jet.orbitAngle = Math.atan2(jet.position.x - jet.holdPos.x, jet.position.z - jet.holdPos.z);
        jet.moveOrder = null;
        jet.waitOrders = false;
      } else {
        const inverse = 1 / distance;
        jet.position.x += (dx * inverse) * JET_SPEED * deltaTime;
        jet.position.z += (dz * inverse) * JET_SPEED * deltaTime;
        jet.position.y += (JET_ALT - jet.position.y) * 2 * deltaTime;
        meshComponent.root.rotation.y = Math.atan2(dx * inverse, dz * inverse);
        jet.bankAngle = jet.bankAngle * 0.92 + 0.18 * 0.08;
        meshComponent.root.rotation.z = jet.bankAngle * -1;
        meshComponent.root.position.copy(jet.position);
        continue;
      }
    }
    if (jet.waitOrders || jet.patrolMode === 'hold') {
      jet.position.y += (JET_ALT - jet.position.y) * 2 * deltaTime;
      meshComponent.root.rotation.z = 0;
      meshComponent.root.position.copy(jet.position);
      continue;
    }
    if (jet.forcedTargetSqId !== null && !world.has(jet.forcedTargetSqId, 'squad')) {
      jet.forcedTargetSqId = null;
    }
    let closestSquadId = null;
    let minDistance = Infinity;
    for (const squadId of world.query('squad')) {
      const squadComponent = world.get(squadId, 'squad');
      if (!squadComponent || squadComponent.team === jet.team) {
        continue;
      }
      const distance = new THREE.Vector3(squadComponent.position.x, 0, squadComponent.position.z).distanceTo(new THREE.Vector3(jet.position.x, 0, jet.position.z));
      if (distance < minDistance) {
        minDistance = distance;
        closestSquadId = squadId;
      }
    }
    const attackSqId = jet.forcedTargetSqId !== null ? jet.forcedTargetSqId : closestSquadId;
    const attackSq = attackSqId !== null ? world.get(attackSqId, 'squad') : null;
    const attackDistance = attackSq
      ? new THREE.Vector3(attackSq.position.x, 0, attackSq.position.z).distanceTo(new THREE.Vector3(jet.position.x, 0, jet.position.z))
      : Infinity;
    const isAttacking = attackSq && attackDistance < JET_ATTACK_RANGE;
    if (isAttacking) {
      jet.position.y += (JET_ALT - jet.position.y) * 2 * deltaTime;
      const tdx = attackSq.position.x - jet.position.x;
      const tdz = attackSq.position.z - jet.position.z;
      meshComponent.root.rotation.y = Math.atan2(tdx, tdz);
      jet.bankAngle = jet.bankAngle * 0.85;
    } else {
      const cx = jet.patrolMode === 'orbit' ? jet.holdPos.x : 0;
      const cz = jet.patrolMode === 'orbit' ? jet.holdPos.z : 0;
      jet.orbitAngle += jet.orbitSpeed * deltaTime;
      const tx = cx + Math.sin(jet.orbitAngle) * jet.orbitR;
      const tz = cz + Math.cos(jet.orbitAngle) * jet.orbitR;
      const dx = tx - jet.position.x;
      const dz = tz - jet.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      jet.position.x += (dx / dist) * JET_SPEED * deltaTime;
      jet.position.z += (dz / dist) * JET_SPEED * deltaTime;
      jet.position.y += (JET_ALT - jet.position.y) * 2 * deltaTime;
      if (!isShooting) {
        jet.bankAngle = jet.bankAngle * 0.92 + 0.28 * 0.08;
      }
      const tanX = Math.cos(jet.orbitAngle);
      const tanZ = -Math.sin(jet.orbitAngle);
      meshComponent.root.rotation.y = Math.atan2(tanX, tanZ);
    }
    if (jet.attackCd <= 0 && isAttacking) {
      createMissileEntity(world, jet.position.clone(), attackSqId);
      jet.attackCd = 1 / jet.attackRate;
      jet.shootFlashT = 0.18;
      spawnParticles(jet.position.clone(), new THREE.Color(1, 0.7, 0.2), 4);
    }
    meshComponent.root.rotation.z = jet.bankAngle * -1;
    meshComponent.root.position.copy(jet.position);
  }
}

export function systemMissile(world, deltaTime) {
  for (const id of world.query('missile', 'mesh')) {
    const missileComponent = world.get(id, 'missile');
    const meshComponent = world.get(id, 'mesh');
    if (!missileComponent || !meshComponent) {
      continue;
    }
    missileComponent.age += deltaTime;
    if (meshComponent.root._exhaustMat) {
      meshComponent.root._exhaustMat.opacity = 0.7 + 0.3 * Math.sin(missileComponent.age * 22);
      meshComponent.root._exhaustMat.transparent = true;
    }
    if (window._multiplayerMode) {
      continue;
    }
    if (missileComponent.age > 4) {
      childMeshes(meshComponent.root).forEach((c) => disposeObj(c));
      disposeObj(meshComponent.root);
      world.destroyEntity(id);
      continue;
    }
    {
      let tx;
      let tz;
      const solMesh = missileComponent.targetSoldierId != null
        ? world.get(missileComponent.targetSoldierId, 'mesh')?.root
        : null;
      if (solMesh) {
        tx = solMesh.position.x - meshComponent.root.position.x;
        tz = solMesh.position.z - meshComponent.root.position.z;
      } else {
        const squadComponent = world.get(missileComponent.targetSqId, 'squad');
        if (squadComponent) {
          const alive = squadComponent.soldiers.filter((soldierId) => soldierId !== null && world.has(soldierId, 'soldier'));
          if (alive.length) {
            missileComponent.targetSoldierId = alive[Math.floor(Math.random() * alive.length)];
          }
          tx = squadComponent.position.x - meshComponent.root.position.x;
          tz = squadComponent.position.z - meshComponent.root.position.z;
        }
      }
      if (tx !== undefined) {
        const len = Math.hypot(tx, tz) || 1;
        const turnRate = 4 * deltaTime;
        missileComponent.vx += (tx / len) * 35 * turnRate;
        missileComponent.vz += (tz / len) * 35 * turnRate;
        const spd = Math.hypot(missileComponent.vx, missileComponent.vy, missileComponent.vz);
        const scale = 35 / (spd || 1);
        missileComponent.vx *= scale;
        missileComponent.vz *= scale;
      }
    }
    if (meshComponent.root.position.y > 1.5) {
      missileComponent.vy -= 6 * deltaTime;
    }
    meshComponent.root.position.x += missileComponent.vx * deltaTime;
    meshComponent.root.position.y += missileComponent.vy * deltaTime;
    meshComponent.root.position.z += missileComponent.vz * deltaTime;
    meshComponent.root.rotation.y = Math.atan2(missileComponent.vx, missileComponent.vz);
    meshComponent.root.rotation.x = Math.atan2(-missileComponent.vy, Math.hypot(missileComponent.vx, missileComponent.vz));
    if (meshComponent.root._exhaustMat) {
      meshComponent.root._exhaustMat.opacity = 0.7 + 0.3 * Math.sin(missileComponent.age * 22);
      meshComponent.root._exhaustMat.transparent = true;
    }
    let exploded = false;
    if (missileComponent.targetSoldierId != null && world.has(missileComponent.targetSoldierId, 'soldier')) {
      const lockedMesh = world.get(missileComponent.targetSoldierId, 'mesh')?.root;
      if (lockedMesh && meshComponent.root.position.distanceTo(lockedMesh.position) < 1.5) {
        _soldierTakeDamage(world, missileComponent.targetSoldierId, missileComponent.damage);
        spawnParticles(meshComponent.root.position.clone(), new THREE.Color(1, 0.6, 0.1), 20);
        spawnParticles(meshComponent.root.position.clone(), new THREE.Color(1, 1, 0.3), 8);
        const ring = mkDisc('mexp', 0.5, 32, true);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(meshComponent.root.position);
        ring.position.y = 0.08;
        const rm = new THREE.MeshBasicMaterial();
        rm.color = new THREE.Color(1, 0.5, 0.1);
        rm.opacity = 0.8;
        rm.transparent = true;
        ring.material = rm;
        let rAge = 0;
        const rObs = addBeforeRender(() => {
          rAge += getDeltaTime();
          const scale = 1 + rAge * 9;
          ring.scale.set(scale, scale, scale);
          rm.opacity = 0.8 * (1 - rAge / 0.6);
          rm.transparent = true;
          if (rAge >= 0.6) {
            disposeObj(ring);
            removeBeforeRender(rObs);
          }
        });
        childMeshes(meshComponent.root).forEach((c) => disposeObj(c));
        disposeObj(meshComponent.root);
        world.destroyEntity(id);
        exploded = true;
      }
    }
    if (exploded) {
      continue;
    }
    for (const squadId of world.query('squad')) {
      const squadComponent = world.get(squadId, 'squad');
      if (!squadComponent || squadComponent.team === missileComponent.team) {
        continue;
      }
      const squadDistance = meshComponent.root.position.distanceTo(squadComponent.position);
      if (squadDistance < 4) {
        for (const soldierId of squadComponent.soldiers) {
          if (soldierId === null || !world.has(soldierId, 'soldier')) {
            continue;
          }
          const soldierMeshComponent = world.get(soldierId, 'mesh');
          if (!soldierMeshComponent) {
            continue;
          }
          const distance = meshComponent.root.position.distanceTo(soldierMeshComponent.root.position);
          if (distance < 5) {
            _soldierTakeDamage(world, soldierId, missileComponent.damage * (1 - distance / 5));
          }
        }
        spawnParticles(meshComponent.root.position.clone(), new THREE.Color(1, 0.6, 0.1), 30);
        spawnParticles(meshComponent.root.position.clone(), new THREE.Color(1, 1, 0.3), 12);
        spawnParticles(meshComponent.root.position.clone(), new THREE.Color(0.6, 0.6, 0.6), 18);
        const ring = mkDisc('mexp', 0.5, 32, true);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(meshComponent.root.position);
        ring.position.y = 0.08;
        const rm = new THREE.MeshBasicMaterial();
        rm.color = new THREE.Color(1, 0.5, 0.1);
        rm.opacity = 0.8;
        rm.transparent = true;
        ring.material = rm;
        let rAge = 0;
        const rObs = addBeforeRender(() => {
          rAge += getDeltaTime();
          const scale = 1 + rAge * 9;
          ring.scale.set(scale, scale, scale);
          rm.opacity = 0.8 * (1 - rAge / 0.6);
          rm.transparent = true;
          if (rAge >= 0.6) {
            disposeObj(ring);
            removeBeforeRender(rObs);
          }
        });
        childMeshes(meshComponent.root).forEach((c) => disposeObj(c));
        disposeObj(meshComponent.root);
        world.destroyEntity(id);
        exploded = true;
        break;
      }
    }
    if (exploded) {
      continue;
    }
    if (meshComponent.root.position.y <= 0.1) {
      spawnParticles(meshComponent.root.position.clone(), new THREE.Color(1, 0.5, 0.1), 14);
      childMeshes(meshComponent.root).forEach((c) => disposeObj(c));
      disposeObj(meshComponent.root);
      world.destroyEntity(id);
    }
  }
}

export function systemRequisitionIncome(world, deltaTime) {
  if (window._multiplayerMode) {
    return;
  }
  const rate = getRequisitionRate(world);
  counters.baseReqT += deltaTime * (rate * 0.1);
  if (counters.baseReqT >= 1) {
    const gained = Math.floor(counters.baseReqT);
    counters.baseReqT -= gained;
    gainRequisition(world, gained);
  }
}

export function systemAI(world, deltaTime) {
  if (controlBoth) {
    return;
  }
  counters.aiT += deltaTime;
  if (counters.aiT >= 28) {
    counters.aiT = 0;
    createSquadEntity(world, 'red', 30 + (Math.random() - .5) * 10, (Math.random() - .5) * 40, 5);
  }
}

export function systemWinCheck(world) {
  const playerSquads = world.query('squad').filter((id) => world.get(id, 'squad')?.team === PLAYER);
  const playerBuildings = world.query('building');
  const playerBuilders = world.query('builder');
  if (playerSquads.length === 0 && playerBuildings.length === 0 && playerBuilders.length === 0) {
    setGameOver(true);
    const winText = document.getElementById('winText');
    if (winText) {
      winText.textContent = 'RED WINS';
      winText.style.color = '#ff4444';
    }
    const win = document.getElementById('win');
    if (win) {
      win.style.display = 'flex';
    }
  }
}

export function _initSystems(w) {
  w.addSystem(systemSoldier);
  w.addSystem(systemSquad);
  w.addSystem(systemBuilder);
  w.addSystem(systemBuilding);
  w.addSystem(systemStructure);
  w.addSystem(systemApc);
  w.addSystem(systemVehicle);
  w.addSystem(systemStructureCollision);
  w.addSystem(systemStrategicPoint);
  w.addSystem(systemBullet);
  w.addSystem(systemLaserBullet);
  w.addSystem(systemBeam);
  w.addSystem(systemPlasmaBullet);
  w.addSystem(systemBlasterBullet);
  w.addSystem(systemReaperBullet);
  w.addSystem(systemGrenade);
  w.addSystem(systemParticle);
  w.addSystem(systemAirfield);
  w.addSystem(systemJet);
  w.addSystem(systemMissile);
  w.addSystem(systemRequisitionIncome);
}
