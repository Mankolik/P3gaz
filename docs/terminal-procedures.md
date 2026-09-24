# SID / STAR procedures and traffic lifetime

The supplied `SID_STAR_extraction.zip` contains 162 procedures. The game imports
155 fixed choices across 15 Polish airports, covering all 205 explicitly filed
domestic SID/STAR connectors in the current 251 route variants. The same route
compiler and movement/guidance code run offline and on the multiplayer server.

## Route selection

Only an explicit SID or STAR marker expands a procedure, and only when its
airport and connecting fix match. DCT legs stay DCT. Foreign airports stay on
the existing foreign-route rules; EDDB, LKPR and EYVI still start airborne at
their airport, now at FL030. EPZG has STAR data only. Unmatched future markers
retain the original direct connection; no procedure is invented.

One variant is selected per airport/type/connecting fix. Where the supplied
data has alternatives, the choices are VADOL 1J at EPLB, DOSIX 1Y / GOGUS 1Y /
NUBLI 1Y / SORIX 3Y at EPMO, and LUXAR 3D at EPRZ. Remaining connections have a
single supplied variant. Supplied runway configurations are retained, including
EPWA departures on 29 and arrivals on 33; there is no new runway-selection UI.

Terminal fixes are inserted in published order, with the common en-route fix
appearing once. Each route point carries its own procedure name, runway and
restrictions. They appear in route drawing, sector prediction and Direct-to;
hover a Direct-to option to see its procedure and restrictions. Terminal fixes
also supplement the navigation search without overriding existing corrections.
The simulator uses its existing point-to-point turn/capture model. Course,
climb-gradient notes and full ARINC leg geometry are not separately flown.
EPSC's unnamed climb-to-600-ft legs are already satisfied at the FL030 start.

## Restrictions and clearances

The importer preserves lower bounds, upper bounds, exact values and windows.
A lone dash/blank is unrestricted. Speeds are IAS knots. FL values are converted
to feet for calculation while the original notation remains in tooltips. The
existing standard-pressure approximation still applies to altitude in feet.

The next and later route restrictions inform automatic speed/vertical planning.
The aircraft decelerates in advance of a speed limit. Climbing aircraft can slow
to meet a later minimum altitude after an earlier ceiling. Descent planning can
increase automatic rate for tight crossing constraints, up to 6,000 ft/min;
automatic climb retains the existing 110% performance allowance. Actual speed
and rate still change gradually, and the existing IAS safety floor remains.

A human CFL overrides procedure altitude guidance; an assigned speed or rate
retains its usual priority. Clearing the assignment restores automatic guidance.
Rejected CFLs do not cancel the preceding accepted instruction. An impossible
late shortcut/clearance does not teleport an aircraft or remove performance
limits. Crossing compliance depends on the remaining distance and clearances.

A Direct-to shortcut retains restrictions at the chosen fix and every subsequent
fix. Bypassed points no longer constrain the aircraft. Off-route Direct-to with
a rejoin applies the rejoined suffix, and heading navigation suspends waypoint
constraints until route navigation resumes.

## Arrivals

The destination's computer approach unit starts managed arrival at ownership
transfer, including the usual early transfer before a physical boundary. An
unrelated TMA does not trigger it. Domestic departures must first leave their
origin terminal area for ACC, so spawning at FL030 cannot count as landing.

At transfer, approach issues CFL030 and cancels the old manual speed/rate and
altitude override. The aircraft follows a nominal 300-ft/NM progressive descent
toward the airport, with advance planning for published altitude limits. It
holds above outstanding minima and can finish descending after the last STAR
fix. Once approach has taken over, descent continues through lower FIS volumes;
a human taking ownership suspends the automatic arrival management.

Automatic approach speed caps are 250 kt outside 30 NM, 220 kt from 30 to 15 NM,
and 180 kt inside 15 NM, subject to the aircraft's existing minimum-speed floor
and any stricter published limit. A speed proposal accepted after transfer is
honoured until the final 15 NM, when approach cancels Mach or IAS above 220 kt.
Cancelling an excessive arrival speed may produce a small message in the ELW.

An approach-managed arrival is removed upon reaching FL030 (within the existing
5-ft capture tolerance). Airports without a STAR still receive the direct-route
progressive arrival behavior once their destination approach takes ownership.

## Departures and outbound removal

All airport departures start at FL030 / IAS180 instead of FL010. They retain
their existing type, ECL, climb coordination and gradual acceleration behavior.

An aircraft is removed once it has been inside EPWW, is outside again, and its
nearest lateral EPWW boundary is at least 60 NM away. This is distance from the
boundary, not accumulated distance flown outside. Incoming aircraft are not
removed before their first entry; re-entry prevents outbound deletion while
inside. The boundary check runs at most once per simulated second. Multiplayer
uses the existing removal deltas and cancels obsolete aircraft proposals.

## Data regeneration and verification

```sh
python3 scripts/import-terminal-procedures.py /path/to/SID_STAR_extraction.zip
npm test
npm run build:static
```

The generated module retains source filenames, dates, original restriction
labels and procedure notes. Its current size is 185,731 bytes / 13,698 bytes
gzip; it is served with the other static assets, with no new fetch per tick.
Route metadata is transmitted on creation and changes via the existing protocol.

Validation: 187 automated tests passed, including every catalogue variant under
five sectorisations, all 155 selected procedures with 898 B738 restriction-fix
crossings, exact/window constraints, shortcuts, manual overrides, progressive
arrival, a real EPWA arrival from handoff through removal in both simulation
modes, boundary removal and snapshot deletion/reconnect behavior. The existing
WebSocket integration test passed with ten clients and 100 aircraft. The static
build passed. Cloud Browser blocked the local preview URL, so this change has
not received a fresh browser UI check or a production deployment check.
