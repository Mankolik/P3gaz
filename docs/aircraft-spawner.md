# Aircraft spawner

Use **+ Aircraft** at the top right. Each click creates one **accepted** track. The button waits for the navigation data and route catalogue; a load failure leaves it disabled with an explanation. A short message identifies the flight and its spawn fix or ground state.

## Selection and levels

Routes and callsigns come from `assets/sources/Airporty_revamped.txt`. Choose an eligible departure/destination pair uniformly, then an unused callsign from that pair, then a valid route variant, then an aircraft type uniformly from that directional pair's operator pool. The operator is the callsign's first three letters. Pairs with more variants or more aircraft types do not get more traffic. Active callsigns and track IDs are unique. All callsigns exhausted produces a message and no new track.

`assets/sources/route-aircraft-types.txt` contains the user's aircraft list for all 184 directional pairs and 290 route/operator combinations. Directions are independent: for example, TAY is supplied only on EPWA–LFPG and CAI only on EYVI–LTAI. Missing or invalid pools prevent startup with an explanation; no reverse-route, source-type or B738 fallback is used. Wake category follows the selected type, including heavy widebodies. `track.sourceRoute.operator` and `aircraftTypeSource` record the selection's provenance.

Airborne flights start at the type's cruise Mach, converted to TAS at the sampled altitude, with AFL = CFL = that level. The initial bearing to the next resolved point determines direction: 000 through just below 180 degrees is eastbound; 180 through just below 360 is westbound.

- East: 290, 310, 330, 350, 370, 390, 410, 450.
- West: 280, 300, 320, 340, 360, 380, 400, 430.

These are the supplied pools with the subsequent FL430/FL450 correction. Levels above the selected type's ceiling are removed before sampling, retaining direction and relative weights. FL350 east / FL340 west has weight 2, the adjacent levels have weight 1.5, and the remaining levels have weight 1. Source route levels and inline annotations remain in `track.sourceRoute` as provenance only; they do not override this initial selection. Source variant aircraft types are likewise ignored when spawning.

## Entry and route following

The spawner expands the route before selecting a position. It tests intersections with the EPWW FIR polygon, including legs whose endpoints are both outside, handles holes and multipolygon parts, and finds the first entry. It then selects the second route fix strictly before entry and starts navigation at the following point. Fewer than two usable preceding fixes means the variant is unavailable.

The KJFK–EPWA source example starts at **BIVKI**, followed by **SONAL**, **BINKA** and the rest of the expanded route. P150's intermediate fixes are present. Tracks use the existing flight-plan navigation and turn/capture logic.

EPWW airway sections use the bundled PANSA dataset, in the order needed by the route. This is geometric expansion; it does not validate level restrictions, CDR availability or direction arrows. Entirely foreign airway sections become DCT between their named endpoints. A section with one foreign endpoint can extend through the single unambiguous published boundary endpoint. Ambiguous continuations are rejected. No U-prefixed aliases or internal airway connections are invented. The strict general-purpose airway resolver keeps its existing behaviour, including rejection of the Q800 foreign gap; the traffic compiler may bridge that gap only when it is wholly foreign.

The FIR outline and airway coordinates come from separate datasets. For foreign-leg classification only, an edge tolerance of 0.5 NM accommodates boundary fixes slightly displaced from the FIR outline. The spawn point itself must be outside the actual polygon and outside this tolerance. A leg crossing the FIR interior cannot be discarded as foreign.

Five-letter points, navaid identifiers, coordinate fixes (`63N010W` / `5230N02030E`), adjacent fixes, DCT, level-only and combined speed/level suffixes are supported. Generic SID/STAR markers connect the airport to the first/last en-route fix directly; actual procedures are not generated.

## Ground departures

Airports inside EPWW and the explicit exceptions EYVI, LKPR and EDDB start at their airport reference point, already airborne at AFL/CFL 010 and **180 kt IAS**, immediately following the route. The initial groundspeed is the altitude-adjusted TAS (about 183 kt in calm air at FL010), not 180 kt GS. No speed clearance is installed: movement smoothly adopts the type's initial-climb IAS, then its altitude/phase schedule. The sampled level is retained as the future cruise target; the aircraft holds its current cleared level until the controller clears it higher. This is a generic departure, without taxi, runway roll or a published SID.

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

Lower level-offs retain the relevant climb or descent/approach speed; they do not automatically climb through a clearance. Speeds use the simulator's existing altitude-aware IAS/TAS and Mach/TAS conversions and 5 kt/s acceleration model. The supplied cruise TAS and Mach are not always equivalent, so Mach drives automatic cruise while nominal TAS remains reference data. Manual IAS or Mach instructions take priority; **Clear** restores the automatic schedule without writing an assigned speed into the label.

RoC/RoD are phase defaults and capability limits for vertical-rate requests. Smaller assigned rates are honoured; requests above capability are limited to the current phase's rate. Rate changes retain the existing 1,500 ft/min per second response, and level capture prevents overshoot. Movement uses at most 0.5-second integration steps for profiled types, including heading-only flights, so accelerated time does not skip altitude bands. Spawn levels, level-picker presets, manual level entry and physical movement respect the aircraft ceiling.

Range and minimum clean speed (MCS) are retained as reference fields. There is no fuel/range or flap-configuration model; MCS is not applied as a blanket speed floor because the supplied initial-climb and approach speeds can be below it. Unknown ad hoc types retain generic movement, while the route spawner requires a profile for every configured type.

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

Browser checks require Playwright; `BROWSER_CHANNEL=chrome` selects installed Chrome. Tests cover all compiled variants, every supplied operator/type choice, directional pool differences, the real BIVKI entry, boundary geometry, parsing/expansion, selection order, weighted levels, moving FL010 departures, duplicate prevention, startup failures (including unavailable aircraft pools), real accepted labels, keyboard activation and button placement at 1440/1100/650/390 px.
