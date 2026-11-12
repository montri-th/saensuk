"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "governance", "public-data-release.json"), "utf8"));
const assetBytes = fs.readFileSync(path.join(root, manifest.public_asset.path));
const decodedBytes = zlib.gunzipSync(assetBytes);
const snapshot = JSON.parse(decodedBytes.toString("utf8"));
const expectedRowKeys = ["public_id", "house_reg_id", "house_no", "road", "community", "place_type", "lat", "lon", "radius_m", "tier", "confidence_band", "status", "geom_level", "candidate"].sort();
const expectedCandidateKeys = ["lat", "lon", "shift_m", "conflict", "auxiliary", "nonresidential"].sort();
const roads = new Set(["ถนน บางแสนสาย 2", "ถนน ลงหาดบางแสน", "ถนน สุขุมวิท", "ถนน แสนสุข", "ถนน บางแสนสาย 4 ใต้", "ถนน สันติเกษม", "ถนน บางแสนล่าง", "ถนน เนตรดี", "ถนน รอบเขาสามมุข", "ถนน มิตรสัมพันธ์", "ถนน บางแสน-อ่างศิลา", "ถนน บางแสนสาย 3", "ถนน บางแสนสาย 1", "ถนน เปรมใจราษฎร์", "ถนน มาบมะยม", "ถนน หลังวัดกลางดอน", "ถนน บางแสนสาย 4 เหนือ", "ถนน ข้าวหลาม", "ถนน เทศบาลพัฒนา 1", "ถนน เทศบาลพัฒนา 2"]);
const communities = new Set(["ชุมชน สมใจนึก", "ชุมชน หน้ามอโชคดี", "ชุมชน วัดแสนสุข", "ชุมชน บางแสนบน", "ชุมชน หาดวอนนภา", "ชุมชน ตาลล้อม 2", "ชุมชน ดอนบน", "ชุมชน มณีแก้ว", "ชุมชน ร่วมใจพัฒนา", "ชุมชน ท้ายตลาด", "ชุมชน บ้านเหมือง", "ชุมชน แสนสุข", "ชุมชน มุขแสนเจริญ", "ชุมชน เขาสามมุข", "ชุมชน วัดกลางดอน", "ชุมชน บางเป้ง", "ชุมชน บ้านแหลมแท่น", "ชุมชน หน้าเทศบาล", "ชุมชน ตาลล้อม 1", "ชุมชน บางแสนทาวเวอร์", "ชุมชน มาบมะยม", "ชุมชน พัฒนา 2", "ชุมชน ดอนนารา"]);
const placeTypes = new Set(["บ้าน", "สถานที่ราชการ", "บ้านพักข้าราชการ", "บ้านแฝด", "สำนักสงฆ์", "วัด", "สำนักงาน", "อาคารชุด", "โรงแรม", "ตึกแถว", "ร้านค้า", "อาคาร", "อื่นๆ", "โรงพยาบาล", "หอพัก", "ทาวน์โฮม", "โกดัง", "ทะเบียนบ้านชั่วคราว", "ตึก", "รัฐวิสาหกิจ", "เรือ", "สถานศึกษา", "ทาวน์เฮ้าส์", "ห้องแถว", "-", "สโมสร", "บริษัท", "โรงงาน", "อาคารอเนกประสงค์", "คลังสินค้า-อยู่อาศัย", "เรือนจำ", "แฟลต"]);
const bands = new Map([
  ["A0 สำรวจสิ่งปลูกสร้างของเทศบาล", ["A0", 10114]],
  ["A จับคู่จากที่อยู่เจ้าของ", ["A", 1855]],
  ["B จับคู่แบบมีเงื่อนไข", ["B", 744]],
  ["C ยังไม่มีพิกัด ต้องตรวจ", ["C", 2288]],
  ["D ค่าประมาณกลุ่ม", ["D", 27523]]
]);

test("public snapshot asset bytes are content-addressed and manifest-bound", () => {
  const hash = crypto.createHash("sha256").update(assetBytes).digest("hex");
  assert.equal(manifest.public_asset.sha256, hash);
  assert.equal(manifest.public_asset.bytes, assetBytes.length);
  assert.equal(manifest.public_asset.path, `assets/data/public-housepoints-${hash.slice(0, 12)}.json.gz`);
  assert.equal(manifest.public_asset.mime_type, "application/gzip");
  assert.equal(manifest.public_asset.stored_compression, "gzip");
  assert.equal(manifest.public_asset.decoded.sha256, crypto.createHash("sha256").update(decodedBytes).digest("hex"));
  assert.equal(manifest.public_asset.decoded.bytes, decodedBytes.length);
  assert.equal(manifest.audience, "public");
  assert.equal(manifest.owner_authorization, "owner-message:2026-11-12:public-house-number-and-house-registry-id-approved");
  assert.equal(manifest.candidate_policy.status, "candidate-unverified");
  assert.equal(manifest.candidate_policy.auto_apply, false);
  assert.equal(manifest.candidate_policy.newly_field_verified, 0);
});

