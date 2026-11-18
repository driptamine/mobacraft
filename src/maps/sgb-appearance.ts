import * as THREE from 'three';
import { mapDirFromKey, mapFileUrl, fetchMapJson } from './map-source.js';

export interface SgbLayout {
  map: string;
  terrain: {
    ground_texture: string;
    tile_texture_repeat: number;
    texture_indices: { size: [number, number]; rows: number[][] };
    detail_textures: { index: number; path: string; file: string }[];
  };
  decals: { ref: string; x: number; z: number; size_raw: number; rotation_rad: number }[];
}

export async function loadSgbLayout(mapPath: string): Promise<SgbLayout | null> {
  const dir = mapDirFromKey(mapPath);
  if (!dir) return null;
  return fetchMapJson(mapFileUrl(dir, 'layout.json'));
}

export async function applySgbDetailTextures(root: THREE.Group, layout: SgbLayout, mapPath: string): Promise<void> {
  const loader = new THREE.TextureLoader();
  const materials = new Map<number, THREE.MeshStandardMaterial>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const index = mesh.userData.detailTextureIndex;
    if (mesh.isMesh && typeof index === 'number') materials.set(index, mesh.material as THREE.MeshStandardMaterial);
  });
  await Promise.all(layout.terrain.detail_textures.map(async (detail) => {
    const material = materials.get(detail.index);
    if (!material) return;
    const dir = mapDirFromKey(mapPath);
    const url = dir ? mapFileUrl(dir, detail.file) : detail.file;
    if (!url) throw new Error(`Missing map texture: ${detail.file}`);
    const texture = await loader.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    // Terrain UVs span the map; SGB repeat describes repeats per tile.
    texture.repeat.set(layout.terrain.tile_texture_repeat * layout.terrain.texture_indices.size[0], layout.terrain.tile_texture_repeat * layout.terrain.texture_indices.size[1]);
    texture.anisotropy = 4;
    texture.name = detail.path;
    material.map = texture;
    material.color.set(0xffffff);
    material.needsUpdate = true;
  }));
  // SGB can leave index 0 without a DSHD reference (Doom Spiral). Cover
  // those tiles with the map's base ground, as Alvarus does for its ground
  // sheet, while preserving the authored raw tile indices in the layout.
  const ground = layout.terrain.detail_textures.find((detail) => detail.path === layout.terrain.ground_texture);
  const groundTexture = ground ? materials.get(ground.index)?.map : null;
  if (groundTexture) {
    for (const material of materials.values()) {
      if (material.map) continue;
      material.map = groundTexture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    }
  }
}
