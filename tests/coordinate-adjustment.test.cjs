"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const adjustment = require(path.join(__dirname, "..", "assets", "coordinate-adjustment.js"));

const sourceRow = (overrides = {}) => ({
  house_reg_id: "HOUSE-001",
  lat: 13.2784,
  lon: 100.934,
  radius_m: 20,
  tier: "D",
  confidence_band: "D ค่าประมาณกลุ่ม",
  status: "approximate-unverified",
  geom_level: "cluster",
  place_type: "บ้าน",
  review_priority: "สูง",
  review_flags: "far_from_road",
  pipeline_run_id: "20260908T071053_f3b4ba_38e4d7_rules1.9.0",
  ...overrides
});

const validDraft = (overrides = {}) => ({
  adjustment_action: "move_existing",
  proposed_lat: 13.2785,
  proposed_lon: 100.9341,
  adjustment_reason_code: "source_point_conflicts_evidence",
  adjustment_reason_note: "จุดต้นทางไม่ตรงกับหลักฐานที่ตรวจและต้องส่งให้ผู้รับผิดชอบยืนยัน",
  evidence_source: "google-street-view",
  evidence_reference: "SV-2026-09-08-HOUSE-001",
  evidence_observed_at: "2026-09-08",
  reviewer_code: "TEAM-A-01",
  adjustment_id: "adj-0001",
  adjusted_at_utc: "2026-09-08T08:30:00.000Z",
  ...overrides
});

const provenance = Object.freeze({
  source_sha256: "a57f1462fdc5b23f88d90856b0e2556d2d231d6e0b17af3468e133ed2770d8f5",
  source_dataset_contract: "housemapdisplaydataset-v3",
  tool_release: "saensuk-adjustment-20260908.1",
  export_batch_id: "batch-20260908-001"
});

test("eligibility distinguishes placement, review candidates, ordinary rows, and invalid sources", () => {
  assert.deepEqual(adjustment.classifyEligibility(sourceRow({ lat: null, lon: null })), {
    allowed: true,
    action: "place_missing",
    recommendation: "place_missing",
    recommended: true,
    requiresStrongEvidence: true,
    reasonCodes: ["source_missing_coordinate"]
  });

  const reviewed = adjustment.classifyEligibility(sourceRow());
  assert.equal(reviewed.action, "move_existing");
  assert.equal(reviewed.recommendation, "review_before_move");
  assert.equal(reviewed.recommended, true);
  assert.deepEqual(reviewed.reasonCodes, ["source_review_queue", "source_position_flag"]);

  const ordinary = adjustment.classifyEligibility(sourceRow({ review_priority: "", review_flags: "" }));
  assert.equal(ordinary.recommendation, "available_with_evidence");
  assert.equal(ordinary.recommended, false);
  assert.deepEqual(ordinary.reasonCodes, ["no_source_adjustment_signal"]);

  for (const partialCoordinate of [
    { lat: null, lon: 100.934 },
    { lat: 13.2784, lon: null }
  ]) {
    const partialRow = sourceRow(partialCoordinate);
    assert.equal(adjustment.classifyEligibility(partialRow).allowed, false);
    const validation = adjustment.validateAdjustment(validDraft(), partialRow);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.includes("SOURCE_COORDINATE_INVALID"));
  }
  assert.equal(adjustment.classifyEligibility(sourceRow({ house_reg_id: "" })).allowed, false);
});

test("A0 and multi-unit rows require stronger evidence without claiming the source is wrong", () => {
  const a0 = adjustment.classifyEligibility(sourceRow({ tier: "A0", review_priority: "", review_flags: "" }));
  assert.equal(a0.recommended, false);
  assert.equal(a0.requiresStrongEvidence, true);
  assert.ok(a0.reasonCodes.includes("source_tier_a0"));

  const building = adjustment.classifyEligibility(sourceRow({ geom_level: "building", review_priority: "", review_flags: "" }));
  assert.equal(building.requiresStrongEvidence, true);
  assert.ok(building.reasonCodes.includes("source_multi_unit_or_building"));
});

