import type { LoadFactionHooks } from '../factions.js';
import { isDoomSpiral } from '../maps/doom-spiral.js';
import { preloadDoomCreepModels } from '../systems/lane-creeps.js';

// Startup never fetches the RTS factions or the hero catalog. Only the six
// creep templates are needed immediately; hero templates load on selection.
export async function loadStartupModels(mapKey: string, hooks: LoadFactionHooks = {}): Promise<void> {
  if (isDoomSpiral(mapKey)) await preloadDoomCreepModels(hooks);
  else hooks.onProgress?.({ loaded: 0, total: 0, label: 'Ready' });
}
