# Rhean Jungle layout

`layout.json` is extracted from `8p_rhean_jungle.sgb` in the same format as
Into the Breach. It contains 10 detail textures,
1431 decal placements and 2237 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/8p_rhean_jungle/8p_rhean_jungle.sgb --assets-dir maps/all_tiles_staged/8p_rhean_jungle
```

`8p_rhean_jungle_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/8p_rhean_jungle/8p_rhean_jungle.sgb
```
