export interface LanePoint { x: number; z: number }
export interface DoomBase extends LanePoint { team: 'blue' | 'red'; faction: string }
export const DOOM_LANES = ['top', 'mid', 'bottom'] as const;
export type DoomLane = typeof DOOM_LANES[number];

export function isDoomSpiral(mapKey: string): boolean {
  return /(?:^|\/)4p_doom_spiral(?:\.sgb)?$/i.test(mapKey);
}

// Doom Spiral's alpha-0 camera shows world -X toward screen-top.
// Raise red to the opposite corner from blue, keeping its horizontal position.
// 'ig' below is only the shared hero stats registry.
export function doomSpiralBases(positions: Array<LanePoint & { faction?: string }>): DoomBase[] {
  const blue = positions.find((point) => point.faction === 'ig') || positions[1];
  if (!blue) return [];
  const red = positions.find((point) => point.faction === 'space marines') || positions[3];
  if (!red || red === blue) return [];
  return [
    { x: red.x, z: red.z, team: 'blue', faction: 'ig' },
    { x: -red.x, z: blue.z, team: 'red', faction: 'ig' },
  ];
}

export function doomSpiralLanes(blue: LanePoint, red: LanePoint): Record<DoomLane, LanePoint[]> {
  // Keep the physical lanes in place when the teams exchange ends.
  const forward = blue.z <= red.z;
  const start = forward ? blue : red;
  const end = forward ? red : blue;
  const length = Math.hypot(end.x - start.x, end.z - start.z) || 1;
  const dx = (end.x - start.x) / length;
  const dz = (end.z - start.z) / length;
  const from = { x: start.x + dx * 20, z: start.z + dz * 20 };
  const to = { x: end.x - dx * 20, z: end.z - dz * 20 };
  const points = (pairs: number[][]): LanePoint[] => pairs.map(([x, z]) => ({ x, z }));
  const lanes: Record<DoomLane, LanePoint[]> = {
    top: [from, ...points([[-92, -58], [-92, 56], [-64, 94], [62, 92]]), to],
    mid: [from, ...points([[-44, -44], [0, 0], [44, 44]]), to],
    bottom: [from, ...points([[52, -92], [94, -48], [94, 0], [94, 62]]), to],
  };
  if (!forward) for (const lane of DOOM_LANES) lanes[lane].reverse();
  return lanes;
}
