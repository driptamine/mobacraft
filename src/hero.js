// Hero registry: loads showcase hero models (axe-final/axe-combined.glb is
// the first of 100+) and spawns selectable, movable display instances. Not
// ECS units — lightweight instances on the shared gltf mixer pipeline, so
// they animate with the normal frame tick and clean up on reset.
//
// Register a new hero once, then use it by key everywhere:
//   registerHero('lina', { model: 'axe-final/lina-combined.glb' });
//   await loadHero('lina');
//   spawnHero(scene, new THREE.Vector3(x, 0, z), 'lina');
import * as THREE from 'three';
import { scene, currentBounds, setGameOver } from './scene.js';
import { modelUrl } from './assets.js';
import { loadGltf, instantiateGltf } from './gltf-models.js';
import { mkGroup, mkDisc, mkTorus } from './three-helpers.js';

export const HERO_ARRIVE_RADIUS = 0.35;

const HERO_DEFAULTS = {
  title: '',
  model: '',
  idle: 'idle',
  run: 'run',
  // Bind-pose bodies span y 0..4.2; infantry stand ~2 tall — 0.6 keeps a hero
  // a head above guardsmen without towering over structures.
  scale: 0.6,
  // Builder pace: brisk stride that still reads beside squads.
  speed: 7,
  // Skirmish combat: melee closes to attackRange, ranged fires projectiles.
  attackKind: 'melee',
  attackRange: 2.4,
  attackName: 'attack',
  deathName: 'death',
  damage: 30,
  hp: 500,
  cooldown: 1.4,
  projectileSpeed: 22,
};

export const HERO_BATCH_1 = [
  'axe',
  'crystal_maiden',
  'drow',
  'juggernaut',
  'lina',
  'lion',
  'pudge',
  'shadow_fiend',
  'sven',
  'tidehunter',
  'brewmaster',
  'storm_spirit',
  'obsidian_destroyer',
  'earth_spirit',
];

// Heroes loaded automatically at boot. The rest of the roster stays
// registered and can be loaded on demand via loadHero(key).
export const HERO_AUTOLOAD = ['axe', 'juggernaut', 'pudge', 'drow', 'sven', 'shadow_fiend', 'crystal_maiden', 'brewmaster', 'storm_spirit', 'obsidian_destroyer', 'earth_spirit'];

