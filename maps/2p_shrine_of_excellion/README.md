# Shrine Of Excellion layout

`layout.json` is extracted from `2p_shrine_of_excellion.sgb` in the same format as
Into the Breach. It contains 4 detail textures,
445 decal placements and 392 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/2p_shrine_of_excellion/2p_shrine_of_excellion.sgb --assets-dir maps/all_tiles_staged/2p_shrine_of_excellion
```

`2p_shrine_of_excellion_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/2p_shrine_of_excellion/2p_shrine_of_excellion.sgb
```
