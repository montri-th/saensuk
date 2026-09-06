# CityChat · แสนสุข

Interactive single-page review desk and executive summary of the latest Saensuk household-registry geocoding result for non-technical municipal officers and executives.

The published repository contains the public interface, aggregate figures, and community boundaries only. It does **not** contain the raw master table, household identifiers, house numbers, parcel identifiers, review notes, or exact per-house coordinates.

## Local-data review desk

- An officer explicitly selects the approved master-table CSV with the browser's native file picker.
- A Web Worker verifies the exact SHA-256, UTF-8 encoding, ordered 22-column schema, 42,524 rows, coordinate counts, and seven-level geometry distribution before showing any record.
- Records, indexes, selections, and review drafts remain in tab memory. They are not written to `localStorage`, `sessionStorage`, IndexedDB, a service worker, the page URL, or analytics, and are cleared on reload/close.
- The list is paginated at 30 records. A canvas layer renders filtered points without creating tens of thousands of DOM markers.
- Nearby records are collision-clustered at every zoom into numbered markers with a guaranteed screen-space gap. Selecting a group zooms in through level 20; at maximum zoom, repeated clicks cycle only the records named by that visible group. The interface distinguishes an exact shared coordinate from a small group of nearby screen positions, so a hidden record is never selected through a different visible symbol.
- Marker meaning is redundant by color and shape: green cross for parcel/building-level points, blue diagonally split hexagon for estimated points, yellow triangle for coarse points, and a neutral numbered circle for a group. The selected record keeps its category shape and gains a static double ring.
- Every saved review requires an evidence source; strong plate-match/conflict results also require a note. The explicit local export keeps every row marked `draft-unverified` and defends spreadsheet cells beginning with `=`, `+`, `-`, or `@`. The export remains sensitive working data.

The page accepts only the approved snapshot whose SHA-256 is `15b897a48bdd14cf8c6ca71bcd560bf800102480a6ad7e5d35b433b85837bb4e`. A future dataset must update the contract and published aggregate narrative together.

## Private Google Sheet connection

The browser-to-Google-Sheet connection is not implemented in this release. It remains pending a Google OAuth Web Client ID, enabled Google Sheets API, consent configuration, and an authorized JavaScript origin. The intended connection uses a user-triggered Google Identity Services token, the read-only Sheets scope, and the file's existing Google Drive permissions; it will not publish a CSV/`gviz` endpoint or bypass file access controls. Until that setup is supplied and verified, the local approved-CSV upload remains the only data-loading path shown on the page.

Because all project sites under `montri-th.github.io` share one browser origin, approving that origin also lets other repositories under the account initiate the same OAuth client. A dedicated custom hostname is the stronger isolation choice for sensitive working data.

## Maps and outbound boundaries

- The default map uses the same-origin community-boundary file and local CSV coordinates only; it makes no map-provider request.
- Road and satellite basemaps are explicit opt-ins. The three-state control starts at `off`, can request road tiles from OpenStreetMap, or imagery tiles from Esri World Imagery. The selected provider may receive the user's IP address and viewed area; attribution remains visible.
- Esri World Imagery can combine imagery from different dates, resolutions, and providers. It is context for comparison, not proof of current conditions, property rights, or legal boundaries.
- Google Maps and Street View are opened only after an explicit click. Only the selected latitude/longitude is placed in the outgoing URL—never the house number, registration ID, parcel ID, note, or source filename. Google may still receive normal connection, IP, account, or session metadata.
- Street View is enabled only for fine-grained parcel/building candidates without selected evidence-conflict flags. It is described as nearby imagery for review, not proof of a house location.
- Community containment is a QA comparison and never overwrites the CSV's declared community.

The published GeoJSON is a derived copy of the user-supplied boundary file: 23 polygons, `name` plus geometry only, CRS84, outer-ring winding normalized, 42,807 bytes, SHA-256 `1419e28b00ed22ba4802a30cc3e0d01e4051c57165bc20e548b055839f4b8d71`. It is presented for communication and QA, not as a legal boundary. Source ownership, license, and reference date are not encoded in the supplied file and should be documented before reuse beyond this authorized page.

GitHub Pages project sites under `montri-th.github.io` share one browser origin. Before the file input is enabled, this page synchronously clears `window.name`, drops `window.opener`, and redirects framed or opener-initiated sessions to a no-input safety page. It also rechecks the top-level state immediately before parsing and asks users to open the canonical URL directly. A repository path is still not a complete origin-isolation boundary; a wider sensitive-data rollout should use a dedicated custom origin with response-level framing and opener policies.

## Snapshot

- Master table v3 — 2026-09-05
- Steps 0–3 run report v3 — 2026-09-05
- Pipeline v3 / rules 1.2.0 — 2026-09-05
- Implementation plan v1 — 2026-09-04
- Visual guidance: Landometer Design System v0.9.1 (`v0.9.1-mp7`) and the approved normative CityChat DS Add-on v0.9.1. This page does not claim artifact-level conformance.

The hero uses the two exact, hash-verified CityChat horizontal lockups supplied by the governed handoff, selected for light or deep surfaces. Its Conversation Motif derivatives preserve the supplied geometry while mapping only the two motif colors to approved CityChat light/dark surface colors and removing embedded source metadata. These assets are approved here only for `identity.hero` and `conversation_motif.decorative`; they are not approved as favicons, compact or secondary logos, social previews, diagrams, or evidence. Full hashes, source bindings, transformations, alt guidance, and review gates are recorded in `governance/assets.json`.

No favicon, app icon, or large-image social preview is declared because the approved CityChat assets do not carry those roles.

Leaflet 1.9.4 is vendored locally under `assets/vendor/leaflet/` with its BSD-2-Clause license. The JavaScript and CSS hashes match the official Leaflet distribution.

## Local preview

Serve the repository root with any static HTTP server, then open `index.html`. A local HTTP origin is required for the Web Worker and file verification workflow.

The page loads without a third-party request. OpenStreetMap or Esri World Imagery tiles and Google Maps/Street View become external only when the user explicitly chooses those actions.

Run the synthetic parser checks with:

```sh
node --test tests/csv-parser.test.cjs
```