// Batch-1 roster. Axe ships merged from axe-final/; the rest load their main
// body file straight from batches/1 (parts like weapons merge later).
// Scales normalize bind-pose height to ~2.5 world units (axe: 4.19 -> 0.6).
export const HEROES = {
  axe: { title: 'Axe', model: 'axe-final/axe-combined.glb', idle: 'idle', run: 'run', scale: 0.6, speed: 7, attackName: 'attack_main', damage: 35, hp: 650, cooldown: 1.3 },
  crystal_maiden: { title: 'Crystal Maiden', model: 'batches/1/final/crystal_maiden-combined.glb', idle: 'background_idle', run: 'run', scale: 0.55, speed: 7, attackKind: 'ranged', attackRange: 13, damage: 20, hp: 400 },
  drow: { title: 'Drow Ranger', model: 'batches/1/final/drow-combined.glb', idle: 'idle', run: '@drow_shooting_apples_run', scale: 0.63, speed: 7, attackKind: 'ranged', attackRange: 14, attackName: 'attack_fast', damage: 25, hp: 450, cooldown: 1.3 },
  juggernaut: { title: 'Juggernaut', model: 'batches/1/final/juggernaut-combined.glb', idle: 'idle', run: 'run_run', scale: 0.56, speed: 7, attackName: 'attack01_fast', damage: 30, hp: 550, cooldown: 1.2 },
  lina: { title: 'Lina', model: 'batches/1/final/lina-combined.glb', idle: 'idle', run: 'run', scale: 0.49, speed: 7, attackKind: 'ranged', attackRange: 14, attackName: 'attack1', damage: 28, hp: 450, cooldown: 1.2 },
  lion: { title: 'Lion', model: 'batches/1/models/heroes/lion/lion.glb', idle: 'idle', run: 'run', scale: 0.51, speed: 7, attackKind: 'ranged', attackRange: 13, attackName: 'attack', damage: 22, hp: 400, cooldown: 1.3 },
  pudge: { title: 'Pudge', model: 'batches/1/final/pudge-combined.glb', idle: 'ftp_dendi_portrait_look', run: 'run', scale: 0.56, speed: 7, damage: 45, hp: 750, cooldown: 1.6 },
  shadow_fiend: { title: 'Shadow Fiend', model: 'batches/1/final/shadow_fiend-combined.glb', idle: 'idle_rare_anim', run: 'run_haste', scale: 0.58, speed: 7, attackKind: 'ranged', attackRange: 14, attackName: 'cast6_requiem', deathName: 'defeat', damage: 30, hp: 450, cooldown: 1.5 },
  sven: { title: 'Sven', model: 'batches/1/final/sven-combined.glb', idle: 'idle', run: 'run', scale: 0.55, speed: 7, attackName: 'attack01', damage: 35, hp: 620, cooldown: 1.3 },
  tidehunter: { title: 'Tidehunter', model: 'batches/1/models/heroes/tidehunter/tidehunter.glb', idle: 'idle', run: 'run', scale: 0.46, speed: 7, attackName: 'attack1', damage: 30, hp: 550 },
  brewmaster: { title: 'Brewmaster', model: 'batches/12/final/brewmaster-combined.glb', idle: 'idle', run: 'Run', scale: 0.48, speed: 7, attackName: 'Attack', deathName: 'die', damage: 30, hp: 560, cooldown: 1.3 },
  storm_spirit: { title: 'Storm Spirit', model: 'batches/2/final/storm_spirit-combined.glb', idle: 'idle', run: 'run', scale: 0.67, speed: 7 },
  obsidian_destroyer: { title: 'Outworld Devourer', model: 'batches/9/final/obsidian_destroyer-combined.glb', idle: 'idle', run: 'run', scale: 0.31, speed: 7, attackKind: 'ranged', attackRange: 14, attackName: 'attack', damage: 28, hp: 475, cooldown: 1.3 },
  earth_spirit: { title: 'Earth Spirit', model: 'batches/7/final/earth_spirit-combined.glb', idle: 'idle_staff', run: 'run', scale: 0.53, speed: 7, attackName: 'attack_bo_staff_two_hand', damage: 30, hp: 560, cooldown: 1.35 },
};

// 5v5 skirmish teams by hero key. Heroes outside both teams stay neutral:
// selectable and movable, but they never attack and can't be damaged.
export const HERO_TEAMS = {
  radiant: ['axe', 'drow', 'lina', 'sven', 'earth_spirit'],
  dire: ['juggernaut', 'pudge', 'crystal_maiden', 'shadow_fiend', 'brewmaster'],
};

export const HERO_TEAM_COLORS = {
  radiant: 0x3b82f6,
  dire: 0xef4444,
};

export const HERO_TEAM_LABELS = {
  radiant: 'Radiant',
  dire: 'Dire',
};

export function registerHero(key, config) {
  HEROES[key] = { ...HERO_DEFAULTS, ...(config || {}) };
  return HEROES[key];
}

export function heroConfig(key) {
  return HEROES[key] || null;
}

const _containers = new Map();
const _active = new Map();
const _selectedIds = new Set();

export function heroLoaded(key = 'axe') {
  return _containers.has(key);
}

export async function loadHero(key = 'axe', hooks = {}) {
  if (_containers.has(key)) {
    return _containers.get(key);
  }
  const config = heroConfig(key);
  if (!config || !config.model) {
    throw new Error(`unknown hero: ${key}`);
  }
  const { loadModel = loadGltf } = hooks;
  const container = await loadModel(modelUrl(config.model));
  _containers.set(key, container);
  return container;
}

export function getHero(id = 'axe') {
  return _active.get(id) || null;
}

export function allHeroes() {
  return [..._active.values()];
}

export function heroClips(key = 'axe') {
  return (_containers.get(key)?.animations || []).map((clip) => clip.name);
}

