# Into the Breach layout

`layout.json` is extracted from `4p_into_the_breach.sgb` in the same format as
Alvarus. It contains 256 terrain tiles, 4 detail textures,
310 original decal placements of 13 types and 170 entity records.

The game loads the original tile texture assignments and drapes decals over
the terrain using their original positions, sizes and rotations. Coordinates
stay local to the SGB; the map root applies rotation and mirroring once.

`small_round_hole` is temporarily hidden by default on this map. Its original
placement and texture are retained, and the decals panel can show it again.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/4p_into_the_breach/4p_into_the_breach.sgb --assets-dir "maps/4p_into_the_breach/Into The Breach"
```

## Passability

`4p_into_the_breach_path.json` comes directly from the SGB `DATAIMPA` chunk.
It has 128×128 cells, 2 world units each, covering X/Z −128…128. The terrain
extends farther; the paint must not be stretched to the 512-unit terrain size.
The same 90-degree yaw and horizontal mirror as Alvarus put rows in world space.
The map loader automatically loads this sidecar before play. Existing A*, local
avoidance and grounded movement steps use it: 2 is open; all other values are
closed, including the original 3, 7, 70 and 71 values. No source cells are altered.
All four HQ starts and the sixteen capture objectives are on open paint.

Rebuild the grid and diagnostic preview:

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/4p_into_the_breach/4p_into_the_breach.sgb
node --import tsx scripts/render-sgb-path.mjs maps/4p_into_the_breach/4p_into_the_breach.sgb artifacts/into-the-breach-true-grid-scale.html
```

Open the generated standalone HTML and click **Download PNG**. The committed
`artifacts/into-the-breach-true-grid-scale.png` shows the relief, numbered cells,
HQs, strategic points and relics in exactly the same coordinate frame.
