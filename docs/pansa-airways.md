# PANSA airways for P3gaz

P3gaz expands airway route text into resolved waypoint sequences using the PANSA ENR 3.2.1 snapshot effective 3 September 2026.

At startup, `src/main.js` loads `assets/navigation/pansa-airways.json` through `loadAirways` and stores the resolver in `state.air.airwayResolver`. It passes that resolver into track construction. A load failure is reported to the console; the map and existing demo tracks remain available, while route-text construction requires a loaded resolver.

## Create a track with a route

```js
import { createTrack } from './src/radar/tracks.js';

const track = createTrack({
  callsign: 'TEST123',
  lat: 53.178055556,
  lon: 23.894166667,
  heading: 271,
  groundSpeed: 450,
  flightPlan: 'GORAT L23 BINKA'
}, state.map.project, state.air.tracks.length, state.air.airwayResolver);
state.air.tracks.push(track);
```

A flight plan may also be `{route: 'GORAT L23 BINKA', nextIndex: 2}` to resume at a specific expanded waypoint. Existing `{waypoints: [{name, lon, lat}], nextIndex}` flight plans still work without a resolver. The FPL menu remains a placeholder; this change supplies route parsing to the navigation and track APIs without adding a route-entry UI.

## Assign an airway route

From a module in `src/radar/`, import and call:

```js
import { setRouteFlightPlan } from './airways.js';

setRouteFlightPlan(track, 'GORAT L23 BINKA', state.air.airwayResolver);
```

This passes the following resolved points, including coordinates, to the existing `setFlightPlan` implementation:

```text
GORAT OTPES GONTU GRUDA UNDUK ASGUL TOMKO BINKA
```

For a preview without changing the aircraft:

```js
const points = state.air.airwayResolver.resolveRoute(
  'BODLA DCT GORAT L23 GRUDA L29 VABER'
);
// BODLA GORAT OTPES GONTU GRUDA IXIXI OLKIN ARDUT SUWGI VABER
// Each item: { name, lon, lat }
```

Catch resolver errors at the route-input boundary and show their message. Assignment resolves the whole route before changing the aircraft, so a failed route leaves its previous flight plan unchanged. The helper starts at waypoint index 0; the caller must choose an appropriate start point for an aircraft already airborne.

## Supported syntax and behaviour

- `ENTRY AIRWAY EXIT`, including partial airway sections, reversed sequences and consecutive airways with an explicit shared fix.
- Mixed DCT legs and consecutive waypoint identifiers; waypoint-only routes remain valid.
- Case-insensitive identifiers and arbitrary whitespace.
- A leading ICAO speed/level group, such as `N0450F350`, and fix suffixes such as `GORAT/N0450F350`. These annotations are parsed only to locate fixes; speed/level clearances are not applied.
- All airway points have coordinates from the source. Other DCT points and airports use P3gaz's supplied navigation index. Ambiguous names produce an error.
- Unknown airways/fixes, missing exits and endpoints outside an airway produce errors. U-prefixed aliases are not invented.
- No implicit airway-to-airway intersection selection, SID/STAR expansion, coordinate-token parsing or foreign airway extensions.

By default, expansion reconstructs the geometric sequence in either direction. To reject travel against the source's cruising-direction arrows:

```js
const points = state.air.airwayResolver.resolveRoute(
  'BODLA L132 DEMUR', { respectDirection: true }
);
```

This option checks only published direction arrows. The data does not model altitude limits, CDR availability or other operational restrictions.

## Data structure

```js
data.points.GORAT
// { lat, lon, latitudeDms, longitudeDms, kind }

data.airways.L23.waypoints
// ['GORAT', 'OTPES', 'GONTU', 'GRUDA', 'UNDUK', 'ASGUL', 'TOMKO', 'BINKA']

data.airways.L23.legs[0]
// { from: 'GORAT', to: 'OTPES', status: 'published',
//   distanceNm: 128.6, directions: ['forward', 'reverse'] }
```

`forward` follows the PDF's top-to-bottom sequence; `reverse` follows it backwards. `waypoints` records publication order, while `legs` is authoritative for connectivity. Each airway also retains its source filename and printed page dates. Coordinates are WGS84 decimal degrees, accompanied by the original DMS strings.

**Q800 has two covered portions:** `BILRA–POKEN` and `LARMA–IVGOR`. PANSA explicitly refers the intervening `POKEN–LARMA` portion to AIP Sweden. Its leg is marked `external-gap` and has no invented distance or direction. The resolver rejects any Q800 expansion crossing it, in either direction. Do not turn the complete Q800 waypoint list into one continuous polyline without checking the leg statuses.

## Source and validation

Source: the supplied 137 original ENR 3.2.1 PDFs from [PANSA AIRAC AMDT 09-26, effective 3 September 2026](https://docs.pansa.pl/ais/eaipifr/AIRAC%20AMDT%2009-26_2026_09_03/index-v2.html). This is a versioned snapshot of the supplied edition. Individual pages retain their printed amendment dates, including earlier dates where unchanged. The ZIP SHA-256 is stored in the JSON source metadata.

- 137 airway designators, 194 source pages.
- 743 waypoint occurrences and 419 unique points.
- 605 published legs, plus the one explicitly uncovered Q800 connection.
- Names and coordinates split over 14 page boundaries were rejoined.
- `ŁUKAWIEC DVOR/DME 'RSW'` is represented by the usable identifier `RSW`.
- An independent PDF text extractor matched all 743 waypoint occurrences and coordinate pairs.
- Every published distance was compared with its coordinate-derived great-circle distance; the largest difference was 0.475 NM (rounded up).
- All 418 fixes already present in P3gaz matched its coordinates; RSW is supplied by this dataset.
- Alternate routes appearing in remarks were excluded from the airway sequence.

Run from the repository root with a recent Node.js:

```sh
node --test tests/airways.test.mjs tests/routes.test.mjs tests/sectors.test.mjs
```

All 39 unit and integration tests passed. The added suite checks every published leg in both directions, all uninterrupted full airway sequences, page-boundary cases, DCT mixtures, the Q800 gap, direction checks, invalid input atomic flight-plan assignment, startup asset loading and route-text track construction.
