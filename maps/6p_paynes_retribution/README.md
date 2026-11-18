# Paynes Retribution layout

`layout.json` is extracted from `6p_paynes_retribution.sgb` in the same format as
Into the Breach. It contains 8 detail textures,
557 decal placements and 406 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/6p_paynes_retribution/6p_paynes_retribution.sgb --assets-dir maps/all_tiles_staged/6p_paynes_retribution
```

`6p_paynes_retribution_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/6p_paynes_retribution/6p_paynes_retribution.sgb
```