test("public record schema contains only reviewed fields and vocabulary", () => {
  assert.deepEqual(Object.keys(snapshot).sort(), ["schema_version", "release_id", "snapshot", "summary", "records"].sort());
  assert.equal(snapshot.schema_version, "saensuk-public-points-3");
  assert.equal(snapshot.release_id, "public-20261112-registry");
  assert.deepEqual(snapshot.snapshot, { source_date: "2026-09-08", rules: "1.9.0", buildings_received_date: "2026-11-11" });
  for (const [index, record] of snapshot.records.entries()) {
    assert.deepEqual(Object.keys(record).sort(), expectedRowKeys);
    assert.equal(record.public_id, `P${String(index + 1).padStart(6, "0")}`);
    assert.match(record.house_reg_id, /^[0-9]{4}-[0-9]{6}-[0-9]$/u);
    assert.match(record.house_no, /^[0-9]{1,6}(?:\/{1,2}[0-9]{1,6})?(?: ?[ก-ฮ]\.?)?$/u);
    assert.equal(roads.has(record.road), true);
    assert.equal(communities.has(record.community), true);
    assert.equal(placeTypes.has(record.place_type), true);
    assert.equal(bands.has(record.confidence_band), true);
    assert.equal(["A0", "A1", "A2", "B2", "B3", "B4", "B5", "B6", "B7", "C1", "C2", "C3", "C4", "C5", "D"].includes(record.tier), true);
    assert.equal(["prototype-unverified", "needs-review", "approximate-unverified", "building-lookup-pending", "desk-lookup-unverified"].includes(record.status), true);
    assert.equal(["parcel", "review", "cluster", "soi_road", "interpolated", "building", "community"].includes(record.geom_level), true);
    assert.equal(record.lat === null, record.lon === null);
    if (record.lat !== null) {
      assert.equal(Number.isFinite(record.lat) && record.lat >= -90 && record.lat <= 90, true);
      assert.equal(Number.isFinite(record.lon) && record.lon >= -180 && record.lon <= 180, true);
    }
    if (record.radius_m !== null) assert.equal(Number.isFinite(record.radius_m) && record.radius_m >= 0 && record.radius_m <= 100000, true);
  }
});

test("public snapshot retains source coverage and confidence totals without inventing coordinates", () => {
  assert.equal(snapshot.records.length, 42524);
  assert.equal(snapshot.records.filter((r) => r.lat !== null).length, 40236);
  assert.equal(snapshot.records.filter((r) => r.lat === null).length, 2288);
  const counts = {};
  for (const [label, [code, count]] of bands) {
    assert.equal(snapshot.records.filter((r) => r.confidence_band === label).length, count);
    counts[code] = count;
  }
  assert.deepEqual(snapshot.summary.confidence_counts, counts);
  assert.equal(snapshot.summary.with_coordinates, 40236);
  assert.equal(snapshot.summary.without_coordinates, 2288);
});

test("all 70 parcel comparisons remain separate unverified source-compatible candidates", () => {
  const candidates = snapshot.records.filter((r) => r.candidate !== null);
  assert.equal(candidates.length, 70);
  assert.equal(candidates.filter((r) => r.candidate.conflict).length, 2);
  assert.equal(candidates.filter((r) => !r.candidate.conflict).length, 68);
  assert.equal(candidates.filter((r) => r.tier === "D").length, 66);
  assert.equal(candidates.filter((r) => r.tier.startsWith("C")).length, 4);
  assert.equal(candidates.filter((r) => r.lat === null).length, 4);
  assert.equal(candidates.filter((r) => r.candidate.auxiliary).length, 4);
  assert.equal(candidates.filter((r) => r.candidate.nonresidential).length, 6);
  for (const record of candidates) {
    const candidate = record.candidate;
    assert.deepEqual(Object.keys(candidate).sort(), expectedCandidateKeys);
    assert.equal(Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon), true);
    for (const flag of ["conflict", "auxiliary", "nonresidential"]) assert.equal(typeof candidate[flag], "boolean");
    assert.equal(record.lat === null, candidate.shift_m === null);
    if (candidate.shift_m !== null) assert.equal(Number.isFinite(candidate.shift_m) && candidate.shift_m >= 0, true);
    assert.equal(record.tier === "D" || record.tier.startsWith("C"), true);
  }
});

