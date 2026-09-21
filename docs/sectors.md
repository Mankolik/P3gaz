# Track sector membership

Each track is checked against the loaded `SECTOR_LOW`, `SECTOR_HIGH`, and `TMA` GeoJSON datasets after initial loading and after every movement update. Checks use the source longitude/latitude polygons and `actualFlightLevel`; map zoom, layer visibility, cleared levels and planned levels do not change physical membership.

The callsign tooltip shows physical sector membership and vertical limits. The floating [Extended Label Window](extended-label-window.md) shows the last hovered aircraft's details, live Mode S values and grouped sector sequence with exit levels. It remains draggable and stays within the radar area when resized.

A track outside every loaded volume is shown as outside the loaded sector limits. Missing position/altitude or incomplete sector datasets produce an unavailable result rather than a guessed sector.

The stored data currently defines LOW as FL095–365 and HIGH as FL365–660. The simulator uses **floor inclusive, ceiling exclusive**: FL365 belongs to HIGH, and FL660 is outside these volumes. This is an explicit simulation convention for the shared vertical boundary.

Polygon holes and MultiPolygon islands are supported. Lateral edges are included. At an exact shared edge or an overlap, all matching sectors are reported in stable order; none is arbitrarily selected as the controlling sector.

Matching local TMA volumes take precedence over broad UTMAs, and both take precedence over ACC sectors. Priority applies only after the lateral and vertical checks pass. Above/below a TMA band, outside its polygon, or inside a polygon hole, membership falls back to the next matching volume. All matches at the highest priority are retained.

Named UTMA subdivisions use `vertical: "UTMA"` to preserve that priority, and an optional `name` provides the tooltip's display name. See [the EPWA / EPKK rebuild notes](tma-epwa-epkk.md) for the supplied boundaries, eight-part Krakow/Katowice structure, arc interpretation and FIR approximation.

TMA `vertical_bands` are checked separately, preserving gaps between bands. FL/STD limits are used directly; feet AMSL/STD are divided by 100 using the simulator's existing **standard-pressure approximation**. There is no QNH or terrain model, so unsupported references such as AGL mark the index incomplete rather than guessing. The tooltip preserves source units, for example `2000 FT AMSL–FL245`, instead of relabelling AMSL limits as flight levels.

`track.sectorMembership` contains `{ status, sectors }`, where status is `inside`, `outside`, or `unknown`. Each sector has `id` (for example `E:HIGH`), `code`, `vertical`, `name`, `minFl`, `maxFl`, `kind` (`ACC` or `TMA`) and `priority`. TMA matches also retain their source `floor` and `ceiling`; multi-band features get distinct band IDs. On a change, `track:sector-changed` emits `{ track, previous, current }` and the label refreshes.

This represents membership in the bundled ACC/TMA volumes. CTR handling, controller ownership, handoff state, traffic colors and the top-bar working-sector selection are separate features. Geometry files are not modified by the priority rules.

Run the geometry and movement checks with `node --test tests/sectors.test.mjs`. The browser suite also checks that the live application's callsign tooltips show sector membership.
