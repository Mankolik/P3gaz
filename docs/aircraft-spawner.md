# Aircraft spawner

Use **+ Aircraft** at the top right. Each click creates one track whose label reflects its ownership and predicted entry into ALLFIR. The button waits for the navigation data and route catalogue; a load failure leaves it disabled with an explanation. A short message identifies the flight and its spawn fix or ground state. See [trajectory and coordination](trajectory.md) for airspace designators, automatic transfers and inbound proposals.

## Selection and initial levels

Routes and callsigns come from `assets/sources/Airporty_revamped.txt`. Choose an eligible departure/destination pair uniformly, then an unused callsign from that pair, then a valid route variant, then an aircraft type uniformly from that directional pair's operator pool. The operator is the callsign's first three letters. Pairs with more variants or more aircraft types do not get more traffic. Active callsigns and track IDs are unique. All callsigns exhausted produces a message and no new track.

`assets/sources/route-aircraft-types.txt` contains the user's aircraft list for all 184 directional pairs and 290 route/operator combinations. Directions are independent: for example, TAY is supplied only on EPWA–LFPG and CAI only on EYVI–LTAI. Missing or invalid pools prevent startup with an explanation; no reverse-route, source-type or B738 fallback is used. Wake category follows the selected type, including heavy widebodies. `track.sourceRoute.operator` and `aircraftTypeSource` record the selection's provenance.

Arrivals and overflights spawn at the calculated ECL: AFL = CFL = PEL = ECL. There is one distance-based cruise-level draw; the earlier weighted altitude sampler is removed. Initial speed is the type's cruise Mach converted to TAS at this same altitude. Departures retain AFL/CFL 010 and a separately calculated ECL/PEL. All new aircraft start with empty XFL. Source route levels and inline annotations remain in `track.sourceRoute` as provenance only; they do not control spawn altitude. Source variant aircraft types are likewise ignored when spawning.

## Requested cruise level (ECL)

At catalogue compilation, `route-metrics.js` resolves the departure and destination airport coordinates and caches `routeDistanceKm` and `generalTrack` on each group. Distance is the great-circle airport-to-airport distance (mean Earth radius 6371.0088 km); general track is its initial bearing. Each directional airport pair is measured once per compilation, regardless of route-variant count. Spawning reuses these fields; movement ticks never calculate route distance. Route detours, truncated foreign prefixes/suffixes and original route-file type/FL annotations do not influence ECL.

| Airport distance (km) | ECL target band |
| --- | --- |
| Below 250 | FL180–240 |
| 250 to below 450 | FL220–280 |
| 450 to below 700 | FL260–320 |
| 700 to below 1000 | FL280–340 |
| 1000 to below 1500 | FL300–360 |
| 1500 to below 2200 | FL320–380 |
| 2200 through 3500 | FL340–400 |
| Above 3500 | FL350–410 |

`cruise-level.js` samples a target around the band's midpoint with uniform variation of at most ±FL020, then snaps to the nearest valid general-track level (ties go lower):

- 000° to below 180°: 190, 210, 230, 250, 270, 290, 310, 330, 350, 370, 390, 410, 450.
- 180° to below 360°: 180, 200, 220, 240, 260, 280, 300, 320, 340, 360, 380, 400, 430.

Where performance is supplied, the ceiling and optional `maxCruiseFL` limit the eligible levels before snapping, so clamping cannot produce an invalid east/west level. A restrictive aircraft limit can place ECL below the distance band. The present profiles provide `ceilingFL`.

The generated level supplies `expectedCruiseLevel` (the ECL label field), PEL, and initial AFL/CFL for arrivals and overflights. Departures still have AFL/CFL 010. **All new aircraft start with an empty XFL.** ECL is shown in its existing compact tens-of-FL format on label hover, with the full value in its title. Editing ECL later does not fill XFL or issue a climb clearance.

An empty XFL appears as a blank, always-visible box using the label controls' 1px `currentColor` outline. Filling XFL removes the persistent outline and restores normal behavior: matching CFL values hide until hovering/focusing the levels, and different values stay visible. Clearing XFL restores the empty box. Column geometry stays fixed, and ECL edits leave XFL intact.

The empty XFL picker opens around ECL; a filled XFL picker opens around its assigned value. CFL opens around XFL when set, otherwise around CFL. Scrolling does not select or assign the reference level, and the current clearance remains highlighted even when outside the initial scroll area.

Heading, speed and rate manual inputs open blank. Enter with no value clears the restriction, as does **Clear**. Clearing H removes its label value but retains the last heading target, including completion of an ongoing turn. A new heading or direct-to/route instruction replaces that hold. Clearing an already empty H does not cancel point/route navigation. Clearing S/R returns to the performance baseline and clears any R unable indication.

## Entry and route following

The spawner expands the route before selecting a position. It tests intersections with the EPWW FIR polygon, including legs whose endpoints are both outside, handles holes and multipolygon parts, and finds the first entry. It then selects the second route fix strictly before entry and starts navigation at the following point. Fewer than two usable preceding fixes means the variant is unavailable.

