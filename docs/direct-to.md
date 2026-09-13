# Direct-to navigation

Click the existing **destination/waypoint text** on a track label to open direct-to. The point field is focused automatically. Type a waypoint or airport identifier from the loaded navigation data, then press Enter or choose **Fly direct**. Matching names appear below the field. Names are case-insensitive; unknown names are rejected, and duplicate names at different coordinates require selecting a location.

**End here · continue present heading** flies to the entered point, ends navigation there, and continues on the arrival heading. It does not stop or remove the aircraft and does not restore an earlier heading clearance. This option also suspends a track's existing flight plan.

For tracks with flight plans:

- With the point field empty, the dropdown lists the remaining route points in route order. Selecting one issues a shortcut, skips the earlier points, and continues through subsequent points after arrival. Repeated identifiers remain distinct route occurrences.
- To reroute through a different point, type that point, select **Return to FPL point**, and type/select the remaining FPL point to rejoin. The aircraft flies to the entered point first, then to the selected FPL point, then follows the rest of the plan.
- **Cancel route · hold heading**, or a new heading clearance, suspends navigation while preserving the flight plan and its progress. The DCT dropdown can issue a new shortcut to resume it.

The existing destination/waypoint field is the button; there is no additional DCT control. During navigation it shows the active waypoint. After navigation ends or is cancelled it returns to the track's destination/exit-point text. It remains visible without hovering, and hovering does not change label geometry.

## Dropdown typing

Heading, speed, vertical-rate, level and direct-to dropdowns focus their editable field and select its current contents when opened. Enter applies a typed value. Escape or an outside click cancels an unsubmitted edit; level fields no longer commit on blur. Existing descending level presets and selected-range scrolling remain in place.

Range, QL SC, FPL, MAP and CONFIG menus open with a focused filter. Typing narrows the options; Enter selects the first match (or toggles the matching map layer). FPL menu actions remain the existing placeholders. The toolbar now reserves space for wrapped rows so the radar does not cover its lower controls.

## Flight-plan integration

There is no new flight-plan editor or import workflow in this change. Demo tracks remain planless. A future plan loader should resolve its points to geographic coordinates and call:

```js
import { setFlightPlan } from './src/radar/routes.js';

setFlightPlan(track, [
  {name:'FIRST', lon:20.5, lat:52.0},
  {name:'SECOND', lon:21.0, lat:52.2},
], 0);
```

Coordinates above illustrate the data contract, not published fixes. `setFlightPlan` validates and copies the points, sets `flightPlan: {waypoints, nextIndex}`, and starts route following. The track constructor also accepts that flightPlan shape. `nextIndex` denotes the next route occurrence; a shortcut moves it to the selected occurrence immediately, and arrival increments it.

`assignDirectTo(track, point, {planIndex})` issues a shortcut to a remaining route occurrence. `assignDirectTo(track, point, {rejoinIndex})` inserts an off-route point before rejoining. With neither index, it ends navigation at the point. Invalid or obsolete selections do not alter the clearance. If the plan is replaced while a direct-to is active, its old return index is not applied to the replacement plan.

`navigationMode` is `heading`, `direct`, or `route`. `directTo` stores its target and optional plan/return indices. `assignHeading` clears active navigation. The catalog is built from the original WAYPOINTS and AIRPORTS GeoJSON coordinates and does not depend on layer visibility.

Navigation retains the simulator's 3°/s turn rate, uses geographic bearings, and checks each travelled segment against a 0.05 NM fix-capture circle. Navigation steps are at most 0.5 seconds even for longer updates. A point within the initial turn circle uses a brief straight extension before interception to avoid endless circling. Route legs sequence at capture; there is no fly-by turn anticipation. Existing speed/altitude behavior remains active. A null speed assignment now remains unassigned instead of being converted to a zero-speed instruction and clamped by label rendering.

## Validation

```sh
node --test tests/*.test.mjs
node tests/track-labels.browser.cjs
```

The browser suite requires Playwright; use `BROWSER_CHANNEL=chrome` for an installed Chrome. It tests immediate typing, cancellation, real catalog lookup, invalid names, plan shortcuts, off-route rejoining, end-here behavior, heading override, narrow popup layouts, all top-bar filters, and live application wiring. Temporary flight plans exist only in tests. Movement tests also cover overshoot, current-position targets, stale plan indices, route completion and close-point interception. Existing sector and label interaction tests remain enabled.
