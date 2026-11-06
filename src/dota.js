// Procedural Dota map: three lanes (top/mid/bottom), three towers per lane
// per side (18 total), creep waves for both sides, and a shopkeeper per
// side. Everything is primitive meshes — no model files involved.
//
// Coordinate frame: Radiant base at anchor + (-40, +40), Dire base at
// anchor + (+40, -40); mid runs the diagonal, top/bottom bow via corners.
// Towers stand along each lane from their own base outward. Creeps spawn in
// waves, walk their lane waypoints, and fight the nearest enemy (creeps,
// teamed heroes, towers). Towers prefer creeps, then teamed heroes.
import * as THREE from 'three';
import { allHeroes, damageHero } from './hero.js';
import { mkGroup } from './three-helpers.js';

export const DOTA_LANES = ['top', 'mid', 'bot'];
export const DOTA_TEAMS = ['radiant', 'dire'];
export const DOTA_TEAM_COLORS = { radiant: 0x3b82f6, dire: 0xef4444 };

const BASE_SPREAD = 40;
// Tower distances from the owner's own base along the lane path. The guard
// in _alongPath keeps every tower on its own half (mid lane is ~113 long,
// so the outer tower stops just short of the river).
const TOWER_DISTANCES = [22, 38, 50];
const WAVE_PERIOD = 25;
const MAX_CREEPS_PER_LANE_SIDE = 10;

const TOWER = { hp: 1200, damage: 55, range: 16, cooldown: 1.1, projectileSpeed: 26 };
const CREEP_MELEE = { hp: 200, damage: 10, range: 2.2, cooldown: 1.2, speed: 3 };
const CREEP_RANGED = { hp: 120, damage: 14, range: 10, cooldown: 1.4, speed: 3, projectileSpeed: 18 };
const AGGRO_RANGE = 7;

const _dota = {
  group: null,
  towers: [],
  creeps: [],
  shops: [],
  projectiles: [],
  waveTimer: 0,
  seq: 0,
};

function _teamColor(team) {
  return new THREE.Color(DOTA_TEAM_COLORS[team]);
}