export function despawnHero(id = 'axe') {
  const state = _active.get(id);
  if (!state) {
    return;
  }
  _selectedIds.delete(id);
  try {
    state.instance.dispose();
  } catch (_) { /* already gone */ }
  if (state.root.parent) {
    state.root.parent.remove(state.root);
  }
  _active.delete(id);
}

export function despawnAllHeroes() {
  [..._active.keys()].forEach((id) => despawnHero(id));
  for (const proj of _projectiles) {
    proj.mesh.parent?.remove(proj.mesh);
  }
  _projectiles.length = 0;
  _teamGameEnded = false;
}

function _findClip(container, name, idle) {
  const clips = container?.animations || [];
  const lower = (s) => (s || '').toLowerCase();
  return clips.find((clip) => clip.name === name)
    || clips.find((clip) => lower(clip.name).includes(lower(name)))
    || clips.find((clip) => lower(clip.name).includes(lower(idle)))
    || clips[0]
    || null;
}

export function playHeroAnim(id, name, loop = true, fade = 0) {
  const state = typeof id === 'string' ? _active.get(id) : null;
  if (!state) {
    return null;
  }
  const config = heroConfig(state.key);
  const clip = _findClip(_containers.get(state.key), name, config?.idle || 'idle');
  if (!clip) {
    return null;
  }
  const target = state.instance.animationGroups.find((g) => g.name === clip.name);
  // Crossfade: spent actions (weight 0) are reaped, the rest fade out while
  // the target fades in — no hard pose cuts between clips.
  state.instance.animationGroups.forEach((group) => {
    if (group === target) return;
    if (group.weight === 0) group.stop();
    else group.stop(fade);
  });
  if (target) {
    target.start(loop, 1, fade);
  }
  return clip.name;
}

export const HERO_FADE = 0.25;

function _setHeroClip(state, name) {
  if (!state || state.clip === name) {
    return state?.clip || null;
  }
  const played = playHeroAnim(state.id, name, true, HERO_FADE);
  if (played) {
    state.clip = played;
  }
  return state.clip;
}

export function spawnHero(parent, position, key = 'axe', id = key) {
  const container = _containers.get(key);
  const config = heroConfig(key);
  if (!container || !config) {
    return null;
  }
  despawnHero(id);
  const instance = instantiateGltf(container);
  instance.animationGroups.forEach((group) => group.stop());

  const root = mkGroup(`${key}_hero_root`);
  root.position.copy(position);
  root.scale.setScalar(config.scale);
  instance.rootNodes.forEach((node) => {
    node.visible = true;
    node.traverse((child) => {
      if (child.isSkinnedMesh || child.isMesh) {
        // Bind-pose bounds don't cover skinned weapon arcs — never cull.
        child.frustumCulled = false;
        child.userData.pickable = true;
        child.userData.heroEntityId = id;
        if (scene && scene._registerShadows) {
          scene._registerShadows(child);
        }
      }
    });
    root.add(node);
  });

  const selDisc = mkTorus(`sel_${key}_hero`, 4.2, 0.09, 40);
  selDisc.position.y = 0.06;
  selDisc.visible = false;
  const selMat = new THREE.MeshBasicMaterial();
  selMat.color = new THREE.Color(0, 1, 0.53);
  selMat.transparent = true;
  selDisc.material = selMat;
  root.add(selDisc);
  root._selDisc = selDisc;

  const blob = mkDisc(`${key}_hero_shadow`, 0.9, 16, false);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  const blobMaterial = new THREE.MeshBasicMaterial();
  blobMaterial.color = new THREE.Color(0, 0, 0);
  blobMaterial.opacity = 0.5;
  blobMaterial.transparent = true;
  blobMaterial.polygonOffset = true;
  blobMaterial.polygonOffsetFactor = -1;
  blob.material = blobMaterial;
  blob.userData.pickable = false;
  root.add(blob);

  // Floating HP bar for team fighters (hidden until the hero joins a team).
  // A sprite is always camera-facing on the GPU — a lookAt-driven plane flips
  // through edge-on (and near-degenerate overhead) orientations every frame,
  // which reads as a flickering black line/rect. Left-anchored by offsetting
  // x with the hp fraction so it shrinks toward the left edge.
  const barMat = new THREE.SpriteMaterial({ color: 0x22c55e });
  barMat.depthTest = false;
  barMat.depthWrite = false;
  barMat.transparent = true;
  const hpBar = new THREE.Sprite(barMat);
  hpBar.scale.set(1.7, 0.2, 1);
  hpBar.position.set(0, 2.9, 0);
  hpBar.renderOrder = 10;
  hpBar.visible = false;
  hpBar.userData.pickable = false;
  root.add(hpBar);

  parent.add(root);
  const state = {
    id, key, root, instance, moveTarget: null, clip: null, manual: false,
    focusId: null,
    team: null, teamRing: null, hpBar,
    hp: config.hp ?? HERO_DEFAULTS.hp,
    maxHp: config.hp ?? HERO_DEFAULTS.hp,
    alive: true, cooldown: 0, deadTimer: 0,
  };
  _active.set(id, state);
  playHeroAnim(id, config.idle, true);
  state.clip = config.idle;
  return state;
}

