// Rebuildable tiers of the finished IG listening post.
// Source: models/ig/structures/listening_post.glb (never modified).
// LP1 = finished post without turrets, LP2 adds the addon_1 turret set,
// LP3 adds the addon_2 turret. Construction equipment (scaffolding,
// crates, mech arms, turbines, tanks, railings, attachments) is stripped
// from every tier via isolateMeshes (nodes/skins/animations stay intact).
// The turret material (ig_listening_post_02) ships alphaMode BLEND while
// its texture is fully opaque, which sorts like glass in-game — tiers
// containing turrets switch it to OPAQUE.
//
//   node scripts/build-lp-tiers.mjs
import { readGlb, writeGlb, isolateMeshes } from './glb-mesh-tool.mjs';

const SRC = 'models/ig/structures/listening_post.glb';
const BASE = [
  'listening_post', 'listening_post_shadow',
  'addon_1_sandbags', 'addon_1_sandbags_shadow',
  'addon_2_sandbags', 'addon_2_sandbags_shadow',
];
const TIERS = {
  'models/ig/structures/listening_post_clean_lp1.glb': [...BASE],
  'models/ig/structures/listening_post_clean_lp2.glb': [...BASE, 'addon_1_turret', 'addon_1_turret_barrels'],
  'models/ig/structures/listening_post_clean_lp3.glb': [...BASE, 'addon_1_turret', 'addon_1_turret_barrels', 'addon_2_turret', 'addon_2_turret_shadow'],
};

for (const [dst, keep] of Object.entries(TIERS)) {
  const { hidden, kept } = isolateMeshes(SRC, dst, keep);
  // Opaque texture + BLEND sorting = glassy turrets; drop the blend flag.
  const { json, bin } = readGlb(dst);
  for (const mat of json.materials || []) {
    if (mat.name === 'ig_listening_post_02') delete mat.alphaMode;
  }
  writeGlb(dst, json, bin);
  console.log(`wrote ${dst} (${hidden} meshes hidden, kept: ${kept.join(', ')})`);
}
