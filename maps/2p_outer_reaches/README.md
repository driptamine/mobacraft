# Outer Reaches layout

`layout.json` is extracted from `2p_outer_reaches.sgb` in the same format as
Into the Breach. It contains 5 detail textures,
265 decal placements and 328 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/2p_outer_reaches/2p_outer_reaches.sgb --assets-dir maps/all_tiles_staged/2p_outer_reaches
```

`2p_outer_reaches_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/2p_outer_reaches/2p_outer_reaches.sgb
```
