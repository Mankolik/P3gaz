# Viewing aircraft routes

Click the destination/next-point field on an aircraft label to open the existing Direct to point editor. While it is open, the radar shows that aircraft's route ahead as a green line, with green waypoint dots and names. Applying a change, pressing Escape, clicking outside, switching to another editor or removing the aircraft closes this temporary preview along with the menu.

Hover over any part of an aircraft label and press **R** to toggle its route display without opening the editor. It stays visible after moving the pointer away. Hover the same label and press **R** again to hide it. Multiple aircraft can have their routes toggled on independently. The shortcut ignores held-key repeats, Ctrl/Alt/Command combinations and typing in input fields.

The two controls are independent. Closing the editor never hides a route toggled on with R. Turning an R toggle off while the same aircraft's editor is open leaves the temporary preview visible until that editor closes. A route enabled by both controls is drawn once.

The line starts at the aircraft's current position and uses the remaining resolved points, including expanded airway fixes. Passed points are omitted. Direct-to shortcuts, off-route directs with a rejoin, and directs that end at a point are reflected in the display. On an assigned heading, the remaining filed route is shown as a reference; it does not change the clearance. An aircraft without resolved route points has no route line to show.

Routes update with aircraft movement, route changes, map panning and zooming. Lines, dots and text retain their screen size, are visible independently of the general waypoint layer, and do not intercept clicks or map gestures.

## Validation

```sh
node --test tests/route-display.test.mjs
node tests/route-display.browser.cjs
node tests/track-labels.browser.cjs
```

Browser checks use Playwright; `BROWSER_CHANNEL=chrome` selects installed Chrome. The display suite exercises the actual radar renderer at device scale 2, the editor lifecycle, multiple toggles, keyboard guards, direct-to updates, pan/zoom projection and removal cleanup.