// Points along a polyline at fraction f (0..1 of total length), or at an
// absolute distance d from the path start (null when past the end).
function _alongPath(points, f, dist = null) {
  const lens = [0];
  for (let i = 1; i < points.length; i++) {
    lens.push(lens[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  const total = lens[lens.length - 1];
  if (dist !== null) {
    if (dist > total / 2 - 4) {
      return null;
    }
    return _alongPoints(points, lens, Math.max(0, dist));
  }
  const target = Math.max(0, Math.min(1, f)) * total;
  return _alongPoints(points, lens, target);
}

function _alongPoints(points, lens, target) {
  for (let i = 1; i < points.length; i++) {
    if (target <= lens[i] || i === points.length - 1) {
      const span = lens[i] - lens[i - 1] || 1;
      const t = (target - lens[i - 1]) / span;
      return points[i - 1].clone().lerp(points[i], Math.max(0, Math.min(1, t))).setY(0);
    }
  }
  return points[points.length - 1].clone().setY(0);
}

// Lane polylines from the Radiant base to the Dire base.
function _lanePaths(anchor) {
  const rb = new THREE.Vector3(anchor.x - BASE_SPREAD, 0, anchor.z + BASE_SPREAD);
  const db = new THREE.Vector3(anchor.x + BASE_SPREAD, 0, anchor.z - BASE_SPREAD);
  const cornerTop = new THREE.Vector3(anchor.x - BASE_SPREAD, 0, anchor.z - BASE_SPREAD);
  const cornerBot = new THREE.Vector3(anchor.x + BASE_SPREAD, 0, anchor.z + BASE_SPREAD);
  return {
    top: [rb, cornerTop, db],
    mid: [rb, db],
    bot: [rb, cornerBot, db],
  };
}

function _noPick(root) {
  root.traverse((child) => { child.userData.pickable = false; });
}

function _mesh(geo, color, x = 0, y = 0, z = 0) {
  const mat = new THREE.MeshBasicMaterial();
  mat.color = new THREE.Color(color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function _buildTower(team, lane, index, position) {
  const root = mkGroup(`dota_tower_${team}_${lane}_${index}`);
  root.position.copy(position);
  const paint = DOTA_TEAM_COLORS[team];
  root.add(_mesh(new THREE.CylinderGeometry(1.6, 2.2, 1.2, 8), paint, 0, 0.6, 0));
  root.add(_mesh(new THREE.CylinderGeometry(0.9, 1.3, 4.2, 8), paint, 0, 3.2, 0));
  root.add(_mesh(new THREE.CylinderGeometry(1.5, 1.0, 0.8, 8), paint, 0, 5.6, 0));
  const crystal = _mesh(new THREE.OctahedronGeometry(0.7), 0xffffff, 0, 6.6, 0);
  root.add(crystal);
  // Small floating HP bar, same pattern as hero bars.
  const barMat = new THREE.SpriteMaterial();
  barMat.depthTest = false;
  barMat.depthWrite = false;
  barMat.transparent = true;
  const bar = new THREE.Sprite(barMat);
  bar.scale.set(2.4, 0.25, 1);
  bar.position.set(0, 7.8, 0);
  bar.renderOrder = 10;
  bar.userData.pickable = false;
  root.add(bar);
  _noPick(root);
  return {
    id: `tw_${team}_${lane}_${index}`,
    kind: 'tower', team, lane, root, bar,
    hp: TOWER.hp, maxHp: TOWER.hp, cooldown: 0, alive: true, deadTimer: 0,
  };
}

function _refreshTowerBar(tower) {
  const frac = Math.max(0, tower.hp / tower.maxHp);
  tower.bar.scale.x = Math.max(2.4 * frac, 0.0001);
  tower.bar.position.x = -1.2 + 1.2 * frac;
  tower.bar.material.color.setRGB(1 - frac * 0.85, 0.15 + frac * 0.6, 0.2);
}

function _buildCreep(team, lane, kind, position) {
  const root = mkGroup(`dota_creep_${team}_${lane}_${kind}_${_dota.seq}`);
  root.position.copy(position);
  const trim = DOTA_TEAM_COLORS[team];
  if (kind === 'melee') {
    root.add(_mesh(new THREE.BoxGeometry(0.9, 1.1, 0.7), trim, 0, 0.9, 0));
    const head = _mesh(new THREE.SphereGeometry(0.35, 10, 8), trim, 0, 1.8, 0);
    root.add(head);
    root.add(_mesh(new THREE.BoxGeometry(0.18, 1.0, 0.18), 0x4a443c, 0.6, 0.9, 0.2));
  } else {
    root.add(_mesh(new THREE.BoxGeometry(0.7, 0.9, 0.55), trim, 0, 0.7, 0));
    root.add(_mesh(new THREE.SphereGeometry(0.3, 10, 8), trim, 0, 1.4, 0));
    root.add(_mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), 0x4a443c, 0.5, 1.0, 0));
  }
  _noPick(root);
  return root;
}

// River along the top-left to bottom-right diagonal: water strip with
// sandy banks. Everything is unpickable so clicks pass through to the
// ground and heroes behind it.
function _buildRiver(anchor) {
  const root = mkGroup('dota_river');
  const a = new THREE.Vector3(anchor.x - BASE_SPREAD, 0, anchor.z - BASE_SPREAD);
  const b = new THREE.Vector3(anchor.x + BASE_SPREAD, 0, anchor.z + BASE_SPREAD);
  const dir = b.clone().sub(a);
  const len = dir.length() + 40;
  const mid = a.clone().lerp(b, 0.5);
  const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const angle = Math.atan2(dir.x, dir.z);
  const water = _mesh(new THREE.PlaneGeometry(10, len), 0x2a6f9e);
  water.name = 'dota_river_water';
  water.rotation.x = -Math.PI / 2;
  water.material.transparent = true;
  water.material.opacity = 0.9;
  const waterHolder = mkGroup('dota_river_water_holder');
  waterHolder.add(water);
  waterHolder.position.set(mid.x, 0.02, mid.z);
  waterHolder.rotation.y = angle;
  root.add(waterHolder);
  for (const side of [-1, 1]) {
    const bank = _mesh(new THREE.PlaneGeometry(2.5, len), 0xc2a878);
    bank.name = 'dota_river_bank';
    bank.rotation.x = -Math.PI / 2;
    const holder = mkGroup('dota_river_bank_holder');
    holder.add(bank);
    holder.position.set(mid.x + perp.x * 6.25 * side, 0.012, mid.z + perp.z * 6.25 * side);
    holder.rotation.y = angle;
    root.add(holder);
  }
  _noPick(root);
  return root;
}

function _buildShopkeeper(team, position) {
  const root = mkGroup(`dota_shop_${team}`);
  root.position.copy(position);
  // Stone counter, wooden posts, team-colored canopy, keeper figure.
  root.add(_mesh(new THREE.BoxGeometry(3.2, 1.1, 1.6), 0x8a8f98, 0, 0.55, 0));
  for (const [px, pz] of [[-1.5, -0.7], [1.5, -0.7], [-1.5, 0.7], [1.5, 0.7]]) {
    root.add(_mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6), 0x6b4a2f, px, 1.3, pz));
  }
  const canopy = _mesh(new THREE.BoxGeometry(3.8, 0.18, 2.2), DOTA_TEAM_COLORS[team], 0, 2.7, 0);
  root.add(canopy);
  root.add(_mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.3, 8), 0x5a3fa0, 0, 1.75, 0));
  root.add(_mesh(new THREE.SphereGeometry(0.32, 10, 8), 0xd9b48f, 0, 2.6, 0));
  _noPick(root);
  return { id: `shop_${team}`, kind: 'shop', team, root };
}

