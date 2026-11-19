import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function fixture(file, name, restX, bindX, helper = false) {
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: 'hand', translation: [restX, 0, 0] }, { name, mesh: 0, skin: 0 }],
    meshes: [], skins: [], animations: [], accessors: [], bufferViews: [],
    images: [], textures: [], samplers: [], materials: [], buffers: [],
  };
  const chunks = [];
  if (helper) {
    json.nodes[0].children = [2];
    json.nodes.push({ name: 'finger', translation: [1, 0, 0] });
  }
  let length = 0;
  function accessor(array, type, count, componentType = 5126, extra = {}) {
    const padding = (4 - length % 4) % 4;
    chunks.push(Buffer.alloc(padding));
    length += padding;
    const view = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: array.byteLength });
    chunks.push(Buffer.from(array.buffer));
    length += array.byteLength;
    json.accessors.push({ bufferView: view, componentType, count, type, ...extra });
    return json.accessors.length - 1;
  }
  const position = accessor(new Float32Array([3, 0, 0, 3, 1, 0, 3, 0, 1]), 'VEC3', 3, 5126, { min: [3, 0, 0], max: [3, 1, 1] });
  const joints = accessor(new Uint16Array(12), 'VEC4', 3, 5123);
  const weights = accessor(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 'VEC4', 3);
  const ibm = accessor(new Float32Array(new THREE.Matrix4().makeTranslation(-bindX - (helper ? 1 : 0), 0, 0).elements), 'MAT4', 1);
  json.skins.push({ joints: [helper ? 2 : 0], inverseBindMatrices: ibm });
  json.meshes.push({ name, primitives: [{ attributes: { POSITION: position, JOINTS_0: joints, WEIGHTS_0: weights } }] });
  const times = accessor(new Float32Array([0, 1]), 'SCALAR', 2, 5126, { min: [0], max: [1] });
  const motion = accessor(new Float32Array([10, 0, 0, 20, 0, 0]), 'VEC3', 2);
  json.animations.push({ name: 'move', samplers: [{ input: times, output: motion }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] });
  const bin = Buffer.concat(chunks);
  json.buffers.push({ byteLength: bin.length });
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.write('glTF'); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + bin.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length); binHeader.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, padded, binHeader, bin]));
}

test('wearables bind to the animated hand even when exported in another rest pose', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-parts-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const master = path.join(temp, 'body.glb');
  const donor = path.join(temp, 'weapon.glb');
  const output = path.join(temp, 'combined.glb');
  fixture(master, 'body', 10, 10);
  fixture(donor, 'weapon', 2, 2);
  execFileSync(process.execPath, ['scripts/merge-hero-parts.mjs', '--out', output, master, donor]);
  const bytes = fs.readFileSync(output);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const weapon = gltf.scene.getObjectByName('weapon');
  const body = gltf.scene.getObjectByName('body');
  assert.equal(weapon.skeleton.bones[0], body.skeleton.bones[0], 'one animated skeleton drives both meshes');
  gltf.scene.updateMatrixWorld(true);
  assert.equal(weapon.getVertexPosition(0, new THREE.Vector3()).x, 11, 'weapon uses its own binding offset at the master hand');
  assert.equal(gltf.animations.length, 1, 'only master animation survives');
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations[0]).play();
  mixer.setTime(0.5);
  gltf.scene.updateMatrixWorld(true);
  assert.equal(weapon.getVertexPosition(0, new THREE.Vector3()).x, 16, 'weapon follows the animated hand');
});

test('wearable helper bones attach beneath the matching animated body bone', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-helper-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const master = path.join(temp, 'body.glb');
  const donor = path.join(temp, 'glove.glb');
  const output = path.join(temp, 'combined.glb');
  fixture(master, 'body', 10, 10);
  fixture(donor, 'glove', 2, 2, true);
  execFileSync(process.execPath, ['scripts/merge-hero-parts.mjs', '--out', output, master, donor]);
  const bytes = fs.readFileSync(output);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const glove = gltf.scene.getObjectByName('glove');
  const body = gltf.scene.getObjectByName('body');
  assert.equal(glove.skeleton.bones[0].parent, body.skeleton.bones[0]);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations[0]).play();
  mixer.setTime(0.5);
  gltf.scene.updateMatrixWorld(true);
  assert.equal(glove.getVertexPosition(0, new THREE.Vector3()).x, 16);
});