test("distance and nudges are geodesic, deterministic, and do not mutate their input", () => {
  const point = Object.freeze({ lat: 13.2784, lon: 100.934 });
  assert.equal(adjustment.distanceMeters(point, point), 0);

  for (const direction of ["north", "east", "south", "west"]) {
    const nudged = adjustment.nudgeCoordinate(point, direction, 10);
    assert.ok(Math.abs(adjustment.distanceMeters(point, nudged) - 10) < 0.02, direction);
  }
  assert.deepEqual(point, { lat: 13.2784, lon: 100.934 });
  assert.ok(adjustment.nudgeCoordinate(point, "north", 10).lat > point.lat);
  assert.ok(adjustment.nudgeCoordinate(point, "south", 10).lat < point.lat);
  assert.ok(adjustment.nudgeCoordinate(point, "east", 10).lon > point.lon);
  assert.ok(adjustment.nudgeCoordinate(point, "west", 10).lon < point.lon);
});

test("distance and nudge fail closed for invalid coordinates, directions, and distances", () => {
  assert.throws(
    () => adjustment.distanceMeters({ lat: 0, lon: 0 }, { lat: 13, lon: 100 }),
    (error) => error.code === "INVALID_COORDINATE"
  );
  assert.throws(
    () => adjustment.nudgeCoordinate({ lat: 13, lon: 100 }, "up", 5),
    (error) => error.code === "INVALID_DIRECTION"
  );
  assert.throws(
    () => adjustment.nudgeCoordinate({ lat: 13, lon: 100 }, "north", 0),
    (error) => error.code === "INVALID_NUDGE_DISTANCE"
  );
  assert.throws(
    () => adjustment.nudgeCoordinate({ lat: 13, lon: 100 }, "north", 0.05),
    (error) => error.code === "INVALID_NUDGE_DISTANCE"
  );
  assert.doesNotThrow(
    () => adjustment.nudgeCoordinate({ lat: 13, lon: 100 }, "north", 0.1)
  );
  assert.throws(
    () => adjustment.nudgeCoordinate({ lat: 13, lon: 100 }, "north", 1001),
    (error) => error.code === "INVALID_NUDGE_DISTANCE"
  );
});

test("a valid move is normalized without mutating the source row or draft", () => {
  const row = sourceRow();
  const draft = validDraft();
  const before = JSON.stringify({ row, draft });
  const result = adjustment.validateAdjustment(draft, row);

  assert.equal(result.valid, true);
  assert.equal(result.normalized.adjustment_action, "move_existing");
  assert.equal(typeof result.normalized.movement_m, "number");
  assert.deepEqual(result.warnings, []);
  assert.equal(JSON.stringify({ row, draft }), before);
});

test("movement beyond the source radius is a warning, not an invented correctness verdict", () => {
  const result = adjustment.validateAdjustment(validDraft(), sourceRow({ radius_m: 1 }));
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, ["MOVE_EXCEEDS_SOURCE_RADIUS"]);
});

test("unchanged coordinates and mismatched actions fail validation", () => {
  const row = sourceRow();
  const unchanged = adjustment.validateAdjustment(validDraft({
    proposed_lat: row.lat,
    proposed_lon: row.lon
  }), row);
  assert.equal(unchanged.valid, false);
  assert.ok(unchanged.errors.includes("UNCHANGED_COORDINATE"));

  const wrongAction = adjustment.validateAdjustment(validDraft({ adjustment_action: "place_missing" }), row);
  assert.equal(wrongAction.valid, false);
  assert.ok(wrongAction.errors.includes("ACTION_MISMATCH"));
});

test("placing a missing point requires a placement-compatible reason and strong evidence", () => {
  const row = sourceRow({ lat: null, lon: null, radius_m: null, tier: "C1", geom_level: "review" });
  const weak = adjustment.validateAdjustment(validDraft({
    adjustment_action: "place_missing",
    adjustment_reason_code: "place_missing_coordinate",
    evidence_source: "satellite-imagery"
  }), row);
  assert.equal(weak.valid, false);
  assert.ok(weak.errors.includes("STRONG_EVIDENCE_REQUIRED"));

  const valid = adjustment.validateAdjustment(validDraft({
    adjustment_action: "place_missing",
    adjustment_reason_code: "place_missing_coordinate",
    evidence_source: "agency-evidence"
  }), row);
  assert.equal(valid.valid, true);
  assert.equal(valid.normalized.movement_m, null);

  const wrongReason = adjustment.validateAdjustment(validDraft({
    adjustment_action: "place_missing",
    adjustment_reason_code: "frontage_or_access_correction",
    evidence_source: "agency-evidence"
  }), row);
  assert.ok(wrongReason.errors.includes("REASON_ACTION_MISMATCH"));
});

