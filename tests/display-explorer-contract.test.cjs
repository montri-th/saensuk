"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets", "explorer.css"), "utf8");
const explorer = fs.readFileSync(path.join(root, "assets", "record-explorer.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "assets", "record-worker.js"), "utf8");

test("explorer consumes the display-only business, frontage, review, and provenance fields", () => {
  for (const field of [
    "confidence_band",
    "frontage_heading",
    "frontage_road",
    "frontage_road_layer",
    "frontage_road_source",
    "dist_named_soi_m",
    "soi_check",
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
  assert.match(worker, /csv-parser\.js\?v=20260908-display-v2/);
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
  assert.match(html, /value="nearer-to-another-soi"/);
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

test("Street View sends coordinates only and includes heading only when supplied", () => {
  assert.match(explorer, /Number\.isFinite\(row\.frontage_heading\) \? `&heading=\$\{Number\(row\.frontage_heading\)\}` : ""/);
  assert.match(explorer, /map_action=pano&viewpoint=\$\{viewpoint\}\$\{heading\}&pitch=0&fov=80/);
  assert.match(explorer, /maps\/search\/\?api=1&query=\$\{Number\(row\.lat\)\.toFixed\(7\)\},\$\{Number\(row\.lon\)\.toFixed\(7\)\}/);
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
    "nearer_to_another_soi",
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
