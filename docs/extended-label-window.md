# Extended Label Window

The floating ELW replaces the sector-sequence inspector. It remembers the last hovered aircraft, refreshes on simulation ticks, and keeps header dragging, keyboard arrow movement and viewport bounds. It is 360 px wide (36% narrower than the original 560 px window). Ten rows follow the supplied `ELW.txt` specification and subsequent compact-layout instructions; rows stay distinct and long rows scroll horizontally in narrow windows.

1. Green callsign, green joined `WY` (RVSM/8.33 kHz), green radio callsign with its flight suffix joined (`LOT123`), white `S/` immediately followed by the four-digit squawk.
2. Joined ICAO aircraft type/wake category (`A320/M`), reserved blank status.
3. Blank.
4. Departure and destination aerodromes, green `XXX,XXX` next frequency.
5. Yellow `I`, followed by up to five next points from the same route used for drawing and prediction.
6. White `CFLxxx` and `ECLxxx`.
7. Blank, reserved for future free text in a 20-character space. There is no editor yet.
8. `SECTOR/XFL` sequence. Green marks the owning sector, white the next non-skipped visit, gray later visits. Yellow is reserved for explicitly marked skipped visits; visits of 3 NM or less are omitted completely. Repeated meaningful visits remain ordered. The local XFL stays `---` when unset; remote sectors use their coordinated exit level or predicted target when no explicit level is stored. Foreign sectors after leaving EPWW show just their designator (`ESA`); the foreign inbound sector still shows its XFL. EPWW TMAs/FIS retain their levels, including on a return visit.
9. `SEL ALTFLxxx` (actual accepted CFL), `HDGxxx°`, `TRKxxx°` (same as current heading for now).
10. `IASxxx`, `MN0.xx`, `GSxxx`, without knot suffixes. Mode S designators use a smaller 10 px font beside regular 13 px values. The three value columns align between rows 9 and 10; designators align right without a gap before their values.

All other characters are white. W/Y/I and Mode S are the requested simulator defaults, not inferred real-world equipment declarations. Missing values show dashes, including `S/----` when no squawk is stored; the window does not allocate transponder codes. Pending proposals do not replace accepted values here.

IAS and Mach are derived from current ground speed and actual altitude by reversing the simulator's ISA/wind model. They therefore follow gradual speed changes and remain separate from queued speed restrictions. Track heading remains the current heading, not its assigned target. This is a display calculation and does not change movement or performance.

Radio names use the catalogue operator prefix followed by the full flight suffix, preserving leading zeros and letters. The mapping is sourced from [FAA JO 7340.2P, section 3-3](https://www.faa.gov/air_traffic/publications/atpubs/cnt_html/chap3_section_3.html), checked 2026-09-22. The FAA list has no telephony entry for MSC or SXS; those and unknown operators retain the ICAO prefix rather than a guessed name. A track's explicit `radioCallsign` overrides the mapping.

Validation: `tests/extended-label.test.mjs` covers field formatting, route truncation/shortcuts, speed conversions, radio names and sector colours/levels. `tests/trajectory.browser.cjs` checks the ten rows, colours and live accepted values. Existing label/spawn browser suites retain selection, dragging, resizing, switching and empty-startup coverage.
