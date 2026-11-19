import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { recruitableHeroes } from '../../stats/races/heroes.js';
import { abilityShotStyle, kitFor, type ShotStyle } from '../heroes/hero-kits.js';
import { createHeroProjectile, createHeroShotImpact, disposeShotVisual, heroShotOrigin } from '../heroes/hero-shot-visuals.js';
import { modelUrl } from '../render/assets.js';
import { loadGltf, type GltfContainer } from '../render/gltf-models.js';
import './hero-shot-preview.css';

type ProjectileHero = (typeof recruitableHeroes)[number] & { model: string };
const heroes = recruitableHeroes.filter((hero): hero is ProjectileHero => {
  const kit = kitFor(hero.name);
  return !!(hero.name && hero.model && (kit?.primary || kit?.abilities.some(ability => ability.shot)));
}).sort((a, b) => Number(!!kitFor(b.name)?.primary) - Number(!!kitFor(a.name)?.primary));
const batches = [...new Set(heroes.map(hero => hero.batch))].sort((a, b) => a - b);
const names: Record<string, string> = { drow: 'Drow Ranger' };

export function mountHeroShotPreview(): void {
  const page = document.createElement('main');
  page.className = 'shot-preview';
  page.innerHTML = `
    <header><h1>Стрельбище</h1><a href="/">В игру</a></header>
    <div class="shot-preview-layout">
      <section class="shot-preview-controls" aria-label="Настройки выстрела">
        <label>Batch<select id="shot-batch"></select></label>
        <label>Герой<select id="shot-hero"></select></label>
        <label>Действие<select id="shot-action"></select></label>
        <label>Скорость<select id="shot-speed"><option value="1">1×</option><option value="0.45" selected>0,45×</option><option value="0.25">0,25×</option></select></label>
        <button id="shot-fire" type="button" disabled>Атака</button>
        <p id="shot-status" role="status"></p>
      </section>
      <section id="shot-stage" aria-label="Тренировочная сцена"></section>
    </div>`;
  document.body.replaceChildren(page);
  const batchSelect = page.querySelector<HTMLSelectElement>('#shot-batch')!;
  const heroSelect = page.querySelector<HTMLSelectElement>('#shot-hero')!;
  const actionSelect = page.querySelector<HTMLSelectElement>('#shot-action')!;
  const speed = page.querySelector<HTMLSelectElement>('#shot-speed')!;
  const attack = page.querySelector<HTMLButtonElement>('#shot-fire')!;
  const status = page.querySelector<HTMLElement>('#shot-status')!;
  const stage = page.querySelector<HTMLElement>('#shot-stage')!;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.setAttribute('aria-label', 'Анимация атаки героя и попадания снаряда');
  stage.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111921);
  scene.fog = new THREE.FogExp2(0x111921, .027);
  scene.add(new THREE.HemisphereLight(0xc7e9ff, 0x756450, 2.1));
  const key = new THREE.DirectionalLight(0xffdfb6, 2.7);
  key.position.set(-9, 13, 5);
  const rim = new THREE.DirectionalLight(0x89bbef, 2.2);
  rim.position.set(5, 7, -8);
  scene.add(key, rim);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.MeshStandardMaterial({ color: 0x192027, roughness: .84 }));
  ground.rotateX(-Math.PI / 2);
  ground.position.y = -.24;
  scene.add(ground);
  const grid = new THREE.GridHelper(100, 100, 0x4b615f, 0x2b3c40);
  grid.position.y = -.23;
  scene.add(grid);

  const heroAt = new THREE.Vector3(-5.4, 0, 0), targetAt = new THREE.Vector3(5.4, 1.8, 0);
  for (const x of [heroAt.x, targetAt.x]) {
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(1.47, 1.6, .24, 32), new THREE.MeshStandardMaterial({ color: 0x384655, roughness: .72, metalness: .43 }));
    dais.position.set(x, -.12, 0);
    scene.add(dais);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.12, 1.16, 48), new THREE.MeshBasicMaterial({ color: x < 0 ? 0x84cab3 : 0xea9d69, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, .012, 0);
    scene.add(ring);
  }
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(.12, .22, 1.9, 10), new THREE.MeshStandardMaterial({ color: 0x7c8585, metalness: .6, roughness: .46 }));
  stand.position.set(targetAt.x, .95, 0);
  scene.add(stand);
  const dummy = new THREE.Group();
  dummy.position.copy(targetAt);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(.71, .75, .34, 10), new THREE.MeshStandardMaterial({ color: 0x8b4c34, roughness: .57, metalness: .26 }));
  shell.rotateZ(Math.PI / 2);
  const hitMaterial = new THREE.MeshStandardMaterial({ color: 0xf3ab6a, emissive: 0xffad71, emissiveIntensity: .28 });
  const bullseye = new THREE.Mesh(new THREE.RingGeometry(.25, .39, 32), hitMaterial);
  bullseye.rotateY(-Math.PI / 2);
  bullseye.position.x = -.18;
  dummy.add(shell, bullseye);
  scene.add(dummy);

  const camera = new THREE.PerspectiveCamera(42, 1, .1, 180);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, 1.15, 0);
  orbit.minDistance = 9;
  orbit.maxDistance = 45;
  orbit.maxPolarAngle = Math.PI * .49;
  let cameraReady = false;
  new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!width || !height) return;
    camera.aspect = width / height;
    if (!cameraReady) {
      camera.position.set(1, 5.9, width < 660 ? 21.5 : 16.1);
      cameraReady = true;
    }
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    orbit.update();
  }).observe(stage);

  batchSelect.append(...batches.map(batch => new Option(`Batch ${batch}`, String(batch))));
  const actor = new THREE.Group();
  actor.position.copy(heroAt);
  actor.rotation.y = Math.PI / 2;
  scene.add(actor);
  let container: GltfContainer | undefined;
  let mixer: THREE.AnimationMixer | undefined;
  let idle: THREE.AnimationAction | undefined, fire: THREE.AnimationAction | undefined;
  let actions: { name: string; style: ShotStyle; clip: string }[] = [];
  let request = 0;
  let shot: { style: ShotStyle; wait: number; projectile?: ReturnType<typeof createHeroProjectile>; impact?: ReturnType<typeof createHeroShotImpact>; age: number } | undefined;

  function clearShot(): void {
    if (shot?.projectile) disposeShotVisual(shot.projectile.root);
    if (shot?.impact) disposeShotVisual(shot.impact.root);
    shot = undefined;
    dummy.rotation.y = 0;
    hitMaterial.emissiveIntensity = .28;
  }

  async function selectHero(): Promise<void> {
    const ticket = ++request;
    const hero = heroes.find(item => item.name === heroSelect.value)!;
    const kit = kitFor(hero.name)!;
    const clips = hero.animations as Record<string, string>;
    clearShot();
    attack.disabled = true;
    if (container && mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(container.scene);
      container.scene.removeFromParent();
      container.dispose();
    }
    container = mixer = fire = idle = undefined;
    actions = kit.primary ? [{ name: 'Обычная атака', style: { ...kit.primary, color: kit.color }, clip: clips.firing }] : [];
    for (const ability of kit.abilities) {
      const style = abilityShotStyle(ability, kit.color);
      if (style) actions.push({ name: ability.name, style, clip: kit.castClip || clips.firing });
    }
    actionSelect.replaceChildren(...actions.map((action, i) => new Option(action.name, String(i))));
    actionSelect.disabled = false;
    status.textContent = 'Загрузка модели…';
    try {
      const loaded = await loadGltf(modelUrl(`/${hero.model.replace(/^\/+/, '')}`));
      if (ticket !== request) { loaded.dispose(); return; }
      container = loaded;
      const bounds = new THREE.Box3().setFromObject(loaded.scene);
      const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      const scale = 3.25 / Math.max(size.y, 1e-6);
      loaded.scene.scale.multiplyScalar(scale);
      loaded.scene.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      actor.add(loaded.scene);
      mixer = new THREE.AnimationMixer(loaded.scene);
      const idleClip = THREE.AnimationClip.findByName(loaded.animations, clips.idle);
      if (idleClip) idle = mixer.clipAction(idleClip).play();
      mixer.addEventListener('finished', () => { fire?.stop(); idle?.reset().play(); });
      refreshAttack();
    } catch {
      if (ticket === request) status.textContent = 'Не удалось загрузить модель. Выберите героя повторно.';
    }
  }

  function refreshAttack(): void {
    if (!container || shot) return;
    const clip = actions[Number(actionSelect.value)].clip;
    const available = THREE.AnimationClip.findByName(container.animations, clip) !== null;
    attack.disabled = !available;
    status.textContent = available ? 'Готов к атаке' : 'Анимация атаки не найдена';
  }

  attack.addEventListener('click', () => {
    if (!container || !mixer || shot) return;
    const chosen = actions[Number(actionSelect.value)];
    const clip = THREE.AnimationClip.findByName(container.animations, chosen.clip);
    if (!clip) return;
    fire?.stop();
    idle?.stop();
    fire = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1).play();
    attack.disabled = true;
    actionSelect.disabled = true;
    status.textContent = 'Замах';
    shot = { style: chosen.style, wait: Math.min(.46, clip.duration * .36), age: 0 };
  });
  actionSelect.addEventListener('change', refreshAttack);
  heroSelect.addEventListener('change', () => { void selectHero(); });
  function selectBatch(batch: number): void {
    heroSelect.replaceChildren(...heroes.filter(hero => hero.batch === batch)
      .map(hero => new Option(names[hero.name] || kitFor(hero.name)!.name, hero.name)));
    void selectHero();
  }
  batchSelect.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('batch', batchSelect.value);
    history.replaceState(null, '', url);
    selectBatch(Number(batchSelect.value));
  });

  let previous: number | undefined;
  renderer.setAnimationLoop(now => {
    const dt = Math.min(.05, previous === undefined ? 0 : (now - previous) / 1000) * Number(speed.value);
    previous = now;
    mixer?.update(dt);
    if (shot?.impact) {
      shot.age += dt;
      const p = Math.min(1, shot.age / shot.impact.duration);
      shot.impact.advance(p);
      dummy.rotation.y = Math.sin(p * 11) * .38 * (1 - p);
      hitMaterial.emissiveIntensity = .28 + (1 - p) * 2;
      if (p === 1) { clearShot(); actionSelect.disabled = false; attack.disabled = false; }
    } else if (shot?.projectile) {
      const contact = shot.projectile.advance(dt, targetAt);
      if (contact) {
        disposeShotVisual(shot.projectile.root);
        shot.projectile = undefined;
        shot.impact = createHeroShotImpact(contact.at, shot.style);
        shot.impact.advance(0);
        scene.add(shot.impact.root);
        status.textContent = 'Попадание';
      }
    } else if (shot) {
      shot.wait -= dt;
      if (shot.wait <= 0) {
        const from = heroShotOrigin(actor, heroSelect.value, heroAt.clone().add(new THREE.Vector3(.64, 1.95, 0)));
        from.x += .16;
        shot.projectile = createHeroProjectile(from, targetAt, shot.style);
        scene.add(shot.projectile.root);
        status.textContent = 'Снаряд в полёте';
      }
    }
    renderer.render(scene, camera);
  });
  const requestedBatch = Number(new URLSearchParams(location.search).get('batch'));
  const initialBatch = batches.includes(requestedBatch) ? requestedBatch : batches[0];
  batchSelect.value = String(initialBatch);
  selectBatch(initialBatch);
}
