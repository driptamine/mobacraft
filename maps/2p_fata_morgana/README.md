# Fata Morgana layout

`layout.json` is extracted from `2p_fata_morgana.sgb` in the same format as
Into the Breach. It contains 2 detail textures,
396 decal placements and 368 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/2p_fata_morgana/2p_fata_morgana.sgb --assets-dir maps/all_tiles_staged/2p_fata_morgana
```

`2p_fata_morgana_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/2p_fata_morgana/2p_fata_morgana.sgb
```
