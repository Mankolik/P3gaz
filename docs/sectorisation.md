# Live ACC sectorisation

Open **Sector → Sectorisation** in the top bar. Every session starts with **ALLFIR**, containing all ten Low and ten High elementary volumes. Select cells in the Low/High table, choose a destination and **Move selected**, or choose **New sector from selected**. **Make standalone** releases each selected volume into its own sector. Named groups provide selection shortcuts; they do not change the live configuration by themselves.

Choose one group under **Your controlled sector**, then **Apply configuration**. All other ACC groups are computer controlled. Changes are applied together while the simulation runs. Cancel or Escape discards the draft. If moving all members out of your controlled group removes it, choose a replacement before applying. **Reset to ALLFIR** prepares the default configuration; Apply is still required. Configuration is session-local and refresh restores ALLFIR.

Every elementary volume always belongs to exactly one group. Group IDs survive name changes. Ordinary names use member codes and layers: `TC L+H`, `FGNE L`, `FGNE L FGN H`, or `TC L TCJ H`. Code order is F, G, N, E, B, D, T, C, J, R. Exact set matches use these special names:

| Name | Low members | High members |
| --- | --- | --- |
| ALLFIR | All ten | All ten |
| ALLFIR L | All ten | — |
| ALLFIR H | — | All ten |
| NFIR | FGNEBD | FGNEBD |
| NFIR L | FGNEBD | — |
| NFIR H | — | FGNBD |
| SFIR | TCJR | TCJR |
| SFIR L | TCJR | — |
| SFIR H | — | TCJRE |

The different placement of E High in combined versus layer-specific NFIR/SFIR names is intentional. These are naming shortcuts for exact member sets, not extra geometry or constraints.

Applying a configuration rebuilds logical airspace assignments and every aircraft's trajectory immediately. Aircraft physically inside your resulting sector are accepted; aircraft outside transfer to the appropriate computer sector. An aircraft that stays under your control keeps its CFL and XFL, including when you select a newly created group. Other per-sector XFLs follow surviving groups through renames and full merges; the receiving group's assignment takes priority in a merge. Selecting another controlled sector displays that group's stored XFL, or an empty XFL if none was assigned. Pending proposals are cancelled on reconfiguration because their addressed sector visit may no longer exist. Normal 10 NM transfers resume after a three-second reconciliation interval.

Departures in computer sectors aim for ECL unless that specific sector has an explicit exit-level restriction. Changing ECL updates their computer clearance immediately; a PEL proposal constrains only the sector immediately preceding the user's sector. Its actual CFL changes when that is the aircraft's active sector. Other upstream computer sectors continue toward their own targets. Inside the user's sector, actual CFL remains a manual clearance and XFL remains a prediction target. At transfer to the destination approach unit, [managed arrivals](terminal-procedures.md) descend progressively toward FL030 under the remaining procedure restrictions.

The ELW uses merged designators and refreshed sequences. All domestic ACC groups retain exit-level display; foreign sectors after leaving EPWW still show only their designator. Existing short-visit filtering and direction/altitude boundary handling apply between logical groups. There is no transfer across elementary boundaries within one merged group.

The radar background is slightly lighter. Your sector's lateral footprint uses the old dark background colour. Its footprint is the union of all assigned Low and High polygons, independent of altitude and map-layer visibility. For `TC L TCJ H`, J's High-only area is therefore also dark. Cached polygon paths preserve holes and use opaque fills so overlaps do not darken twice.

Validation: unit tests cover partition integrity, exact names, vertical grouping, ownership reconciliation, preserved clearances, proposal cancellation, per-sector coordination, caching and footprint selection. The real catalogue test exercises all 251 variants under ALLFIR, Low/High, North/South layers, elementary sectors and a mixed merge. `tests/sectorisation.browser.cjs` exercises the editor, cancel/apply, standalone removal, mobile bounds, live ownership/ELW updates, actual shading pixels and full application loading/spawning.
