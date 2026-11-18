# GrimCraft computer players

The `.ai` files are Dawn of War Lua scripts. Their engine functions are unavailable
in GrimCraft, so they are preserved as source data rather than executed directly.
`scripts/compile-ai.mjs` reads their literal strategy tables and produces
`profiles.json`: nine races, four difficulties, and the original 0.5-second AI tick.
The source file list and SHA-256 fingerprint are included in the generated file.

## Behavior

Every seat starts with a completed HQ and one worker. Combat squads must be
ordered through production; no race receives free starting warriors.
Normal seats start with 1000 requisition and 100 energy. Base requisition income
is +20 per ten seconds (the HUD period); point/LP0, LP1, LP2 and LP3 add
+6/+12/+18/+24. Necrons retain their previous starting resources.

Computer slots use their race's supported opening build order, desired worker and
capturer counts, strategic point limit, attack group size, army budget and retreat
rating. They capture points, build a base with workers, produce units, reinforce,
defend their HQ, gather attack groups and retreat injured/outnumbered squads.
Construction pauses without an active worker. Production retains the bot's owner.
Each bot has its own resources and pays through normal construction/production
queues; there are no free replacement armies. Allied bots cannot be commanded by
the human. Difficulty is selectable on each Computer slot in the lobby.

Local games run `src/ai/controller.ts`. Online games run
`grimcraft-go/internal/sim/computer.go` inside the Go authority; the client disables
its AI in multiplayer. Node is a build-time tool only.

## Updating source data

After editing Lua tables or faction catalogs:

```sh
npm run ai:compile -- --go-dir ../grimcraft-go
```

This writes identical profiles into both repositories. Restart the Go server after
rebuilding it. `npm run dev` and `npm run build` regenerate the client profile.

The adapter translates blueprints only when the corresponding game unit/building
exists. Original spells, research, addons and unavailable units are not implemented
by this change; unsupported opening entries are listed in each profile's
`unsupported` field. Source flags such as `noResearch` are retained as metadata for
future systems. This is an adaptation of strategy data, not full DoW Lua execution.

## Verification

```sh
node --import ./tests/register-hooks.mjs --test tests/game-ai.test.js
AI_TEST_FACTIONS='ig;chaos;space marines;orks;necrons;eldar;dark eldar;tau;sob' \
  node --import ./tests/register-hooks.mjs tests/game-ai-probe.mjs
cd ../grimcraft-go && go test ./...
```

The integration probes advance real game systems and check capture, worker-led
construction, production, ownership and economy isolation. Go tests cover all nine
races, base defense, retreat and the absence of free respawns.