// Hero lane slots 2-1-2: two top, one mid, two bot per team, standing just
// behind their outer tower near the team base.
export function dotaHeroSlots(anchor) {
  const paths = _lanePaths(anchor);
  const slots = { radiant: [], dire: [] };
  for (const team of DOTA_TEAMS) {
    for (const [lane, count] of [['top', 2], ['mid', 1], ['bot', 2]]) {
      const path = team === 'radiant' ? paths[lane] : [...paths[lane]].reverse();
      const dir = path[1].clone().sub(path[0]).setY(0).normalize();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x);
      const base = _alongPath(path, 0, 12);
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * 4;
        slots[team].push({ lane, pos: base.clone().addScaledVector(perp, off) });
      }
    }
  }
  return slots;
}

export function dotaTowers() {
  return [..._dota.towers];
}

export function dotaCreeps() {
  return [..._dota.creeps];
}

export function dotaShops() {
  return [..._dota.shops];
}

export function buildDotaMap(parent, anchor) {
  clearDotaMap();
  const group = mkGroup('dota_map');
  parent.add(group);
  _dota.group = group;
  const paths = _lanePaths(anchor);
  _dota.anchorPaths = paths;
  group.add(_buildRiver(anchor));
  for (const team of DOTA_TEAMS) {
    for (const lane of DOTA_LANES) {
      const path = team === 'radiant' ? paths[lane] : [...paths[lane]].reverse();
      TOWER_DISTANCES.forEach((d, i) => {
        const pos = _alongPath(path, 0, d);
        if (!pos) {
          return;
        }
        const tower = _buildTower(team, lane, i, pos);
        group.add(tower.root);
        _dota.towers.push(tower);
      });
    }
    // Shopkeeper beside its own base.
    const base = team === 'radiant' ? paths.mid[0] : paths.mid[paths.mid.length - 1];
    const side = team === 'radiant' ? 1 : -1;
    const shop = _buildShopkeeper(team, base.clone().add(new THREE.Vector3(6 * side, 0, 0)));
    group.add(shop.root);
    _dota.shops.push(shop);
  }
  _dota.waveTimer = 3;
  return group;
}

export function clearDotaMap() {
  if (_dota.group?.parent) {
    _dota.group.parent.remove(_dota.group);
  }
  _dota.group = null;
  _dota.towers = [];
  _dota.creeps = [];
  _dota.shops = [];
  for (const proj of _dota.projectiles) {
    proj.mesh.parent?.remove(proj.mesh);
  }
  _dota.projectiles = [];
  _dota.waveTimer = 0;
  _dota.anchorPaths = null;
}

