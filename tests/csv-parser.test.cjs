"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { webcrypto } = require("node:crypto");

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const parser = require(path.join(__dirname, "..", "assets", "csv-parser.js"));

function syntheticRow(overrides) {
  const values = {
    house_reg_id: "TEST-ROW-1",
    house_no: "1",
    trok: "",
    soi: "ซอยทดสอบ",
    road: "ถนนทดสอบ",
    community: "ชุมชนทดสอบ",
    place_type: "บ้าน",
    lat: "13.0000",
    lon: "100.0000",
    radius_m: "5",
    tier: "A0",
    confidence_band: "A0 สำรวจสิ่งปลูกสร้างของเทศบาล",
    method: "A0",
    status: "prototype-unverified",
    geom_level: "parcel",
    frontage_heading: "90",
    frontage_road: "ถนนทดสอบ",
    frontage_road_layer: "municipal",
    frontage_road_source: "road+soi",
    dist_named_soi_m: "10.5",
    soi_check: "ตรงซอยที่ระบุ",
    business_count: "2",
    business_names: "บริษัท ทดสอบ จำกัด | ห้างหุ้นส่วน ทดสอบ จำกัด",
    business_status: "จดทะเบียนอยู่",
    business_match_confidence: "unique_house_key",
    review_priority: "สูง",
    review_score: "200",
    review_flags: "frontage_road_by_name",
    pipeline_run_id: "test-run",
    ...(overrides || {})
  };
  return parser.HEADERS.map((header) => values[header]);
}

function validSyntheticRows(overridesByRow = {}) {
  return [
    parser.HEADERS,
    syntheticRow(overridesByRow[0]),
    syntheticRow({
      house_reg_id: "TEST-ROW-2",
      house_no: "2",
      geom_level: "building",
      tier: "D",
      confidence_band: "D ค่าประมาณกลุ่ม",
      radius_m: "15.5",
      frontage_heading: "",
      frontage_road: "",
      frontage_road_layer: "",
      frontage_road_source: "",
      dist_named_soi_m: "",
      soi_check: "",
      business_count: "0",
      business_names: "",
      business_status: "",
      business_match_confidence: "",
      review_priority: "",
      review_score: "",
      review_flags: "",
      ...(overridesByRow[1] || {})
    }),
    syntheticRow({
      house_reg_id: "TEST-ROW-3",
      house_no: "3",
      geom_level: "review",
      tier: "C1",
      confidence_band: "C ยังไม่มีพิกัด ต้องตรวจ",
      status: "needs-review",
      lat: "",
      lon: "",
      radius_m: "",
      frontage_heading: "",
      frontage_road: "",
      frontage_road_layer: "",
      frontage_road_source: "",
      dist_named_soi_m: "",
      soi_check: "",
      business_count: "0",
      business_names: "",
      business_status: "",
      business_match_confidence: "",
      review_priority: "",
      review_score: "",
      review_flags: "",
      ...(overridesByRow[2] || {})
    })
  ];
}