The KJFK–EPWA source example starts at **BIVKI**, followed by **SONAL**, **BINKA** and the rest of the expanded route. P150's intermediate fixes are present. Tracks use the existing flight-plan navigation and turn/capture logic.

EPWW airway sections use the bundled PANSA dataset, in the order needed by the route. This is geometric expansion; it does not validate level restrictions, CDR availability or direction arrows. Entirely foreign airway sections become DCT between their named endpoints. A section with one foreign endpoint can extend through the single unambiguous published boundary endpoint. Ambiguous continuations are rejected. No U-prefixed aliases or internal airway connections are invented. The strict general-purpose airway resolver keeps its existing behaviour, including rejection of the Q800 foreign gap; the traffic compiler may bridge that gap only when it is wholly foreign.

The FIR outline and airway coordinates come from separate datasets. For foreign-leg classification only, an edge tolerance of 0.5 NM accommodates boundary fixes slightly displaced from the FIR outline. The spawn point itself must be outside the actual polygon and outside this tolerance. A leg crossing the FIR interior cannot be discarded as foreign.

Five-letter points, navaid identifiers, coordinate fixes (`63N010W` / `5230N02030E`), adjacent fixes, DCT, level-only and combined speed/level suffixes are supported. Generic SID/STAR markers connect the airport to the first/last en-route fix directly; actual procedures are not generated.

## Ground departures

Airports inside EPWW and the explicit exceptions EYVI, LKPR and EDDB start at their airport reference point, already airborne at AFL010 and **180 kt IAS**, immediately following the route. The initial groundspeed is the altitude-adjusted TAS (about 183 kt in calm air at FL010), not 180 kt GS. No speed clearance is installed: movement smoothly adopts the type's initial-climb IAS, then its altitude/phase schedule. With airspace control loaded, the computer-controlled departure sector issues a CFL toward its coordinated exit level (PEL, initially ECL). Once ALLFIR accepts ownership, actual flight follows that clearance until the controller changes CFL. This is a generic departure, without taxi, runway roll or a published SID.

## Aircraft performance

The user-supplied `assets/sources/aircraft-performance.txt` defines all 23 available types. `node scripts/import-aircraft-performance.mjs` regenerates `src/data/aircraft-performance.js`; tests compare every field with the original. The repeated unlabelled `210 kt` after E195's MCS is treated as a duplicate, not a second parameter.

| Flight phase | Altitude band | Automatic speed and vertical rate |
| --- | --- | --- |
| Initial climb | Below FL050 | Type initial-climb IAS and RoC |
| Climb | FL050 to below FL150 | Type first-climb IAS and RoC |
| Climb | FL150 to below FL240 | Type second-climb IAS and RoC |
| Mach climb | FL240 and above, with a higher CFL | Type climb Mach and RoC |
| Cruise | Level at FL240 or above | Type cruise Mach; zero vertical speed |
| Initial descent | Above FL240 | Type descent Mach and RoD |
| Descent | Above FL100 through FL240 | Type descent IAS and RoD |
| Approach | FL100 and below while descending | Type approach IAS and RoD |

Lower level-offs retain the relevant climb or descent/approach speed; they do not automatically climb through a clearance. Speeds use the simulator's existing altitude-aware IAS/TAS and Mach/TAS conversions and 5 kt/s acceleration model. The supplied cruise TAS and Mach are not always equivalent, so Mach drives automatic cruise while nominal TAS remains reference data.

Speed mode uses a fixed **FL240 conversion level**, matching the supplied phase schedule, rather than calculating an IAS/Mach crossover. Below FL240 the aircraft uses IAS; at and above FL240 it uses Mach, consistently in climb, descent and level flight. An opposite-mode instruction remains recorded but waits until the aircraft enters its mode. Until then the aircraft holds its automatic phase speed: for example, an IAS restriction above FL240 leaves the baseline Mach active. Clearing the restriction restores the automatic schedule. Switching tabs in the speed picker only browses the other mode and does not cancel an existing instruction.

Mach selections are bounded only by the type's cruise Mach minus 0.05 and plus 0.01; the picker and manual entry share these limits. MCS does not constrain Mach flight, including at FL430. Below conversion, the absolute IAS minimum is **MCS minus 25 kt**, allowing lower approach speeds. This floor applies to assigned and automatic IAS targets. Departures still spawn at IAS180 and then accelerate toward a target no lower than MCS minus 25 kt; acceleration remains gradual. An IAS restriction entered above conversion is bounded for later use but remains inactive until the aircraft descends below FL240.

RoC/RoD are phase **baselines**. Without a rate command, the aircraft aims for that baseline. Explicit climb requests can reach 110% of the current baseline; lower requests are honoured. For example, a 1,000 ft/min request against an 800 ft/min climb baseline targets 880 ft/min. Descent requests can be higher or lower without a performance-table cap. Manual rate entry and label normalization do not silently clip values at the former 4,000/6,000 ft/min limits; the preset list remains a convenience. “Or greater” and “or less” compare the requested magnitude with the baseline, then apply the climb allowance if climbing. Clearing a rate command restores the baseline.

