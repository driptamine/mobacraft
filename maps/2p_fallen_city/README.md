# Fallen City layout

`layout.json` is extracted from `2p_fallen_city.sgb` in the same format as
Into the Breach. It contains 5 detail textures,
778 decal placements and 697 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/2p_fallen_city/2p_fallen_city.sgb --assets-dir maps/all_tiles_staged/2p_fallen_city
```

`2p_fallen_city_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/2p_fallen_city/2p_fallen_city.sgb
```
