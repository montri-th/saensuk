# CityChat · แสนสุข

Public point explorer for Saensuk, with the original household-geocoding snapshot from 2026-09-08 and separate parcel-level comparison candidates derived from the building register received on 2026-11-11. The interface is Thai. The owner authorized public access on 2026-11-11 after the private-data disclosure was explained.

The page loads its minimized public snapshot automatically; visitors do not need to sign in or choose a CSV. It opens on all 42,524 source records, giving A0/A/B source evidence priority in the queue and map presentation. The working map can use 34 guarded parcel fallbacks while keeping the immutable source coordinates, source confidence, source status and source missingness separate. A preset opens all 70 parcel comparisons.

This repository contains the 2026-11-12 release source. Repository text and local tests do not establish which commit GitHub Pages is serving or replace live browser checks; those results are recorded separately for the exact deployed head.

## Public data and disclosure

The published data projection contains snapshot-specific display IDs, house numbers, road and community labels, controlled place categories, source coordinates/radii, source evidence categories, and separate candidate coordinates/flags. The owner explicitly approved public house numbers and roads on 2026-11-12. It excludes names of owners, contacts, municipal household identifiers, trok/soi addresses, parcel UUIDs, tax parcel codes, building identifiers, business names, reviewer metadata, and review notes. No raw registry CSV, building XLSX or LTAX file is deployed.

**House numbers, roads and point coordinates are public and downloadable under the owner's explicit authorization.** Owner names and municipal identifiers remain excluded. The `P000001` display sequence identifies only a record within this public snapshot, not a municipal registry identity. It is assigned after geographic/category sorting, not private source-file order. House numbers retain the 2026-09-08 baseline spelling; a public address is not confirmation of the correct dwelling at a displayed point.

- The release asset is `assets/data/public-housepoints-74080982aded.json.gz`, a deterministic gzip payload of 453,902 bytes. Compressed SHA-256 is `74080982aded398033ab40f71062557539fec09829d54df95db9a6e3cf3fd54f`.
- Decoded JSON is 16,699,447 bytes, SHA-256 `a14ffc3bc643dc5316fac1e10a8bf191fb559e6773a9ca1da42552730ccc9493`. Only the compressed asset is published. The browser verifies compressed bytes before decoding with native `DecompressionStream("gzip")`; unsupported browsers receive a readable error rather than fabricated data.
- `governance/public-data-release.json` records the exact file, schema, field allowlist, source hashes, owner authority and disclosure boundary.
- `scripts/build-public-snapshot.py` accepts the approved private display CSV and either the original private candidate file or the pinned previous public snapshot. The schema-2 migration validates every old public source field against the exact private display, preserves all old public values and all 70 candidates, and adds only the approved original `house_no`. It scans all actual household IDs and rejects free text outside the strict house-number grammar. The previous private candidate-ID absence check is inherited from its pinned release; it is not claimed as a newly repeated private-input scan when those bytes are unavailable. Sources are never edited.
- Public mode has no review form, editable adjustment form or export action. It does not save or submit corrections. Historical local-file parsing/adjustment code remains in the bundle for its separate authorized workflow; it is not the default public loading route or an access-control mechanism.

## What the parcel comparison means

The original sources contain 42,524 records: 40,236 with coordinates and 2,288 intentionally without coordinates. Confidence-band counts remain A0/A/B/C/D = 10,114 / 1,855 / 744 / 2,288 / 27,523. The public projection does not change any of these totals.

The additional building register contains 16,953 building rows on 14,546 distinct tax parcel codes. Exact source-based crosswalking links 5,992 codes, covering 7,437 building rows, to the historical LTAX parcel layer. Household-to-building matching still uses normalized house number and road, because every house-registry-ID cell in the new building register is blank and that file has no soi or subdistrict columns. A one-to-one address candidate is therefore not proof of the correct house.

The 70 public comparisons comprise:

| Original source state | Comparisons |
|---|---:|
| Approximate coordinate, no prior parcel ID | 64 |
| No original coordinate | 4 |
| Approximate coordinate, candidate parcel conflicts with prior parcel | 2 |

The 68 comparisons without a known prior-parcel conflict all lack a prior source parcel ID; they are **not positive parcel agreements or confirmed improvements**. Seven are more than 500 m from the original point; four candidates are auxiliary structures (three garages and one sports court). Other candidates include restaurant, office and warehouse categories. These signals require review rather than automatic promotion.

Candidate points use original LTAX `map_lat`/`map_long` values strictly inside the exact referenced parcel geometry. Native GEOS 3.13.1 independently validated all 30,110 source geometries, including 159 hole rings, and all 70 comparison points. The 592 LTAX map points outside their source polygons were excluded, not moved or repaired. Valid geometry and point containment do not identify a dwelling, building entrance, house plate, current occupancy, or legal boundary. Point-to-point displacement is not measured accuracy improvement.

The selected record retains source and candidate as distinct marks with a comparison connector when both exist. The default working-position policy uses a candidate only when it has no known prior-parcel conflict and is neither an auxiliary nor another nonresidential type. A D candidate must be no more than 500 m from the original point and no farther than the original source radius; a C candidate requires both original coordinates missing. A0/A/B source points are never replaced by a candidate. This selects 30 D records and four C records, or 34 working parcel fallbacks. The remaining 36 candidates stay comparison-only.

