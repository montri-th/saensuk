# CityChat · แสนสุข

Public point explorer for Saensuk, with the original household-geocoding snapshot from 2026-09-08 and separate parcel-level comparison candidates derived from the building register received on 2026-11-11. The interface is Thai. The owner authorized public access on 2026-11-11 after the private-data disclosure was explained.

The page loads its minimized public snapshot automatically; visitors do not need to sign in or choose a CSV. It opens on all 42,524 source records, giving A0/A/B source evidence priority in the queue and map presentation. The working map can use 34 guarded parcel fallbacks while keeping the immutable source coordinates, source confidence, source status and source missingness separate. A preset opens all 70 parcel comparisons.

This repository contains the 2026-11-12 release source. Repository text and local tests do not establish which commit GitHub Pages is serving or replace live browser checks; those results are recorded separately for the exact deployed head.

## Public data and disclosure

The main point projection contains snapshot-specific display IDs, house numbers, actual 11-digit household registration identifiers (`house_reg_id`), road and community labels, controlled place categories, source coordinates/radii, source evidence categories, and separate candidate coordinates/flags. The owner explicitly approved public house numbers and roads, then explicitly confirmed publication of both house numbers and 11-digit household registration identifiers on 2026-11-12. This main projection excludes names of owners, contacts, trok/soi addresses, parcel UUIDs, tax parcel codes, building identifiers, business names, reviewer metadata, and review notes. A separate owner-requested sample viewer exposes old/new tax parcel codes alongside house numbers and roads to make the reported code changes inspectable. No raw registry CSV, building XLSX or LTAX file is deployed.

**House numbers, 11-digit household registration identifiers, roads and point coordinates are public and downloadable under the owner's explicit authorization.** Owner names and contacts remain excluded. The `P000001` display sequence identifies only a record within this public snapshot and remains separate from the actual `house_reg_id`. It is assigned after geographic/category sorting, not private source-file order. House numbers and household registration identifiers retain their original 2026-09-08 baseline values; a matching identifier or address is not confirmation of the correct dwelling at a displayed point.

- The release asset is `assets/data/public-housepoints-90968c55f259.json.gz`, a deterministic gzip payload of 639,647 bytes. Compressed SHA-256 is `90968c55f2594d3f65821851933921f32304bc97a62f1f3d257708f74ab5d47c`.
- Decoded JSON is 18,017,700 bytes, SHA-256 `e7397dba4fed2194301363256a5640cad8d26b8e8a810aea7bc624c1c88aba53`. Only the compressed asset is published. The browser verifies compressed bytes before decoding with native `DecompressionStream("gzip")`; unsupported browsers receive a readable error rather than fabricated data.
- `governance/public-data-release.json` records the exact file, schema, field allowlist, source hashes, owner authority and disclosure boundary.
- `scripts/build-public-snapshot.py` accepts the approved private display CSV and either the original private candidate file or the pinned previous public snapshot. The schema-3 migration validates existing public source fields against the exact private display, preserves their values and all 70 candidates, and adds the explicitly approved original 11-digit `house_reg_id` alongside `house_no`. Household identifiers are exact source values, never substitutes derived from display IDs or addresses. Strict field and value checks continue to exclude owner/contact fields and unrelated free text. The previous private candidate-ID absence check is inherited from its pinned release; it is not claimed as a newly repeated private-input scan when those bytes are unavailable. Sources are never edited.
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
- Public presets cover the 70 candidates and all 42,524 source records, plus 34 working fallbacks, four previously unpositioned records and 36 comparison-only candidates. Search by house number or 11-digit household registration identifier, plus community, road, place-type and source-evidence filters remain available. Private business/review-priority filters and editing/export controls are hidden and disabled in public mode.
- `ดูแผนที่เต็มพื้นที่` temporarily hides the queue and detail panes without changing selection, filters or basemap. Escape returns to the working view. The map legend is an operable disclosure rather than a permanently obscuring overlay.
- The map starts without a third-party basemap. Road tiles (OpenStreetMap) and satellite imagery (Esri World Imagery) are explicit opt-ins. A selected provider may receive the user's IP and viewed map area. Attribution remains visible.
- Google Maps and Street View open only after explicit action. URLs contain the selected coordinates, not an actual house number or municipal household ID. Google can receive normal IP/account/session metadata. Images can differ by date and resolution and do not independently verify a house plate or parcel.
- Source categories remain visible through labels and shape/color cues. Missing points are listed separately, never placed at `0,0`. Categorical and quantitative colors follow their own LDS theme contracts; color alone does not establish accuracy.

The local 23-community layer is communication/QA context, not a legal municipal boundary. Its safe name-and-geometry projection has SHA-256 `1419e28b00ed22ba4802a30cc3e0d01e4051c57165bc20e548b055839f4b8d71`. The separate inferred outer frame is the dissolved union's exterior, not a convex hull, cadastral boundary or official municipality extent; SHA-256 `8f0661e695b20e606fd38084ca5d4281b3b318ea054cf4dadf74b4c1033eac9e`. Parcel polygons used during private analysis are not included in the public data asset.

## Parcel code change examples

The `#parcel-changes` sample viewer compares the September and November building registers by the same private building identity. Its published rows use sample-specific IDs and omit the source building key, owner names and contact fields. Household registration identifiers are blank in both source building registers: zero populated values among 14,577 September rows and 16,953 November rows. The 40 examples therefore have no household identifier to publish or use to confirm a join to the main household register. The page offers a normal link to search the main register, without fabricating a record-level match. Code changes do not establish building movement, parcel split/merge, a corrected household position, or accuracy improvement. Exact old/new code lookups use the historical LTAX layer; absent codes and unusable reference points remain missing. This comparison does not change any of the 42,524 source records or 70 prior candidates.

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
python scripts/build-public-snapshot.py --display /private/display-v3.csv --previous-public-snapshot assets/data/public-housepoints-74080982aded.json.gz --output-root /path/to/saensuk
node --test tests/*.test.cjs
python tests/public-projection.test.py
```

The builder enforces exact approved hashes and will reject replacement snapshots until their contract is explicitly updated. Do not commit private inputs, raw output from analysis, owner-scoped review reports, or browser captures. Tests cover projection allowlists, exact approved registry identifiers, rejection of other source fields, source/candidate separation and aggregate/hash bindings. The current 2026-11-12 local run passed 92 Node tests and 16 Python projection tests. Local browser coverage is recorded in `governance/build-card.yml`; physical-device and native browser-zoom testing were not performed. Deployed-origin inspection and live-byte checks are separate release evidence.
