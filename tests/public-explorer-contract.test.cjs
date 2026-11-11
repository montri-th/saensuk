"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { validatePublicSnapshot, publicEvidenceRank, isPublicParcelFallback, publicDisplayPoint } = require("../assets/record-explorer.js");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "governance", "public-data-release.json"), "utf8"));
const snapshot = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, manifest.public_asset.path))));
const source = fs.readFileSync(path.join(root, "assets", "record-explorer.js"), "utf8");
const clone = () => structuredClone(snapshot);

test("public explorer validates the complete public snapshot without mutating source values", () => {
  const first = snapshot.records[0];
  const initial = JSON.stringify(first);
  assert.equal(validatePublicSnapshot(snapshot), snapshot);
  assert.equal(JSON.stringify(first), initial);
  assert.equal(snapshot.records.filter((row) => row.candidate).length, 70);
});

test("public explorer rejects unexpected fields at every disclosure boundary", () => {
  for (const inject of [
    (data) => { data.owner = "not allowed"; },
    (data) => { data.records[0].house_reg_id = "not allowed"; },
    (data) => { data.records[0].house_no = "not allowed"; },
    (data) => { data.records.find((row) => row.candidate).candidate.parcel_id = "not allowed"; }
  ]) {
    const data = clone();
    inject(data);
    assert.throws(() => validatePublicSnapshot(data), /ชุดข้อมูลสาธารณะ/);
  }
});

test("public explorer rejects invalid coordinates, partial missingness and changed source bands", () => {
  for (const change of [
    (data) => { data.records[0].lat = NaN; },
    (data) => { data.records[0].lon = null; },
    (data) => { data.records[0].tier = "verified"; },
    (data) => { data.records[0].public_id = "P999999"; }
  ]) {
    const data = clone();
    change(data);
    assert.throws(() => validatePublicSnapshot(data));
  }
});

test("public explorer rejects changed candidate counts, conflict flags and unsubstantiated shift distances", () => {
  for (const change of [
    (data) => { data.records.find((row) => row.candidate).candidate = null; },
    (data) => { data.records.find((row) => row.candidate?.conflict).candidate.conflict = false; },
    (data) => { data.records.find((row) => row.candidate?.shift_m > 0).candidate.shift_m = 0; },
    (data) => { data.records.find((row) => row.candidate && row.lat === null).candidate.shift_m = 0; }
  ]) {
    const data = clone();
    change(data);
    assert.throws(() => validatePublicSnapshot(data));
  }
});

test("public explorer rejects changed release, source date and aggregate claims", () => {
  for (const change of [
    (data) => { data.release_id = "different"; },
    (data) => { data.snapshot.source_date = "2026-11-11"; },
    (data) => { data.summary.with_coordinates += 1; },
    (data) => { data.summary.confidence_counts.D -= 1; }
  ]) {
    const data = clone();
    change(data);
    assert.throws(() => validatePublicSnapshot(data));
  }
});

test("automatic loading pins compressed bytes before decoding and validating disclosure schema", () => {
  const loader = source.slice(source.indexOf("const loadPublicSnapshot ="), source.indexOf("const applyFilters ="));
  assert.match(loader, /credentials: "omit", redirect: "error"/);
  assert.match(loader, /response\.status !== 200/);
  assert.match(loader, /hash !== PUBLIC_SNAPSHOT_SHA256/);
  assert.match(loader, /new DecompressionStream\("gzip"\)/);
  assert.ok(loader.indexOf("hash !== PUBLIC_SNAPSHOT_SHA256") < loader.indexOf("new DecompressionStream"));
  assert.match(loader, /CityChatPublicSnapshot\.validatePublicSnapshot/);
  assert.match(source, /if \(PUBLIC_SNAPSHOT_URL\) void loadPublicSnapshot\(\)/);
  assert.match(loader, /state\.publicFilter = "all"/);
  assert.doesNotMatch(source, /state\.publicFilter = "candidates"/);
});

test("public initial all-points view prioritizes source evidence without upgrading rows", () => {
  const original = JSON.stringify(snapshot.records[0]);
  const ordered = [...snapshot.records].sort((left, right) => publicEvidenceRank(left) - publicEvidenceRank(right));
  assert.equal(ordered.length, 42524);
  assert.equal(ordered[0].tier, "A0");
  assert.equal(ordered[10113].tier, "A0");
  assert.equal(ordered.filter((row) => publicEvidenceRank(row) <= 2).length, 12713);
  assert.equal(ordered[12713].tier, "D");
  assert.match(ordered.at(-1).tier, /^C/u);
  assert.equal(JSON.stringify(snapshot.records[0]), original);
  assert.match(source, /if \(publicMode\) return publicEvidenceRank\(left\) - publicEvidenceRank\(right\)/);
  assert.match(source, /if \(publicMode\) setMobilePanel\("map", \{ focus: false \}\)/);
  assert.match(source, /publicEvidenceRank\(state\.rows\[right\.indices\[0\]\]\) - publicEvidenceRank\(state\.rows\[left\.indices\[0\]\]\)/);
  assert.match(source, /เดิมไม่ระบุแปลง 68/);
  assert.doesNotMatch(source, /ยังไม่พบข้อขัดแย้งกับรหัสแปลงเดิม/);
});