test("required reason, evidence, audit identity, and timestamps report stable error codes", () => {
  const result = adjustment.validateAdjustment({
    adjustment_action: "move_existing",
    proposed_lat: 13.279,
    proposed_lon: 100.935
  }, sourceRow());
  assert.deepEqual(result.errors, [
    "REASON_REQUIRED",
    "REASON_NOTE_REQUIRED",
    "EVIDENCE_SOURCE_REQUIRED",
    "EVIDENCE_REFERENCE_REQUIRED",
    "EVIDENCE_DATE_REQUIRED",
    "REVIEWER_CODE_REQUIRED",
    "ADJUSTMENT_ID_REQUIRED",
    "ADJUSTED_AT_REQUIRED"
  ]);

  const malformed = adjustment.validateAdjustment(validDraft({
    evidence_observed_at: "2026-09-08-extra",
    reviewer_code: "ชื่อ ผู้ใช้",
    adjustment_id: "bad id",
    adjusted_at_utc: "2026-02-30T15:00:00.000Z"
  }), sourceRow());
  assert.ok(malformed.errors.includes("EVIDENCE_DATE_INVALID"));
  assert.ok(malformed.errors.includes("REVIEWER_CODE_INVALID"));
  assert.ok(malformed.errors.includes("ADJUSTMENT_ID_INVALID"));
  assert.ok(malformed.errors.includes("ADJUSTED_AT_INVALID"));
});

test("audit text boundaries match the browser form contract", () => {
  const row = sourceRow();
  const validAtBoundaries = adjustment.validateAdjustment(validDraft({
    adjustment_reason_note: "x".repeat(5),
    evidence_reference: "r".repeat(240),
    reviewer_code: "A".repeat(64)
  }), row);
  assert.equal(validAtBoundaries.valid, true);

  const tooShort = adjustment.validateAdjustment(validDraft({ adjustment_reason_note: "x".repeat(4) }), row);
  assert.ok(tooShort.errors.includes("REASON_NOTE_TOO_SHORT"));

  const tooLong = adjustment.validateAdjustment(validDraft({
    adjustment_reason_note: "x".repeat(501),
    evidence_reference: "r".repeat(241),
    reviewer_code: "A".repeat(65)
  }), row);
  assert.ok(tooLong.errors.includes("REASON_NOTE_TOO_LONG"));
  assert.ok(tooLong.errors.includes("EVIDENCE_REFERENCE_TOO_LONG"));
  assert.ok(tooLong.errors.includes("REVIEWER_CODE_INVALID"));
});

test("export uses the exact audit schema, sorts by stable key, and keeps source coordinates separate", () => {
  const sourceA = sourceRow({ house_reg_id: "HOUSE-002" });
  const sourceB = sourceRow({
    house_reg_id: "HOUSE-001",
    lat: null,
    lon: null,
    radius_m: null,
    tier: "C1",
    geom_level: "review",
    confidence_band: "C ยังไม่มีพิกัด ต้องตรวจ",
    status: "needs-review"
  });
  const snapshot = JSON.stringify([sourceA, sourceB]);
  const output = adjustment.buildAdjustmentExport([
    { row: sourceA, draft: validDraft({ adjustment_id: "adj-2" }) },
    { row: sourceB, draft: validDraft({
      adjustment_action: "place_missing",
      adjustment_reason_code: "place_missing_coordinate",
      evidence_source: "agency-evidence",
      adjustment_id: "adj-1"
    }) }
  ], provenance);

  assert.deepEqual(output.headers, adjustment.EXPORT_HEADERS);
  assert.equal(output.headers.length, 27);
  assert.deepEqual(output.records.map((record) => record.house_reg_id), ["HOUSE-001", "HOUSE-002"]);
  assert.equal(output.records[0].source_lat, "");
  assert.equal(output.records[0].source_lon, "");
  assert.equal(output.records[0].movement_m, "");
  assert.equal(output.records[0].proposed_lat, 13.2785);
  assert.equal(output.records[0].adjustment_status, "draft-unverified");
  assert.equal(output.records[0].coordinate_crs, "EPSG:4326");
  assert.equal(output.records[0].source_sha256, provenance.source_sha256);
  assert.equal(output.records[0].source_pipeline_run_id, sourceB.pipeline_run_id);
  assert.equal(JSON.stringify([sourceA, sourceB]), snapshot);
});

