# Demes Northlands layout

`layout.json` is extracted from `8p_demes_northlands.sgb` in the same format as
Into the Breach. It contains 3 detail textures,
1873 decal placements and 66 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/8p_demes_northlands/8p_demes_northlands.sgb --assets-dir maps/all_tiles_staged/8p_demes_northlands
```

`8p_demes_northlands_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/8p_demes_northlands/8p_demes_northlands.sgb
```