Actual vertical rate approaches its target at **50 ft/min per second** for profiled aircraft: a 1,000 ft/min change takes 20 seconds. This applies both to phase changes (such as FL050) and controller requests. A lower phase baseline changes the target, without instantly clipping the current rate; the aircraft gradually settles onto the new baseline/allowance. The response also works at normal high-frame-rate tick sizes. Level capture still prevents crossing a cleared level. Movement uses at most 0.5-second integration steps for profiled types, including heading-only flights, so accelerated time does not skip altitude bands. Spawn levels and physical movement respect the aircraft ceiling.

### Unable responses

CFL requests above the type ceiling are rejected, whether selected from a preset or entered manually. The **last accepted CFL remains active and visible in orange**, including when it matches AFL; its tooltip identifies the rejected level. The aircraft finishes its existing climb/descent or holds that accepted CFL, rather than climbing to the ceiling. Reissuing an achievable CFL (including the same accepted value) or clearing CFL removes the response. CFL offers the full level picker so an impossible request can receive this response; PEL/XFL/ECL keep their ceiling-bounded editors.

A new exact or “or greater” climb-rate request **strictly above 130%** of the current altitude band's baseline turns **R orange**. The requested rate stays recorded, while movement still targets no more than **110%** of baseline with the existing gradual transition. Exactly 130% does not produce “unable”. “Or less” is an upper bound, so a high bound is achievable at baseline and is not rejected. Descents remain unrestricted. CFL determines climb/descent direction; while level, a positive rate request is checked against the climb baseline for that altitude. The response is evaluated when the rate instruction is issued, not regenerated each tick, and remains until the rate is replaced or cleared. CFL and R responses clear independently.

Range remains a reference field; there is no fuel/range or flap-configuration model. Unknown ad hoc types retain generic movement, while the route spawner requires a profile for every configured type.

## Route coverage and diagnostics

The supplied catalogue contains 184 airport pairs and 251 variants. With the user corrections dated 2026-09-19, **all 184 pairs / 251 variants** are usable (40 variants restored). There are no excluded variants. Unresolved distant foreign prefixes/suffixes still produce omission notices under the rules below; full foreign-route coverage is not implied. For example, LKPR-EETN still omits the unresolved foreign ADBIB/SULUN suffix.

`assets/geojson/route-point-corrections.geojson` records the 16 user-supplied coordinates with their original DMS values, including OKL and PAM. It is required navigation data loaded by the manifest. Its explicit `navigationOverrides` flag makes those names take precedence in the navigation index regardless of dataset order, including the selected ELVOT coordinate. Other duplicate names remain ambiguous; conflicting overrides also remain ambiguous. Original imported GeoJSONs and published airway coordinates are unchanged. SUXTU uses 53 03 36 N / 017 16 52 E; the alternative compact coordinate supplied by the user differs slightly.

The route source includes the requested SONUD-SUBIX replacement with DCT IDOBA DCT in both directions, and removes BUG from KEROP DCT BUG DCT LITKU without duplicating KEROP. EGSS-EPLL's MAG Z20 SUBIX section becomes MAG DCT KISUC DCT BUROK DCT ESIKA DCT LULUL DCT SONUD DCT IDOBA DCT SUBIX, using the user's corrected KISUC spelling and its existing abroad coordinates. N858 becomes DCT only in the four specified EDDF-EETN/EVRA/EYVI and LFPG-EYVI rows. Other N858 uses and the airway interpreter are unchanged. Route line numbers, callsigns, aircraft types and level annotations are preserved.

Unresolved distant foreign prefixes/suffixes may be omitted if a continuous resolved block covers the EPWW flight and its spawn lead-in. The compiler never bridges an unresolved fix within that block. Ground-start routes must retain their departure airport; EPWW arrivals must retain their destination. A missing foreign tail cannot truncate the simulated route while still inside EPWW. Each omission is recorded in diagnostics and track metadata. After the last available foreign fix, existing navigation holds the arrival heading; full foreign arrival procedures are outside this change.

Inspect `state.air.spawner.catalogue.diagnostics` during development or regenerate the report:

```sh
node scripts/audit-route-catalogue.mjs
```

This report is derived from the actual bundled data, not a maintained exclusion list. Restoring missing fixes automatically restores eligible variants at the next load. No traffic frequency or automatic spawning timer is added.

## Validation

```sh
node --test tests/*.test.mjs
node tests/spawner.browser.cjs
node tests/track-labels.browser.cjs
```

Browser checks require Playwright; `BROWSER_CHANNEL=chrome` selects installed Chrome. Tests cover all compiled variants, every supplied operator/type choice, directional pool differences, the real BIVKI entry, boundary geometry, parsing/expansion, selection order, airborne spawning at ECL, moving FL010 departures, gradual rate changes at phase boundaries and high frame rates, 110% climb requests, uncapped descent requests through the picker, duplicate prevention, startup failures, real accepted labels, keyboard activation and button placement at 1440/1100/650/390 px.