The working view therefore has positions for 40,240 records and no working position for 2,284. The original snapshot still has only 40,236 coordinate records and 2,288 missing records: the four C source rows remain missing, even when a separate parcel point is used for the working display. Both parcel conflicts stay visibly flagged. No candidate is field-verified, written back to source, or assigned building-level certainty. The original radius is evidence context, not a calibrated accuracy estimate for a parcel candidate; the distance/radius guards are display safeguards, not measured success rates. The exact policy and counts are recorded in `governance/public-data-release.json` under `display_coordinate_policy`.

The independent 2026-11-12 audit in `governance/building-register-assessment.json` reproduces all 70 candidates and 34 fallbacks. The November register has 2,376 net more rows than September (+16.30%), but no coordinate columns and all house-registration IDs blank. Among 14,417 stable building IDs, 5,069 changed parcel code. None of the 34 working fallbacks has this history. Historical crosswalking may recover lineage, but does not establish new current geometry or a measured accuracy gain. The page explains the separate building/code/house-record denominators and the missing house numbers/roads, rather than equating register growth with better accuracy.

## Map interaction and outbound requests

- The queue is paginated at 30 records. A canvas renders source points without tens of thousands of DOM markers. Coincident/sub-pixel records remain reachable by repeated selection. Nearby ordinary homes are not proximity-grouped; numbered markers require eligible building semantics at one data coordinate, which is not independently verified proof of one physical building.
- Public presets cover the 70 candidates and all 42,524 source records, plus 34 working fallbacks, four previously unpositioned records and 36 comparison-only candidates. House-number search, community, road, place-type and source-evidence filters remain available. Private business/review-priority filters and editing/export controls are hidden and disabled in public mode.
- `ดูแผนที่เต็มพื้นที่` temporarily hides the queue and detail panes without changing selection, filters or basemap. Escape returns to the working view. The map legend is an operable disclosure rather than a permanently obscuring overlay.
- The map starts without a third-party basemap. Road tiles (OpenStreetMap) and satellite imagery (Esri World Imagery) are explicit opt-ins. A selected provider may receive the user's IP and viewed map area. Attribution remains visible.
- Google Maps and Street View open only after explicit action. URLs contain the selected coordinates, not an actual house number or municipal household ID. Google can receive normal IP/account/session metadata. Images can differ by date and resolution and do not independently verify a house plate or parcel.
- Source categories remain visible through labels and shape/color cues. Missing points are listed separately, never placed at `0,0`. Categorical and quantitative colors follow their own LDS theme contracts; color alone does not establish accuracy.

The local 23-community layer is communication/QA context, not a legal municipal boundary. Its safe name-and-geometry projection has SHA-256 `1419e28b00ed22ba4802a30cc3e0d01e4051c57165bc20e548b055839f4b8d71`. The separate inferred outer frame is the dissolved union's exterior, not a convex hull, cadastral boundary or official municipality extent; SHA-256 `8f0661e695b20e606fd38084ca5d4281b3b318ea054cf4dadf74b4c1033eac9e`. Parcel polygons used during private analysis are not included in the public data asset.

## Design release and retained asset provenance

Current design authority is the complete standalone **Landometer DS 0.9.7**, release `v0.9.7-owner.1`, color set `color-srgb-10`, together with the separate **CityChat Add-on 0.9.2 for LDS 0.9.7**. Exact Project Source bindings are:

| Document | SHA-256 |
|---|---|
| `Landometer-Design-System-v0.9.7.md` | `d3085cbc0a50195f1cbf0c77b1d77c0d19b84364daf2948eb367348d65432d96` |
| `CityChat-Add-on-v0.9.2-for-LDS-v0.9.7.md` | `345ef4054d7a646a73a8b369549c58c8b11d3190e39de5aa0f59704d6a3223ad` |

The Add-on's `baseDocument.sha256` binds the exact base above. The active audience-safe color projection is `assets/color-srgb-10.production.css`; current categorical aliases resolve `--ldm-series-0N-fill-light/dark`. No predecessor LDS/Add-on is a parallel authority for this release. Existing brand filenames containing `v091` retain immutable historical names/bytes and their recorded role-approval provenance; those filenames and old receipts do not select the active design-system version or prove the new release passed review. Asset records remain in `governance/assets.json` and `governance/image-assets.json`.

Package/source integrity, automated artifact checks, live rendering, accessibility, rights review and DS conformance are separate evidence. This README makes no blanket DS-conformance, new browser-pass or physical-device-pass claim.

Leaflet 1.9.4 remains vendored under `assets/vendor/leaflet/` with its BSD-2-Clause license.

## Local preview, rebuilding and tests

Serve the repository root over HTTP and open `index.html`; the public data loads automatically. A current browser with Web Crypto and native gzip decompression is required for this loading path.

To rebuild the minimized asset, provide the two approved private source paths outside the publication tree:

```sh
python scripts/build-public-snapshot.py --display /private/display-v3.csv --previous-public-snapshot assets/data/public-housepoints-43a6b7022e2b.json.gz --output-root /path/to/saensuk
node --test tests/*.test.cjs
python tests/public-projection.test.py
```

The builder enforces exact approved hashes and will reject replacement snapshots until their contract is explicitly updated. Do not commit private inputs, raw output from analysis, owner-scoped review reports, or browser captures. Tests cover projection allowlists, direct-identifier rejection, source/candidate separation and aggregate/hash bindings. The 2026-11-12 local run passed 83 Node tests and 14 Python projection tests. Local browser coverage is recorded in `governance/build-card.yml`; physical-device and native browser-zoom testing were not performed. Deployed-origin inspection and live-byte checks are separate release evidence.