test("CSV output has a BOM, CRLF rows, RFC4180 quoting, and spreadsheet-formula hardening", () => {
  const output = adjustment.buildAdjustmentExport([{
    row: sourceRow({ house_reg_id: "=DANGEROUS" }),
    draft: validDraft({
      adjustment_reason_note: "+SUM(1,1)\nตรวจต่อ",
      evidence_reference: "@external",
      reviewer_code: "TEAM-A-01"
    })
  }], provenance);

  assert.ok(output.csv.startsWith("\uFEFF\"house_reg_id\""));
  assert.ok(output.csv.endsWith("\r\n"));
  assert.ok(output.csv.includes("\"'=DANGEROUS\""));
  assert.ok(output.csv.includes("\"'+SUM(1,1)\nตรวจต่อ\""));
  assert.ok(output.csv.includes("\"'@external\""));
  assert.equal(output.csv.replace(/\r\n/g, "").includes("\r"), false);
});

test("export fails closed for empty, duplicate, invalid, or unprovenanced drafts", () => {
  assert.throws(
    () => adjustment.buildAdjustmentExport([], provenance),
    (error) => error.code === "NO_ADJUSTMENTS"
  );
  assert.throws(
    () => adjustment.buildAdjustmentExport([{ row: sourceRow(), draft: validDraft() }], {
      ...provenance,
      source_sha256: `${provenance.source_sha256}0`
    }),
    (error) => error.code === "INVALID_SOURCE_SHA256"
  );
  assert.throws(
    () => adjustment.buildAdjustmentExport([
      { row: sourceRow(), draft: validDraft({ adjustment_id: "adj-a" }) },
      { row: sourceRow(), draft: validDraft({ adjustment_id: "adj-b" }) }
    ], provenance),
    (error) => error.code === "DUPLICATE_HOUSE_REG_ID"
  );
  assert.throws(
    () => adjustment.buildAdjustmentExport([{
      row: sourceRow(),
      draft: validDraft({ evidence_source: "untrusted-source" })
    }], provenance),
    (error) => error.code === "INVALID_ADJUSTMENT" && error.validationErrors.includes("EVIDENCE_SOURCE_UNSUPPORTED")
  );
});

test("public constants and returned export structures cannot be mutated", () => {
  const output = adjustment.buildAdjustmentExport([{ row: sourceRow(), draft: validDraft() }], provenance);
  assert.equal(Object.isFrozen(adjustment.EXPORT_HEADERS), true);
  assert.equal(Object.isFrozen(adjustment.ADJUSTMENT_REASONS), true);
  assert.equal(Object.isFrozen(adjustment.EVIDENCE_SOURCES), true);
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.records), true);
  assert.equal(Object.isFrozen(output.records[0]), true);
});

test("stable join and provenance identifiers are never silently truncated", () => {
  const longPrefix = `HOUSE-${"x".repeat(200)}`;
  const longHouseIds = [`${longPrefix}-A`, `${longPrefix}-B`];
  const output = adjustment.buildAdjustmentExport(longHouseIds.map((houseRegId, index) => ({
    row: sourceRow({ house_reg_id: houseRegId }),
    draft: validDraft({ adjustment_id: `adj-long-${index}` })
  })), provenance);
  assert.deepEqual(output.records.map((record) => record.house_reg_id), longHouseIds);

  assert.throws(
    () => adjustment.buildAdjustmentExport([{ row: sourceRow(), draft: validDraft() }], {
      ...provenance,
      export_batch_id: "x".repeat(97)
    }),
    (error) => error.code === "INVALID_EXPORT_BATCH_ID"
  );
});
