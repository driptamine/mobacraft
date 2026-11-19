# GrimCraft

```sh
npm install
npm run dev
```

Multiplayer uses the adjacent `../grimcraft-go` server. In a second terminal:

```sh
cd ../grimcraft-go
go run ./cmd/server
```

Open Multiplayer at `http://localhost:3000`, create a game and choose a map.
Share `/server/<id>` with another browser or incognito window, or add Computer
slots before starting. The UI discovers the local WebTransport endpoint and
certificate automatically.

The backend runs entirely in Go, including its authoritative simulation.
Node.js is used for frontend development and builds only.
Go manages map state, movement, ranged and melee combat, construction,
production, research, resources and reinforcement.

Settings and the in-game lighting controls switch Classic/DE lighting and
model-shaped shadows without restarting the match. Infantry model switches
select the classic or new Guardsman and Space Marine assets. The loader repairs
transparency and Guardsman animation timing in older hosted copies.

```sh
npm run build
npm test
npm run test:ts
```

Batch 1 hero exports store bodies and wearables separately. After placing the
source assets in `batches/1/models/heroes/`, run `npm run heroes:build` to assemble
the complete, textured models in `batches/1/final/`. The parts list and runtime
paths live in `animations/batches/1/animations.json`. Generated GLBs stay in the
ignored asset tree alongside the source exports.

HQ → HEROES includes batches 1–13, with search and a batch filter. Additional
heroes load on selection and enter the HQ recruitment queue only after the
model is ready. They are never loaded or spawned by the match-start lineup.
`animations/heroes.json` records their bodies, wearables, clips and official
portrait URLs. Run `npm run heroes:build-all` to rebuild models and
`npm run heroes:icons` to fetch portraits. Marci's source body is absent from
the supplied batch, so her portrait remains visible with recruitment disabled.

Doom Spiral uses two flat recruitment squares: blue occupies the original
Space Marine start, and red sits diagonally opposite it, raised along world -X
while retaining its previous Z position. Startup loads only the six creep models;
race models, workers and the hero lineup are not loaded or spawned. Every
hero, including batch 1, loads only when selected from a square's HEROES menu.
Radiant and Dire creeps march along three lanes. Each side sends three melee,
one ranged and one siege creep per lane every 30 seconds, starting immediately.
They use normal terrain routing and combat; ranged creeps fire projectiles and
siege machines attack from farther away with increased damage against buildings.
Run `npm run creeps:build` after replacing the exports in
the `RADIANT-*` and `DIRE-*` directories under `batches/creeps-lane/`
to embed their textures in `batches/creeps-lane/final/`. The standard Dire
body is used; its overlapping cavern variant stays hidden.
