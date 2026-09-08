"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const embedded = fs.readFileSync(path.join(root, "embedded-blocked.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets", "explorer.css"), "utf8");
const explorer = fs.readFileSync(path.join(root, "assets", "record-explorer.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "assets", "record-worker.js"), "utf8");
const adjustment = fs.readFileSync(path.join(root, "assets", "coordinate-adjustment.js"), "utf8");

test("explorer consumes the display-only business, frontage, review, and provenance fields", () => {
  for (const field of [
    "confidence_band",
    "frontage_heading",
    "frontage_road",
    "frontage_road_layer",
    "frontage_road_source",
    "soi_name_check",
    "soi_name_check_confidence",
    "business_count",
    "business_names",
    "business_status",
    "business_match_confidence",
    "review_priority",
    "review_score",
    "review_flags",
    "pipeline_run_id"
  ]) {
    assert.match(explorer, new RegExp(`row\\.${field}`));
  }
  assert.match(worker, /csv-parser\.js\?v=20260908-display-v3-r3/);
});

test("worker and main-thread fallback use the same pinned verified parser", () => {
  const parserTag = 'assets/csv-parser.js?v=20260908-display-v3-r3';
  const explorerTag = 'assets/record-explorer.js?v=20260908-v9-display-v3-r5';

  assert.match(html, new RegExp(parserTag.replace(/[.?]/g, "\\$&")));
  assert.match(worker, /importScripts\("\.\/csv-parser\.js\?v=20260908-display-v3-r3"\)/);
  assert.ok(html.indexOf(parserTag) < html.indexOf(explorerTag));
  assert.match(explorer, /const csvParser = window\.CityChatCsv \|\| null/);
  assert.match(explorer, /typeof csvParser\.parseVerifiedFile === "function"/);
  assert.match(explorer, /expectedSha256 === "a57f1462fdc5b23f88d90856b0e2556d2d231d6e0b17af3468e133ed2770d8f5"/);
  assert.match(explorer, /const WORKER_URL = "assets\/record-worker\.js\?v=20260908-display-v3-r3"/);
});

test("top-level and embedding-blocked pages share the v9 visual bundle", () => {
  for (const asset of [
    "assets/tokens.css?v=20260908-v9",
    "assets/styles.css?v=20260908-v9",
    "assets/explorer.css?v=20260908-v9-map-focus-r2"
  ]) {
    assert.ok(html.includes(asset));
    assert.ok(embedded.includes(asset));
  }
  assert.doesNotMatch(embedded, /20260908-v8/);
});

test("worker transport failures retry once on the main thread but validation errors fail closed", () => {
  const parseBody = explorer.slice(
    explorer.indexOf("const startParse ="),
    explorer.indexOf("const prepareWorkspace =")
  );
  const parserErrorBranch = parseBody.slice(
    parseBody.indexOf('if (message.type === "error")'),
    parseBody.indexOf('if (message.type === "success")')
  );

  assert.match(parseBody, /let fallbackAttempted = false/);
  assert.match(parseBody, /if \(finished \|\| fallbackAttempted \|\| !isCurrentRequest\(\)\) return/);
  assert.match(parseBody, /catch \(_\) \{\s*void retryOnMainThread\("เบราว์เซอร์เปิดตัวอ่านแบบแยกงานไม่ได้"\)/);
  assert.match(parseBody, /addEventListener\("error",[\s\S]*?retryOnMainThread\("ตัวอ่านแบบแยกงานหยุดก่อนตรวจเสร็จ"\)/);
  assert.match(parseBody, /addEventListener\("messageerror",[\s\S]*?retryOnMainThread\("เบราว์เซอร์รับผลจากตัวอ่านแบบแยกงานไม่ได้"\)/);
  assert.match(parseBody, /worker\.postMessage[\s\S]*?catch \(_\)[\s\S]*?retryOnMainThread\("เบราว์เซอร์ส่งไฟล์ไปยังตัวอ่านแบบแยกงานไม่ได้"\)/);
  assert.match(parseBody, /csvParser\.parseVerifiedFile\(file,[\s\S]*?mainThreadFallback: true/);
  assert.match(parseBody, /error instanceof csvParser\.CsvValidationError/);
  assert.match(parserErrorBranch, /finishWithError\(message\.error\)/);
  assert.doesNotMatch(parserErrorBranch, /retryOnMainThread/);
});

test("fallback progress and terminal loader errors explain what happened without claiming a bad file", () => {
  assert.match(explorer, /กำลังตรวจไฟล์ด้วยวิธีสำรอง/);
  assert.match(explorer, /ตัวอ่านแบบแยกงานเปิดไม่ได้ · กำลังตรวจไฟล์เดิมในหน้าเว็บนี้/);
  assert.match(explorer, /error\?\.category === "loader"/);
  assert.match(explorer, /ข้อมูลยังไม่ได้ถูกเปิด กรุณารีโหลดหน้าเว็บแล้วเลือกไฟล์เดิมอีกครั้ง/);
});

test("filters cover road, place type, confidence, business presence, and review priority", () => {
  for (const selector of [
    "data-road-filter",
    "data-place-filter",
    "data-confidence-filter",
    "data-business-filter",
    "data-priority-filter"
  ]) {
    assert.match(explorer, new RegExp(`\\[${selector}\\]`));
    assert.match(html, new RegExp(selector));
  }
  assert.match(explorer, /row\.road !== road/);
  assert.match(explorer, /row\.place_type !== placeType/);
  assert.match(explorer, /row\.confidence_band !== confidence/);
  assert.match(explorer, /business === "with-business" && row\.business_count <= 0/);
  assert.match(explorer, /priorityFilter && row\.review_priority !== priorityFilter/);
  assert.match(html, /<option value="สูง" selected>/);
  assert.match(html, /value="far-from-named-soi"/);
  assert.match(html, /value="soi-name-needs-review"/);
  assert.doesNotMatch(html, /value="nearer-to-another-soi"/);
});

test("filtered counters keep coordinate, no-coordinate, business, and review totals live", () => {
  for (const selector of [
    "data-filtered-with-coordinate",
    "data-filtered-without-coordinate",
    "data-filtered-business",
    "data-filtered-review"
  ]) {
    assert.match(explorer, new RegExp(`\\[${selector}\\]`));
  }
  assert.match(explorer, /withCoordinate: 0, withoutCoordinate: 0, withBusiness: 0, inReviewQueue: 0/);
  assert.match(explorer, /filteredStats\.withCoordinate/);
  assert.match(explorer, /filteredStats\.withoutCoordinate/);
});

test("review queue ordering uses supplied priority then descending score", () => {
  assert.match(explorer, /REVIEW_PRIORITY_RANK/);
  assert.match(explorer, /rowSortPriority\(left\) - rowSortPriority\(right\)/);
  assert.match(explorer, /\(right\.review_score \?\? -1\) - \(left\.review_score \?\? -1\)/);
});

test("Street View sends coordinates only, distinguishes source from proposed, and includes heading only when supplied", () => {
  assert.match(explorer, /const hasCoordinateOverride = coordinateOverride !== null/);
  assert.match(explorer, /const lat = hasCoordinateOverride \? coordinateOverride\?\.lat : row\?\.lat/);
  assert.match(explorer, /const lon = hasCoordinateOverride \? coordinateOverride\?\.lon : row\?\.lon/);
  assert.match(explorer, /const heading = !hasCoordinateOverride && Number\.isFinite\(row\.frontage_heading\)[\s\S]*?\? `&heading=\$\{Number\(row\.frontage_heading\)\}`[\s\S]*?: ""/);
  assert.doesNotMatch(explorer, /coordinateOverride\?\.(?:lat|lon) \?\?/);
  assert.match(explorer, /map_action=pano&viewpoint=\$\{viewpoint\}\$\{heading\}&pitch=0&fov=80/);
  assert.match(explorer, /maps\/search\/\?api=1&query=\$\{Number\(lat\)\.toFixed\(7\)\},\$\{Number\(lon\)\.toFixed\(7\)\}/);
  assert.doesNotMatch(explorer, /maps[^\n]*house_reg_id/);
  assert.match(explorer, /streetViewAction\.href = streetViewUrl/);
  assert.match(explorer, /streetViewAction\.rel = "noopener noreferrer"/);
  assert.match(explorer, /satelliteAction\.dataset\.satelliteIndex/);
  assert.match(explorer, /setBasemap\("satellite"\)/);
});

test("every review flag has a safe Thai label and unknown flags never render raw", () => {
  for (const flag of [
    "building_register_multi_site",
    "far_from_named_soi",
    "soi_name_needs_review",
    "far_from_road",
    "large_parcel",
    "anchor_contradicted",
    "outside_community_polygon",
    "neighbours_other_community",
    "estate_outlier",
    "owner_multi_parcel",
    "frontage_road_by_name",
    "frontage_none",
    "frontage_no_road",
    "frontage_off_parcel",
    "community_conflict",
    "community_conflict_reestimated",
    "condo_unit"
  ]) {
    assert.match(explorer, new RegExp(`${flag}: "[^"_]+"`));
  }
  assert.match(explorer, /FLAG_LABELS\[key\] \|\| "มีเหตุให้ตรวจสอบตำแหน่งเพิ่มเติม"/);
  assert.doesNotMatch(explorer, /FLAG_LABELS\[key\] \|\| key/);
});

test("point-adjustment workflow keeps source rows immutable and exports only audited patch rows", () => {
  for (const selector of [
    "data-adjustment-guidance",
    "data-start-adjustment",
    "data-place-adjustment",
    "data-adjustment-lat",
    "data-adjustment-lon",
    "data-nudge-direction",
    "data-adjustment-reason",
    "data-adjustment-source",
    "data-adjustment-observed-at",
    "data-adjustment-reference",
    "data-adjustment-reviewer",
    "data-adjustment-note",
    "data-save-adjustment",
    "data-undo-adjustment",
    "data-reset-adjustment",
    "data-export-adjustments"
  ]) {
    assert.match(html, new RegExp(selector));
  }
  assert.match(html, /coordinate-adjustment\.js\?v=20260908-display-v3/);
  assert.match(explorer, /adjustments: new Map\(\)/);
  assert.match(explorer, /adjustmentWorking: new Map\(\)/);
  assert.match(explorer, /state\.adjustments\.set\(adjustmentKey\(row\)/);
  assert.doesNotMatch(explorer, /row\.(?:lat|lon)\s*=(?!=)/);
  assert.match(explorer, /const sourceRows = Object\.freeze\(rows\.map\(\(row\) => Object\.freeze\(\{ \.\.\.row \}\)\)\)/);
  assert.match(explorer, /state\.rows = sourceRows/);
  assert.match(explorer, /"draft-unverified"/);
  assert.match(explorer, /source_sha256/);
  assert.match(explorer, /buildAdjustmentExport/);
  assert.match(explorer, /state\.adjustments\.values\(\)/);
  assert.match(adjustment, /source_lat/);
  assert.match(adjustment, /proposed_lat/);
  assert.match(adjustment, /source_pipeline_run_id/);
  assert.doesNotMatch(adjustment, /localStorage|sessionStorage|indexedDB/);
});

test("point-adjustment integration fails closed for incomplete coordinates and incomplete runtime", () => {
  assert.match(explorer, /const latText = elements\.adjustmentLat\.value\.trim\(\)/);
  assert.match(explorer, /const lonText = elements\.adjustmentLon\.value\.trim\(\)/);
  assert.match(explorer, /if \(!latText \|\| !lonText\)/);
  assert.match(explorer, /if \(!syncCoordinateInputs\(\)\) return/);
  assert.doesNotMatch(explorer, /Number\(elements\.adjustment(?:Lat|Lon)\?\.value\)/);

  for (const method of [
    "classifyEligibility",
    "distanceMeters",
    "nudgeCoordinate",
    "validateAdjustment",
    "buildAdjustmentExport"
  ]) {
    assert.match(explorer, new RegExp(`"${method}"`));
  }
  assert.match(explorer, /const adjustmentUiReady = Boolean/);
  assert.match(explorer, /adjustmentControls\.forEach\(\(control\) => \{ control\.disabled = true; \}\)/);
  assert.ok((explorer.match(/if \(!adjustmentUiReady\)/g) || []).length >= 6);
  assert.doesNotMatch(explorer, /const latDelta = metres \/ 111320/);
});

test("dirty adjustment state cannot be exported as an older saved snapshot", () => {
  assert.match(explorer, /const dirtyAdjustmentCount = \(\) =>/);
  assert.match(explorer, /elements\.exportAdjustments\.disabled = !adjustmentUiReady \|\| state\.adjustments\.size === 0 \|\| dirtyCount > 0/);
  const exportBody = explorer.slice(
    explorer.indexOf("const exportAdjustments ="),
    explorer.indexOf("const exportReviews =")
  );
  assert.match(exportBody, /const dirtyCount = dirtyAdjustmentCount\(\)/);
  assert.match(exportBody, /if \(dirtyCount > 0\)[\s\S]*?return;/);
  assert.ok(exportBody.indexOf("if (dirtyCount > 0)") < exportBody.indexOf("window.confirm"));
  assert.match(explorer, /working\.saved = false;[\s\S]*?updateReviewSummary\(\);/);
  assert.match(explorer, /มีจุดเสนอที่แก้ค้างและยังไม่เก็บ/);
});

test("saved baselines survive undo and stable row keys are never shortened", () => {
  assert.match(explorer, /const adjustmentKey = \(row\) => String\(row\?\.house_reg_id \?\? ""\)\.trim\(\)/);
  assert.doesNotMatch(explorer, /adjustmentKey = [^\n]*clean\([^\n]*160/);
  assert.match(explorer, /if \(!key \|\| nextRowIndexById\.has\(key\)\)/);
  assert.match(explorer, /if \(!Number\.isInteger\(sourceIndex\)\) throw new Error\("source row unavailable"\)/);

  const undoBody = explorer.slice(
    explorer.indexOf("const undoAdjustment ="),
    explorer.indexOf("const resetAdjustment =")
  );
  assert.match(undoBody, /const saved = state\.adjustments\.get\(key\)/);
  assert.match(undoBody, /working\.saved = adjustmentMatchesSaved\(working, saved\)/);
  assert.doesNotMatch(undoBody, /state\.adjustments\.delete/);
});

test("dataset replacement protects all draft state and swaps only verified frozen rows", () => {
  assert.match(explorer, /const hasDatasetDraftState = \(\) => Boolean\([\s\S]*?state\.adjustmentWorking\.size/);
  const parseBody = explorer.slice(
    explorer.indexOf("const startParse ="),
    explorer.indexOf("const prepareWorkspace =")
  );
  assert.ok(parseBody.indexOf("hasDatasetDraftState()") < parseBody.indexOf("new Worker"));
  const prepareBody = explorer.slice(
    explorer.indexOf("const prepareWorkspace ="),
    explorer.indexOf("const applyFilters =")
  );
  assert.ok(prepareBody.indexOf("clearDatasetDraftState()") < prepareBody.indexOf("state.rows = sourceRows"));
  assert.match(explorer, /if \(hasDatasetDraftState\(\) && !window\.confirm/);
});

test("nudge input and adjustment field limits are validated at the integration boundary", () => {
  const nudgeBody = explorer.slice(
    explorer.indexOf("const nudgeAdjustment ="),
    explorer.indexOf("const syncCoordinateInputs =")
  );
  assert.match(nudgeBody, /const rawMetres = elements\.nudgeDistance\.value\.trim\(\)/);
  assert.match(nudgeBody, /!elements\.nudgeDistance\.checkValidity\(\)/);
  assert.match(nudgeBody, /metres < 0\.1 \|\| metres > 1000/);
  assert.match(nudgeBody, /try \{[\s\S]*?adjustmentTools\.nudgeCoordinate/);
  assert.match(nudgeBody, /catch \(_\) \{[\s\S]*?return;/);

  assert.match(explorer, /elements\.adjustmentReference\.maxLength = 240/);
  assert.match(explorer, /elements\.adjustmentReviewer\.maxLength = 64/);
  assert.match(html, /maxlength="64"[^>]*data-adjustment-reviewer/);
  assert.match(html, /maxlength="240"[^>]*data-adjustment-reference/);
  assert.match(html, /minlength="5" maxlength="500"[^>]*data-adjustment-note/);
  assert.match(explorer, /working\.evidenceReference = clean\([^\n]*, 240\)/);
  assert.match(explorer, /working\.reviewerCode = clean\([^\n]*, 64\)/);
  assert.match(explorer, /working\.reasonNote = clean\([^\n]*, 500\)/);
});

test("missing-coordinate reset language never claims there is a source point", () => {
  assert.match(explorer, /elements\.resetAdjustment\.textContent = hasSource \? "กลับจุดต้นทาง" : "ล้างจุดเสนอ"/);
  assert.match(explorer, /รายการต้นทางจะยังคงไม่มีพิกัด/);
  assert.match(explorer, /"ล้างจุดเสนอแล้ว รายการต้นทางยังไม่มีพิกัด"/);
});

test("point adjustment provides drag-independent controls and visible source/proposed layers", () => {
  for (const direction of ["north", "south", "east", "west"]) {
    assert.match(html, new RegExp(`data-nudge-direction="${direction}"`));
  }
  assert.match(explorer, /draggable: state\.adjustmentMode !== "select"/);
  assert.match(explorer, /state\.adjustmentMode === "place"/);
  assert.match(explorer, /coordinate-adjustment-source-marker/);
  assert.match(explorer, /coordinate-adjustment-proposed-marker/);
  assert.match(explorer, /coordinate-adjustment-connector/);
  assert.match(explorer, /event\.key !== "Escape"/);
  assert.match(css, /\.coordinate-adjustment-source-marker/);
  assert.match(css, /\.coordinate-adjustment-proposed-marker/);
  assert.match(css, /\.coordinate-adjustment-connector/);
});

test("map colors encode confidence and large uncertainty radii are drawn", () => {
  for (const key of ["a0", "a", "b", "c", "d"]) {
    assert.match(explorer, new RegExp(`: "${key}"`));
  }
  assert.match(explorer, /cssColor\(`--confidence-\$\{key\}`/);
  assert.match(explorer, /row\.radius_m <= 100/);
  assert.match(explorer, /drawUncertaintyCircle/);
  assert.match(explorer, /selected-marker-confidence-\$\{confidenceKey\(row\)\}/);
  assert.match(explorer, /const drawA0Indicator = \(context, row, radius, palette/);
  assert.match(explorer, /confidenceKey\(row\) !== "a0"/);
  assert.match(explorer, /context\.fillStyle = palette\.halo/);
  assert.match(explorer, /context\.strokeStyle = palette\.stroke/);
  assert.match(explorer, /drawA0Indicator\(context, row, radius, palette\)/);
  assert.match(explorer, /const a0Indicator = confidenceKey\(row\) === "a0"/);
  assert.match(explorer, /\$\{shape\}\$\{a0Indicator\}/);
  assert.match(css, /\.selected-marker-confidence-a0 \.selected-marker-core/);
  assert.match(css, /\.selected-marker-confidence-d \.selected-marker-core/);
});

test("map-first mode expands the map without mutating review data and exits safely", () => {
  assert.match(html, /data-workspace data-map-focused="false"/);
  assert.match(html, /<button(?=[^>]*data-map-focus)(?=[^>]*aria-controls="map-panel")(?=[^>]*aria-pressed="false")[^>]*>/);
  assert.match(html, /data-map-focus-label>ดูแผนที่เต็มพื้นที่/);
  assert.match(explorer, /mapFocus: false/);
  assert.match(explorer, /const setMapFocus = \(active, \{ focus = false \} = \{\}\) =>/);
  assert.match(explorer, /elements\.workspace\.dataset\.mapFocused = String\(next\)/);
  assert.match(explorer, /pane\.inert = next/);
  assert.match(explorer, /state\.map\?\.invalidateSize\(\)/);
  assert.match(explorer, /updateMapSelection\(false\)/);
  assert.match(explorer, /elements\.mapFocus\?\.addEventListener\("click", \(\) => setMapFocus\(!state\.mapFocus\)\)/);
  assert.match(explorer, /if \(state\.adjustmentMode !== "select"\)[\s\S]*?cancelUnsavedAdjustment\(\);[\s\S]*?if \(state\.mapFocus\)[\s\S]*?setMapFocus\(false, \{ focus: true \}\)/);
  assert.match(explorer, /setMapFocus\(false\);[\s\S]*?showOnly\("gate"\)/);
  assert.doesNotMatch(explorer.slice(explorer.indexOf("const setMapFocus ="), explorer.indexOf("const setMobilePanel =")), /reviews\.(?:clear|set)|adjustments\.(?:clear|set)|setBasemap|toggleSpatialLayer/);
  assert.match(css, /\.review-workspace\[data-map-focused="true"\] \.review-grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.review-workspace\[data-map-focused="true"\] \.queue-pane,[\s\S]*?\.review-workspace\[data-map-focused="true"\] \.detail-pane\s*\{[^}]*display: none/);
});

test("map legend is collapsed by default and opens on demand without blocking the map", () => {
  assert.match(html, /<details class="map-legend" data-map-legend>\s*<summary>สัญลักษณ์แผนที่<\/summary>/);
  assert.doesNotMatch(html, /<details class="map-legend"[^>]*\sopen(?:\s|>)/);
  assert.match(html, /class="map-legend-body" role="note"/);
  assert.match(css, /\.map-legend\s*\{[^}]*pointer-events: auto/);
  assert.match(css, /\.map-legend-body\s*\{[^}]*max-height: min\(50dvh, 420px\)[^}]*overflow-y: auto/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.map-legend\s*\{[^}]*position: static/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.map-legend-body\s*\{[^}]*max-height: none/);
});

test("responsive desktop layout gives the map room before falling back to three columns", () => {
  assert.match(css, /\.review-workspace\s*\{[^}]*max-width: 1800px/);
  assert.match(css, /@media \(max-width: 1600px\)\s*\{[\s\S]*?\.review-grid\s*\{[^}]*grid-template-columns: minmax\(300px, 340px\) minmax\(420px, 1fr\)/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.map-focus-button\s*\{[^}]*display: none/);
});

test("community lines and inferred outer frame are independent, truthful map layers", () => {
  assert.match(html, /data-toggle-community-boundaries[^>]*>แนวชุมชน \(23\)<\/button>/);
  assert.match(html, /data-toggle-inferred-frame[^>]*>กรอบพื้นที่อนุมาน<\/button>/);
  assert.match(html, /<button(?=[^>]*data-toggle-community-boundaries)(?=[^>]*aria-pressed="true")[^>]*>/);
  assert.match(html, /<button(?=[^>]*data-toggle-inferred-frame)(?=[^>]*aria-pressed="true")[^>]*>/);
  assert.match(html, /ไม่ใช่เขตเทศบาล แนวเขตทางกฎหมาย หรือแนวเขตสิทธิ/);
  assert.doesNotMatch(html, /data-toggle-boundaries/);

  for (const stateName of [
    "communityBoundaries",
    "communityBoundaryLayer",
    "communityBoundariesVisible",
    "inferredOuterFrame",
    "inferredFrameLayer",
    "inferredFrameVisible"
  ]) {
    assert.match(explorer, new RegExp(`${stateName}:`));
  }
  assert.match(explorer, /for \(const feature of state\.communityBoundaries\.features\)/);
  assert.doesNotMatch(explorer, /for \(const feature of state\.inferredOuterFrame\.features\)/);
  assert.match(explorer, /saensuk-community-outer-frame\.geojson/);
  assert.match(explorer, /properties\.name !== "กรอบพื้นที่อนุมานจากขอบนอก 23 ชุมชน"/);
  assert.match(explorer, /properties\.role !== "inferred_outer_frame"/);
  assert.match(explorer, /properties\.source_features !== 23/);
  assert.match(explorer, /propertyKeys !== "name,role,source_features"/);
  assert.match(explorer, /geometry\?\.type !== "Polygon"/);
  assert.match(explorer, /geometry\.coordinates\?\.length !== 1/);
  assert.match(explorer, /ring\.length !== 528/);
  assert.match(explorer, /\[100\.8974531,13\.2383789,100\.9643072,13\.3175765\]/);
  assert.match(explorer, /Promise\.allSettled/);

  assert.match(explorer, /pane: "inferred-frame-pane",\s*interactive: false/);
  assert.match(explorer, /pane: "community-boundary-pane",\s*interactive: true/);
  assert.match(explorer, /const communityBoundaryStyle = \(\) => \(\{[\s\S]*?weight: 1\.75,[\s\S]*?dashArray: "7 5"/);
  assert.match(explorer, /const inferredFrameStyle = \(\) => \(\{[\s\S]*?weight: 4,[\s\S]*?fill: false/);
  assert.match(explorer, /const fitSpatialContextOnce/);
  assert.match(explorer, /inferredBounds\?\.isValid\(\)[\s\S]*?communityBounds\?\.isValid\(\)/);
  assert.match(explorer, /state\.initialSpatialFitDone = true/);
  assert.match(explorer, /state\.communityBoundaryLayer\?\.setStyle\(communityBoundaryStyle\)/);
  assert.match(explorer, /state\.inferredFrameLayer\?\.setStyle\(inferredFrameStyle\)/);

  assert.match(css, /\.boundary-line-community\s*\{[^}]*border-top: 2px dashed var\(--map-active\)/);
  assert.match(css, /\.boundary-line-inferred\s*\{[^}]*border-top: 4px solid var\(--map-selected\)/);
  assert.doesNotMatch(css, /\.boundary-line-(?:community|inferred)\s*\{[^}]*#[0-9a-f]{3,8}/i);
});

test("detail copy translates methods, hides technical codes, and describes business source rows accurately", () => {
  for (const method of [
    "A0", "A1", "A2", "B2", "B3", "B4", "B5", "B6", "B7",
    "C1", "C2", "C3", "C4", "C5", "E1", "E2a", "E2b", "E3",
    "I1", "I2", "S", "K", "BL1", "desk-lookup", "condo-pending"
  ]) {
    assert.ok(
      explorer.includes(`${method}: "`) || explorer.includes(`"${method}": "`),
      `missing Thai reader label for method ${method}`
    );
  }
  assert.doesNotMatch(explorer, /appendChip\(`Tier /);
  assert.doesNotMatch(explorer, /appendField\("รหัสชั้นข้อมูล"/);
  assert.doesNotMatch(explorer, /appendField\("รหัสวิธี"/);
  assert.match(explorer, /appendField\("วิธีได้ตำแหน่ง", methodLabel\(row\.method\)\)/);
  assert.match(explorer, /METHOD_LABELS\[value\] \|\| "ประมาณจากข้อมูลต้นทางและบริบทพื้นที่"/);
  assert.match(explorer, /const remaining = Math\.max\(0, names\.length - 3\)/);
  assert.doesNotMatch(explorer, /Number\(row\.business_count[^\n]*- 3/);
  assert.match(explorer, /รายชื่อกิจการที่ปรากฏในข้อมูล/);
  assert.match(explorer, /จำนวนรายการทะเบียนกิจการจากต้นทาง/);
  assert.match(explorer, /บ้านที่มีข้อมูลทะเบียนกิจการ/);
});

test("draft export preserves display provenance without storing data in browser storage", () => {
  for (const header of [
    "confidence_band",
    "frontage_heading",
    "business_names",
    "source_review_flags",
    "pipeline_run_id",
    "dataset_contract",
    "streetview_url",
    "google_maps_url",
    "source_sha256"
  ]) {
    assert.match(explorer, new RegExp(`"${header}"`));
  }
  assert.match(explorer, /"draft-unverified"/);
  assert.doesNotMatch(explorer, /localStorage|sessionStorage|indexedDB/);
  assert.match(explorer, /if \(\/\^\\s\*\[=\+\\-@\]\//);
});
