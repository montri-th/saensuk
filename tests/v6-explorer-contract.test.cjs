"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const explorer = fs.readFileSync(path.join(root, "assets", "record-explorer.js"), "utf8");

test("v6 evidence queue offers the six evidence-backed record counts", () => {
  const expectedOptions = new Map([
    ["tier-a0", "10,114"],
    ["building-register-conflict", "981"],
    ["building-register-multi-site", "3,122"],
    ["far-from-road", "1,494"],
    ["source-needs-review", "2,544"],
    ["no-coordinate", "2,288"]
  ]);

  assert.match(html, /data-evidence-filter/);
  for (const [value, count] of expectedOptions) {
    assert.match(html, new RegExp(`<option value="${value}">[^<]*\\(${count.replace(",", "\\,")}\\)</option>`));
    assert.match(explorer, new RegExp(`filter === "${value}"`));
  }
  assert.match(html, /คิวบางกลุ่มซ้อนกัน/);
});

test("review controls distinguish tab-local drafts and building context", () => {
  assert.match(html, /aria-label="กรองตามร่างที่บันทึกในแท็บนี้"/);
  assert.match(html, />ยังไม่มีร่าง</);
  assert.match(html, />มีร่างในแท็บ</);
  assert.match(html, /value="plate-matches" data-review-scope="house-plate"/);
  assert.match(html, /value="building-context-matches" data-review-scope="building-context"/);
  assert.match(explorer, /row\?\.geom_level === "building"/);
  assert.match(explorer, /allowedReviewResults\(evidenceSource, row\)\.has\(result\)/);
  assert.doesNotMatch(explorer, /REVIEW_RESULTS_BY_SOURCE/);
});

test("v6 warnings and safe parameterized flag labels remain visible", () => {
  assert.match(explorer, /A0 ยังไม่ตรวจหน้างาน/);
  assert.match(explorer, /building_register_conflict: "หลักฐานตำแหน่งขัดกันเกิน 50 ม\."/);
  assert.match(explorer, /building_register_multi_site: "บ้านเลขที่–ถนนชี้ได้หลายไซต์"/);
  assert.match(explorer, /far_from_road: "จุดห่างโครงข่ายถนนเกิน 50 ม\."/);
  assert.match(explorer, /citymeter_name_matches_ltax_company:/);
  assert.match(explorer, /key === "desk_lookup_project"/);
  assert.match(explorer, /replace\(\/\[\^0-9A-Za-z\._-\]\/g, ""\)/);
});

test("draft export carries v6 provenance, scope, and eligibility-gated official map URLs", () => {
  for (const header of [
    "source_parcel_id",
    "snapshot_release",
    "verification_scope",
    "streetview_url",
    "google_maps_url",
    "source_sha256"
  ]) {
    assert.match(explorer, new RegExp(`"${header}"`));
  }
  assert.match(explorer, /const SNAPSHOT_RELEASE = "v6"/);
  assert.match(explorer, /"draft-unverified"/);
  assert.match(explorer, /externalMapUrl\(row, "streetview"\)/);
  assert.match(explorer, /externalMapUrl\(row, "map"\)/);
  assert.match(explorer, /mode === "streetview" && !streetviewEligibility\(row\)\.allowed/);
  assert.match(explorer, /if \(\/\^\\s\*\[=\+\\-@\]\//);
});
