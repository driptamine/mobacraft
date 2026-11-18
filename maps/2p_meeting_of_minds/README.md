# Meeting Of Minds layout

`layout.json` is extracted from `2p_meeting_of_minds.sgb` in the same format as
Into the Breach. It contains 2 detail textures,
326 decal placements and 280 entity records.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/2p_meeting_of_minds/2p_meeting_of_minds.sgb --assets-dir maps/all_tiles_staged/2p_meeting_of_minds
```

`2p_meeting_of_minds_path.json` comes directly from the SGB `DATAIMPA` chunk:
open paint is free, everything else is closed for movement.

```sh
node --import tsx scripts/extract-sgb-path.mjs maps/2p_meeting_of_minds/2p_meeting_of_minds.sgb
```
