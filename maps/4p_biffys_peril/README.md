# Biffys Peril layout

`layout.json` is extracted from `4p_biffys_peril.sgb` in the same format as
Into the Breach. It contains 5 detail textures,
218 decal placements and 404 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/4p_biffys_peril/4p_biffys_peril.sgb --assets-dir maps/all_tiles_staged/4p_biffys_peril
```

`4p_biffys_peril_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/4p_biffys_peril/4p_biffys_peril.sgb
```
