# Jalaganda Lowlands layout

`layout.json` is extracted from `8p_jalaganda_lowlands.sgb` in the same format as
Into the Breach. It contains 5 detail textures,
1629 decal placements and 1543 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/8p_jalaganda_lowlands/8p_jalaganda_lowlands.sgb --assets-dir maps/all_tiles_staged/8p_jalaganda_lowlands
```

`8p_jalaganda_lowlands_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/8p_jalaganda_lowlands/8p_jalaganda_lowlands.sgb
```
