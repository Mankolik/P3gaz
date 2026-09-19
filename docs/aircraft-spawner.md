# Aircraft spawner

Use **+ Aircraft** at the top right. Each click creates one **accepted** track. The button waits for the navigation data and route catalogue; a load failure leaves it disabled with an explanation. A short message identifies the flight and its spawn fix or ground state.

## Selection and levels

The source is `assets/sources/Airporty_revamped.txt`. Choose an eligible departure/destination pair uniformly, then an unused callsign from that pair, then a valid route variant. Pairs with more variants do not get more traffic. Active callsigns and track IDs are unique. All callsigns exhausted produces a message and no new track.

Airborne flights start at 450 kt with AFL = CFL = the sampled level. The initial bearing to the next resolved point determines direction: 000 through just below 180 degrees is eastbound; 180 through just below 360 is westbound.

- East: 290, 310, 330, 350, 370, 390, 410, 450.
- West: 280, 300, 320, 340, 360, 380, 400, 430.

These are the supplied pools with the subsequent FL430/FL450 correction. FL350 east / FL340 west has weight 2, the adjacent levels have weight 1.5, and the remaining levels have weight 1. Source route levels and inline annotations remain in `track.sourceRoute`; they do not override this initial selection. Aircraft type comes from the variant. Rows without a type use an explicit temporary B738 default, recorded in metadata. Performance-specific levels and speeds are not modelled.

## Entry and route following

The spawner expands the route before selecting a position. It tests intersections with the EPWW FIR polygon, including legs whose endpoints are both outside, handles holes and multipolygon parts, and finds the first entry. It then selects the second route fix strictly before entry and starts navigation at the following point. Fewer than two usable preceding fixes means the variant is unavailable.

The KJFK–EPWA source example starts at **BIVKI**, followed by **SONAL**, **BINKA** and the rest of the expanded route. P150's intermediate fixes are present. Tracks use the existing flight-plan navigation and turn/capture logic.

EPWW airway sections use the bundled PANSA dataset, in the order needed by the route. This is geometric expansion; it does not validate level restrictions, CDR availability or direction arrows. Entirely foreign airway sections become DCT between their named endpoints. A section with one foreign endpoint can extend through the single unambiguous published boundary endpoint. Ambiguous continuations are rejected. No U-prefixed aliases or internal airway connections are invented. The strict general-purpose airway resolver keeps its existing behaviour, including rejection of the Q800 foreign gap; the traffic compiler may bridge that gap only when it is wholly foreign.

The FIR outline and airway coordinates come from separate datasets. For foreign-leg classification only, an edge tolerance of 0.5 NM accommodates boundary fixes slightly displaced from the FIR outline. The spawn point itself must be outside the actual polygon and outside this tolerance. A leg crossing the FIR interior cannot be discarded as foreign.

Five-letter points, navaid identifiers, coordinate fixes (`63N010W` / `5230N02030E`), adjacent fixes, DCT, level-only and combined speed/level suffixes are supported. Generic SID/STAR markers connect the airport to the first/last en-route fix directly; actual procedures are not generated.

## Ground departures

Airports inside EPWW and the explicit exceptions EYVI, LKPR and EDDB start stationary at their airport reference point. The current airport dataset has no elevations, so the simulator uses AFL/CFL 000 as its ground baseline. The selected level is retained as the future cruise target. **Set both a positive speed and a CFL above the ground level to depart.** This releases the track into the existing acceleration, climb and route-following model. Setting only one clearance leaves it grounded. This is a generic departure, without taxi, runway roll or a published SID.

## Route coverage and diagnostics

The supplied catalogue contains 184 airport pairs and 251 variants. With the user corrections dated 2026-09-19, **180 pairs / 247 variants** are usable (36 variants restored). The four excluded variants remain in the source: EGSS-EPLL needs a resolved MAG Z20 SUBIX section; EGSS-EPBY needs PAM to retain two points before entry; LKPR-EETN and LKPR-EYVI need OKL immediately after their ground departure. LKPR-EETN also lacks foreign ADBIB/SULUN. Missing or ambiguous fixes, unresolved local airway connections and insufficient pre-entry fixes are reported with source line numbers.

`assets/geojson/route-point-corrections.geojson` records the 14 user-supplied coordinates with their original DMS values. It is required navigation data loaded by the manifest. Its explicit `navigationOverrides` flag makes those names take precedence in the navigation index regardless of dataset order, including the selected ELVOT coordinate. Other duplicate names remain ambiguous; conflicting overrides also remain ambiguous. Original imported GeoJSONs and published airway coordinates are unchanged. SUXTU uses 53 03 36 N / 017 16 52 E; the alternative compact coordinate supplied by the user differs slightly.

The route source includes the requested SONUD-SUBIX replacement with DCT IDOBA DCT in both directions, and removes BUG from KEROP DCT BUG DCT LITKU without duplicating KEROP. N858 becomes DCT only in the four specified EDDF-EETN/EVRA/EYVI and LFPG-EYVI rows. Other N858 uses and the airway interpreter are unchanged. Route line numbers, callsigns, aircraft types and level annotations are preserved.

Unresolved distant foreign prefixes/suffixes may be omitted if a continuous resolved block covers the EPWW flight and its spawn lead-in. The compiler never bridges an unresolved fix within that block. Ground-start routes must retain their departure airport; EPWW arrivals must retain their destination. A missing foreign tail cannot truncate the simulated route while still inside EPWW. Each omission is recorded in diagnostics and track metadata. After the last available foreign fix, existing navigation holds the arrival heading; full foreign arrival procedures are outside this change.

Inspect `state.air.spawner.catalogue.diagnostics` during development or regenerate the report:

```sh
node scripts/audit-route-catalogue.mjs
```

This report is derived from the actual bundled data, not a maintained exclusion list. Restoring missing fixes automatically restores eligible variants at the next load. No traffic frequency, performance model or automatic spawning timer is added.

## Validation

```sh
node --test tests/airways.test.mjs tests/routes.test.mjs tests/sectors.test.mjs tests/spawner.test.mjs
node tests/spawner.browser.cjs
node tests/track-labels.browser.cjs
```

Browser checks require Playwright; `BROWSER_CHANNEL=chrome` selects installed Chrome. Tests cover all compiled variants, the real BIVKI entry, boundary geometry, parsing/expansion, selection order, weighted levels, ground holds and release, duplicate prevention, startup failures, real accepted labels, keyboard activation and button placement at 1440/1100/650/390 px.
