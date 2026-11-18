# Ariel Highlands layout

`layout.json` is extracted from `4p_ariel_highlands.sgb` in the same format as
Alvarus. It contains 1024 terrain tiles, 3 detail textures,
1313 original decal placements of 18 types and 1091 entity records.

The game loads the original tile texture assignments and drapes decals over
the terrain using their original positions, sizes and rotations. Coordinates
stay local to the SGB; the map root applies rotation and mirroring once.

Rebuild the layout, heightmap and lossless browser PNGs:

```sh
node --import tsx scripts/extract-sgb-layout.mjs maps/4p_ariel_highlands/4p_ariel_highlands.sgb --assets-dir "maps/4p_ariel_highlands/Ariel"
```

The added `stone_cliff_04c` source files are stored under `Ariel/decals/`.
All 1313 original decal placements now have their referenced textures,
including the 198 original `stone_cliff_04c` positions.