test("working display uses only the 34 conservative parcel fallbacks and preserves every source field", () => {
  const original = JSON.stringify(snapshot.records);
  const fallbackRows = snapshot.records.filter(isPublicParcelFallback);
  assert.equal(fallbackRows.length, 34);
  assert.equal(fallbackRows.filter((row) => row.tier === "D").length, 30);
  assert.equal(fallbackRows.filter((row) => row.tier.startsWith("C")).length, 4);
  assert.equal(snapshot.records.filter((row) => publicDisplayPoint(row)).length, 40240);
  for (const row of snapshot.records) {
    const display = publicDisplayPoint(row);
    if (isPublicParcelFallback(row)) {
      assert.deepEqual(display, { lat: row.candidate.lat, lon: row.candidate.lon, parcelFallback: true });
      assert.equal(row.candidate.conflict || row.candidate.auxiliary || row.candidate.nonresidential, false);
    } else if (row.lat !== null) {
      assert.deepEqual(display, { lat: row.lat, lon: row.lon, parcelFallback: false });
    } else assert.equal(display, null);
  }
  assert.equal(JSON.stringify(snapshot.records), original);
  assert.match(source, /ระดับแปลงสำรอง—ยังไม่ยืนยัน/);
  assert.match(source, /layoutGroups\(this\._indices, state\.mapRows\)/);
  assert.match(source, /if \(state\.publicMode && isPublicParcelFallback\(row\)\) continue/);
});

test("fallback excludes conflict, nonresidential, auxiliary, long or out-of-radius shifts and stronger tiers", () => {
  const base = structuredClone(snapshot.records.find((row) => row.tier === "D" && isPublicParcelFallback(row)));
  for (const change of [
    (row) => { row.candidate.conflict = true; },
    (row) => { row.candidate.auxiliary = true; },
    (row) => { row.candidate.nonresidential = true; },
    (row) => { row.candidate.shift_m = 501; },
    (row) => { row.candidate.shift_m = row.radius_m + 1; },
    (row) => { row.radius_m = null; },
    (row) => { row.radius_m = 0; },
    (row) => { row.tier = "A0"; },
    (row) => { row.tier = "B2"; }
  ]) {
    const row = structuredClone(base);
    change(row);
    assert.equal(isPublicParcelFallback(row), false);
    assert.deepEqual(publicDisplayPoint(row), { lat: base.lat, lon: base.lon, parcelFallback: false });
  }
});

test("confidence map colors stay opaque and uncertainty circles do not tint the fill", () => {
  const uncertainty = source.slice(source.indexOf("const drawUncertaintyCircle ="), source.indexOf("const clusterLabel ="));
  assert.doesNotMatch(uncertainty, /globalAlpha|\.fill\(/);
  assert.match(uncertainty, /strokeStyle = pointColor\(row\)/);
  assert.match(uncertainty, /setLineDash\(\[\]\)/);
  const selection = source.slice(source.indexOf("const updateMapSelection ="), source.indexOf("const selectMapPoint ="));
  assert.doesNotMatch(selection, /fillOpacity: 0\.|opacity: candidate/);
  assert.match(selection, /radius: row\.radius_m,[\s\S]*?opacity: 1,[\s\S]*?fill: false/);
  const candidates = source.slice(source.indexOf("const renderPublicCandidateLayer ="), source.indexOf("const loadPublicSnapshot ="));
  assert.match(candidates, /fillOpacity: 1/);
  assert.match(candidates, /dashArray: "3 3"/);
});

test("public mode separates read-only candidate comparisons from source edits and private exports", () => {
  assert.match(source, /if \(state\.publicMode\) return row\?\.candidate \|\| null/);
  assert.match(source, /candidate: row\.candidate \? Object\.freeze\(\{ \.\.\.row\.candidate \}\) : null/);
  for (const name of ["beginAdjustment", "activateAdjustmentPlacement", "exportAdjustments", "exportReviews"]) {
    const body = source.slice(source.indexOf(`const ${name} =`), source.indexOf(`const ${name} =`) + 180);
    assert.match(body, /if \(state\.publicMode\) return/);
  }
  assert.match(source, /draggable: !state\.publicMode && state\.adjustmentMode !== "select"/);
  assert.match(source, /row\.candidate\.conflict \? "แปลงขัดกับเดิม—พักไว้"/);
  assert.match(source, /ระยะย้ายไม่ใช่ค่าความแม่นยำ/);
});
