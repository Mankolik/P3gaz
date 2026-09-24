# Multiplayer

## Deploy to Render

After merging the multiplayer changes into `main`:

1. In Render, choose **New → Blueprint**, connect GitHub, and select `Mankolik/P3gaz` on `main`.
2. Render reads `render.yaml`. Review the single Node web service: Frankfurt, Starter, one instance. Check the price shown before creating it. No database or disk is needed.
3. Deploy, then open the service's HTTPS `onrender.com` address. That address serves both the simulator and its WebSocket connection.
4. Keep automatic deployments off (the blueprint sets `autoDeployTrigger: off`). Also turn off Blueprint **Auto Sync**, so changes to the deployment definition are reviewed manually.
5. Deploy future versions manually between sessions. A deployment or server restart ends active rooms.

Alternatively create a **Web Service** from the repository using:

| Setting | Value |
| --- | --- |
| Branch | `main` |
| Runtime | Node |
| Root directory | Leave empty |
| Build command | `npm ci --omit=dev --ignore-scripts` |
| Start command | `npm start` |
| Health check | `/health` |
| Instance | Starter, one instance |
| Region | Frankfurt |
| Auto deploy | Off |
| Environment | `NODE_ENV=production` |

`package.json` selects Node 24. Render supplies `PORT`; there are no application secrets to configure. Use one instance because rooms are held in memory. The static GitHub Pages address cannot host multiplayer rooms.

