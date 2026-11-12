"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { validatePublicSnapshot, publicEvidenceRank, isPublicParcelFallback, publicDisplayPoint, matchesPublicPreset, matchesPublicSearch, PUBLIC_PRESETS } = require("../assets/record-explorer.js");

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
    (data) => { data.records[0].building_id = "not allowed"; },
    (data) => { data.records[0].house_no = "not allowed"; },
    (data) => { data.records.find((row) => row.candidate).candidate.parcel_id = "not allowed"; }
  ]) {
    const data = clone();
    inject(data);
    assert.throws(() => validatePublicSnapshot(data), /ชุดข้อมูลสาธารณะ/);
  }
});

test("public registry codes retain exact source grammar and uniqueness", () => {
  assert.equal(new Set(snapshot.records.map((row) => row.house_reg_id)).size, 42524);
  for (const change of [
    (data) => { data.records[0].house_reg_id = "00010023456"; },
    (data) => { data.records[0].house_reg_id = "PRIVATE PERSON"; },
    (data) => { data.records[0].house_reg_id = data.records[1].house_reg_id; }
  ]) {
    const data = clone();
    change(data);
    assert.throws(() => validatePublicSnapshot(data));
  }
});

test("registry searches accept exact formatted, compact and Thai-digit codes with leading zeros", () => {
  const row = { public_id: "P000001", house_reg_id: "0001-002345-6", house_no: "657", road: "ถนน สุขุมวิท", community: "ชุมชน แสนสุข" };
  for (const query of ["0001-002345-6", "00010023456", "๐๐๐๑๐๐๒๓๔๕๖", "00010023456 สุขุมวิท", "สุขุมวิท 00010023456"]) {
    assert.equal(matchesPublicSearch(row, query), true, query);
  }
  assert.equal(matchesPublicSearch(row, "00010023457"), false);
  assert.equal(matchesPublicSearch(row, "00010023456 บางแสน"), false);
  const first = snapshot.records[0];
  assert.deepEqual(snapshot.records.filter((record) => matchesPublicSearch(record, first.house_reg_id.replace(/-/gu, ""))).map((record) => record.public_id), [first.public_id]);
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

test("public presets isolate the 34 working fallbacks, four newly displayed records and 36 comparison-only candidates", () => {
  const original = JSON.stringify(snapshot.records);
  const expectedCounts = { all: 42524, "strong-source": 12713, candidates: 70, "working-fallback": 34, "new-position": 4, "comparison-only": 36, "no-conflict": 68, conflict: 2 };
  assert.deepEqual(PUBLIC_PRESETS, Object.keys(expectedCounts));
  for (const [preset, count] of Object.entries(expectedCounts)) {
    assert.equal(snapshot.records.filter((row) => matchesPublicPreset(row, preset)).length, count, preset);
  }
  const working = snapshot.records.filter((row) => matchesPublicPreset(row, "working-fallback"));
  const comparisonOnly = snapshot.records.filter((row) => matchesPublicPreset(row, "comparison-only"));
  assert.equal(new Set([...working, ...comparisonOnly].map((row) => row.public_id)).size, 70);
  assert.ok(working.every((row) => !matchesPublicPreset(row, "comparison-only")));
  const newPositions = snapshot.records.filter((row) => matchesPublicPreset(row, "new-position"));
  assert.ok(newPositions.every((row) => /^C/u.test(row.tier) && row.lat === null && row.lon === null && isPublicParcelFallback(row)));
  assert.ok(comparisonOnly.every((row) => row.candidate && !isPublicParcelFallback(row)));
  assert.equal(snapshot.records.filter((row) => matchesPublicPreset(row, "unrecognized-preset")).length, 0);
  assert.equal(JSON.stringify(snapshot.records), original);
});

test("numeric public searches match the complete house number rather than display IDs or numeric substrings", () => {
  const original = JSON.stringify(snapshot.records);
  const expected = snapshot.records.filter((row) => row.house_no === "657");
  const actual = snapshot.records.filter((row) => matchesPublicSearch(row, "657"));
  assert.ok(expected.length > 0);
  assert.deepEqual(actual.map((row) => row.public_id), expected.map((row) => row.public_id));
  assert.equal(matchesPublicSearch({ public_id: "P000657", house_no: "127" }, "657"), false);
  assert.equal(matchesPublicSearch({ public_id: "P000001", house_no: "1657" }, "657"), false);
  assert.equal(matchesPublicSearch({ public_id: "P000002", house_no: "6571" }, "657"), false);
  assert.equal(matchesPublicSearch({ public_id: "P000003", house_no: "657/1" }, "657"), false);
  assert.deepEqual(snapshot.records.filter((row) => matchesPublicSearch(row, "๖๕๗")).map((row) => row.public_id), expected.map((row) => row.public_id));
  assert.equal(JSON.stringify(snapshot.records), original);
});

test("public search combines an exact house number with all road words while retaining text and P-ID searches", () => {
  const row = { public_id: "P000657", house_no: "22/9 ก.", road: "ถนน บางแสนสาย 1", community: "ชุมชน แสนสุข", place_type: "บ้าน" };
  assert.equal(matchesPublicSearch(row, "๒๒/๙ ก. บางแสนสาย 1"), true);
  assert.equal(matchesPublicSearch(row, "22/9ก บางแสนสาย"), true);
  assert.equal(matchesPublicSearch(row, "22/9 ก. บางแสนสาย สุขุมวิท"), false);
  assert.equal(matchesPublicSearch(row, "22/9 ข. บางแสนสาย"), false);
  assert.equal(matchesPublicSearch(row, "ถนน บางแสนสาย 1"), true);
  assert.equal(matchesPublicSearch(row, "บางแสนสาย แสนสุข"), true);
  assert.equal(matchesPublicSearch(row, "P000657 แสนสุข"), true);
  assert.equal(matchesPublicSearch(row, "P000657 สุขุมวิท"), false);
  assert.equal(matchesPublicSearch(row, "  "), true);
  assert.equal(matchesPublicSearch({ ...row, house_no: "4//44" }, "4//44"), true);
  assert.equal(matchesPublicSearch({ ...row, house_no: "4//44" }, "4/44"), false);
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
  assert.match(source, /for \(const marker of this\._drawn\) \{\s*\/\/ Public overview[^\n]*\n\s*if \(state\.publicMode\) continue;/);
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
