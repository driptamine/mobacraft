import { setBuildingObstacles } from '../../pathfinding/building-routing.js';
import { worldFootprint } from '../core/structure-footprint.js';
let activeWorld: any = null, worldSerial = 0;
/** Refresh once per movement system; unchanged contours keep the route cache. */
export function refreshNavigation(world: any): void {
    if (world !== activeWorld) {
        activeWorld = world;
        worldSerial++;
    }
    const bounds = [];
    for (const kind of ['building', 'structure', 'airfield'])
        for (const id of world.query(kind)) {
            const site = world.get(id, kind);
            if (!site?.position || site.hp <= 0)
                continue;
            bounds.push(worldFootprint(kind === 'airfield' ? { ...site, type: 'airfield' } : site));
        }
    setBuildingObstacles(bounds, String(worldSerial));
}
