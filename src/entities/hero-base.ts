import * as THREE from 'three';
import { makeHpBar, makeSquareSelRing } from '../meshes/hud.js';
import { mkGroup } from '../render/three-helpers.js';
import { _groundAt } from '../systems/terrain.js';

// A selectable recruitment square; no faction GLB, scaffold or worker.
export function createHeroBase(world: any, position: THREE.Vector3, team: 'blue' | 'red', owner?: number): number {
  const id = world.createEntity(['building']);
  if (owner !== undefined) world.add(id, 'networkOwner', { id: owner });
  world.add(id, 'building', {
    type: 'hq', heroBase: true, faction: 'ig', team,
    position: position.clone(), hp: 2000, maxHp: 2000,
    queue: [], production: [], researchQueue: [], addons: [], tier: 1,
    selected: false, constructing: false, constructProgress: 1, constructTime: 0,
    rallyPoint: new THREE.Vector3(position.x - 12, 0, position.z),
  });
  const root = mkGroup(`hero_base_${team}`) as THREE.Group & Record<string, any>;
  root.position.set(position.x, _groundAt(position.x, position.z), position.z);
  const color = team === 'blue' ? 0x46a5ff : 0xff6657;
  const square = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  square.name = `hero_base_square_${team}`;
  square.rotation.x = -Math.PI / 2;
  square.position.y = 0.12;
  square.userData = { buildingEntityId: id, faction: 'ig', pickable: true };
  root.add(square);
  const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-5, .15, -5), new THREE.Vector3(5, .15, -5),
    new THREE.Vector3(5, .15, 5), new THREE.Vector3(-5, .15, 5),
  ]), new THREE.LineBasicMaterial({ color }));
  outline.userData.pickable = false;
  root.add(outline);
  root._ring = makeSquareSelRing(root, 5, .18, .2);
  root._ringMat = root._ring._material;
  const hpBar = makeHpBar(8, team); hpBar.visible = false;
  world.add(id, 'mesh', { root, hpBar, _realMeshBuilt: true });
  return id;
}
