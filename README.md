# CityChat · แสนสุข

Interactive single-page review desk and executive summary of the latest Saensuk household-registry geocoding result for non-technical municipal officers and executives.

The published repository contains the public interface, aggregate figures, and community boundaries only. It does **not** contain the raw master table, household identifiers, house numbers, parcel identifiers, review notes, or exact per-house coordinates.

## Local-data review desk

- An officer explicitly selects the approved master-table CSV with the browser's native file picker.
- A Web Worker verifies the exact v6 SHA-256, UTF-8 encoding, ordered 22-column schema, 42,524 rows, coordinate counts, and seven-level geometry distribution before showing any record.
- Records, indexes, selections, and review drafts remain in tab memory. They are not written to `localStorage`, `sessionStorage`, IndexedDB, a service worker, the page URL, or analytics, and are cleared on reload/close.
- The list is paginated at 30 records. A canvas layer renders filtered points without creating tens of thousands of DOM markers.
- Ordinary household records are never grouped merely because their coordinates are close. A numbered marker is created only for records that share the exact data coordinate and are explicitly typed as `อาคารชุด`, typed as `สำนักงาน`, or classified at `geom_level=building`. The current v6 schema has no `matched_building_id`, so neither proximity nor a shared parcel ID—including A0 rows—is treated as proof of one building, and the interface describes the evidence as a shared building-level coordinate rather than a verified physical-building match.
- Ordinary records that reuse an approximate cluster, street, or community coordinate remain separate records. Repeated clicks on the same or visually indistinguishable point cycle those records without relabelling the point as a building. Marker meaning is redundant by color and shape: green cross for parcel/building-level points, blue diagonally split hexagon for estimated points, yellow triangle for coarse points, and a neutral numbered circle only for eligible building records at one data coordinate. The selected record keeps its category shape and gains a static double ring.
- Six overlapping v6 evidence queues expose A0 parcel linkage, municipal-register coordinate conflicts, multi-site register matches, far-from-road flags, source review status, and missing coordinates without implying that every queued row has the same priority.
- Every saved review requires an evidence source; strong plate-match/conflict results also require a note. Building and condominium rows can record only building-context observations—not a claim that an individual unit's house plate matched. The explicit local export keeps every row marked `draft-unverified`, includes v6 provenance, parcel linkage, verification scope, and official Google map URLs, leaves Street View blank when a row is ineligible, and defends spreadsheet cells beginning with `=`, `+`, `-`, or `@`. The export remains sensitive working data.

The page accepts only the approved v6 snapshot whose SHA-256 is `4f78161473f9f6398457c4810f45af43806ce2884e44f22e95dc2be92ae11a67`. The row-level `version` column remains `1`; the v6 release identity is bound by the filename, hash, processing evidence, and aggregate contract. A future dataset must update that contract and the published narrative together.

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

- Master table v6 — 2026-09-07 — 42,524 rows, 40,236 with coordinates, 2,288 intentionally without coordinates
- Municipal registers run report v6 — 2026-09-07
- Pipeline v6 / rules 1.6.0 — 2026-09-07
- Implementation plan v1 — 2026-09-04
- Visual guidance: Landometer Design System v0.9.1 (`v0.9.1-mp7`) and the approved normative CityChat DS Add-on v0.9.1. This page does not claim artifact-level conformance.

The v6 summary adds municipal building-survey evidence (A0: 10,114 registry rows), official condominium-name matching as aggregate evidence (47 of 65 groups covering 6,315 rows), and road-distance QA. The master CSV does not contain the official condominium name or road geometry, so the review desk does not invent those record-level fields. All 42,524 rows remain unverified, pending, or queued for review; the raw master table is never bundled into this public repository.

The hero and navbar use the two exact, hash-verified CityChat horizontal lockups supplied by the governed handoff, selected by the surface they actually sit on. The navbar also uses the exact Landometer symbol required by the CityChat Add-on. Its Conversation Motif derivatives preserve the supplied geometry while mapping only the two motif colors to approved CityChat light/dark surface colors and removing embedded source metadata.

The browser tab uses the exact hash-bound CityChat favicon bytes previously governed for that role and newly approved by the owner specifically for this Saensuk URL. It is not reused as a navbar, touch, maskable, search, social, or evidence asset. No app/touch icon or large-image social preview is declared. Full hashes, source bindings, role approvals, transformations, alt guidance, and review gates are recorded in `governance/assets.json`.

Leaflet 1.9.4 is vendored locally under `assets/vendor/leaflet/` with its BSD-2-Clause license. The JavaScript and CSS hashes match the official Leaflet distribution.

## Local preview

Serve the repository root with any static HTTP server, then open `index.html`. A local HTTP origin is required for the Web Worker and file verification workflow.

The page loads without a third-party request. OpenStreetMap or Esri World Imagery tiles and Google Maps/Street View become external only when the user explicitly chooses those actions.

Run the synthetic parser checks with:

```sh
node --test tests/csv-parser.test.cjs tests/marker-grouping.test.cjs tests/v6-explorer-contract.test.cjs
```