// ── Selection (multi-select set shared by all heroes) ───────────────────────

export function getSelectedHeroIds() {
  return [..._selectedIds];
}

export function getSelectedHeroId() {
  return _selectedIds.size ? [..._selectedIds][0] : null;
}

export function isHeroSelected(id) {
  return id !== undefined && _selectedIds.has(id);
}

export function selectHero(id) {
  if (!_active.has(id)) {
    return false;
  }
  _selectedIds.add(id);
  const root = _active.get(id).root;
  if (root._selDisc) {
    root._selDisc.visible = true;
  }
  return true;
}

export function deselectHero(id) {
  const targets = id === undefined ? [..._selectedIds] : [id];
  for (const target of targets) {
    if (_active.has(target)) {
      const root = _active.get(target).root;
      if (root._selDisc) {
        root._selDisc.visible = false;
      }
    }
    _selectedIds.delete(target);
  }
}

// ── Orders ──────────────────────────────────────────────────────────────────

export function orderHeroMove(id, point) {
  const state = _active.get(id);
  if (!state || !point) {
    return false;
  }
  const bound = currentBounds();
  state.moveTarget = new THREE.Vector3(
    Math.max(-bound, Math.min(bound, point.x)), 0,
    Math.max(-bound, Math.min(bound, point.z)),
  );
  // A player order takes over: combat AI stands down until arrival.
  state.manual = true;
  state.focusId = null;
  _setHeroClip(state, heroConfig(state.key).run);
  return true;
}

// Orders a team fighter to hunt one enemy hero: the AI chases that target
// past nearer enemies until it dies or a ground order cancels the focus.
export function orderHeroAttack(id, targetId) {
  const state = _active.get(id);
  const target = _active.get(targetId);
  if (!state || !target || !state.team || !target.team || target.team === state.team || !target.alive) {
    return false;
  }
  state.focusId = targetId;
  state.manual = false;
  return true;
}

export function stopHero(id = 'axe') {
  const state = _active.get(id);
  if (!state) {
    return;
  }
  state.moveTarget = null;
  state.manual = false;
  state.focusId = null;
  _setHeroClip(state, heroConfig(state.key).idle);
}

// ── Skirmish teams ──────────────────────────────────────────────────────

export function heroTeam(id) {
  return _active.get(id)?.team || null;
}

// Assigns a spawned hero to 'radiant' | 'dire' (or null to go neutral).
// Team fighters get a colored ground ring, a visible HP bar, and fight only
// on explicit focus orders; neutrals stay selectable and movable but never
// fight.
export function setHeroTeam(id, team) {
  const state = _active.get(id);
  if (!state) {
    return false;
  }
  if (state.teamRing) {
    state.root.remove(state.teamRing);
    state.teamRing = null;
  }
  state.team = team && HERO_TEAM_COLORS[team] !== undefined ? team : null;
  state.hpBar.visible = !!state.team;
  if (state.team) {
    const ring = mkTorus(`team_${state.team}_${id}`, 2.4, 0.12, 32);
    ring.position.y = 0.05;
    const ringMat = new THREE.MeshBasicMaterial();
    ringMat.color = new THREE.Color(HERO_TEAM_COLORS[state.team]);
    ringMat.transparent = true;
    ringMat.depthWrite = false;
    ring.material = ringMat;
    ring.userData.pickable = false;
    state.root.add(ring);
    state.teamRing = ring;
  }
  return true;
}

