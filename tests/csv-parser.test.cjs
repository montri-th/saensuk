"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { webcrypto } = require("node:crypto");

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const parser = require(path.join(__dirname, "..", "assets", "csv-parser.js"));

function syntheticRow(overrides) {
  const values = {
    house_reg_id: "TEST-ROW",
    subdistrict_sheet: "TEST-SHEET",
    house_no: "0",
    trok: "",
    soi: "Synthetic soi",
    road: "Synthetic road",
    community: "Synthetic community",
    place_type: "test",
    side: "",
    lat: "13.0000",
    lon: "100.0000",
    geom_level: "parcel",
    tier: "test",
    method: "synthetic",
    radius_m: "0",
    source_parcel_id: "TEST-PARCEL",
    status: "synthetic",
    flags: "",
    verified_by: "",
    verified_at: "",
    field_result: "",
    version: "test-v1",
    ...(overrides || {})
  };
  return parser.HEADERS.map((header) => values[header]);
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
  expectedVersion: "test-v1",
  maxDataRows: 3
});

test("production constants match the approved v6 snapshot contract", () => {
  assert.equal(parser.HEADERS.length, 22);
  assert.equal(parser.PRODUCTION_POLICY.expectedRowCount, 42524);
  assert.equal(parser.PRODUCTION_POLICY.expectedSha256, "4f78161473f9f6398457c4810f45af43806ce2884e44f22e95dc2be92ae11a67");
  assert.equal(parser.PRODUCTION_POLICY.expectedValidCoordinateCount, 40236);
  assert.equal(parser.PRODUCTION_POLICY.expectedNoCoordinateCount, 2288);
  assert.deepEqual(parser.GEOM_DISTRIBUTION, {
    parcel: 12713,
    building: 7151,
    cluster: 10321,
    interpolated: 2911,
    soi_road: 7130,
    community: 10,
    review: 2288
  });
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

test("synthetic 22-column dataset is sanitized, typed, and summarized", () => {
  const rows = [
    parser.HEADERS,
    syntheticRow({ flags: "  safe\u202Eflag  " }),
    syntheticRow({ house_reg_id: "TEST-ROW-2", geom_level: "building", radius_m: "15.5" }),
    syntheticRow({
      house_reg_id: "TEST-ROW-3",
      geom_level: "review",
      lat: "",
      lon: "",
      radius_m: ""
    })
  ];
  const result = parser.parseAndValidateText(toCsv(rows), syntheticPolicy);

  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].flags, "safeflag");
  assert.equal(result.rows[0].lat, 13);
  assert.equal(result.rows[1].radius_m, 15.5);
  assert.equal(result.rows[2].lat, null);
  assert.deepEqual(result.summary.geomDistribution, { parcel: 1, building: 1, review: 1 });
  assert.equal(result.summary.validCoordinateCount, 2);
  assert.equal(result.summary.noCoordinateCount, 1);
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

  const incompleteCoordinate = [
    parser.HEADERS,
    syntheticRow(),
    syntheticRow({ house_reg_id: "TEST-ROW-2", geom_level: "building" }),
    syntheticRow({ house_reg_id: "TEST-ROW-3", geom_level: "review", lat: "", lon: "100", radius_m: "" })
  ];
  assert.throws(
    () => parser.parseAndValidateText(toCsv(incompleteCoordinate), syntheticPolicy),
    (error) => error.code === "INCOMPLETE_COORDINATE"
  );

  const wrongAggregate = [
    parser.HEADERS,
    syntheticRow(),
    syntheticRow({ house_reg_id: "TEST-ROW-2" }),
    syntheticRow({ house_reg_id: "TEST-ROW-3", geom_level: "review", lat: "", lon: "", radius_m: "" })
  ];
  assert.throws(
    () => parser.parseAndValidateText(toCsv(wrongAggregate), syntheticPolicy),
    (error) => error.code === "GEOM_DISTRIBUTION_MISMATCH"
  );
});
