# Titan Fall layout

`layout.json` is extracted from `2p_titan_fall.sgb` in the same format as
Into the Breach. It contains 14 detail textures,
444 decal placements and 835 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/2p_titan_fall/2p_titan_fall.sgb --assets-dir maps/all_tiles_staged/2p_titan_fall
```

`2p_titan_fall_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/2p_titan_fall/2p_titan_fall.sgb
```
