import * as THREE from 'three';
import { disposeObj } from '../render/three-helpers.js';
import type { ShotShape, ShotStyle } from './hero-kits.js';

const flight: Record<ShotShape, { rise: number; spread: number; spin: number }> = {
  arrow: { rise: .035, spread: .14, spin: 2 },
  ember: { rise: .018, spread: .29, spin: 9 },
  sigil: { rise: .015, spread: .19, spin: 6 },
  crystal: { rise: .055, spread: .2, spin: 5 },
  crescent: { rise: .02, spread: .27, spin: 3 },
  weight: { rise: .14, spread: .23, spin: 10 },
  tether: { rise: .012, spread: .08, spin: 1.5 },
  shard: { rise: .026, spread: .12, spin: 14 },
  tracer: { rise: 0, spread: .03, spin: 0 },
  orb: { rise: .045, spread: .29, spin: 7 },
  wave: { rise: .009, spread: .48, spin: 0 },
};

const shotJoints: Record<string, string> = {
  drow: 'attach_bone', shadow_fiend: 'RightWrist0_JNT', pudge: 'wrist_L',
  lina: 'wrist_R', lion: 'wrist_R', crystal_maiden: 'wrist_R', sven: 'wrist_R', tidehunter: 'wrist_R',
  antimage: 'wrist_R', bristleback: 'wrist_R', dazzle: 'rtStaff_1', earthshaker: 'wrist_R', kunkka: 'wrist_R',
  phantom_assassin: 'wrist_R', queenofpain: 'wrist_R', sniper: 'WeaponRoot_0', storm_spirit: 'wrist_R',
  vengeful: 'wrist_R', witchdoctor: 'staff_1',
};

export function heroShotOrigin(actor: THREE.Object3D | undefined, unitType: string, fallback: THREE.Vector3): THREE.Vector3 {
  const name = Object.hasOwn(shotJoints, unitType) ? shotJoints[unitType] : undefined;
  return (name ? actor?.getObjectByName?.(name)?.getWorldPosition(fallback) : undefined) ?? fallback;
}

function material(color: THREE.ColorRepresentation, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, opacity, toneMapped: false, transparent: opacity < 1,
    depthWrite: opacity === 1, blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending });
}

function piece(root: THREE.Group, geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, opacity = 1) {
  const mesh = new THREE.Mesh(geometry, material(color, opacity));
  mesh.raycast = () => {};
  root.add(mesh);
  return mesh;
}

