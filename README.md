# CityChat · แสนสุข

Interactive single-page review desk and executive summary for the Saensuk household-registry geocoding run produced on 2026-09-08 (`rules 1.9.0`, pipeline v9). The reader-facing interface is Thai and is designed for municipal officers and non-technical executives.

This tree is the locally verified display-v3 release source. Live delivery is attested separately against the deployed commit; repository text alone never proves which bytes GitHub Pages is serving.

The public repository contains the interface, aggregate figures, an index-safe 23-community layer, its derived outer frame, and governed brand/design assets. It does **not** contain the display CSV, raw registry, household identifiers, house numbers, parcel identifiers, review notes, company-address rows, or exact per-house coordinates.

## Local-data review desk

- An officer explicitly selects `03CityChat__housemapdisplaydataset__v3__20260908.csv` with the browser's native file picker.
- A Web Worker verifies the exact file name, SHA-256, byte length, UTF-8 encoding, ordered 29-column schema, 42,524 unique rows, pipeline run ID, coordinate totals, confidence bands, review priorities, business-tag totals, and frontage totals before showing any record. The v3 contract replaces `dist_named_soi_m` and `soi_check` with the paired `soi_name_check` and `soi_name_check_confidence` fields.
- If the browser cannot start or communicate with the Web Worker, the page retries the same fail-closed parser once in the current tab. A parser-reported validation failure is never bypassed, and neither path uploads the file.
- The accepted display file is 15,709,401 bytes with SHA-256 `a57f1462fdc5b23f88d90856b0e2556d2d231d6e0b17af3468e133ed2770d8f5`. Every row must carry run ID `20260908T071053_f3b4ba_38e4d7_rules1.9.0`.
- Records, indexes, selections, and review drafts remain in tab memory. They are not written to browser storage, a service worker, the page URL, or analytics, and are cleared on reload or close.
- The list is paginated at 30 records. A canvas layer renders the filtered point set without creating tens of thousands of DOM markers. Coincident and sub-pixel records remain reachable by repeated selection; numbered markers are reserved for records with explicit building semantics at one coordinate.
- The map is given more desktop width before the detail pane moves below the working row. An explicit `ดูแผนที่เต็มพื้นที่` action temporarily hides the queue and detail panes without changing the selected record, filters, basemap, review drafts, or coordinate proposals; Escape returns to the review desk.
- The map legend is a keyboard-operable disclosure that starts closed. It can be opened on demand, is height-bounded over a desktop map, and moves below the map on small screens so it does not permanently obscure imagery or intercept map interaction.
- Marker color encodes the governed confidence scale; shape independently encodes location geometry. A0 and A share the highest governed color anchor and A0 carries an additional centre mark. C uses the governed no-data state and is listed separately rather than placed at `0,0`.
- Filters cover community, road, place type, confidence, registered-business presence, review priority, geometry, and evidence signals. The initial view is the 500 high-priority records.
- Every visible queue row offers a coordinate-only Street View link when possible and an in-page action that selects the record and turns on the satellite basemap; neither action sends a request until the officer clicks it.
- The supplied display file has a known producer defect: `review_score` is blank on every row, although the separate QA list contains scores. The interface therefore sorts by high/mid/low priority and preserves source order within each priority; it does not invent scores.
- Business counts are registration-tag rows, not guaranteed distinct companies. The detail panel previews up to three unique names, states when more names exist, and keeps the registration-tag count separate. A registered address is not proof that the business currently operates at that point.
- Frontage headings are used only when present. Street View URLs contain the selected coordinates and optional heading—never the house number or registration ID.
- Every saved review remains `draft-unverified`; exporting requires an explicit warning because the resulting local file contains sensitive working data.

## Coordinate-adjustment proposals

- The original display row and its `source_lat` / `source_lon` are immutable. A proposed point is held separately as `proposed_lat` / `proposed_lon`; the map shows source and proposal as distinct markers joined by a comparison line.
- A record with an existing coordinate creates a `move_existing` proposal. A record with both coordinates absent creates a `place_missing` proposal. Partial or invalid source coordinate pairs fail closed.
- Every proposal requires a reason, evidence source and reference, observation date, reviewer code, adjustment ID, and UTC timestamp. A0 survey rows and multi-unit/building rows require stronger evidence; imagery alone never upgrades the source confidence or proves a correction.
- Saving a proposal does not overwrite the loaded CSV or update the upstream master table. The exported 27-column patch keeps source and proposed coordinates, movement distance, source run ID, source hash, source contract, and audit metadata separate, and every row remains `draft-unverified`.
- Proposal drafts live only in the current browser tab. The exported CSV is a handoff for authorized review and upstream acceptance; it is not a corrected master dataset and must not be merged automatically.