function _spawnWave() {
  if (!_dota.group || !_dota.anchorPaths) {
    return;
  }
  for (const team of DOTA_TEAMS) {
    for (const lane of DOTA_LANES) {
      const alive = _dota.creeps.filter((c) => c.team === team && c.lane === lane && c.alive).length;
      if (alive + 4 > MAX_CREEPS_PER_LANE_SIDE) {
        continue;
      }
      const path = team === 'radiant' ? _dota.anchorPaths[lane] : [..._dota.anchorPaths[lane]].reverse();
      ['melee', 'melee', 'melee', 'ranged'].forEach((kind, i) => {
        const stats = kind === 'melee' ? CREEP_MELEE : CREEP_RANGED;
        const pos = _alongPath(path, 0.05).add(new THREE.Vector3(0, 0, (i - 1.5) * 1.2));
        const root = _buildCreep(team, lane, kind, pos);
        _dota.group.add(root);
        _dota.creeps.push({
          id: `creep_${team}_${lane}_${_dota.seq++}`,
          kind, team, lane, root,
          hp: stats.hp, maxHp: stats.hp,
          wpIndex: 0, path,
          alive: true, cooldown: Math.random() * 0.5, deadTimer: 0,
          bobPhase: Math.random() * Math.PI * 2,
        });
      });
    }
  }
}

// Nearest damageable enemy: creeps, then teamed heroes, then towers.
function _nearestFoe(pos, team, forTower) {
  let best = null;
  let bestDist = Infinity;
  const consider = (obj, distance) => {
    if (distance < bestDist) {
      bestDist = distance;
      best = obj;
    }
  };
  for (const creep of _dota.creeps) {
    if (!creep.alive || creep.team === team) {
      continue;
    }
    consider({ kind: 'creep', ref: creep }, pos.distanceTo(creep.root.position));
  }
  if (!forTower || !best) {
    for (const hero of allHeroes()) {
      if (!hero.team || hero.team === team || !hero.alive) {
        continue;
      }
      consider({ kind: 'hero', ref: hero }, pos.distanceTo(hero.root.position));
    }
  }
  if (!forTower) {
    for (const tower of _dota.towers) {
      if (!tower.alive || tower.team === team) {
        continue;
      }
      consider({ kind: 'tower', ref: tower }, pos.distanceTo(tower.root.position));
    }
  }
  return best ? { ...best, distance: bestDist } : null;
}

function _damageFoe(foe, amount) {
  if (foe.kind === 'creep') {
    if (!foe.ref.alive) {
      return;
    }
    foe.ref.hp -= amount;
    if (foe.ref.hp <= 0) {
      foe.ref.alive = false;
      foe.ref.deadTimer = 1.2;
    }
  } else if (foe.kind === 'hero') {
    damageHero(foe.ref.id, amount);
  } else if (foe.kind === 'tower') {
    if (!foe.ref.alive) {
      return;
    }
    foe.ref.hp -= amount;
    _refreshTowerBar(foe.ref);
    if (foe.ref.hp <= 0) {
      foe.ref.alive = false;
      foe.ref.deadTimer = 1.5;
    }
  }
}

function _foePosition(foe) {
  return foe.ref.root.position;
}

function _fireProjectile(from, foe, damage, speed, color) {
  const parent = _dota.group;
  if (!parent) {
    _damageFoe(foe, damage);
    return;
  }
  const geo = new THREE.SphereGeometry(0.16, 10, 8);
  const mat = new THREE.MeshBasicMaterial();
  mat.color = new THREE.Color(color);
  mat.transparent = true;
  mat.depthWrite = false;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(from);
  mesh.position.y = Math.max(mesh.position.y, 1.2) + 1.2;
  mesh.userData.pickable = false;
  parent.add(mesh);
  _dota.projectiles.push({ mesh, foe, damage, speed, life: 5 });
}

function _tickProjectiles(deltaTime) {
  for (let i = _dota.projectiles.length - 1; i >= 0; i--) {
    const proj = _dota.projectiles[i];
    const alive = proj.foe.ref.alive;
    proj.life -= deltaTime;
    if (!alive || proj.life <= 0) {
      proj.mesh.parent?.remove(proj.mesh);
      _dota.projectiles.splice(i, 1);
      continue;
    }
    const target = _foePosition(proj.foe);
    const dx = target.x - proj.mesh.position.x;
    const dz = target.z - proj.mesh.position.z;
    const dy = 1.2 - proj.mesh.position.y;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= 0.9) {
      _damageFoe(proj.foe, proj.damage);
      proj.mesh.parent?.remove(proj.mesh);
      _dota.projectiles.splice(i, 1);
      continue;
    }
    const step = Math.min(distance, proj.speed * deltaTime);
    proj.mesh.position.x += (dx / distance) * step;
    proj.mesh.position.y += (dy / distance) * step;
    proj.mesh.position.z += (dz / distance) * step;
  }
}

