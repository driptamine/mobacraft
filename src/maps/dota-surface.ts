export interface DotaSurface {
  grid: { sizeX: number; sizeZ: number; originX: number; originZ: number; cellWorld: number };
  rows: number[][];
  heights: number[][];
  heightUnit: number;
  authoritativeWalkability: boolean;
}
export function sampleDotaHeight(surface: DotaSurface, x: number, z: number): number {
  const g = surface.grid;
  const cx = Math.max(0, Math.min(g.sizeX - 1, (x - g.originX) / g.cellWorld - .5));
  const rz = Math.max(0, Math.min(g.sizeZ - 1, (z - g.originZ) / g.cellWorld - .5));
  const c = Math.floor(cx), r = Math.floor(rz), c1 = Math.min(c + 1, g.sizeX - 1), r1 = Math.min(r + 1, g.sizeZ - 1);
  const a = cx - c, b = rz - r;
  return ((surface.heights[r][c] * (1 - a) + surface.heights[r][c1] * a) * (1 - b)
    + (surface.heights[r1][c] * (1 - a) + surface.heights[r1][c1] * a) * b) * surface.heightUnit;
}
