// Strip baked root travel from looped locomotion clips so they cycle in place
// (the game moves the hero root itself; baked travel snaps back each loop).
// Removes only translation channels of the joint literally named 'root' in the
// named clips — rotations, weapon joints and BIN bytes are untouched.
// Usage: node scripts/strip-root-motion.mjs <file.glb> <clip> [clip...] [--joint Name] [--path translation]
// (defaults: joint root, path translation)
import fs from 'node:fs';

const pad4 = (n) => (n + 3) & ~3;

const argv = process.argv.slice(2);
let joint = 'root';
let path = 'translation';
const takeFlag = (flag) => {
  const at = argv.indexOf(flag);
  if (at !== -1) return argv.splice(at, 2)[1];
  return undefined;
};
joint = takeFlag('--joint') || joint;
path = takeFlag('--path') || path;
const [file, ...clips] = argv;
if (!file || !clips.length) {
  console.error('usage: node scripts/strip-root-motion.mjs <file.glb> <clip> [clip...] [--joint Name] [--path translation]');
  process.exit(1);
}
const buf = fs.readFileSync(file);
if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
const binOff = 20 + jsonLen;
const chunkLen = buf.readUInt32LE(binOff);
const bin = Buffer.from(buf.subarray(binOff + 8, binOff + 8 + chunkLen));

let removed = 0;
for (const name of clips) {
  const anim = (json.animations || []).find((a) => a.name === name);
  if (!anim) {
    console.warn(`clip not found: ${name}`);
    continue;
  }
  const before = anim.channels.length;
  anim.channels = anim.channels.filter((c) => {
    const node = json.nodes[c.target.node];
    const strip = node && node.name === joint && c.target.path === path;
    if (strip) removed++;
    return !strip;
  });
  console.log(`${name}: ${before} -> ${anim.channels.length} channels`);
}

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
console.log(`removed ${removed} root-travel channels from ${file}`);