Official deployment references: [Blueprint specification](https://render.com/docs/blueprint-spec), [Blueprint management](https://render.com/docs/infrastructure-as-code), [Node versions](https://render.com/docs/node-version), and [web services](https://render.com/docs/web-services).

## Start a session

Open **Multiplayer**, enter unique initials (1–4 letters or digits), and create a room. Copy the invitation link for other players. They enter initials and join; no accounts are required. Treat the invitation as access to the room.

Everyone, including the host, initially observes. Choose a free sector from **Your sector**. Leaving a sector releases it to computer control. The host can use **Sectorisation** to split or merge sectors and explicitly assign each player to a resulting sector or to Observer. Two players cannot occupy the same sector.

The host alone spawns or deletes aircraft, pauses the simulation, changes its speed, and changes sector configuration. The room closes when the host leaves or loses connection. Silent connection loss is detected by heartbeat, normally within about 30 seconds. A departing guest releases their sector; rejoining starts as a new observer. There is no saved session or reconnection resume yet.

Limits are ten players and 200 aircraft per room, with at most eight rooms per server. These are protective limits, not a capacity guarantee for the smallest hosting plan. Local validation exercised ten clients and 100 aircraft in one room; performance on the selected Render instance still needs measurement.

## Sector views and coordination

The server advances one shared simulation. Each browser derives label status, colours, background footprint and its own levels from its selected sector. Observers see unconcerned tracks and cannot issue instructions.

An accepted aircraft shows CFL and the viewing sector's XFL. An inbound shows PEL in the CFL position; that PEL is the preceding sector's XFL. Changing your own XFL updates the next sector's PEL. Automatic transfers use the existing approximate 10 NM threshold and ignore visits of 3 NM or less.

Instructions to aircraft controlled by another sector become proposals. The sender sees red; a human recipient sees light blue. Click the coloured value to accept or reject it. The sender can replace or withdraw it. Proposed DCT also draws a cyan preview line for the recipient. Navigation does not change until acceptance.

Human proposals have no timeout. Computer-controlled airspaces accept after three simulation seconds. Changing ownership, disconnecting, reconfiguring sectors, or otherwise making a proposal stale cancels it rather than applying it to a different controller.

Accepting a PEL proposal changes the preceding sector's XFL. It does not change a human controller's CFL. Computer-controlled airspace also adjusts the aircraft's CFL to carry out its accepted exit level. Accepting a DCT, heading, speed or rate proposal issues that clearance. Departures in computer-controlled ACC sectors climb toward ECL unless constrained by coordinated exit levels.

## Architecture

`server/room.js` owns room membership, permissions, clearances and proposals. `src/multiplayer/shared-traffic.js` owns shared movement and transfers. `src/multiplayer/view.js` projects a canonical aircraft into a player's view. The existing solo simulator remains available when disconnected.

The server loads bundled navigation and the route catalogue once. Route distances remain cached on catalogue groups. It advances rooms at 10 Hz and sends compressed changes at **3 Hz**, with immediate updates after commands. The network timer is separate from the simulation timer; speed, vertical rate, turning, waypoint passage and ownership still use the authoritative simulation. Label placement, route visibility, mouse input and drawing stay local. The future 2–3-second radar-sweep display option is not implemented here.

Protocol 2 sends a complete snapshot on join or resynchronisation, then compact integer movement deltas, nested patches and removals. Room configuration/player lists/proposals are sent only when they change. Unchanged paused rooms send no state frames (WebSocket heartbeat remains). Sequence numbers detect a missing baseline; the browser requests a fresh snapshot instead of applying incorrect deltas. Old protocol-1 clients receive a refresh instruction.

Only network copies of movement/prediction numbers are rounded: coordinates to 0.000001 degrees (about 0.11 m resolution in latitude), heading to 0.01°, ground speed to 0.01 kt, actual altitude to 0.001 FL (0.1 ft), and vertical speed to 0.1 ft/min. Full-precision server simulation, clearance values, flight-plan coordinates and DCT validation are preserved. Clients receive the sector crossings and levels required by labels/route drawing; server-only trajectory integration samples and prediction clocks are not transmitted.

Static responses are gzip-compressed when supported and worth compressing, with representation-specific ETags and conditional `304` responses. The cache is bounded to 16 MiB per server. Unhashed files revalidate on reuse so deployments do not mix cached protocol versions. These changes save traffic while the entire application still runs on Render.

## Preparing the Cloudflare / Render split

The default remains one Render service serving both files and multiplayer. No Cloudflare account, deployment or DNS changes are made by this code change. Both eventual services can use the same repository; they select different build/start settings.

1. Create a Cloudflare Pages project from this repository. Use `npm run build:static` as the build command and `dist` as the output directory, with Node 24. Set the build environment variable `MULTIPLAYER_URL=wss://YOUR-SERVICE.onrender.com/multiplayer`.
2. On Render set `ALLOWED_ORIGINS=https://YOUR-PROJECT.pages.dev` (add a custom domain as a comma-separated exact origin if needed). No trailing slashes, wildcards or paths. The WebSocket server still accepts same-origin clients. Preview domains must be explicitly allowed if they need multiplayer access.
3. Deploy the same protocol version to both sides between sessions, open the Pages URL and verify create/join, invitations and instructions. Invitation links stay on the frontend's domain; everyone connects to the configured Render backend.
4. Once the frontend works, set `SERVE_STATIC=false` on Render. `/health` and `/multiplayer` remain available; static paths return 404. Keep the navigation assets and shared source code in the Render checkout: its simulation still needs them locally.

`runtime-config.js` carries only the public WebSocket endpoint. It is generated during the static build, with no application-source edits required. `dist/` contains only HTML/CSS, browser source, assets and Pages headers; it excludes server files, tests and package/configuration files. Leave `MULTIPLAYER_URL` empty for same-origin operation. `SNAPSHOT_HZ` defaults to `3` and accepts values from `1` to `20`; changing it does not change the simulation rate.

Keep Render automatic deployments off as described above. The split does not require changing that policy. After a deployment, clients must reload to receive protocol 2. Restarting the backend still ends rooms; this change does not introduce session persistence. Roll back both frontend and backend together if reverting the protocol.

## Measuring bandwidth

```sh
npm run benchmark:bandwidth -- --seconds=30 --players=2 --aircraft=100 --seed=20260924
```

This starts a local server and real compressed WebSocket clients, spawns reproducible traffic, warms up for one second, and measures steady traffic until every client receives the final pause. It prints received TCP bytes, decoded JSON bytes, state counts and a projected hourly total across **all players**. TCP counts include WebSocket framing/compression, but exclude HTTP/static downloads, TLS and IP/TCP packet headers. The hourly number is an extrapolation from the test, not a Render billing measurement. Compare the same duration, player count, aircraft count and seed on both revisions. Route mix, clearances, simulation speed and hosting load affect the result.

See [bandwidth optimisation measurements](bandwidth-optimisation.md) for the recorded before/after run.

## Tests

```sh
npm ci
npm test
```

The tests include room permissions, sector-specific levels, human/computer coordination, replacement and withdrawal, reconfiguration, host departure, room isolation, and ten real WebSocket clients sharing 100 aircraft. The load test prints timing and outbound-traffic measurements for the machine running it.

Browser tests require Playwright to be available and a Chromium browser installed. `BROWSER_CHANNEL=chrome` selects an installed Chrome. Run:

```sh
node tests/trajectory.browser.cjs
node tests/track-labels.browser.cjs
node tests/spawner.browser.cjs
node tests/route-display.browser.cjs
node tests/sectorisation.browser.cjs
npm run test:multiplayer
# Exercise the same two-browser workflow with separate frontend/backend origins:
SPLIT_HOSTING=1 npm run test:multiplayer
```

The multiplayer browser test starts a real local server and two isolated browser contexts. It verifies host assignment, differing PEL/CFL/XFL, red and light-blue proposals, acceptance without changing a human CFL, DCT preview and clearance, withdrawal, observer release, moving/climbing tracks and host departure. `SPLIT_HOSTING=1` serves the frontend on a separate origin and disables backend static serving. `BROWSER_EXECUTABLE_PATH` can select a locally installed Chromium binary.
