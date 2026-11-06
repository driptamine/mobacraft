// Merge wearable part GLBs (weapon, armor, ...) into a hero body GLB so the
// combined file is game-ready: parts share the master skeleton, animations
// stay untouched. Donor skin joints map to master skin joints BY NAME, and
// donor rest-pose differences are baked into the vertices, so parts authored
// in another pose still land exactly where the donor rendered them.
// Usage:
//   node scripts/merge-hero-parts.mjs --out <combined.glb> <master.glb> <donor.glb>...
import fs from 'node:fs';
import * as THREE from 'three';

const pad4 = (n) => (n + 3) & ~3;

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a glb: ' + file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binOff = 20 + jsonLen;
  const bin = Buffer.from(buf.subarray(binOff + 8, binOff + 8 + buf.readUInt32LE(binOff)));
  return { json, bin };
}

function writeGlb(file, json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = pad4(jsonBuf.length) - jsonBuf.length;
  const total = 12 + 8 + jsonBuf.length + jsonPad + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  let o = 12;
  out.writeUInt32LE(jsonBuf.length + jsonPad, o); o += 4;
  out.writeUInt32LE(0x4e4f534a, o); o += 4;
  jsonBuf.copy(out, o); o += jsonBuf.length;
  for (let i = 0; i < jsonPad; i++) out[o++] = 0x20;
  out.writeUInt32LE(bin.length, o); o += 4;
  out.writeUInt32LE(0x004e4942, o); o += 4;
  bin.copy(out, o);
  fs.writeFileSync(file, out);
}

function ibmOf(parsed, skinIdx, jointPos) {
  const { json, bin } = parsed;
  const acc = json.accessors[json.skins[skinIdx].inverseBindMatrices];
  const bv = json.bufferViews[acc.bufferView];
  return new Float32Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), acc.count * 16).slice(jointPos * 16, jointPos * 16 + 16);
}

function nodeLocalMatrix(node) {
  if (node.matrix) return new THREE.Matrix4().fromArray(node.matrix);
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  return new THREE.Matrix4().compose(
    new THREE.Vector3(t[0], t[1], t[2]),
    new THREE.Quaternion(r[0], r[1], r[2], r[3]),
    new THREE.Vector3(s[0], s[1], s[2]),
  );
}

// Rest-pose world matrix per node index.
function worldMatrices(json) {
  const parent = new Map();
  (json.nodes || []).forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
  const cache = new Map();
  const world = (i) => {
    if (cache.has(i)) return cache.get(i);
    const local = nodeLocalMatrix(json.nodes[i]);
    const m = parent.has(i) ? world(parent.get(i)).clone().multiply(local) : local;
    cache.set(i, m);
    return m;
  };
  return (json.nodes || []).map((_, i) => world(i));
}

function f32(parsed, accessorIdx, n) {
  const { json, bin } = parsed;
  const acc = json.accessors[accessorIdx];
  const bv = json.bufferViews[acc.bufferView];
  return {
    acc,
    arr: new Float32Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0), acc.count * n),
  };
}

function usedJointIndices(parsed) {
  const { json, bin } = parsed;
  const used = new Set();
  const EPS = 1e-6;
  for (const m of json.meshes || []) {
    for (const p of m.primitives || []) {
      for (const [attr, ai] of Object.entries(p.attributes || {})) {
        if (!attr.startsWith('JOINTS_')) continue;
        const slot = attr.slice('JOINTS_'.length);
        const wAi = p.attributes['WEIGHTS_' + slot];
        const acc = json.accessors[ai];
        if (acc.componentType !== 5123 || acc.type !== 'VEC4') {
          throw new Error(`unsupported ${attr} layout in donor (need VEC4 UNSIGNED_SHORT)`);
        }
        const bv = json.bufferViews[acc.bufferView];
        const u16 = new Uint16Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0), acc.count * 4);
        let w = null;
        if (wAi !== undefined) {
          const wAcc = json.accessors[wAi];
          const wBv = json.bufferViews[wAcc.bufferView];
          w = new Float32Array(bin.buffer, bin.byteOffset + (wBv.byteOffset || 0) + (wAcc.byteOffset || 0), wAcc.count * 4);
        }
        for (let i = 0; i < u16.length; i++) {
          if (!w || w[i] > EPS) used.add(u16[i]);
        }
      }
    }
  }
  return used;
}

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
if (outIdx === -1 || outIdx + 1 >= argv.length || argv.length < outIdx + 4) {
  console.error('usage: node scripts/merge-hero-parts.mjs --out <combined.glb> <master.glb> <donor.glb>...');
  process.exit(1);
}
const outFile = argv[outIdx + 1];
const [masterFile, ...donorFiles] = [...argv.slice(0, outIdx), ...argv.slice(outIdx + 2)];
if (!masterFile || !donorFiles.length) {
  console.error('need a master and at least one donor');
  process.exit(1);
}

