# Gurmuns Pass layout

`layout.json` is extracted from `4p_gurmuns_pass.sgb` in the same format as
Into the Breach. It contains 3 detail textures,
424 decal placements and 209 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/4p_gurmuns_pass/4p_gurmuns_pass.sgb --assets-dir maps/all_tiles_staged/4p_gurmuns_pass
```

`4p_gurmuns_pass_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/4p_gurmuns_pass/4p_gurmuns_pass.sgb
```
