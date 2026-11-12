"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateParcelChangeExamples, matchesExampleFilter, matchesExampleSearch, distanceMeters, GROUPS } = require("../assets/parcel-change-examples.js");
const root = path.join(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "assets/data/parcel-code-change-examples-ce883c674c76.json"), "utf8"));

test("actual selected examples validate without changing records or historical point evidence", () => {
  const original = JSON.stringify(data);
  assert.equal(validateParcelChangeExamples(data), data);
  assert.equal(data.records.length, 40);
  assert.equal(data.summary.changed_parcel_codes, 5069);
  assert.equal(JSON.stringify(data), original);
});

test("both >50m examples remain valid, including the 99.04m historical reference pair", () => {
  const large = data.records.filter((row) => row.group === "large-historical-separation");
  assert.equal(large.length, 2);
  assert.equal(large.find((row) => row.sample_id === "R008").historical_point_separation_m, 99.04);
  for (const row of large) assert.ok(Math.abs(row.historical_point_separation_m - distanceMeters(row.old_ltax_point, row.new_ltax_point)) < 0.01);
  assert.equal(validateParcelChangeExamples(data), data);
});

test("strict example schema rejects private identifiers and unreviewed free text", () => {
  for (const alter of [
    (d) => { d.owner = "private"; },
    (d) => { d.records[0].house_reg_id = "1111-222222-3"; },
    (d) => { d.records[0].house_no_before = "1111-222222-3"; },
    (d) => { d.records[0].house_no_after = "0812345678"; },
    (d) => { d.records[0].house_no_after = "PRIVATE PERSON"; },
    (d) => { d.records[0].road_after = "PRIVATE ADDRESS"; },
    (d) => { d.records[0].new_parcel_code = "<script>"; },
    (d) => { d.records.find((r) => r.old_ltax_point).old_ltax_point.owner = "private"; }
  ]) {
    const changed = structuredClone(data);
    alter(changed);
    assert.throws(() => validateParcelChangeExamples(changed));
  }
});

test("missing or excluded historical coordinates cannot become invented points or distances", () => {
  for (const alter of [
    (d) => { d.records[0].new_ltax_point = { lat: 0, lon: 0 }; },
    (d) => { d.records[0].new_ltax_point = { lat: 13.2, lon: 100.9 }; },
    (d) => { d.records[0].historical_point_separation_m = 0; },
    (d) => { d.records.find((r) => r.old_ltax_point).old_ltax_point.lat = 16.45; },
    (d) => { d.records.find((r) => r.old_ltax_point).old_ltax_status = "point-outside-geometry"; },
    (d) => { d.records.find((r) => r.new_ltax_point && r.old_ltax_point).historical_point_separation_m += 100; }
  ]) {
    const changed = structuredClone(data);
    alter(changed);
    assert.throws(() => validateParcelChangeExamples(changed));
  }
});

test("summary group counts, source dates and address-change flags cannot diverge from examples", () => {
  for (const alter of [
    (d) => { d.release_id = "unreviewed-release"; },
    (d) => { d.summary.changed_parcel_codes = 5070; },
    (d) => { d.summary.example_count += 1; },
    (d) => { d.summary.example_groups[GROUPS[0]] += 1; },
    (d) => { d.summary.new_ltax_status_counts["code-not-found"] += 1; },
    (d) => { d.records[0].address_changed = !d.records[0].address_changed; },
    (d) => { d.records[0].sample_id = "R999"; }
  ]) {
    const changed = structuredClone(data);
    alter(changed);
    assert.throws(() => validateParcelChangeExamples(changed));
  }
});

test("current-code filters partition all selected examples independently of whether their points are usable", () => {
  const found = data.records.filter((r) => matchesExampleFilter(r, "current-code-found"));
  const missing = data.records.filter((r) => matchesExampleFilter(r, "current-code-missing"));
  assert.equal(found.length + missing.length, 40);
  assert.equal(new Set([...found, ...missing].map((r) => r.sample_id)).size, 40);
  assert.ok(found.every((r) => r.new_ltax_status !== "code-not-found"));
  assert.ok(missing.every((r) => r.new_ltax_status === "code-not-found"));
  assert.ok(data.records.filter((r) => matchesExampleFilter(r, "address-changed")).every((r) => r.address_changed));
  assert.ok(data.records.filter((r) => matchesExampleFilter(r, "both-points")).every((r) => r.old_ltax_point && r.new_ltax_point));
  assert.equal(matchesExampleFilter(data.records[0], "unknown"), false);
});

test("example searches support parcel-code tokens and exact house numbers without numeric substring leakage", () => {
  const row = { sample_id: "R001", old_parcel_code: "12A657", new_parcel_code: "12B657", house_no_before: "127", house_no_after: "1657", road_before: "ถนน แสนสุข", road_after: "ถนน แสนสุข" };
  assert.equal(matchesExampleSearch(row, "657"), false);
  assert.equal(matchesExampleSearch({ ...row, house_no_after: "657" }, "๖๕๗ แสนสุข"), true);
  assert.equal(matchesExampleSearch(row, "12A657 12B657"), true);
  assert.equal(matchesExampleSearch(row, "12B657 สุขุมวิท"), false);
  assert.equal(matchesExampleSearch(row, "R001 แสนสุข"), true);
  assert.equal(matchesExampleSearch(row, ""), true);
});
