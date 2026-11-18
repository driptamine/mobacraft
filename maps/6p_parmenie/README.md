# Parmenie layout

`layout.json` is extracted from `6p_parmenie.sgb` in the same format as
Into the Breach. It contains 2 detail textures,
305 decal placements and 115 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/6p_parmenie/6p_parmenie.sgb --assets-dir maps/all_tiles_staged/6p_parmenie
```

`6p_parmenie_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/6p_parmenie/6p_parmenie.sgb
```