export function teamAliveCounts() {
  const counts = { radiant: 0, dire: 0 };
  for (const state of _active.values()) {
    if (state.team && state.alive) {
      counts[state.team] += 1;
    }
  }
  return counts;
}

function _refreshHpBar(state) {
  if (!state.hpBar) {
    return;
  }
  const frac = Math.max(0, state.hp / state.maxHp);
  state.hpBar.scale.x = Math.max(1.7 * frac, 0.0001);
  state.hpBar.position.x = -0.85 + 0.85 * frac;
  state.hpBar.material.color.setRGB(1 - frac * 0.85, 0.15 + frac * 0.6, 0.2);
}

// Applies damage to a team fighter; neutrals can't be damaged. On death the
// death clip plays once and the corpse is removed after a short delay.
export function damageHero(id, amount) {
  const state = typeof id === 'string' ? _active.get(id) : null;
  if (!state || !state.team || !state.alive) {
    return false;
  }
  state.hp -= amount;
  _refreshHpBar(state);
  if (state.hp > 0) {
    return true;
  }
  state.alive = false;
  state.moveTarget = null;
  state.cooldown = 0;
  state.deadTimer = 2.5;
  // A near-zero-width bar over the corpse shimmers as a flickering sliver.
  if (state.hpBar) {
    state.hpBar.visible = false;
  }
  const config = heroConfig(state.key);
  playHeroAnim(state.id, config.deathName || 'death', false, HERO_FADE);
  state.clip = config.deathName || 'death';
  return true;
}

// Ranged-attack projectiles: small glowing spheres homing in on the victim's
// current position. Purely procedural — no model files involved.
const _projectiles = [];

export function heroProjectiles() {
  return [..._projectiles];
}

function _fireProjectile(attacker, victim, damage) {
  const parent = attacker.root.parent;
  if (!parent) {
    damageHero(victim.id, damage);
    return;
  }
  const config = heroConfig(attacker.key);
  const geo = new THREE.SphereGeometry(0.16, 10, 8);
  const mat = new THREE.MeshBasicMaterial();
  mat.color = new THREE.Color(HERO_TEAM_COLORS[attacker.team] ?? 0xffffff);
  mat.transparent = true;
  mat.depthWrite = false;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(attacker.root.position);
  mesh.position.y = 1.6;
  mesh.userData.pickable = false;
  parent.add(mesh);
  _projectiles.push({
    mesh, victimId: victim.id, damage,
    speed: config.projectileSpeed || HERO_DEFAULTS.projectileSpeed,
    life: 5,
  });
}

function _tickProjectiles(deltaTime) {
  for (let i = _projectiles.length - 1; i >= 0; i--) {
    const proj = _projectiles[i];
    const victim = _active.get(proj.victimId);
    proj.life -= deltaTime;
    if (!victim || !victim.alive || proj.life <= 0) {
      proj.mesh.parent?.remove(proj.mesh);
      _projectiles.splice(i, 1);
      continue;
    }
    const target = victim.root.position;
    const dx = target.x - proj.mesh.position.x;
    const dz = target.z - proj.mesh.position.z;
    const dy = 1.2 - proj.mesh.position.y;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= 0.9) {
      damageHero(proj.victimId, proj.damage);
      proj.mesh.parent?.remove(proj.mesh);
      _projectiles.splice(i, 1);
      continue;
    }
    const step = Math.min(distance, proj.speed * deltaTime);
    proj.mesh.position.x += (dx / distance) * step;
    proj.mesh.position.y += (dy / distance) * step;
    proj.mesh.position.z += (dz / distance) * step;
  }
}

