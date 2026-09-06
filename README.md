# CityChat · แสนสุข

Interactive single-page review desk and executive summary of the latest Saensuk household-registry geocoding result for non-technical municipal officers and executives.

The published repository contains the public interface, aggregate figures, and community boundaries only. It does **not** contain the raw master table, household identifiers, house numbers, parcel identifiers, review notes, or exact per-house coordinates.

## Local-data review desk

- An officer explicitly selects the approved master-table CSV with the browser's native file picker.
- A Web Worker verifies the exact SHA-256, UTF-8 encoding, ordered 22-column schema, 42,524 rows, coordinate counts, and seven-level geometry distribution before showing any record.
- Records, indexes, selections, and review drafts remain in tab memory. They are not written to `localStorage`, `sessionStorage`, IndexedDB, a service worker, the page URL, or analytics, and are cleared on reload/close.
- The list is paginated at 30 records. A canvas layer renders filtered points without creating tens of thousands of DOM markers.
- Every saved review requires an evidence source; strong plate-match/conflict results also require a note. The explicit local export keeps every row marked `draft-unverified` and defends spreadsheet cells beginning with `=`, `+`, `-`, or `@`. The export remains sensitive working data.

The page accepts only the approved snapshot whose SHA-256 is `15b897a48bdd14cf8c6ca71bcd560bf800102480a6ad7e5d35b433b85837bb4e`. A future dataset must update the contract and published aggregate narrative together.

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
- Visual guidance: Landometer Design System v0.9.1 (`v0.9.1-mp7`) and the approved normative CityChat DS Add-on v0.9. This page does not claim artifact-level conformance.

No favicon, app icon, or large-image social preview is declared because this release has no identity asset approved for those roles.

Leaflet 1.9.4 is vendored locally under `assets/vendor/leaflet/` with its BSD-2-Clause license. The JavaScript and CSS hashes match the official Leaflet distribution.

## Local preview

Serve the repository root with any static HTTP server, then open `index.html`. A local HTTP origin is required for the Web Worker and file verification workflow.

The page loads without a third-party request. OpenStreetMap or Esri World Imagery tiles and Google Maps/Street View become external only when the user explicitly chooses those actions.

Run the synthetic parser checks with:

```sh
node --test tests/csv-parser.test.cjs
```