test("public payload includes approved registry IDs and house numbers while excluding owner, contact and object identifiers", () => {
  const text = decodedBytes.toString("utf8");
  assert.equal(new Set(snapshot.records.map((row) => row.house_reg_id)).size, 42524);
  assert.equal(new Set(snapshot.records.map((row) => row.house_reg_id.replace(/-/gu, ""))).size, 42524);
  const withoutRegistryIds = JSON.stringify(snapshot.records.map(({ house_reg_id, ...other }) => other));
  assert.doesNotMatch(withoutRegistryIds, /[0-9]{4}-[0-9]{6}-[0-9]/);
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  for (const forbidden of ["trok", "soi", "source_parcel_id", "new_tax_parcel_code", "building_id", "business_names", "owner1_name", "owner1_phone", "owner1_address", "เจ้าของทรัพย์สิน", "verified_by", "review_notes", "original_pipeline_run_id"]) {
    assert.equal(text.includes(`"${forbidden}"`), false, forbidden);
  }
  assert.equal(manifest.checks.approved_house_registry_ids_preserved_from_exact_source, 42524);
  assert.equal(manifest.checks.approved_house_registry_ids_unique, 42524);
  assert.equal(manifest.checks.registry_identifiers_only_in_approved_field, true);
  assert.equal(manifest.checks.private_candidate_parcel_and_building_ids_absent, 70);
  assert.equal(manifest.fields_allowed.includes("house_no"), true);
  assert.equal(manifest.fields_excluded.includes("house_no"), false);
  assert.equal(manifest.fields_allowed.includes("house_reg_id"), true);
  assert.equal(manifest.fields_excluded.includes("house_reg_id"), false);
  assert.equal(manifest.checks.house_numbers_preserved_from_exact_source, 42524);
});

test("public v3 migration adds only approved registry IDs to the exact prior public records", () => {
  const previousBytes = fs.readFileSync(path.join(root, "assets/data/public-housepoints-74080982aded.json.gz"));
  assert.equal(crypto.createHash("sha256").update(previousBytes).digest("hex"), manifest.source_hashes.previous_public_sha256);
  const previous = JSON.parse(zlib.gunzipSync(previousBytes));
  assert.deepEqual(snapshot.snapshot, previous.snapshot);
  assert.deepEqual(snapshot.summary, previous.summary);
  assert.deepEqual(snapshot.records.map(({ house_reg_id, ...unchanged }) => unchanged), previous.records);
  assert.equal(manifest.checks.previous_public_source_fields_equal, 42524);
  assert.equal(manifest.checks.only_added_record_field, "house_reg_id");
});

test("best working display retains immutable source truth and uses only 34 guarded parcel fallbacks", () => {
  const policy = manifest.display_coordinate_policy;
  assert.equal(policy.default_view, "all_records");
  assert.equal(policy.default_record_count, 42524);
  assert.equal(policy.source_coordinates_immutable, true);
  assert.equal(policy.source_tier_status_immutable, true);
  assert.equal(policy.automatic_source_updates, false);
  assert.deepEqual(policy.source_priority_bands, ["A0", "A", "B"]);
  const eligible = snapshot.records.filter((record) => {
    const c = record.candidate;
    if (!c || c.conflict || c.auxiliary || c.nonresidential) return false;
    return (record.tier === "D" && Number.isFinite(c.shift_m) && Number.isFinite(record.radius_m) && c.shift_m <= 500 && c.shift_m <= record.radius_m) || (record.tier.startsWith("C") && record.lat === null && record.lon === null);
  });
  assert.equal(eligible.length, 34);
  assert.equal(eligible.filter((r) => r.tier === "D").length, 30);
  assert.equal(eligible.filter((r) => r.tier.startsWith("C")).length, 4);
  assert.equal(policy.working_parcel_fallback_records, 34);
  assert.equal(policy.working_parcel_fallback_from_D, 30);
  assert.equal(policy.working_parcel_fallback_from_C, 4);
  assert.equal(policy.working_position_records, 40240);
  assert.equal(policy.working_missing_position_records, 2284);
  assert.equal(policy.source_coordinate_records, 40236);
  assert.equal(policy.source_missing_coordinate_records, 2288);
});
