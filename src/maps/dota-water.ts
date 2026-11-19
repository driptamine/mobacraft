import * as THREE from 'three';

/** Sample the rendered river separately from the walkable heightfield. */
export function makeDotaWaterSampler(root: THREE.Object3D): (x: number, z: number) => number | undefined {
  const water: { mesh: THREE.Mesh; bounds: THREE.Box3 }[] = [];
  let top = -Infinity;
  root.updateMatrixWorld(true);
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (!materials.every(mat => /\/(?:water_generic_000(?:_slope)?|water_flow|riverflow)\.vmat$/i.test(mat.userData.vmat?.Name || ''))) return;
    const bounds = new THREE.Box3().setFromObject(node);
    if (bounds.isEmpty()) return;
    top = Math.max(top, bounds.max.y);
    water.push({ mesh: node, bounds });
  });
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const hits: THREE.Intersection[] = [];
  return (x, z) => {
    hits.length = 0;
    ray.ray.origin.set(x, top + 1, z);
    for (const { mesh, bounds } of water) {
      if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) continue;
      // Map mesh picking is disabled; use the original mesh raycast here.
      THREE.Mesh.prototype.raycast.call(mesh, ray, hits);
    }
    return hits.length ? Math.max(...hits.map(hit => hit.point.y)) : undefined;
  };
}
