// Extract the original DATAIMPA paint at its authored scale into world space.
// Usage: node --import tsx scripts/extract-sgb-path.mjs [maps/<map>/<map>.sgb]
// Defaults to Alvarus. The map loader discovers the adjacent *_path.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createChunkReader } from '../src/maps/sgb-reader.js';
import { applySgbRootTransform } from '../src/maps/sgb-mirror.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export function readImpaGrid(buffer) {
  const reader = createChunkReader(buffer);
  reader.skipChunky();
  let end = reader.size;
  for (const wanted of ['FOLDSCEN', 'FOLDWSTC', 'FOLDMSTC', 'FOLDPFDR', 'DATAIMPA']) {
    let found = false;
    while (reader.position < end) {
      const header = reader.readHeader();
      const payloadEnd = reader.position + header.size;
      if (header.typeid === wanted) {
        end = payloadEnd;
        found = true;
        break;
      }
      reader.skip(payloadEnd - reader.position);
    }
    if (!found) throw new Error('chunk not found: ' + wanted);
  }
  const width = reader.readU32(), height = reader.readU32();
  const cellWorld = reader.readFloat();
  if (!width || !height || !Number.isFinite(cellWorld) || cellWorld <= 0) throw new Error('invalid IMPA geometry');
  if (end - reader.position !== width * height) throw new Error('IMPA payload size mismatch');
  return { raw: reader.readData(width * height), width, height, cellWorld };
}

export function extractSgbPath(buffer, map) {
  const { raw, width, height, cellWorld } = readImpaGrid(buffer);
  // Same yaw/mirror as sgb-upload. The quarter turn swaps rectangular axes.
  const sizeX = height, sizeZ = width;
  const originX = -sizeX * cellWorld / 2, originZ = -sizeZ * cellWorld / 2;
  const terrainRoot = new THREE.Object3D();
  applySgbRootTransform(terrainRoot, 90, true);
  terrainRoot.updateMatrixWorld(true);
  const inverse = terrainRoot.matrixWorld.clone().invert(), point = new THREE.Vector3();
  const rows = [], counts = {};
  for (let row = 0; row < sizeZ; row++) {
    const cells = [];
    for (let column = 0; column < sizeX; column++) {
      point.set(originX + (column + .5) * cellWorld, 0, originZ + (row + .5) * cellWorld).applyMatrix4(inverse);
      const localColumn = Math.min(width - 1, Math.max(0, Math.floor(point.x / cellWorld + width / 2)));
      const localRow = Math.min(height - 1, Math.max(0, Math.floor(point.z / cellWorld + height / 2)));
      const value = raw[localRow * width + localColumn];
      cells.push(value); counts[value] = (counts[value] || 0) + 1;
    }
    rows.push(cells);
  }
  const legend = { 2: 'free ground', 7: 'closed paint (borders, cliff/flat zones) — route around', 3: 'fringe at closed-zone edges (treat as closed for movement)' };
  for (const value of Object.keys(counts)) if (!(value in legend)) legend[value] = 'other source paint (closed for movement)';
  return {
    map,
    source: {
      file: `${map}.sgb`, chunk: 'FOLDWSTC/FOLDMSTC/FOLDPFDR/DATAIMPA', chunkName: 'Passability Map',
      note: 'Read DATAIMPA width, height and FLOAT cell size before the cell bytes. Reprojected through the game terrain root transform without stretching to the terrain extent.',
    },
    grid: {
      sizeX, sizeZ, cellWorld, originX, originZ, frame: 'world',
      layout: `rows[r][c]: world x in [originX + c*${cellWorld}, originX + (c+1)*${cellWorld}), z in [originZ + r*${cellWorld}, originZ + (r+1)*${cellWorld})`,
      transform: 'applySgbRootTransform(rotY=90, flipH=true) per src/sgb-mirror.js and src/sgb-upload.js defaults',
    },
    legend,
    counts, rows,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourcePath = process.argv[2] ? resolve(process.argv[2]) : join(rootDir, 'maps/6p_alvarus/6p_alvarus.sgb');
  const map = basename(sourcePath).replace(/\.sgb$/i, '');
  const outputPath = join(dirname(sourcePath), `${map}_path.json`);
  const doc = extractSgbPath(readFileSync(sourcePath), map);
  const head = JSON.stringify({ ...doc, rows: undefined }, null, 2).replace(/\n\}$/, '');
  const body = '"rows": [\n' + doc.rows.map(row => '    [' + row.join(', ') + ']').join(',\n') + '\n  ]\n}';
  writeFileSync(outputPath, head + ',\n  ' + body + '\n');
  console.log(`Wrote ${outputPath}: ${doc.grid.sizeX}×${doc.grid.sizeZ}, cell=${doc.grid.cellWorld}, counts=${JSON.stringify(doc.counts)}`);
}
