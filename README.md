# CityChat · แสนสุข

Interactive single-page review desk and executive summary for the Saensuk household-registry geocoding run produced on 2026-09-08 (`rules 1.8.0`). The reader-facing interface is Thai and is designed for municipal officers and non-technical executives.

The public repository contains the interface, aggregate figures, an index-safe community-boundary layer, and governed brand/design assets. It does **not** contain the display CSV, raw registry, household identifiers, house numbers, parcel identifiers, review notes, company-address rows, or exact per-house coordinates.

## Local-data review desk

- An officer explicitly selects `03CityChat__housemapdisplaydataset__v2__20260908.csv` with the browser's native file picker.
- A Web Worker verifies the exact SHA-256, byte length, UTF-8 encoding, ordered 29-column schema, 42,524 unique rows, pipeline run ID, coordinate totals, confidence bands, review priorities, business-tag totals, and frontage totals before showing any record.
- The accepted display file is 14,812,722 bytes with SHA-256 `4f68b1c5a7f962a2ddc06e4e9f7bd6a9959e94c42bd65e2c94354153a04c19d5`. Every row must carry run ID `20260908T044243_f3b4ba_38e4d7_rules1.8.0`.
- Records, indexes, selections, and review drafts remain in tab memory. They are not written to browser storage, a service worker, the page URL, or analytics, and are cleared on reload or close.
- The list is paginated at 30 records. A canvas layer renders the filtered point set without creating tens of thousands of DOM markers. Coincident and sub-pixel records remain reachable by repeated selection; numbered markers are reserved for records with explicit building semantics at one coordinate.
- Marker color encodes the governed confidence scale; shape independently encodes location geometry. A0 and A share the highest governed color anchor and A0 carries an additional centre mark. C uses the governed no-data state and is listed separately rather than placed at `0,0`.
- Filters cover community, road, place type, confidence, registered-business presence, review priority, geometry, and evidence signals. The initial view is the 500 high-priority records.
- Every visible queue row offers a coordinate-only Street View link when possible and an in-page action that selects the record and turns on the satellite basemap; neither action sends a request until the officer clicks it.
- The supplied display file has a known producer defect: `review_score` is blank on every row, although the separate QA list contains scores. The interface therefore sorts by high/mid/low priority and preserves source order within each priority; it does not invent scores.
- Business counts are registration-tag rows, not guaranteed distinct companies. The detail panel previews up to three unique names, states when more names exist, and keeps the registration-tag count separate. A registered address is not proof that the business currently operates at that point.
- Frontage headings are used only when present. Street View URLs contain the selected coordinates and optional heading—never the house number or registration ID.
- Every saved review remains `draft-unverified`; exporting requires an explicit warning because the resulting local file contains sensitive working data.

## Private Google Sheet connection

The browser-to-Google-Sheet connection is not implemented in this release. It still requires a Google OAuth Web Client ID, enabled Google Sheets API, consent configuration, and an authorized JavaScript origin. The intended connection must use a user-triggered read-only token and the file's existing Drive permissions; it must not expose a public CSV or `gviz` endpoint. Until those inputs are supplied and verified, approved local-CSV selection is the only data-loading path.

Because all project sites under `montri-th.github.io` share one browser origin, a dedicated custom hostname remains the stronger isolation choice for wider sensitive-data use.

## Maps and outbound boundaries

- The map starts with no third-party basemap. The same-origin community polygons are an approximate communication/QA layer, not an official municipal boundary.
- Road tiles (OpenStreetMap) and satellite imagery (Esri World Imagery) are explicit opt-ins. A selected provider may receive the user's IP address and viewed area; attribution remains visible.
- Imagery can differ by date, resolution, and source. It supports visual review but does not prove present conditions, property rights, legal boundaries, or that a house plate matches.
- Google Maps and Street View open only after an explicit click. Google may receive normal connection, IP, account, or session metadata.

The published community GeoJSON contains 23 polygons with name and geometry only, uses CRS84, and has SHA-256 `1419e28b00ed22ba4802a30cc3e0d01e4051c57165bc20e548b055839f4b8d71`.

## Snapshot

- Display dataset v2 / pipeline v8 / rules 1.8.0 — 2026-09-08
- 42,524 registry rows: 40,236 with coordinates and 2,288 intentionally without coordinates
- Confidence bands A0/A/B/C/D: 10,114 / 1,855 / 744 / 2,288 / 27,523
- Review priorities high/mid/low: 500 / 2,044 / 3,102
- 13,960 frontage points; 8,036 face a road named by the address; 9,630 use a municipal-road geometry layer
- 1,379 registry rows carry 2,048 business-registration tags
- Field-verified count, measured accuracy, and official municipal boundary are null in the delivered figures and are therefore not rendered as numeric claims

Visual guidance is Landometer Design System v0.9.1 (`0.9.1-r8`, machine package `v0.9.1-mp7`) plus the approved CityChat DS Add-on v0.9.1. The exact audience-safe production color projection is shipped as `assets/color-srgb-05.production.css`, 8,184 bytes, SHA-256 `3bac2499df594bbf6b016b650ee7763f7ec093e33bc5f28239144e0677281d5c`.

The hero, navbar, motif, Landometer symbol, and favicon retain their previously governed exact bytes and role approvals. Full asset bindings are recorded in `governance/assets.json` and `governance/image-assets.json`.

Leaflet 1.9.4 is vendored under `assets/vendor/leaflet/` with its BSD-2-Clause license.

## Local preview and tests

Serve the repository root over HTTP, open `index.html`, and select the exact approved display CSV. A local HTTP origin is required for the Web Worker.

```sh
node --test tests/*.test.cjs
```

The page performs no map-provider request until the user explicitly enables a road or satellite basemap. Google Maps and Street View open only after an explicit record action.
