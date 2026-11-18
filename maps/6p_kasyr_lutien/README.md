# Kasyr Lutien layout

`layout.json` is extracted from `6p_kasyr_lutien.sgb` in the same format as
Into the Breach. It contains 12 detail textures,
1690 decal placements and 1230 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/6p_kasyr_lutien/6p_kasyr_lutien.sgb --assets-dir maps/all_tiles_staged/6p_kasyr_lutien
```

`6p_kasyr_lutien_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/6p_kasyr_lutien/6p_kasyr_lutien.sgb
```
