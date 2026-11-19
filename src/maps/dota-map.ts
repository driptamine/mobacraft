import * as THREE from 'three';
import { scene, camera, canvas, setGridVariant } from '../core/scene.js';
import { loadGltf, type GltfContainer } from '../render/gltf-models.js';
import { mapFileUrl, fetchMapJson } from './map-source.js';
import { clearSgbMap } from './sgb-upload.js';
import { clearTerrainMesh } from './terrain-upload.js';
import { _snapTerrainBegin } from '../systems/terrain.js';
import { sampleDotaHeight, type DotaSurface } from './dota-surface.js';
import { makeDotaWaterSampler } from './dota-water.js';

let active: GltfContainer | null = null;
let surface: DotaSurface | null = null;
let waterHeightAt: ReturnType<typeof makeDotaWaterSampler> | undefined;
let generation = 0;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), point = new THREE.Vector3();

export function clearDotaMap(): void {
  generation++;
  waterHeightAt = undefined;
  if (!active) return;
  if (window.__sgbTerrainRoot === active.scene) {
    window.__sgbTerrainRoot = null;
    window.__sgbSampleHeight = null;
    window.__sgbPassGrid = null;
    _snapTerrainBegin();
  }
  scene.remove(active.scene);
  active.dispose();
  active = null;
  surface = null;
  if (scene._ground) scene._ground.visible = true;
}

export async function loadDotaMap(): Promise<void> {
  clearDotaMap();
  clearSgbMap(true);
  clearTerrainMesh(true);
  // clearTerrainMesh also schedules SGB cleanup. Finish that microtask before
  // installing the Dota surface, so it cannot clear the newly loaded map.
  await import('./sgb-upload.js');
  const token = generation;
  const data = await fetchMapJson(mapFileUrl('dotamap-game', 'surface.json'));
  if (token !== generation) return;
  if (!data?.grid || !data?.rows || !data?.heights) throw new Error('Dota navigation surface is missing');
  const model = await loadGltf(mapFileUrl('dotamap-game', 'map.glb'));
  if (token !== generation) { model.dispose(); return; }
  active = model;
  surface = data as DotaSurface;
  model.scene.name = 'DotaSkirmishMap';
  model.scene.traverse((node: any) => {
    if (!node.isMesh) return;
    // The baked heightfield handles ground picking. Visual map meshes never
    // compete with selectable heroes/bases or run multi-million-triangle rays.
    node.userData.pickable = false;
    node.raycast = () => {};
    node.castShadow = false;
    node.receiveShadow = false;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (materials.every((material: any) => material.userData?.vmat?.Name?.includes('/overlays/'))) {
      node.renderOrder = 1;
      for (const material of materials) {
        material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
        material.depthWrite = false;
      }
    }
  });
  scene.add(model.scene);
  waterHeightAt = makeDotaWaterSampler(model.scene);
  window.__sgbTerrainRoot = model.scene;
  window.__sgbSampleHeight = (x, z) => surface ? sampleDotaHeight(surface, x, z) : 0;
  window.__sgbPassGrid = surface;
  if (scene._ground) scene._ground.visible = false;
  setGridVariant(3);
  _snapTerrainBegin();
}

export function dotaWaterHeightAt(x: number, z: number): number | undefined {
  return waterHeightAt?.(x, z);
}

export function pickDotaGround(sx: number, sy: number): THREE.Vector3 | null {
  if (!active || !surface || !camera || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  ndc.set((sx - rect.left) / rect.width * 2 - 1, -(sy - rect.top) / rect.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (ray.ray.direction.y >= -.00001) return null;
  let y = sampleDotaHeight(surface, camera.target.x, camera.target.z);
  for (let i = 0; i < 8; i++) {
    const distance = (y - ray.ray.origin.y) / ray.ray.direction.y;
    if (distance < 0) return null;
    ray.ray.at(distance, point);
    const height = sampleDotaHeight(surface, point.x, point.z);
    if (Math.abs(height - y) < .02) break;
    y = height;
  }
  point.y = sampleDotaHeight(surface, point.x, point.z);
  return point.clone();
}