function csvEscape(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

const syntheticPolicy = Object.freeze({
  expectedSha256: null,
  expectedRowCount: 3,
  expectedValidCoordinateCount: 2,
  expectedNoCoordinateCount: 1,
  expectedGeomDistribution: Object.freeze({ parcel: 1, building: 1, review: 1 }),
  expectedConfidenceDistribution: Object.freeze({
    "A0 สำรวจสิ่งปลูกสร้างของเทศบาล": 1,
    "C ยังไม่มีพิกัด ต้องตรวจ": 1,
    "D ค่าประมาณกลุ่ม": 1
  }),
  expectedReviewPriorityDistribution: Object.freeze({ "สูง": 1 }),
  expectedBusinessRowCount: 1,
  expectedBusinessTagCount: 2,
  expectedFrontageHeadingCount: 1,
  expectedNamedFrontageCount: 1,
  expectedMunicipalFrontageCount: 1,
  expectedPipelineRunId: "test-run",
  maxDataRows: 3
});

test("production constants match the approved 29-column display contract", () => {
  assert.equal(parser.HEADERS.length, 29);
  assert.deepEqual(parser.HEADERS.slice(15, 21), [
    "frontage_heading",
    "frontage_road",
    "frontage_road_layer",
    "frontage_road_source",
    "dist_named_soi_m",
    "soi_check"
  ]);
  assert.equal(parser.PRODUCTION_POLICY.expectedRowCount, 42524);
  assert.equal(parser.PRODUCTION_POLICY.expectedSha256, "4f68b1c5a7f962a2ddc06e4e9f7bd6a9959e94c42bd65e2c94354153a04c19d5");
  assert.equal(parser.PRODUCTION_POLICY.expectedValidCoordinateCount, 40236);
  assert.equal(parser.PRODUCTION_POLICY.expectedNoCoordinateCount, 2288);
  assert.equal(parser.PRODUCTION_POLICY.expectedBusinessRowCount, 1379);
  assert.equal(parser.PRODUCTION_POLICY.expectedBusinessTagCount, 2048);
  assert.equal(parser.PRODUCTION_POLICY.expectedFrontageHeadingCount, 13960);
  assert.equal(parser.PRODUCTION_POLICY.expectedNamedFrontageCount, 8036);
  assert.equal(parser.PRODUCTION_POLICY.expectedMunicipalFrontageCount, 9630);
  assert.equal(parser.PIPELINE_RUN_ID, "20260908T044243_f3b4ba_38e4d7_rules1.8.0");
  assert.deepEqual(parser.REVIEW_PRIORITY_DISTRIBUTION, { "สูง": 500, "กลาง": 2044, "ต่ำ": 3102 });
});

test("strict UTF-8 decoding rejects malformed bytes", () => {
  assert.throws(
    () => parser.decodeUtf8Strict(new Uint8Array([0xc3, 0x28])),
    (error) => error.code === "INVALID_UTF8"
  );
});

test("SHA-256 helper hashes bytes without exposing their contents", async () => {
  const bytes = new TextEncoder().encode("abc");
  assert.equal(
    await parser.sha256Hex(bytes),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("RFC4180-style quotes, commas, escaped quotes, and embedded newlines parse", () => {
  const rows = parser.parseCsvText('a,b\r\n"x,y","line 1\r\nline ""2"""\r\n', {
    maxColumns: 2,
    maxRows: 2
  });
  assert.deepEqual(rows, [
    ["a", "b"],
    ["x,y", 'line 1\r\nline "2"']
  ]);
});

test("synthetic display dataset is sanitized, typed, and summarized", () => {
  const rows = validSyntheticRows({ 0: { review_flags: "  safe\u202Eflag  " } });
  const result = parser.parseAndValidateText(toCsv(rows), syntheticPolicy);

  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].review_flags, "safeflag");
  assert.equal(result.rows[0].lat, 13);
  assert.equal(result.rows[0].frontage_heading, 90);
  assert.equal(result.rows[0].dist_named_soi_m, 10.5);
  assert.equal(result.rows[0].business_count, 2);
  assert.equal(result.rows[0].review_score, 200);
  assert.equal(result.rows[1].radius_m, 15.5);
  assert.equal(result.rows[2].lat, null);
  assert.deepEqual(result.summary.geomDistribution, { parcel: 1, building: 1, review: 1 });
  assert.deepEqual(result.summary.reviewPriorityDistribution, { "สูง": 1 });
  assert.equal(result.summary.validCoordinateCount, 2);
  assert.equal(result.summary.noCoordinateCount, 1);
  assert.equal(result.summary.businessRowCount, 1);
  assert.equal(result.summary.businessTagCount, 2);
  assert.equal(result.summary.frontageHeadingCount, 1);
  assert.equal(result.summary.namedFrontageCount, 1);
  assert.equal(result.summary.municipalFrontageCount, 1);
});

test("duplicate and missing headers fail closed", () => {
  const duplicate = [...parser.HEADERS];
  duplicate[1] = duplicate[0];
  assert.throws(
    () => parser.validateHeader(duplicate),
    (error) => error.code === "DUPLICATE_HEADER"
  );

  assert.throws(
    () => parser.validateHeader(parser.HEADERS.slice(0, -1)),
    (error) => error.code === "MISSING_HEADER"
  );

  const padded = [...parser.HEADERS];
  padded[0] = ` ${padded[0]}`;
  assert.throws(
    () => parser.validateHeader(padded),
    (error) => error.code === "MISSING_HEADER"
  );
});

test("row, cell, quote, coordinate, and aggregate violations fail closed", () => {
  assert.throws(
    () => parser.parseCsvText("a,toolong", { maxCellChars: 3, maxColumns: 2, maxRows: 1 }),
    (error) => error.code === "CELL_TOO_LONG"
  );
  assert.throws(
    () => parser.parseCsvText('a,"not closed', { maxColumns: 2, maxRows: 1 }),
    (error) => error.code === "UNCLOSED_QUOTE"
  );

  const incompleteCoordinate = validSyntheticRows({ 2: { lon: "100" } });
  assert.throws(
    () => parser.parseAndValidateText(toCsv(incompleteCoordinate), syntheticPolicy),
    (error) => error.code === "INCOMPLETE_COORDINATE"
  );

  const wrongAggregate = validSyntheticRows({ 1: { geom_level: "parcel" } });
  assert.throws(
    () => parser.parseAndValidateText(toCsv(wrongAggregate), syntheticPolicy),
    (error) => error.code === "GEOM_DISTRIBUTION_MISMATCH"
  );
});

test("heading, business, review, and run provenance violations fail closed", () => {
  const badHeading = validSyntheticRows({ 0: { frontage_heading: "361" } });
  assert.throws(
    () => parser.parseAndValidateText(toCsv(badHeading), syntheticPolicy),
    (error) => error.code === "NUMBER_OUT_OF_RANGE" && error.columnName === "frontage_heading"
  );

  const missingBusiness = validSyntheticRows({ 0: { business_names: "" } });
  assert.throws(
    () => parser.parseAndValidateText(toCsv(missingBusiness), syntheticPolicy),
    (error) => error.code === "MISSING_BUSINESS_DETAIL"
  );

  const scoreWithoutPriority = validSyntheticRows({ 1: { review_score: "50" } });
  assert.throws(
    () => parser.parseAndValidateText(toCsv(scoreWithoutPriority), syntheticPolicy),
    (error) => error.code === "REVIEW_SCORE_CONFLICT"
  );

  const priorityWithoutScore = validSyntheticRows({ 0: { review_score: "" } });
  assert.doesNotThrow(() => parser.parseAndValidateText(toCsv(priorityWithoutScore), syntheticPolicy));

  const wrongRun = validSyntheticRows({ 1: { pipeline_run_id: "other-run" } });
  assert.throws(
    () => parser.parseAndValidateText(toCsv(wrongRun), syntheticPolicy),
    (error) => error.code === "PIPELINE_RUN_MISMATCH"
  );
});
