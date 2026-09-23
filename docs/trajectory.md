# Trajectory and coordination

The playable responsibility is one configurable merged Warszawa ACC sector, **ALLFIR** by default. The [live sectorisation editor](sectorisation.md) partitions the 20 elementary Low/High volumes and selects the user's group. Physical airspace, controlling owner, and the local label status are separate. The host simulation owns transfers and proposal timers; `statusForSector` derives a controller-relative view. Networking is not implemented and neighbouring FIRs/TMAs are not playable. References to ALLFIR below also apply to the currently selected merged sector.

## Airspace designators

| Loaded airspace | Sequence designator |
| --- | --- |
| EPPO, EPZG (and EPWR if geometry is added later) | APPO |
| EPKK, EPKT | APKK |
| EPWA, EPMO, EPRA | APWA |
| EPGD | APGD |
| EPSC / EPLB / EPRZ / EPSY / EPLL / EPBY | TSC / TLB / TRZ / TSY / TLL / TBY |
| EPWW ACC sectors | Current merged group name; ALLFIR by default |
| Inside EPWW, below FL095, outside TMAs | FIS |
| Foreign FIR/UIR | First three characters of `AV_AIRSPAC`, e.g. EDU, ESA, UKL, UKB |

Grouping preserves the actual polygons, holes and altitude bands. Local TMAs take priority over UTMAs, and both take priority over ACC. Adjacent volumes with the same designator form one sequence visit. Floors are inclusive and ceilings exclusive. Missing coverage is explicitly UNKNOWN; the simulation does not invent an ACC/TMA or transfer to UNKNOWN. Original map data is unchanged; EPWR geometry is not added.

## Predicted path

`trajectory.js` builds a separate virtual profile from the current position along the drawn route. The route display and prediction use the same `plannedRoutePoints` helper: the remaining filed route on a heading, or the cleared shortcut and its continuation on a direct-to. Heading instructions still steer actual movement but never generate a projected heading path for the trajectory. Changing or clearing a heading keeps the filed route prediction; without remaining route points there are no predicted onward crossings. Cyan crossing markers follow that same drawn route.

Each sector aims for its coordinated XFL using the type's phase baseline climb/descent rates and automatic phase speeds. Before ALLFIR, PEL supplies the preceding sector's XFL. Inside ALLFIR, the local XFL is used. Departures with no XFL aim for ECL; other flights retain their inherited coordinated level when XFL is empty (or current level when no preceding target exists). An unfinished descent therefore continues through a TMA roof/FIS ceiling rather than stopping exactly on the boundary and oscillating between volumes. A lower departure XFL caps that sector's climb. The next target takes effect only after crossing into the next volume, and explicit `sectorExitLevels` can constrain computer sectors too. Targets are limited by the aircraft ceiling. Arrivals have no inferred airport descent or route-point restrictions yet.

This is a coordination plan, not an extrapolation of every current tactical instruction: CFL, manually assigned speed/rate, turn rollout and vertical-rate acceleration do not drive the predicted profile. Actual aircraft continue to obey their CFL and their existing gradual movement model. XFL edits never issue a local CFL automatically. Computer sectors issue a matching CFL for their coordinated exit target, including departure climb; after ownership is accepted by ALLFIR, its controller supplies further actual CFL changes.

Horizontal legs are split at all intersected polygon edges, including holes, and vertical integration splits at airspace floors/ceilings and performance phase levels. Within those intervals, prediction steps are at most ten seconds. Short crossings are preserved even if shorter than an integration step. Repeated visits are retained. A finite work/visit guard reports incomplete predictions rather than freezing on contradictory profiles.

Predictions refresh immediately on approved route/PEL/XFL changes and physical sector changes; ordinary motion refreshes after five simulation seconds, half a nautical mile or FL001 of altitude change. Unchanged ticks reuse the cached prediction. This work is separate from the airport-pair distance cache used to generate ECL. Map-layer visibility does not affect prediction or transfers.

## Transfers and labels

Upcoming visits with a known exit and no more than **3 NM along the predicted route** inside that sector are omitted from the sector sequence. The threshold is inclusive and measures cumulative route distance, including bends. Adjacent visits to the same sector merge across an omitted excursion. The geometric/altitude profile still resolves the loaded volumes to measure visits; omitted visits are excluded from route crossing markers, coordination and transfers. An already established current visit is retained as the aircraft approaches its exit, so it does not disappear when only 3 NM remain. A route ending inside a sector has no known onward exit and is retained.

Physical membership remains available separately. While crossing an omitted volume, the aircraft keeps its preceding effective sector; that volume does not take ownership or issue a computer clearance. Transfers target the next retained sector's actual entry at 10 NM, not the earlier omitted boundary. Reroutes can promote a previously omitted current volume if the short onward crossing no longer exists. Pending coordination is cancelled on meaningful ownership/visit changes, not on an ignored physical crossing.

The floating [Extended Label Window](extended-label-window.md) remembers the last hovered track. Row 8 shows its current and upcoming sector designators and exit levels in route order, coloured by ownership and sequence position; repeated visits remain in order. The other rows show flight details and live Mode S values. Drag the header or use its arrow keys to move the window. Predicted crossing markers and levels still appear when the route is displayed/previewed.

- ALLFIR next: **inbound**; ALLFIR later in the sequence: **pre-inbound**.
- Within approximately 10 NM along the prediction before entry: automatically owned by ALLFIR and **accepted**, even while physically outside.
- Within approximately 10 NM of exit: automatically owned by the next sector and **intruder** while physically inside ALLFIR. That next sector's view is **accepted**.
- Once outside: **unconcerned**, unless another predicted ALLFIR visit makes it inbound/pre-inbound (or close enough for acceptance again).

To avoid immediate accept/send oscillation in short visits, departure transfer waits for three seconds of physical presence in ALLFIR. A transfer is retained while approaching the same exit; rerouting away from that exit cancels it. Physical crossings reconcile ownership even when there was too little distance/time for advance transfer.

## Proposals

An inbound/pre-inbound label exposes **PEL**, including when empty; it never substitutes the previous controller's CFL. The local controller cannot edit a remotely owned CFL. PEL, H, S, R and direct-to changes to computer-owned traffic become red proposals while the old instruction remains active. Local XFL/ECL planning changes are immediate.

After **three simulation seconds**, the computer accepts and applies the proposal. PEL acceptance updates the XFL of the last sector before the user's sector and, when that is the aircraft's active sector, the computer's actual CFL. Other upstream sectors keep their own targets. Clearing PEL removes that coordinated target, returning a departure to ECL and other traffic to its current level. H/S/R clearing is also proposed when remotely owned; normal baseline/heading-hold behavior applies after acceptance. Heading and direct-to share one pending navigation slot; other fields can be proposed independently. A replacement restarts that field's timer.

Changing owner or physical sector visit cancels pending proposals. A route replacement also invalidates an outstanding shortcut; point/index validity is checked again when it is accepted. Red pending rate indications override an older orange unable indication. Normal aircraft ceiling and climb-rate unable behavior remains in force after acceptance.

## Validation

`node --test tests/*.test.mjs` includes all 251 real catalogue variants, airspace grouping, vertical TMA exits, horizontal limits, holes, narrow visits, re-entry, baseline prediction, caching, transfers and proposal timing. `node tests/trajectory.browser.cjs` exercises real PEL/shortcut/H/S/R controls, red pending values, delayed application, empty PEL, label transfers and the sequence panel. The existing label, spawner and route-display browser suites provide regression coverage.
