# ATC Sim — Project Template

This is a **no-bundler**, browser-only ES modules scaffold for your radar/ATC sim.
- Clean canvas (no rings/crosshair)
- Topbar with Range, FALT (000–990 with ON/OFF text toggles), QL/Filter OFF, Sector info, FPL/MAP/CONFIG stubs, UTC clock, and bottom MENU toggle
- Extensible architecture: `src/core`, `src/render`, `src/map`, `src/radar`, `src/ui`, `src/plugins`, `src/utils`
- Drop GeoJSONs in `assets/geojson/` and wire via a manifest later

## Run
Open `index.html` in a modern browser.

## Next
- Wire MAP toggles to `state.map.layers.get(name).visible`
- Implement GeoJSON loader and `fitAll()` call after import
- Add traffic model and apply FALT/QL/Filter OFF