// Focus target only (right-clicked enemy). No auto-acquire: fighters hold
// position unless explicitly ordered to hunt. A dead or missing focus is
// dropped, the chase target is cancelled, and the fighter holds.
function _pickEnemy(state) {
  if (!state.focusId) {
    return null;
  }
  const focus = _active.get(state.focusId);
  if (focus && focus.team && focus.team !== state.team && focus.alive) {
    const dx = focus.root.position.x - state.root.position.x;
    const dz = focus.root.position.z - state.root.position.z;
    return { state: focus, distance: Math.hypot(dx, dz) };
  }
  state.focusId = null;
  state.moveTarget = null;
  return null;
}

let _teamGameEnded = false;

function _checkTeamVictory() {
  if (_teamGameEnded) {
    return;
  }
  let spawned = 0;
  const alive = { radiant: 0, dire: 0 };
  for (const state of _active.values()) {
    if (!state.team) {
      continue;
    }
    spawned += 1;
    if (state.alive) {
      alive[state.team] += 1;
    }
  }
  if (!spawned) {
    return;
  }
  const radiantDead = alive.radiant === 0;
  const direDead = alive.dire === 0;
  if (!radiantDead && !direDead) {
    return;
  }
  _teamGameEnded = true;
  const winner = radiantDead && direDead
    ? null
    : (radiantDead ? 'dire' : 'radiant');
  setGameOver(true);
  try {
    // The overlay is flex-centered with a PLAY AGAIN button — update only
    // the headline so layout and restart survive; never wipe its children.
    const winText = document.getElementById('winText');
    if (winText) {
      winText.textContent = winner ? `${HERO_TEAM_LABELS[winner]} VICTORY` : 'DRAW';
    }
    const winEl = document.getElementById('win');
    if (winEl) {
      winEl.style.display = 'flex';
    }
  } catch (_) { /* headless */ }
}

// Per-frame drive for every active hero: call from the game tick.
export function tickHeroes(deltaTime) {
  const dead = [];
  for (const state of _active.values()) {
    const config = heroConfig(state.key);
    if (!state.alive) {
      // Corpse timer: the death clip plays out, then the body is removed.
      state.deadTimer -= deltaTime;
      if (state.deadTimer <= 0) {
        dead.push(state.id);
      }
      continue;
    }
    // Movement toward the current move target (player order or chase).
    if (state.moveTarget) {
      const dx = state.moveTarget.x - state.root.position.x;
      const dz = state.moveTarget.z - state.root.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= HERO_ARRIVE_RADIUS) {
        state.moveTarget = null;
        // A completed player order hands control back to combat AI.
        state.manual = false;
        _setHeroClip(state, config.idle);
      } else {
        state.root.rotation.y = Math.atan2(dx, dz);
        const step = Math.min(distance, config.speed * deltaTime);
        state.root.position.x += (dx / distance) * step;
        state.root.position.z += (dz / distance) * step;
        _setHeroClip(state, config.run);
      }
    }
    // Team combat AI: chase the ordered focus target, strike in range.
    // Without a focus order the fighter holds (no auto-acquire). Stands down
    // while a player move order (manual) is in progress; holds on arrival.
    if (state.team && !state.manual) {
      const contact = _pickEnemy(state);
      if (!contact) {
        if (!state.moveTarget) {
          _setHeroClip(state, config.idle);
        }
      } else {
        const enemy = contact.state;
        const range = config.attackRange ?? HERO_DEFAULTS.attackRange;
        state.root.rotation.y = Math.atan2(
          enemy.root.position.x - state.root.position.x,
          enemy.root.position.z - state.root.position.z,
        );
        if (contact.distance > range) {
          state.moveTarget = enemy.root.position.clone().setY(0);
        } else {
          state.moveTarget = null;
          state.cooldown -= deltaTime;
          _setHeroClip(state, config.attackName || 'attack');
          if (state.cooldown <= 0) {
            state.cooldown = config.cooldown ?? HERO_DEFAULTS.cooldown;
            const damage = config.damage ?? HERO_DEFAULTS.damage;
            if ((config.attackKind || 'melee') === 'ranged') {
              _fireProjectile(state, enemy, damage);
            } else {
              damageHero(enemy.id, damage);
            }
          }
        }
      }
    }
  }
  for (const id of dead) {
    despawnHero(id);
  }
  _tickProjectiles(deltaTime);
  _checkTeamVictory();
}