## Private Google Sheet connection

The browser-to-Google-Sheet connection is not implemented in this release. In plain terms, the current safe route is to download the approved CSV and choose it from the device; the file is processed only in that browser tab. A future private-Sheet route would require a separately configured Google sign-in flow and access-control review so that the Sheet is never made public. Until that work is supplied and verified, approved local-CSV selection is the only data-loading path.

Because all project sites under `montri-th.github.io` share one browser origin, a dedicated custom hostname remains the stronger isolation choice for wider sensitive-data use.

## Maps and outbound boundaries

- The map starts with no third-party basemap. The same-origin 23-community polygons remain the named communication/QA layer used for community comparison.
- A separate solid outer frame is derived by dissolving all 23 community polygons and retaining the union's exterior ring. It is labelled as an inferred working extent—not an official municipal, legal, cadastral, or property boundary.
- Road tiles (OpenStreetMap) and satellite imagery (Esri World Imagery) are explicit opt-ins. A selected provider may receive the user's IP address and viewed area; attribution remains visible.
- Imagery can differ by date, resolution, and source. It supports visual review but does not prove present conditions, property rights, legal boundaries, or that a house plate matches.
- Google Maps and Street View open only after an explicit click. Google may receive normal connection, IP, account, or session metadata.

The owner-supplied `saensuk_village_boundaries.geojson` has SHA-256 `d397dff38411bdb46d8923d5a04e608f10c569fe65a598f4754464608e8f3c83`. Its published geometry-equivalent safe copy contains 23 polygons with name and geometry only, uses CRS84, and has SHA-256 `1419e28b00ed22ba4802a30cc3e0d01e4051c57165bc20e548b055839f4b8d71`. The separate inferred outer-frame GeoJSON contains one closed 528-vertex Polygon, is 13,974 bytes, and has SHA-256 `8f0661e695b20e606fd38084ca5d4281b3b318ea054cf4dadf74b4c1033eac9e`. Its area is approximately 20.163 km² and it covers all 23 supplied polygons. It is the exterior of their dissolved union, not a convex hull or bounding box; taking only that exterior fills ten topology micro-holes totalling 63.8914 m².

## Snapshot

- Display dataset v3 / pipeline v9 / rules 1.9.0 — 2026-09-08
- 42,524 registry rows: 40,236 with coordinates and 2,288 intentionally without coordinates
- Confidence bands A0/A/B/C/D: 10,114 / 1,855 / 744 / 2,288 / 27,523
- Review priorities high/mid/low: 500 / 2,044 / 3,102
- 13,959 frontage points; 8,042 face a road named by the address; 9,634 use a municipal-road geometry layer
- 103 road/soi keys checked across three sources: 84 verified, with 4 keys / 380 positioned rows queued for municipal review
- 1,379 registry rows carry 2,048 business-registration tags
- Field-verified count, measured accuracy, and official municipal boundary are null in the delivered figures and are therefore not rendered as numeric claims. The inferred outer frame is a separately labelled working context and does not replace that null official-boundary value.

Visual guidance is Landometer Design System v0.9.1 (`0.9.1-r8`, machine package `v0.9.1-mp7`) plus the approved CityChat DS Add-on v0.9.1. The exact audience-safe production color projection is shipped as `assets/color-srgb-05.production.css`, 8,184 bytes, SHA-256 `3bac2499df594bbf6b016b650ee7763f7ec093e33bc5f28239144e0677281d5c`.

The hero, navbar, motif, Landometer symbol, and favicon retain their previously governed exact bytes and role approvals. Full asset bindings are recorded in `governance/assets.json` and `governance/image-assets.json`.

Leaflet 1.9.4 is vendored under `assets/vendor/leaflet/` with its BSD-2-Clause license.

## Local preview and tests

Serve the repository root over HTTP, open `index.html`, and select the exact approved display CSV. A local HTTP origin is required for the Web Worker.

```sh
node --test tests/*.test.cjs
```

The page performs no map-provider request until the user explicitly enables a road or satellite basemap. Google Maps and Street View open only after an explicit record action.

Physical iPhone/Safari testing was not available. The owner accepted the best available browser coverage on 2026-09-08; responsive emulation, touch-sized controls, Thai 130%, 200% zoom, light/dark/system themes, keyboard focus, and reduced motion remain the recorded evidence and must not be described as a physical-device pass.
