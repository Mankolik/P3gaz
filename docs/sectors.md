# Track sector membership

Each track is checked against the loaded `SECTOR_LOW` and `SECTOR_HIGH` GeoJSON datasets after initial loading and after every movement update. Checks use the source longitude/latitude polygons and `actualFlightLevel`; map zoom, layer visibility, cleared levels and planned levels do not change physical membership.

The floating **Track sector** window remembers the last track label hovered and updates its callsign, actual level, sector and vertical limits as the simulation runs. Drag its header to move it, or focus the header and use the arrow keys. It stays within the radar area when the window is resized. The callsign tooltip also shows membership.

A track outside every loaded volume is shown as outside the loaded sector limits. Missing position/altitude or incomplete sector datasets produce an unavailable result rather than a guessed sector.

The stored data currently defines LOW as FL095–365 and HIGH as FL365–660. The simulator uses **floor inclusive, ceiling exclusive**: FL365 belongs to HIGH, and FL660 is outside these volumes. This is an explicit simulation convention for the shared vertical boundary.

Polygon holes and MultiPolygon islands are supported. Lateral edges are included. At an exact shared edge or an overlap, all matching sectors are reported in stable order; none is arbitrarily selected as the controlling sector.

`track.sectorMembership` contains `{ status, sectors }`, where status is `inside`, `outside`, or `unknown`. Each sector has `id` (for example `E:HIGH`), `code`, `vertical`, `name`, `minFl`, and `maxFl`. On a change, `track:sector-changed` emits `{ track, previous, current }` and the label refreshes.

This represents membership in the bundled ACC sector volumes. TMA/CTR volumes are not subtracted from those datasets. Controller ownership, handoff state, traffic colors and the top-bar working-sector selection are separate features.

Run the geometry and movement checks with `node --test tests/sectors.test.mjs`. The browser suite also checks that the live application's callsign tooltips show sector membership.
