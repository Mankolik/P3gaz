# EPWA and EPKK/EPKT boundary rebuild

The source is the project owner's DMS coordinates and vertical limits supplied on 13 September 2026. No AIRAC effective date was supplied. `assets/sources/tma-epwa-epkk.json` retains those coordinates and limits so future edits are reproducible.

## EPWA

All seven sectors A–G are present. Their vertical limits already matched the supplied values and have been retained.

Two boundary points changed in both A and B:

| Previous coordinate | Supplied replacement |
| --- | --- |
| A: 522001N 0212336E; B: 522001N 0212337E | 522008N 0212532E |
| A and B: 520700N 0213241E | 520704N 0213343E |

C–G have no coordinate changes at the supplied one-arcsecond precision. All rings were regenerated from DMS and normalized to counterclockwise exterior winding. The additional intermediate point in A is retained exactly as supplied; no shared edges were silently snapped or simplified.

## Krakow and Katowice

The former six features are replaced by eight:

| Sector | Floor | Ceiling |
| --- | --- | --- |
| LTMA EPKK | 2300 ft AMSL | 3500 ft AMSL |
| LTMA B | 3500 ft AMSL | FL95 |
| LTMA C | 5500 ft AMSL | FL95 |
| LTMA D | 6500 ft AMSL | FL95 |
| LTMA EPKT | 2300 ft AMSL | 3500 ft AMSL |
| UTMA A | FL95 | FL245 |
| UTMA B | FL245 | FL285 |
| UTMA C | FL145 | FL285 |

- LTMA B gains 504110N 0185955E.
- LTMA D gains six western boundary points: 494754N 0192337E, 495041N 0191535E, 495108N 0191129E, 495054N 0190854E, 494923N 0190457E, and 495220N 0190056E.
- LTMA C retains its supplied outline, which matches the previous points.
- LTMA EPKK and EPKT arcs are regenerated from their specified centers, radii and endpoints. The former geometry traced almost complete circles with incorrectly ordered joins.
- The combined FL95–285 UTMA is replaced by A, B and C with their distinct footprints and bands. UTMA A's wider northern extent no longer incorrectly applies at FL245–285. The eastern UTMA C extension starts at FL145.

### Arc interpretation

The supplied prose does not state a direction. Both arcs are traced clockwise in geodesic bearing, along the eastern side of each volume: approximately 79.108 degrees for EPKK and 188.927 degrees for EPKT. In particular, EPKT uses the eastern arc, not the shorter western arc. This interpretation follows the surrounding perimeter and includes the terminal area centers.

Intermediate points use WGS84 geodesics at the supplied radii of 27 km and 19.5 km, with chords no longer than 500 m (less than 2 m chord sagitta). Supplied endpoints remain exact even where their geodesic distance differs from the nominal radius: approximately 24/11 m for EPKK and 2/5 m for EPKT. Centers are construction metadata, not polygon vertices.

### FIR boundary approximation

UTMA A and B follow the southern EPWW FIR boundary from the existing `flightmap_europe_fir_uir.json`, using 51 intervening stored vertices. The supplied join coordinates are retained exactly, connected to their nearest points on the stored boundary. Those connectors measure approximately 539 m at the eastern endpoint and 405 m at the western endpoint. This is a documented approximation caused by the existing sampled FIR geometry, not a newly verified detailed FIR border. Both sectors reuse precisely the same closure.

## Sector lookup and validation

The sector index recognizes explicit `vertical: "UTMA"` on named A/B/C volumes and uses their display names in the last-hovered track window. Matching LTMA volumes take precedence over UTMA, which takes precedence over ACC. Existing floor-inclusive, ceiling-exclusive behavior and the standard-pressure approximation for feet AMSL remain in effect.

Generate with Python after installing `pyproj==3.7.2` and `shapely==2.1.2`:

```sh
python scripts/rebuild-tmas.py
python scripts/rebuild-tmas.py --check
node --test tests/sectors.test.mjs
node tests/track-labels.browser.cjs
```

The generator checks polygon validity, closure and area, and `--check` verifies the checked-in GeoJSON exactly matches regeneration. Sector tests cover the FL95/145/245/285 transitions, differing upper footprints, both lower arcs, and UTMA priority. The browser suite checks the live floating window through the Krakow vertical stack and retains existing EPWA and label interaction checks.
