# Ground navigation

The client combines the original SGB passability paint with dynamic building
footprints. `src/systems/navigation.ts` collects living buildings, structures and
airfields using the same measured contours as collision. Placement previews and
unplaced ghosts do not block movement. Contour changes invalidate cached paths.

`building-routing.js` runs A* on a one-unit search lattice when buildings exist.
It samples the original paint without modifying its resolution or data. Exact
rectangle/segment checks keep smoothing and long movement steps outside buildings.
Clearance includes the mover's radius: infantry/workers 0.5, vehicles 1.0, APCs 1.2.
Orders inside a building finish at its outside boundary. Construction work positions
remain reachable. Formation soldiers and pursuit use the same checks; flying units
retain their flight behavior. Building avoidance also applies in straight terrain mode.

The native Go authority implements building detours in
`internal/sim/navigation.go`: a cached visibility graph over expanded building
corners, with invalidation on construction/completion/destruction. Ground movement,
pursuit and replica formation positions respect those contours. The client does
not run a second simulation in multiplayer.

Regression checks:

```sh
node --import ./tests/register-hooks.mjs --test tests/building-routing.test.js tests/building-movement.test.js tests/mover-routing.test.js tests/structure-footprint.test.js
cd ../grimcraft-go && go test ./...
```
