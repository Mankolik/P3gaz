# Bandwidth optimisation measurements

Measured locally on 2026-09-24. Baseline: `97be5cf45e80b2fe71e1b020a64876a77f833304` (multiplayer protocol 1). The baseline already used WebSocket compression and top-level delta updates; these results are additional savings, not a comparison against full-state streaming.

## Reproducible two-player test

The current default is **2 Hz**, restored after the measurements below at the user's request. The recorded optimised run used **3 Hz**; it has not been rerun at 2 Hz. Simple proportional scaling suggests about 16 MB/hour at 2 Hz, but that is only an estimate because some traffic does not scale with snapshot frequency. To reproduce the recorded optimised configuration, set `SNAPSHOT_HZ=3` when running the benchmark.

Same benchmark script, seed `20260924`, 100 aircraft, two real WebSocket clients, one-second warm-up and 30-second measurement window. Both clients consumed the final pause before the counters were read. The baseline script was run from a detached checkout of the baseline commit, with the same `ws` dependency. No static HTTP downloads are included in this test.

| Measurement | Baseline | Optimised |
| --- | ---: | ---: |
| Protocol | 1 | 2 |
| Nominal movement updates/second | 2 | 3 |
| State messages per player during window | 59 | 89 |
| Combined received wire bytes | 753,529 | 199,059 |
| Combined decoded JSON bytes | 3,870,725 | 755,175 |
| Combined wire KiB/second | 24.52 | 6.48 |
| Projected combined MB/hour (decimal) | 90.39 | 23.88 |

**73.6% less measured multiplayer traffic**, approximately 3.79× smaller, despite increasing the update rate. The hourly values are projections from short local tests, not measured hour-long sessions or Render bills. These TCP receive counters include WebSocket frames and negotiated compression, but exclude TLS, IP/TCP packet headers, initial loading, joins and normal player command activity beyond the final pause. Route mix, active manoeuvres, simulation speed, connection count and deployment conditions affect actual usage. Timing is wall-clock based; identical seeds do not imply identical packet boundaries.

The historical “0.5 GB for a short two-player session” figure could not be verified from a measurement log and is not used as the baseline.

## Static files

An actual HTTP request for `assets/geojson/WptsAbroad.geojson` measured:

- Identity response body: **1,420,357 bytes**.
- Gzip response body: **167,066 bytes** (88.2% smaller); decompression exactly matches the original.
- Conditional request with its ETag: **304, zero body bytes**. Response headers still consume a small amount of bandwidth.

Other compressible static responses use the same bounded cache and conditional-response mechanism. Later, serving these files directly from Cloudflare will remove their downloads from Render altogether. No Cloudflare deployment is included in this change.

## Validation

These results describe the original optimisation at 3 Hz, before the subsequent default-only change to 2 Hz.

- `npm test`: **174 passing tests**, including the existing simulation/coordination suite and ten real WebSocket clients sharing 100 aircraft.
- `npm run test:multiplayer`: passed with two isolated Chromium contexts.
- `SPLIT_HOSTING=1 npm run test:multiplayer`: passed with frontend/backend on different origins and backend static serving disabled.
- Protocol tests exercise changing speed/rate, climbing/descent through performance bands, turns, level-off, waypoint passage, exact DCT coordinates, object/array patches, explicit field deletion, late joins, missing sequence detection and full resynchronisation.
- Hosting tests cover gzip/identity/HEAD/304 behaviour, exact origin allowlists, rejection of old clients, private-path blocking and the public-only static build.

The server's movement, performance, trajectory and ownership algorithms are unchanged. Network copies use sub-metre position and sub-foot altitude precision; navigation coordinates and clearance inputs remain exact. Production deployment, Cloudflare provisioning and the future 2–3-second radar-sweep display filter remain separate steps.
