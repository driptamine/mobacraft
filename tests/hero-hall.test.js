import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./node-esm-hooks.mjs', import.meta.url);

function fakeEl() {
  return {
    children: [],
    parent: null,
    style: {},
    dataset: {},
    textContent: '',
    className: '',
    id: '',
    _handlers: {},
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    addEventListener(ev, fn) { this._handlers[ev] = fn; },
    remove() {
      if (this.parent) {
        this.parent.children = this.parent.children.filter((c) => c !== this);
        this.parent = null;
      }
    },
  };
}
function fakeDocument() {
  const body = fakeEl();
  return {
    body,
    created: [],
    getElementById: () => null,
    createElement() {
      const el = fakeEl();
      this.created.push(el);
      return el;
    },
  };
}
globalThis.window = {};
globalThis.document = fakeDocument();

const sceneMod = await import('../src/scene.js');
const headlessScene = new THREE.Scene();
sceneMod.__setSceneCameraForTests(headlessScene, { target: new THREE.Vector3() });

const heroMod = await import('../src/hero.js');
const hallMod = await import('../src/hero-hall.js');

function stubContainer(clips = ['idle']) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()));
  return { scene: group, animations: clips.map((name) => new THREE.AnimationClip(name, 1, [])) };
}

describe('hero hall', () => {
  it('grid data lists all fourteen heroes with titles', () => {
    const data = hallMod.heroGridData();
    assert.equal(data.length, 14);
    assert.equal(data[0].title, 'Axe');
    assert.ok(data.every((d) => d.title && d.key));
  });

  it('spawns a tagged procedural hall', () => {
    const parent = new THREE.Group();
    const hall = hallMod.spawnHeroHall(parent, new THREE.Vector3(5, 0, 5));
    assert.ok(hall);
    assert.equal(hall.root.parent, parent);
    let tagged = 0, meshes = 0;
    hall.root.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        if (o.userData.pickable && o.userData.heroHall) tagged++;
      }
    });
    assert.ok(meshes > 0 && tagged === meshes, 'every mesh pickable as hall');
    hallMod.despawnHeroHall();
    assert.equal(hall.root.parent, null);
    assert.equal(hallMod.getHeroHall(), null);
  });

  it('opens a ten-card grid and closes it', () => {
    assert.equal(hallMod.isHeroGridOpen(), false);
    const panel = hallMod.openHeroGrid();
    assert.ok(panel);
    assert.equal(hallMod.isHeroGridOpen(), true);
    const cards = globalThis.document.created.filter((el) => el.dataset && el.dataset.hero);
    assert.equal(cards.length, 14);
    assert.deepEqual(cards.map((c) => c.dataset.hero).sort(), [...heroMod.HERO_BATCH_1].sort());
    assert.equal(hallMod.toggleHeroGrid(), false);
    assert.equal(hallMod.isHeroGridOpen(), false);
  });

  it('card click loads, spawns and selects the hero', async () => {
    const parent = new THREE.Group();
    hallMod.spawnHeroHall(parent, new THREE.Vector3(0, 0, 0));
    await heroMod.loadHero('lina', { loadModel: async () => stubContainer(['idle', 'run']) });
    hallMod.openHeroGrid();
    const card = globalThis.document.created.find((el) => el.dataset && el.dataset.hero === 'lina');
    assert.ok(card && card._handlers.click);
    await card._handlers.click();
    const lina = heroMod.getHero('lina');
    assert.ok(lina, 'lina spawned by the hall');
    assert.equal(heroMod.isHeroSelected('lina'), true);
    hallMod.despawnHeroHall();
    heroMod.despawnHero('lina');
    hallMod.closeHeroGrid();
  });
});
