import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

globalThis.window = {};
globalThis.document = { getElementById: () => null };
const scene = await import('../src/core/scene.js');
scene.__setSceneCameraForTests(new THREE.Scene(), { target: new THREE.Vector3() });
const { soldierRingDiameter, _makeFactionSoldierMesh } = await import('../src/meshes/soldiers.js');
const heroes = await import('../stats/races/batch1/heroes.js');

test('hero portraits ship as official png files', () => {
  for (const hero of heroes.batch1Heroes) {
    const rel = hero.icon;
    assert.ok(rel && rel.endsWith('.png'), `${hero.name} icon is a png`);
    assert.ok(fs.existsSync(path.join(root, rel)), `${rel} exists`);
  }
});

test('hero ground rings run wider than infantry', () => {
  assert.equal(soldierRingDiameter('axe'), 4.0);
  assert.equal(soldierRingDiameter('guardsmen'), 1.5);
  assert.equal(soldierRingDiameter(undefined), 1.5);
});

test('hero meshes get the wide selection torus', () => {
  const model = new THREE.Group();
  const container = { scene: model, meshes: [], _hiddenNodes: [], dispose() {}, animations: [] };
  const heroRoot = _makeFactionSoldierMesh(container, 'blue', { unitType: 'axe', faction: 'ig' }, 'ig');
  const troopRoot = _makeFactionSoldierMesh(container, 'blue', { unitType: 'guardsmen', faction: 'ig' }, 'ig');
  assert.equal(heroRoot._selDisc.geometry.parameters.radius, 2.0);
  assert.equal(troopRoot._selDisc.geometry.parameters.radius, 0.75);
});

test('HQ grid offers a heroes window that trains from the roster', () => {
  const src = fs.readFileSync(path.join(root, 'src/hud/components/ActionsGrid.tsx'), 'utf8');
  assert.ok(src.includes("label=\"HEROES\""), 'HQ grid has a HEROES button');
  assert.ok(src.includes('batch1Heroes.map((hero)'), 'modal lists the batch 1 roster');
  assert.ok(src.includes('onClick={() => { train(hero); setHeroesOpen(false); }}'), 'picking a hero queues training');
  assert.ok(src.includes("factionKey === 'ig'"), 'heroes window is IG HQ only');
});