function projectileHead(style: ShotStyle) {
  const head = new THREE.Group(), { shape, color } = style;
  const highlight = new THREE.Color(color).lerp(new THREE.Color(0xffffff), .63);
  if (shape === 'arrow' || shape === 'tether') {
    piece(head, new THREE.BoxGeometry(.09, .09, .94), color);
    const tip = piece(head, new THREE.ConeGeometry(.18, .42, 4), highlight);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = .53;
    for (const side of [-1, 1]) {
      const blade = piece(head, new THREE.BoxGeometry(.25, .035, .28), highlight);
      blade.position.set(side * .15, 0, shape === 'arrow' ? -.38 : .28);
      blade.rotation.y = side * -.5;
    }
  } else if (shape === 'tracer') {
    const core = piece(head, new THREE.BoxGeometry(.06, .06, .86), highlight);
    core.position.z = -.22;
    const streak = piece(head, new THREE.BoxGeometry(.13, .08, 2.45), color, .48);
    streak.position.z = -1.02;
  } else if (shape === 'shard') {
    for (const side of [-1, 1]) {
      const shard = piece(head, new THREE.TetrahedronGeometry(.38), side === 1 ? highlight : color);
      shard.position.set(side * .11, 0, side * .15);
      shard.scale.set(.58, .45, 1.75);
      shard.rotation.y = side * .28;
    }
  } else if (shape === 'orb') {
    piece(head, new THREE.IcosahedronGeometry(.25, 1), highlight);
    for (const turn of [0, Math.PI / 3, Math.PI * 2 / 3]) {
      piece(head, new THREE.TorusGeometry(.42, .043, 6, 20), color, .72).rotation.set(1.15, turn, turn);
    }
  } else if (shape === 'wave') {
    for (const side of [-1, 0, 1]) {
      const crest = piece(head, new THREE.TorusGeometry(.78 - Math.abs(side) * .12, .10, 6, 16, Math.PI * .8), side ? color : highlight, .73);
      crest.position.set(side * .58, -.33, -Math.abs(side) * .34);
      crest.rotation.set(.62, side * .34, .33);
    }
  } else if (shape === 'sigil' || shape === 'crescent') {
    piece(head, new THREE.OctahedronGeometry(.18), highlight);
    for (const turn of [0, Math.PI]) {
      const arc = piece(head, new THREE.TorusGeometry(.33, .05, 5, 14, shape === 'sigil' ? Math.PI * .6 : Math.PI * .76), color);
      arc.rotation.set(.42, .42, turn);
    }
  } else {
    const weight = shape === 'weight', ember = shape === 'ember';
    const core = piece(head, new THREE.OctahedronGeometry(weight ? .38 : .25), highlight);
    core.scale.z = ember ? 1.95 : 1.35;
    const shell = piece(head, new THREE.IcosahedronGeometry(weight ? .55 : .37, 0), color, .42);
    shell.scale.set(.88, .88, ember ? 2.2 : 1.2);
    if (weight) piece(head, new THREE.TorusGeometry(.52, .05, 6, 18), color).rotation.x = 1.05;
  }
  return head;
}

