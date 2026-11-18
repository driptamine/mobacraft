import { structureFootprint, worldFootprint } from '../core/structure-footprint.js';

export interface SitePoint { x: number; z: number }
export interface GhostRect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface ExistingBuilding {
  type?: string;
  faction?: string;
  team?: string;
  constructing?: boolean;
  pendingWorker?: boolean;
  position: SitePoint;
}

// How far past a finished building's walls its construction zone reaches.
// The ring each building projects is its own footprint plus this margin.
export const BUILD_ZONE_MARGIN = 16;

export function buildZoneRadius(site: { type?: string; faction?: string }): number {
  const fp = structureFootprint({ type: site.type, faction: site.faction }, false);
  const half = Math.max(Math.abs(fp.minX), Math.abs(fp.maxX), Math.abs(fp.minZ), Math.abs(fp.maxZ));
  return half + BUILD_ZONE_MARGIN;
}

/** World-space footprint of the ghost box when its centre sits on point. */
export function ghostRectAt(point: SitePoint, size: { x: number; z: number }, offset: { x: number; z: number }): GhostRect {
  return {
    minX: point.x + offset.x - size.x / 2,
    maxX: point.x + offset.x + size.x / 2,
    minZ: point.z + offset.z - size.z / 2,
    maxZ: point.z + offset.z + size.z / 2,
  };
}

const OVERLAP_PAD = 0.5;

function rectsOverlap(a: GhostRect, b: GhostRect, pad: number): boolean {
  return a.minX < b.maxX + pad && a.maxX > b.minX - pad
    && a.minZ < b.maxZ + pad && a.maxZ > b.minZ - pad;
}

export type PlacementReason = 'overlap' | 'zone' | null;

/**
 * Shared validity rule for the ghost tint and the confirm click.
 * Listening posts plant on strategic points, not on open ground, so they
 * are exempt from both the overlap and the zone checks.
 */
export function placementStatus(
  type: string,
  team: string | undefined,
  point: SitePoint,
  ghost: GhostRect,
  buildings: ExistingBuilding[],
): { ok: boolean; reason: PlacementReason } {
  if (type === 'listening_post') return { ok: true, reason: null };
  const own = buildings.filter((b) => b.team === team);
  for (const other of own) {
    const bounds = worldFootprint({
      type: other.type,
      faction: other.faction,
      constructing: !!(other.constructing || other.pendingWorker),
      position: other.position,
    });
    if (rectsOverlap(ghost, bounds, OVERLAP_PAD)) return { ok: false, reason: 'overlap' };
  }
  const finished = own.filter((b) => !(b.constructing || b.pendingWorker));
  if (finished.length === 0) return { ok: true, reason: null };
  const inside = finished.some((b) =>
    Math.hypot(point.x - b.position.x, point.z - b.position.z)
    <= buildZoneRadius({ type: b.type, faction: b.faction }));
  return inside ? { ok: true, reason: null } : { ok: false, reason: 'zone' };
}
