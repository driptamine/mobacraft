# Thargorum layout

`layout.json` is extracted from `6p_thargorum.sgb` in the same format as
Into the Breach. It contains 1 detail textures,
701 decal placements and 186 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/6p_thargorum/6p_thargorum.sgb --assets-dir maps/all_tiles_staged/6p_thargorum
```

`6p_thargorum_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/6p_thargorum/6p_thargorum.sgb
```