export function tickDota(deltaTime) {
  if (!_dota.group) {
    return;
  }
  _dota.waveTimer -= deltaTime;
  if (_dota.waveTimer <= 0) {
    _dota.waveTimer = WAVE_PERIOD;
    _spawnWave();
  }
  const dead = [];
  for (const creep of _dota.creeps) {
    if (!creep.alive) {
      creep.deadTimer -= deltaTime;
      creep.root.rotation.x = Math.min(creep.root.rotation.x + deltaTime * 4, Math.PI / 2);
      if (creep.deadTimer <= 0) {
        dead.push(creep);
        creep.root.parent?.remove(creep.root);
      }
      continue;
    }
    const stats = creep.kind === 'melee' ? CREEP_MELEE : CREEP_RANGED;
    const foe = _nearestFoe(creep.root.position, creep.team, false);
    if (foe && foe.distance <= AGGRO_RANGE) {
      creep.root.lookAt(foe.ref.root.position.x, creep.root.position.y, foe.ref.root.position.z);
      const range = stats.range;
      if (foe.distance <= range) {
        creep.cooldown -= deltaTime;
        if (creep.cooldown <= 0) {
          creep.cooldown = stats.cooldown;
          if (creep.kind === 'melee') {
            _damageFoe(foe, stats.damage);
          } else {
            _fireProjectile(creep.root.position, foe, stats.damage, stats.projectileSpeed, DOTA_TEAM_COLORS[creep.team]);
          }
        }
      } else {
        const dir = _foePosition(foe).clone().sub(creep.root.position).setY(0).normalize();
        creep.root.position.addScaledVector(dir, stats.speed * deltaTime);
      }
    } else {
      // Advance along lane waypoints.
      const next = creep.path[Math.min(creep.wpIndex + 1, creep.path.length - 1)];
      const dx = next.x - creep.root.position.x;
      const dz = next.z - creep.root.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= 0.6) {
        creep.wpIndex = Math.min(creep.wpIndex + 1, creep.path.length - 1);
      } else {
        creep.root.rotation.y = Math.atan2(dx, dz);
        creep.root.position.x += (dx / distance) * stats.speed * deltaTime;
        creep.root.position.z += (dz / distance) * stats.speed * deltaTime;
      }
    }
    // Walk bob.
    creep.bobPhase += deltaTime * 8;
    creep.root.position.y = Math.abs(Math.sin(creep.bobPhase)) * 0.12;
  }
  for (const gone of dead) {
    _dota.creeps.splice(_dota.creeps.indexOf(gone), 1);
  }
  const fallen = [];
  for (const tower of _dota.towers) {
    if (!tower.alive) {
      tower.deadTimer -= deltaTime;
      tower.root.position.y -= deltaTime * 1.5;
      if (tower.deadTimer <= 0) {
        fallen.push(tower);
        // Leave low rubble where the tower stood.
        const rubble = _mesh(new THREE.CylinderGeometry(1.8, 2.2, 0.5, 8), 0x555a63, tower.root.position.x, 0.25, tower.root.position.z);
        rubble.userData.pickable = false;
        _dota.group.add(rubble);
        tower.root.parent?.remove(tower.root);
      }
      continue;
    }
    const foe = _nearestFoe(tower.root.position, tower.team, true);
    if (foe && foe.distance <= TOWER.range) {
      tower.cooldown -= deltaTime;
      if (tower.cooldown <= 0) {
        tower.cooldown = TOWER.cooldown;
        _fireProjectile(tower.root.position, foe, TOWER.damage, TOWER.projectileSpeed, DOTA_TEAM_COLORS[tower.team]);
      }
    } else {
      tower.cooldown = Math.min(tower.cooldown, 0.2);
    }
  }
  for (const gone of fallen) {
    _dota.towers.splice(_dota.towers.indexOf(gone), 1);
  }
  _tickProjectiles(deltaTime);
}