function instances(geometry: THREE.BufferGeometry, color: number, opacity: number, count: number) {
  const mesh = new THREE.InstancedMesh(geometry, material(color, opacity), count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  return mesh;
}

export function disposeShotVisual(root: THREE.Group): void {
  if (root.userData.disposed) return;
  root.traverse(node => { if (node instanceof THREE.InstancedMesh) node.dispose(); });
  disposeObj(root, true);
}

/** Contact follows the simulation position. The visible arc is 4h·u·(1−u), also zero at contact. */
export function createHeroProjectile(from: THREE.Vector3, aim: THREE.Vector3, style: ShotStyle, visualFrom = from) {
  const root = new THREE.Group();
  root.name = `hero-shot-${style.shape}`;
  const head = projectileHead(style);
  head.name = 'projectile-head';
  const profile = flight[style.shape];
  const tether = style.shape === 'tether';
  const trail = tether ? instances(new THREE.TorusGeometry(.11, .028, 5, 8), style.color, .88, 44)
    : instances(new THREE.OctahedronGeometry(1), style.color, .72, 24);
  trail.name = 'projectile-trail';
  root.add(trail, head);
  const spawn = visualFrom.clone(), position = from.clone(), end = aim.clone();
  const offset = spawn.clone().sub(position);
  const initialDistance = position.distanceTo(end);
  const duration = Math.max(.8, initialDistance / style.speed + 1.2);
  const height = Math.min(3.2, initialDistance * profile.rise);
  const velocity = new THREE.Vector3(), visual = spawn.clone(), last = spawn.clone();
  const instance = new THREE.Object3D();
  const samples = Array.from({ length: trail.instanceMatrix.count }, () => ({ at: new THREE.Vector3(), born: 0 }));
  let age = 0, sampleTime = 0, cursor = 0, count = 0, travelled = 0;
  head.position.copy(spawn);
  head.lookAt(aim);

  return { root, duration, advance(dt: number, target: THREE.Vector3 | null) {
    if (target) end.copy(target);
    const distance = position.distanceTo(end), step = Math.min(distance, style.speed * dt);
    if (distance <= step || distance < .06) return { at: end, hit: target !== null };
    velocity.subVectors(end, position).multiplyScalar(1 / distance);
    position.addScaledVector(velocity, step);
    travelled += step;
    age += dt;
    const phase = travelled / (travelled + distance - step);
    visual.copy(position).addScaledVector(offset, 1 - phase);
    visual.y += 4 * height * phase * (1 - phase);
    head.position.copy(visual);
    head.lookAt(visual.clone().add(velocity));
    head.rotateZ(age * profile.spin);

    if (tether) {
      trail.count = Math.min(samples.length, Math.floor(spawn.distanceTo(visual) / .35));
      for (let i = 0; i < trail.count; i++) {
        const t = (i + 1) / (trail.count + 1);
        instance.position.lerpVectors(spawn, visual, t);
        instance.position.y -= .65 * 4 * t * (1 - t);
        instance.lookAt(instance.position.clone().add(velocity));
        instance.rotateY(Math.PI / 2);
        instance.rotateZ(i % 2 * Math.PI / 2);
        instance.updateMatrix();
        trail.setMatrixAt(i, instance.matrix);
      }
    } else {
      const spacing = .018;
      while (dt > 0 && sampleTime + spacing <= age) {
        sampleTime += spacing;
        const sample = samples[cursor];
        sample.at.lerpVectors(last, visual, THREE.MathUtils.clamp(1 - (age - sampleTime) / dt, 0, 1));
        sample.born = sampleTime;
        cursor = (cursor + 1) % samples.length;
        count = Math.min(samples.length, count + 1);
      }
      trail.count = 0;
      instance.rotation.set(0, 0, 0);
      for (let i = 0; i < count; i++) {
        const sample = samples[i], elapsed = age - sample.born;
        const opacity = 1 - elapsed * 3.3;
        if (opacity <= 0) continue;
        instance.position.copy(sample.at);
        const drift = profile.spread * (.3 + elapsed * 3);
        instance.position.x += Math.cos(i * 2.4) * drift;
        instance.position.z += Math.sin(i * 2.4) * drift;
        instance.position.y += elapsed * (style.shape === 'ember' ? 1.25 : -.8);
        const scale = (.075 + i % 4 * .035) * opacity;
        instance.scale.set(scale, scale, scale);
        instance.updateMatrix();
        trail.setMatrixAt(trail.count++, instance.matrix);
      }
    }
    trail.instanceMatrix.needsUpdate = true;
    last.copy(visual);
    return null;
  } };
}

export function createHeroShotImpact(at: THREE.Vector3, style: ShotStyle) {
  const root = new THREE.Group();
  root.name = 'hero-shot-impact';
  root.position.copy(at);
  const flash = piece(root, new THREE.IcosahedronGeometry(.62, 1), 0xfffcf4, .72);
  const sparks = instances(new THREE.OctahedronGeometry(1), style.color, .9, 18);
  root.add(sparks);
  sparks.count = sparks.instanceMatrix.count;
  const instance = new THREE.Object3D();
  const impulse = style.shape === 'weight' ? 4.8 : style.shape === 'tether' ? 2.4 : 3.6;
  return { root, duration: .46, advance(progress: number) {
    flash.scale.setScalar(.18 + 1.5 * progress);
    (flash.material as THREE.MeshBasicMaterial).opacity = .65 * Math.max(0, 1 - 3.8 * progress);
    for (let i = 0; i < sparks.count; i++) {
      const time = progress * .46, angle = i * 2.399963;
      const radius = impulse * (1 + i % 4 * .29) * time / (1 + 1.4 * time);
      instance.position.set(Math.cos(angle) * radius, (1.8 + i % 7 * .55) * time - 5.5 * time * time, Math.sin(angle) * radius);
      instance.rotation.set(.3 + time * 6, angle, .6 + time * 3);
      instance.scale.set(.115 * (1 - progress), .115 * (1 - progress), .36 * (1 - progress));
      instance.updateMatrix();
      sparks.setMatrixAt(i, instance.matrix);
    }
    sparks.instanceMatrix.needsUpdate = true;
  } };
}
