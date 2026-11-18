// Embed external image files into GLBs so each .glb is self-contained
// (drag-and-drop into sandbox.babylonjs.com, single-file hosting, R2, ...).
// Usage: node scripts/embed-glb-images.mjs <dir...>  (rewrites .glb in place)
import fs from 'node:fs';
import path from 'node:path';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const pad4 = (n) => (n + 3) & ~3;

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a glb: ' + file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  let bin = Buffer.alloc(0);
  const binOff = 20 + jsonLen;
  if (binOff + 8 <= buf.length) {
    const binLen = buf.readUInt32LE(binOff + 4);
    bin = Buffer.from(buf.subarray(binOff + 8, binOff + 8 + binLen));
  }
  return { json, bin };
}

function writeGlb(file, json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = pad4(jsonBuf.length) - jsonBuf.length;
  const binPad = pad4(bin.length) - bin.length;
  const total = 12 + 8 + jsonBuf.length + jsonPad + 8 + bin.length + binPad;
  const out = Buffer.alloc(total);
  out.write('glTF', 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  let o = 12;
  out.writeUInt32LE(jsonBuf.length + jsonPad, o); o += 4;
  out.writeUInt32LE(0x4e4f534a, o); o += 4;
  jsonBuf.copy(out, o); o += jsonBuf.length;
  for (let i = 0; i < jsonPad; i++) out[o++] = 0x20;
  out.writeUInt32LE(bin.length + binPad, o); o += 4;
  out.writeUInt32LE(0x004e4942, o); o += 4;
  bin.copy(out, o);
  fs.writeFileSync(file, out);
}

function embedOne(file) {
  const { json, bin } = readGlb(file);
  const images = json.images || [];
  const targets = images.filter((img) => img.uri && !/^data:|^https?:/.test(img.uri));
  if (!targets.length) return { embedded: 0 };
  const dir = path.dirname(file);
  let base = pad4(bin.length);
  const chunks = [bin.subarray(0, base)];
  if (base > bin.length) chunks.push(Buffer.alloc(base - bin.length));
  let embedded = 0;
  for (const img of targets) {
    const rel = img.uri.split('?')[0].split('#')[0];
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) throw new Error(`${file}: missing image ${img.uri}`);
    const mime = MIME[path.extname(rel).toLowerCase()];
    if (!mime) throw new Error(`${file}: unknown image type ${img.uri}`);
    const data = fs.readFileSync(abs);
    const bvIndex = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: base, byteLength: data.length });
    base += pad4(data.length);
    chunks.push(data);
    if (pad4(data.length) > data.length) chunks.push(Buffer.alloc(pad4(data.length) - data.length));
    delete img.uri;
    img.bufferView = bvIndex;
    img.mimeType = mime;
    embedded++;
  }
  const merged = Buffer.concat(chunks);
  json.buffers[0].byteLength = merged.length;
  writeGlb(file, json, merged);
  return { embedded };
}

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('usage: node scripts/embed-glb-images.mjs <dir...>');
  process.exit(1);
}
let files = 0, totalEmbedded = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && e.name.endsWith('.glb')) {
      files++;
      totalEmbedded += embedOne(p).embedded;
    }
  }
};
for (const d of dirs) walk(d);
console.log(`done: ${files} glb, ${totalEmbedded} images embedded`);