const base = readGlb(masterFile);
const masterSkin = base.json.skins[0];
const masterByName = new Map(masterSkin.joints.map((ji, si) => [base.json.nodes[ji].name, si]));
const masterByLower = new Map(masterSkin.joints.map((ji, si) => [base.json.nodes[ji].name.toLowerCase(), si]));
const lookupJoint = (name) => {
  if (masterByName.has(name)) return { si: masterByName.get(name), alias: false };
  if (masterByLower.has(name.toLowerCase())) return { si: masterByLower.get(name.toLowerCase()), alias: true };
  return null;
};
const masterWorlds = worldMatrices(base.json);
const masterIBM = masterSkin.joints.map((_, si) => ibmOf(base, 0, si));

let bin = base.bin;
let imgOff = base.json.images.length;
let texOff = base.json.textures.length;
let samplerOff = base.json.samplers.length;
let matOff = base.json.materials.length;
let meshOff = base.json.meshes.length;
let nodeOff = base.json.nodes.length;

for (const donorFile of donorFiles) {
  const donor = readGlb(donorFile);
  const donorSkin = donor.json.skins[0];
  const djoints = donorSkin.joints.map((ji) => donor.json.nodes[ji].name);
  const used = usedJointIndices(donor);
  const remap = djoints.map((name, di) => {
    const hit = lookupJoint(name);
    if (hit) {
      if (hit.alias) console.log(`  ${donorFile}: joint '${name}' matched case-insensitively`);
      return hit.si;
    }
    if (!used.has(di)) {
      console.warn(`  ${donorFile}: joint '${name}' missing in master but skins no verts — mapping to 0`);
      return 0;
    }
    throw new Error(`${donorFile}: joint '${name}' skins verts but is missing in master`);
  });

  // Rest-pose delta per donor joint: D = IBMm^-1 * Wm^-1 * Wd * IBMd.
  // Baking it into the verts makes the part render exactly as the donor did.
  const donorWorlds = worldMatrices(donor.json);
  const deltas = djoints.map((name, di) => {
    const mi = remap[di];
    const ibmM = new THREE.Matrix4().fromArray(masterIBM[mi]);
    const ibmD = new THREE.Matrix4().fromArray(ibmOf(donor, 0, di));
    return ibmM.clone().invert()
      .multiply(new THREE.Matrix4().copy(masterWorlds[masterSkin.joints[mi]]).invert())
      .multiply(donorWorlds[donorSkin.joints[di]])
      .multiply(ibmD);
  });
  const delta3 = deltas.map((d) => new THREE.Matrix3().setFromMatrix4(d));

  // Bake deltas into vertices (BIN copy), then remap JOINTS_*.
  const dbin = Buffer.from(donor.bin);
  const donorParsed = { json: donor.json, bin: dbin };
  const jointBytes = (ai) => {
    const acc = donor.json.accessors[ai];
    const bv = donor.json.bufferViews[acc.bufferView];
    return { acc, u16: new Uint16Array(dbin.buffer, dbin.byteOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0), acc.count * 4) };
  };
  // mode 'point' uses the full affine delta; 'dir'/'offset' use rotation only.
  const bakeVec3 = (ai, W, J, mode) => {
    const { acc, arr } = f32(donorParsed, ai, 3);
    const v = new THREE.Vector3();
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < acc.count; i++) {
      v.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = W[i * 4 + k];
        if (!w) continue;
        const src = new THREE.Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
        v.addScaledVector(mode === 'point' ? src.applyMatrix4(deltas[J[i * 4 + k]]) : src.applyMatrix3(delta3[J[i * 4 + k]]), w);
      }
      if (mode === 'dir') v.normalize();
      arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
      for (let k = 0; k < 3; k++) {
        const c = k === 0 ? v.x : k === 1 ? v.y : v.z;
        if (c < min[k]) min[k] = c;
        if (c > max[k]) max[k] = c;
      }
    }
    acc.min = min;
    acc.max = max;
    return acc.count;
  };
  let bakedVerts = 0;
  for (const m of donor.json.meshes || []) {
    for (const p of m.primitives || []) {
      const jointsAttr = p.attributes.JOINTS_0;
      const weightsAttr = p.attributes.WEIGHTS_0;
      if (jointsAttr === undefined || weightsAttr === undefined) continue;
      const { u16: J } = jointBytes(jointsAttr);
      const { arr: W } = f32(donorParsed, weightsAttr, 4);
      bakedVerts += bakeVec3(p.attributes.POSITION, W, J, 'point');
      if (p.attributes.NORMAL !== undefined) bakeVec3(p.attributes.NORMAL, W, J, 'dir');
      if (p.attributes.TANGENT !== undefined) {
        const { acc, arr } = f32(donorParsed, p.attributes.TANGENT, 4);
        const v = new THREE.Vector3();
        for (let i = 0; i < acc.count; i++) {
          v.set(0, 0, 0);
          for (let k = 0; k < 4; k++) {
            const w = W[i * 4 + k];
            if (!w) continue;
            v.addScaledVector(new THREE.Vector3(arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2]).applyMatrix3(delta3[J[i * 4 + k]]), w);
          }
          v.normalize();
          arr[i * 4] = v.x; arr[i * 4 + 1] = v.y; arr[i * 4 + 2] = v.z;
        }
      }
      for (const t of p.targets || []) {
        if (t.POSITION !== undefined) bakeVec3(t.POSITION, W, J, 'offset');
        if (t.NORMAL !== undefined) bakeVec3(t.NORMAL, W, J, 'dir');
      }
      for (const [attr, ai] of Object.entries(p.attributes || {})) {
        if (!attr.startsWith('JOINTS_')) continue;
        const { u16 } = jointBytes(ai);
        for (let i = 0; i < u16.length; i++) u16[i] = remap[u16[i]];
      }
    }
  }
  console.log(`  ${donorFile}: baked ${bakedVerts} verts`);

  const baseLen = pad4(bin.length);
  bin = Buffer.concat([bin, Buffer.alloc(baseLen - bin.length), dbin]);
  const bvOff = base.json.bufferViews.length;
  const accOff = base.json.accessors.length;
  for (const bv of donor.json.bufferViews) {
    base.json.bufferViews.push({ ...bv, byteOffset: (bv.byteOffset || 0) + baseLen, buffer: 0 });
  }
  for (const a of donor.json.accessors) {
    const na = { ...a };
    if (na.bufferView !== undefined) na.bufferView += bvOff;
    base.json.accessors.push(na);
  }
  for (const img of donor.json.images || []) {
    const ni = { ...img };
    // Embedded images point at bufferViews — remap the index like accessors.
    if (Number.isInteger(ni.bufferView)) ni.bufferView += bvOff;
    base.json.images.push(ni);
  }
  const donorSamplers = donor.json.samplers || [];
  for (const t of donor.json.textures || []) {
    base.json.textures.push({
      ...t,
      source: t.source + imgOff,
      sampler: t.sampler !== undefined && donorSamplers.length ? t.sampler + samplerOff : t.sampler,
    });
  }
  for (const s of donor.json.samplers || []) base.json.samplers.push({ ...s });
  const remapTex = (o) => { if (o && Number.isInteger(o.index)) o.index += texOff; };
  for (const m of donor.json.materials || []) {
    const nm = JSON.parse(JSON.stringify(m));
    remapTex(nm.pbrMetallicRoughness?.baseColorTexture);
    remapTex(nm.pbrMetallicRoughness?.metallicRoughnessTexture);
    remapTex(nm.normalTexture);
    remapTex(nm.occlusionTexture);
    remapTex(nm.emissiveTexture);
    remapTex(nm.extensions?.KHR_materials_specular?.specularTexture);
    base.json.materials.push(nm);
  }
  for (const m of donor.json.meshes || []) {
    const nm = JSON.parse(JSON.stringify(m));
    for (const p of nm.primitives) {
      for (const k of Object.keys(p.attributes)) p.attributes[k] += accOff;
      if (Number.isInteger(p.indices)) p.indices += accOff;
      if (Number.isInteger(p.material)) p.material += matOff;
    }
    base.json.meshes.push(nm);
    const node = { name: m.name, mesh: meshOff++, skin: 0 };
    base.json.nodes.push(node);
    base.json.scenes[0].nodes.push(nodeOff++);
  }
  if ((donor.json.animations || []).length) {
    console.log(`  ${donorFile}: ignoring ${donor.json.animations.length} donor animation(s), master drives`);
  }
  imgOff += (donor.json.images || []).length;
  texOff += (donor.json.textures || []).length;
  samplerOff += (donor.json.samplers || []).length;
  matOff += (donor.json.materials || []).length;
  console.log(`merged ${donorFile}: joints remapped by name, rest pose baked`);
}

base.json.buffers[0].byteLength = bin.length;
writeGlb(outFile, base.json, bin);
console.log(`wrote ${outFile}: meshes ${base.json.meshes.length}, materials ${base.json.materials.length}, anims ${base.json.animations.length}`);
