# Morriah Coast layout

`layout.json` is extracted from `8p_morriah_coast.sgb` in the same format as
Into the Breach. It contains 4 detail textures,
1849 decal placements and 2987 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/8p_morriah_coast/8p_morriah_coast.sgb --assets-dir maps/all_tiles_staged/8p_morriah_coast
```

`8p_morriah_coast_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/8p_morriah_coast/8p_morriah_coast.sgb
```
