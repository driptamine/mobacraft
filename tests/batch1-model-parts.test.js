import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const root = new URL('../', import.meta.url);
const heroes = JSON.parse(fs.readFileSync(new URL('animations/batches/1/animations.json', root)));

function readGlb(relative) {
  const bytes = fs.readFileSync(new URL(relative, root));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const bin = bytes.subarray(28 + jsonLength);
  return { bytes, json, bin };
}

function accessorBytes(file, ai) {
  const acc = file.json.accessors[ai];
  const view = file.json.bufferViews[acc.bufferView];
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const components = { VEC3: 3, MAT4: 16 }[acc.type];
  assert.equal(acc.componentType, 5126);
  return file.bin.subarray(start, start + acc.count * components * 4);
}

for (const [name, hero] of Object.entries(heroes)) {
  test(`${name} includes its wearables, embedded textures and animated attachments`, async () => {
    const assembled = readGlb(hero.model);
    const body = readGlb(hero.sourceModel);
    assert.deepEqual(assembled.json.animations, body.json.animations, 'body animation channels stay intact');
    assert.ok(hero.parts.length >= 3, 'complete outfit is specified');
    let meshCount = body.json.meshes.length;
    for (const part of hero.parts) {
      const donor = readGlb(path.posix.join(path.posix.dirname(hero.sourceModel), part));
      meshCount += donor.json.meshes.length;
      for (const node of donor.json.nodes.filter((n) => n.mesh !== undefined)) {
        const meshName = donor.json.meshes[node.mesh].name;
        const meshIndex = assembled.json.meshes.findIndex((m) => m.name === meshName);
        assert.ok(meshIndex >= 0, `${part} geometry is present`);
        const resultNode = assembled.json.nodes.find((n) => n.mesh === meshIndex);
        const resultSkin = assembled.json.skins[resultNode.skin];
        const sourceSkin = donor.json.skins[node.skin];
        assert.deepEqual(accessorBytes(assembled, resultSkin.inverseBindMatrices), accessorBytes(donor, sourceSkin.inverseBindMatrices), `${part} keeps its binding offsets`);
        const original = donor.json.meshes[node.mesh].primitives;
        const result = assembled.json.meshes[meshIndex].primitives;
        assert.equal(result.length, original.length);
        for (let i = 0; i < original.length; i++) {
          assert.deepEqual(accessorBytes(assembled, result[i].attributes.POSITION), accessorBytes(donor, original[i].attributes.POSITION), `${part} keeps its vertices`);
          assert.equal(result[i].targets?.length, original[i].targets?.length, 'facial morphs survive');
        }
      }
    }
    assert.equal(assembled.json.meshes.length, meshCount);
    for (const image of assembled.json.images) {
      assert.equal(image.uri, undefined, 'texture must travel with the final GLB');
      const view = assembled.json.bufferViews[image.bufferView];
      assert.ok(view.byteOffset + view.byteLength <= assembled.bin.length);
      assert.equal(assembled.bin.toString('hex', view.byteOffset, view.byteOffset + 8), '89504e470d0a1a0a', 'embedded PNG bytes resolve');
    }

    // Decode actual meshes, morphs, skins and clips with the game's loader.
    // Texture decoding alone needs browser APIs; structural checks above
    // validate those bytes without a DOM or a GPU.
    const loader = new GLTFLoader().register(() => ({
      name: 'headless-textures',
      loadTexture: () => Promise.resolve(new THREE.Texture()),
    }));
    const bytes = assembled.bytes;
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    let skinnedCount = 0;
    gltf.scene.traverse((mesh) => { if (mesh.isSkinnedMesh) skinnedCount++; });
    assert.equal(skinnedCount, meshCount, 'body and every wearable are skinned');
    const mixer = new THREE.AnimationMixer(gltf.scene);
    for (const action of ['idle', 'run', 'melee']) {
      const clip = gltf.animations.find((a) => a.name === hero.actions[action]);
      assert.ok(clip, `${action} clip loads`);
      mixer.stopAllAction();
      mixer.clipAction(clip).play();
      mixer.setTime(Math.min(0.5, clip.duration / 2));
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene, true);
      for (const value of [...box.min.toArray(), ...box.max.toArray()]) {
        assert.ok(Number.isFinite(value) && Math.abs(value) < 100, `${action} geometry stays finite and near the hero`);
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
    gltf.scene.traverse((mesh) => { if (mesh.isMesh) mesh.geometry.dispose(); });
  });
}
