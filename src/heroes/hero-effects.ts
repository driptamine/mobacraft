import * as THREE from 'three';
import { scene } from '../core/scene.js';
import { createHeroProjectile, createHeroShotImpact, disposeShotVisual } from './hero-shot-visuals.js';
import { _groundAt } from '../systems/terrain.js';
import type { ShotStyle } from './hero-kits.js';

type Motion = (root: THREE.Group, progress: number) => void | boolean;
interface HeroEffect { root: THREE.Group; time: number; duration: number; move: Motion }

function paint(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: false,
    blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
  });
}
function piece(root: THREE.Group, geometry: THREE.BufferGeometry, color: number, opacity = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, paint(color, opacity));
  mesh.userData.pickable = false;
  mesh.raycast = () => {};
  root.add(mesh);
  return mesh;
}
export function addHeroEffect(world: any, root: THREE.Group, duration: number, move: Motion): void {
  if (move(root, 0)) {
    disposeShotVisual(root);
    return;
  }
  scene?.add(root);
  const id = world.createEntity();
  world.add(id, 'heroEffect', { root, time: 0, duration, move } satisfies HeroEffect);
}
export function clearHeroEffects(world: any): void {
  for (const id of world.query('heroEffect')) {
    disposeShotVisual(world.get(id, 'heroEffect').root);
    world.destroyEntity(id);
  }
}
export function tickHeroEffects(world: any, dt: number): void {
  for (const id of world.query('heroEffect')) {
    const effect: HeroEffect = world.get(id, 'heroEffect');
    effect.time += dt;
    const finished = effect.move(effect.root, Math.min(effect.time / effect.duration, 1));
    if (finished || effect.time >= effect.duration) {
      disposeShotVisual(effect.root);
      world.destroyEntity(id);
    }
  }
}

export function launchHeroShot(
  world: any,
  from: THREE.Vector3,
  aim: () => THREE.Vector3 | null,
  style: ShotStyle,
  onHit: (at: THREE.Vector3) => void,
  visualFrom = from,
): void {
  const target = aim();
  if (!target) return;
  const projectile = createHeroProjectile(from, target, style, visualFrom);
  let previous = 0;
  addHeroEffect(world, projectile.root, projectile.duration, (_, progress) => {
    const contact = projectile.advance((progress - previous) * projectile.duration, aim());
    previous = progress;
    if (!contact) return;
    if (contact.hit) {
      const impact = createHeroShotImpact(contact.at, style);
      addHeroEffect(world, impact.root, impact.duration, (_, elapsed) => impact.advance(elapsed));
      onHit(contact.at);
    }
    return true;
  });
}

export function heroBurst(world: any, at: THREE.Vector3, color: number, radius: number, length = .46): void {
  const root = new THREE.Group();
  root.name = 'hero-burst';
  const scale = Math.max(.65, radius);
  root.position.set(at.x, at.y + .20, at.z);
  const ring = piece(root, new THREE.RingGeometry(.83, 1, 30), color, .72);
  ring.rotateX(-Math.PI / 2);
  const accent = piece(root, new THREE.RingGeometry(.51, .54, 22), color, .44);
  accent.rotateX(-Math.PI / 2);
  const sparks = Array.from({ length: 9 }, (_, index) => {
    const spark = piece(root, new THREE.OctahedronGeometry(.16 + (index % 3) * .04), color, .9);
    spark.rotation.y = index;
    return spark;
  });
  addHeroEffect(world, root, length, (_, p) => {
    ring.scale.setScalar(scale * (.2 + .8 * p));
    accent.scale.setScalar(scale * (.4 + .7 * p));
    for (const [i, mesh] of sparks.entries()) {
      const angle = i / sparks.length * Math.PI * 2;
      const distance = scale * (.13 + p * .7);
      mesh.position.set(Math.cos(angle) * distance, Math.sin(Math.PI * p) * (.7 + i % 3 * .21), Math.sin(angle) * distance);
      mesh.rotation.x = p * 2;
      mesh.scale.setScalar(1 - .75 * p);
    }
    for (const mesh of [ring, accent, ...sparks]) (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, .86 * (1 - p));
  });
}
export function heroArc(world: any, start: THREE.Vector3, end: THREE.Vector3, color: number, radius: number): void {
  const root = new THREE.Group();
  root.name = 'hero-corridor';
  const distance = Math.hypot(end.x - start.x, end.z - start.z);
  root.position.copy(start);
  root.rotation.y = Math.atan2(end.x - start.x, end.z - start.z);
  const bands = Array.from({ length: Math.max(2, Math.ceil(distance / 1.5)) }, (_, i) => {
    const band = piece(root, new THREE.BoxGeometry(radius * 1.75, .19, 1.15), color, .6);
    band.position.z = distance * (i + 1) / Math.max(2, Math.ceil(distance / 1.5));
    band.position.y = _groundAt(start.x + Math.sin(root.rotation.y) * band.position.z,
      start.z + Math.cos(root.rotation.y) * band.position.z) - start.y + .24;
    return band;
  });
  addHeroEffect(world, root, .55, (_, p) => {
    for (const [index, band] of bands.entries()) {
      const phase = p * 1.7 - index / bands.length * .65;
      (band.material as THREE.MeshBasicMaterial).opacity = phase > 0 && phase < 1 ? .72 * Math.sin(Math.PI * phase) : 0;
    }
  });
}
