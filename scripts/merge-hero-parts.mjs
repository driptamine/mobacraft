// Merge wearable part GLBs (weapon, armor, ...) into a hero body GLB so the
// combined file is game-ready: parts share the master skeleton, animations
// stay untouched. Each wearable keeps its original inverse-bind matrices and
// vertex data, with skin joints rebound to master skeleton nodes BY NAME.
// This also handles weapons whose exported rest pose differs from the body.
// Usage:
//   node scripts/merge-hero-parts.mjs --out <combined.glb> <master.glb> <donor.glb>...
import fs from 'node:fs';
import path from 'node:path';

const pad4 = (n) => (n + 3) & ~3;

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a glb: ' + file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binOff = 20 + jsonLen;
  let bin = Buffer.from(buf.subarray(binOff + 8, binOff + 8 + buf.readUInt32LE(binOff)));
  // Resolve textures beside each source, before moving the assembled model
  // into final/. Relative donor URIs otherwise become broken texture URLs.
  for (const img of json.images || []) {
    if (!img.uri || /^(data:|https?:)/.test(img.uri)) continue;
    const imageFile = path.resolve(path.dirname(file), decodeURIComponent(img.uri));
    const bytes = fs.readFileSync(imageFile);
    const offset = pad4(bin.length);
    img.bufferView = json.bufferViews.length;
    img.mimeType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(imageFile).toLowerCase()];
    if (!img.mimeType) throw new Error(`unsupported image: ${imageFile}`);
    delete img.uri;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    bin = Buffer.concat([bin, Buffer.alloc(offset - bin.length), bytes, Buffer.alloc(pad4(bytes.length) - bytes.length)]);
  }
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

function usedJointIndices(parsed, skinIndex) {
  const { json, bin } = parsed;
  const used = new Set();
  const EPS = 1e-6;
  for (const node of json.nodes || []) {
    if (node.mesh === undefined || node.skin !== skinIndex) continue;
    for (const p of json.meshes[node.mesh].primitives || []) {
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
if (outIdx === -1 || outIdx + 1 >= argv.length || argv.length < outIdx + 3) {
  console.error('usage: node scripts/merge-hero-parts.mjs --out <combined.glb> <master.glb> <donor.glb>...');
  process.exit(1);
}
const outFile = argv[outIdx + 1];
const [masterFile, ...donorFiles] = [...argv.slice(0, outIdx), ...argv.slice(outIdx + 2)];
if (!masterFile) {
  console.error('need a master');
  process.exit(1);
}

const base = readGlb(masterFile);
const masterSkin = base.json.skins[0];
const masterJoints = [...new Set(base.json.skins.flatMap((skin) => skin.joints))];
const masterByName = new Map(masterJoints.map((ji) => [base.json.nodes[ji].name, ji]));
const masterByLower = new Map(masterJoints.map((ji) => [base.json.nodes[ji].name.toLowerCase(), ji]));
const lookupJoint = (name) => {
  if (masterByName.has(name)) return { si: masterByName.get(name), alias: false };
  if (masterByLower.has(name.toLowerCase())) return { si: masterByLower.get(name.toLowerCase()), alias: true };
  return null;
};

let bin = base.bin;
let imgOff = base.json.images.length;
let texOff = base.json.textures.length;
let samplerOff = base.json.samplers.length;
let matOff = base.json.materials.length;
let meshOff = base.json.meshes.length;

for (const donorFile of donorFiles) {
  const donor = readGlb(donorFile);
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (donor.json[key]?.length) base.json[key] = [...new Set([...(base.json[key] || []), ...donor.json[key]])];
  }
  const donorParents = new Map((donor.json.nodes || []).flatMap((node, i) => (node.children || []).map((child) => [child, i])));
  const resolveDonorJoint = (index) => {
    const node = donor.json.nodes[index];
    const hit = lookupJoint(node.name);
    if (hit) return hit.si;
    const parent = donorParents.get(index);
    if (parent === undefined) throw new Error(`${donorFile}: joint '${node.name}' has no matching skeleton ancestor`);
    const parentIndex = resolveDonorJoint(parent);
    // Some wearables add helper bones (shoulder pads, toes, hair). Retain
    // their local transforms beneath the corresponding animated body bone.
    const copy = { ...node };
    delete copy.mesh;
    delete copy.skin;
    delete copy.children;
    const mapped = base.json.nodes.push(copy) - 1;
    (base.json.nodes[parentIndex].children ||= []).push(mapped);
    masterByName.set(node.name, mapped);
    masterByLower.set(node.name.toLowerCase(), mapped);
    return mapped;
  };
  const skinOff = base.json.skins.length;
  const donorSkins = (donor.json.skins || []).map((skin, skinIndex) => {
    const used = usedJointIndices(donor, skinIndex);
    const joints = skin.joints.map((ji, di) => {
      const name = donor.json.nodes[ji].name;
      const hit = lookupJoint(name);
      if (hit) return hit.si;
      if (!used.has(di)) return masterSkin.joints[0];
      return resolveDonorJoint(ji);
    });
    const rebound = { ...skin, joints };
    delete rebound.skeleton;
    return rebound;
  });
  const dbin = donor.bin;

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
    if (na.sparse) {
      na.sparse.indices.bufferView += bvOff;
      na.sparse.values.bufferView += bvOff;
    }
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
    remapTex(nm.extensions?.KHR_materials_specular?.specularColorTexture);
    base.json.materials.push(nm);
  }
  for (const skin of donorSkins) {
    if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices += accOff;
    base.json.skins.push(skin);
  }
  const donorMeshOff = meshOff;
  for (const m of donor.json.meshes || []) {
    const nm = JSON.parse(JSON.stringify(m));
    for (const p of nm.primitives) {
      for (const k of Object.keys(p.attributes)) p.attributes[k] += accOff;
      for (const target of p.targets || []) {
        for (const k of Object.keys(target)) target[k] += accOff;
      }
      if (Number.isInteger(p.indices)) p.indices += accOff;
      if (Number.isInteger(p.material)) p.material += matOff;
    }
    base.json.meshes.push(nm);
    meshOff++;
  }
  for (const node of donor.json.nodes || []) {
    if (node.mesh === undefined) continue;
    if (node.skin === undefined) throw new Error(`${donorFile}: wearable mesh must be skinned`);
    const merged = { ...node, mesh: node.mesh + donorMeshOff, skin: node.skin + skinOff };
    delete merged.children;
    base.json.scenes[base.json.scene || 0].nodes.push(base.json.nodes.push(merged) - 1);
  }
  if ((donor.json.animations || []).length) {
    console.log(`  ${donorFile}: ignoring ${donor.json.animations.length} donor animation(s), master drives`);
  }
  imgOff += (donor.json.images || []).length;
  texOff += (donor.json.textures || []).length;
  samplerOff += (donor.json.samplers || []).length;
  matOff += (donor.json.materials || []).length;
  console.log(`merged ${donorFile}: skin rebound by name, original geometry and bind matrices preserved`);
}

base.json.buffers[0].byteLength = bin.length;
writeGlb(outFile, base.json, bin);
console.log(`wrote ${outFile}: meshes ${base.json.meshes.length}, materials ${base.json.materials.length}, anims ${base.json.animations.length}`);
