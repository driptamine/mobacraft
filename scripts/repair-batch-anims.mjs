// Repair exporter-truncated hero GLBs: drop mesh primitives and animation
// channels whose accessors point past the end of the BIN chunk (three.js and
// Babylon throw on those), keeping every survivor intact. BIN bytes are copied
// verbatim — only the JSON chunk changes — except with --rebuild-ibm, which
// appends reconstructed inverse-bind tables (proven: IBM == inverse(rest
// world) to ~5e-7 on sibling files) for skins whose IBM data is truncated.
// Usage: node scripts/repair-batch-anims.mjs [--rebuild-ibm] <file.glb...>
import fs from 'node:fs';
import * as THREE from 'three';

const CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const pad4 = (n) => (n + 3) & ~3;

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a glb: ' + file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binOff = 20 + jsonLen;
  const bin = (binOff + 8 <= buf.length)
    ? Buffer.from(buf.subarray(binOff + 8, binOff + 8 + buf.readUInt32LE(binOff)))
    : Buffer.alloc(0);
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

function repairOne(file, rebuildIbm) {
  let { json, bin } = readGlb(file);
  const report = { primsDropped: 0, meshesDropped: [], animsKept: [], animsDropped: 0, sparseStripped: 0, unskinned: 0, ibmRebuilt: 0 };
  const range = (bvOff, accOff, count, t, c) => (bvOff || 0) + (accOff || 0) + count * (TC[t] || 0) * (CS[c] || 0);
  const binLen = () => bin.length;

  // Rebuild truncated inverse-bind tables from the node hierarchy first, so
  // the passes below (and the skinning itself) see valid data.
  if (rebuildIbm) {
    const worlds = worldMatrices(json);
    for (const skin of json.skins || []) {
      if (skin.inverseBindMatrices === undefined) continue;
      const acc = json.accessors[skin.inverseBindMatrices];
      const bv = json.bufferViews[acc.bufferView];
      const need = range(bv.byteOffset, acc.byteOffset || 0, acc.count, acc.type, acc.componentType);
      if (need <= bin.length) continue;
      // Validate the rule on whatever prefix survived.
      const have = Math.max(0, Math.floor((bin.length - ((bv.byteOffset || 0) + (acc.byteOffset || 0))) / 64));
      let worst = 0;
      if (have > 0) {
        const arr = new Float32Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0), have * 16);
        for (let si = 0; si < have; si++) {
          const inv = new THREE.Matrix4().copy(worlds[skin.joints[si]]).invert();
          for (let k = 0; k < 16; k++) {
            worst = Math.max(worst, Math.abs(inv.elements[k] - arr[si * 16 + k]));
          }
        }
      }
      if (have > 0 && worst > 1e-4) {
        throw new Error(`${file}: skin IBM prefix contradicts inverse(world) (${worst.toExponential(2)}), refusing to rebuild`);
      }
      const table = new Float32Array(skin.joints.length * 16);
      skin.joints.forEach((ji, si) => {
        new THREE.Matrix4().copy(worlds[ji]).invert().toArray(table, si * 16);
      });
      const off = pad4(bin.length);
      bin = Buffer.concat([bin, Buffer.alloc(off - bin.length), Buffer.from(table.buffer)]);
      const bvIdx = json.bufferViews.length;
      json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: table.byteLength });
      const accIdx = json.accessors.length;
      json.accessors.push({ bufferView: bvIdx, componentType: 5126, count: skin.joints.length, type: 'MAT4' });
      skin.inverseBindMatrices = accIdx;
      report.ibmRebuilt++;
      console.log(`  ${file}: rebuilt IBM table (${skin.joints.length} joints, validated prefix ${have}, diff ${worst.toExponential(2)})`);
    }
  }

  // Sparse morph data first: when the sparse indices/values are truncated but
  // the base array is intact, drop the sparse extension so the morph loads
  // inert instead of throwing the whole file.
  json.accessors.forEach((acc) => {
    if (!acc || !acc.sparse) return;
    const baseBv = json.bufferViews[acc.bufferView];
    if (!baseBv) return;
    const baseBad = range(baseBv.byteOffset, acc.byteOffset, acc.count, acc.type, acc.componentType) > binLen();
    const si = acc.sparse.indices, sv = acc.sparse.values;
    const ib = si && json.bufferViews[si.bufferView];
    const vb = sv && json.bufferViews[sv.bufferView];
    const sparseBad = !ib
      || range(ib.byteOffset, si.byteOffset, acc.sparse.count, 'SCALAR', si.componentType) > binLen()
      || (vb && range(vb.byteOffset, sv.byteOffset || 0, acc.sparse.count, acc.type, acc.componentType) > binLen());
    if (sparseBad && !baseBad && (acc.sparse.count || 0) <= acc.count) {
      delete acc.sparse;
      report.sparseStripped++;
    }
  });

  const bad = (a) => {
    if (a === undefined) return false;
    const acc = json.accessors[a];
    const bv = acc && json.bufferViews[acc.bufferView];
    if (!acc || !bv) return true;
    if (range(bv.byteOffset, acc.byteOffset, acc.count, acc.type, acc.componentType) > binLen()) return true;
    // A surviving sparse extension must also fit, or readers throw on it.
    if (acc.sparse) {
      const si = acc.sparse.indices, sv = acc.sparse.values;
      const ib = si && json.bufferViews[si.bufferView];
      if (!ib || range(ib.byteOffset, si.byteOffset, acc.sparse.count, 'SCALAR', si.componentType) > binLen()) return true;
      if (sv) {
        const vb = json.bufferViews[sv.bufferView];
        if (!vb || range(vb.byteOffset, sv.byteOffset || 0, acc.sparse.count, acc.type, acc.componentType) > binLen()) return true;
      }
    }
    return false;
  };

  // Skins whose inverse-bind matrices are truncated: un-skin every meshed node
  // using them so the geometry renders static at bind pose instead of throwing
  // (identity IBMs would double-transform the mesh).
  (json.skins || []).forEach((s, si) => {
    if (s.inverseBindMatrices === undefined || !bad(s.inverseBindMatrices)) return;
    for (const n of json.nodes || []) {
      if (n.skin !== si || n.mesh === undefined) continue;
      const mesh = json.meshes[n.mesh];
      for (const pr of (mesh && mesh.primitives) || []) {
        if (pr.attributes) {
          delete pr.attributes.JOINTS_0;
          delete pr.attributes.WEIGHTS_0;
        }
      }
      delete n.skin;
      report.unskinned++;
    }
    // Nodes left pointing at the dead skin without a mesh: detach them too.
    for (const n of json.nodes || []) {
      if (n.skin === si && n.mesh === undefined) delete n.skin;
    }
  });
  // Mesh primitives: drop any primitive with an out-of-range index/attribute.
  const deadMeshes = new Set();
  (json.meshes || []).forEach((m, mi) => {
    m.primitives = (m.primitives || []).filter((pr) => {
      const ids = [pr.indices, ...Object.values(pr.attributes || {})];
      if (pr.targets) for (const t of pr.targets) ids.push(...Object.values(t));
      const ok = !ids.some((i) => i !== undefined && bad(i));
      if (!ok) report.primsDropped++;
      return ok;
    });
    if (!m.primitives.length) {
      deadMeshes.add(mi);
      report.meshesDropped.push(m.name || mi);
    }
  });
  // Nodes pointing at removed meshes become plain transforms (keeps hierarchy).
  for (const n of json.nodes || []) {
    if (n.mesh !== undefined && deadMeshes.has(n.mesh)) delete n.mesh;
  }

  // Exporter garbage: in-range but non-finite or absurd float tracks. Hero
  // keyframe data (times, translations, quats, scales) lives around units —
  // anything past 1e6 teleports joints to infinity and renders as giant black
  // triangles mid-battle. Drop those channels like the out-of-range ones.
  const valuesBad = (a) => {
    if (a === undefined) return false;
    const acc = json.accessors[a];
    if (!acc || acc.componentType !== 5126) return false;
    const bv = json.bufferViews[acc.bufferView];
    if (!bv || bv.byteStride) return false;
    const n = (TC[acc.type] || 0) * acc.count;
    const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    if (off + n * 4 > bin.length) return true;
    const arr = new Float32Array(bin.buffer, bin.byteOffset + off, n);
    for (let i = 0; i < n; i++) {
      const v = arr[i];
      if (!Number.isFinite(v) || Math.abs(v) > 1e6) return true;
    }
    return false;
  };

  // Animations: keep channels whose sampler input/output are both in range.
  json.animations = (json.animations || []).filter((a) => {
    const kept = (a.channels || []).filter((c) => {
      const s = (a.samplers || [])[c.sampler];
      if (!s || bad(s.input) || bad(s.output)) return false;
      if (valuesBad(s.input) || valuesBad(s.output)) {
        report.garbageChannels = (report.garbageChannels || 0) + 1;
        return false;
      }
      return true;
    });
    // Compact samplers to the survivors so no dead sampler stays referenced.
    const used = new Set(kept.map((c) => c.sampler));
    const remap = new Map([...used].map((old, ni) => [old, ni]));
    a.samplers = (a.samplers || []).filter((_, i) => used.has(i));
    for (const c of kept) c.sampler = remap.get(c.sampler);
    a.channels = kept;
    if (!kept.length) {
      report.animsDropped++;
      return false;
    }
    report.animsKept.push(`${a.name}(${kept.length}ch)`);
    return true;
  });

  writeGlb(file, json, bin);
  return report;
}

const args = process.argv.slice(2);
const rebuildIbm = args.includes('--rebuild-ibm');
const files = args.filter((a) => a !== '--rebuild-ibm');
if (!files.length) {
  console.error('usage: node scripts/repair-batch-anims.mjs [--rebuild-ibm] <file.glb...>');
  process.exit(1);
}
for (const f of files) {
  const r = repairOne(f, rebuildIbm);
  console.log(`--- ${f}`);
  console.log(`    prims dropped: ${r.primsDropped}, meshes emptied: [${r.meshesDropped.join(', ')}], anims dropped: ${r.animsDropped}, kept: ${r.animsKept.length}, sparse stripped: ${r.sparseStripped}, unskinned: ${r.unskinned}, ibm rebuilt: ${r.ibmRebuilt}, garbage channels: ${r.garbageChannels || 0}`);
  console.log(`    kept: ${r.animsKept.slice(0, 25).join(' | ')}${r.animsKept.length > 25 ? ' | ...' : ''}`);
}
