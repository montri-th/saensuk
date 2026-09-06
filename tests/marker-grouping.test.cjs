"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const grouping = require(path.join(__dirname, "..", "assets", "marker-grouping.js"));

const row = (overrides = {}) => ({
  house_reg_id: "TEST",
  place_type: "บ้าน",
  geom_level: "parcel",
  lat: 13,
  lon: 100,
  ...overrides
});

test("nearby houses remain separate groups", () => {
  const rows = [row(), row({ lon: 100.0000002 })];
  const groups = grouping.layoutGroups([0, 1], rows);

  assert.equal(groups.length, 2);
  assert.equal(groups.every((group) => !group.buildingGroup), true);
  assert.deepEqual(groups.map((group) => group.indices).sort(), [[0], [1]]);
});

test("ordinary records at one approximate coordinate stay individual", () => {
  const rows = [row({ geom_level: "cluster" }), row({ geom_level: "community" })];
  const groups = grouping.layoutGroups([0, 1], rows);

  assert.equal(groups.length, 2);
  assert.equal(groups.every((group) => !group.buildingGroup && group.buildingKind === ""), true);
  assert.deepEqual(groups.map((group) => group.indices), [[0], [1]]);
});

test("condominium and office records share one eligible group at their exact coordinate", () => {
  const rows = [
    row({ place_type: "อาคารชุด" }),
    row({ place_type: "อาคารชุด" }),
    row({ place_type: "สำนักงาน" }),
    row({ place_type: "สำนักงาน" })
  ];
  const groups = grouping.layoutGroups([0, 1, 2, 3], rows);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].buildingKind, "building");
  assert.equal(groups[0].buildingGroup, true);
  assert.deepEqual(groups[0].indices, [0, 1, 2, 3]);
});

test("nearby condominiums do not group across coordinates", () => {
  const rows = [
    row({ place_type: "อาคารชุด" }),
    row({ place_type: "อาคารชุด", lon: 100.0000002 })
  ];
  const groups = grouping.layoutGroups([0, 1], rows);

  assert.equal(groups.length, 2);
  assert.equal(groups.every((group) => !group.buildingGroup), true);
});

test("building-level records at one coordinate form one building group", () => {
  const rows = [row({ geom_level: "building" }), row({ geom_level: "building" })];
  const groups = grouping.layoutGroups([0, 1], rows);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].buildingGroup, true);
  assert.equal(groups[0].buildingKind, "building");
});

test("a normal house never gets absorbed into a condominium group", () => {
  const rows = [row({ place_type: "อาคารชุด" }), row()];
  const groups = grouping.layoutGroups([0, 1], rows);

  assert.equal(groups.length, 2);
  assert.equal(groups.every((group) => !group.buildingGroup), true);
  assert.deepEqual(groups.map((group) => group.indices).sort(), [[0], [1]]);
});

test("arbitrary place type text cannot opt a record into building grouping", () => {
  const rows = [row({ place_type: "__proto__" }), row({ place_type: "__proto__" })];
  const groups = grouping.layoutGroups([0, 1], rows);

  assert.equal(groups.length, 2);
  assert.equal(groups.every((group) => !group.buildingGroup), true);
});

test("layout does not mutate source rows or input order", () => {
  const rows = [row({ place_type: "อาคารชุด" }), row({ place_type: "อาคารชุด" })];
  const snapshot = JSON.stringify(rows);
  const indices = [1, 0];

  grouping.layoutGroups(indices, rows);

  assert.equal(JSON.stringify(rows), snapshot);
  assert.deepEqual(indices, [1, 0]);
});

test("mixed building and ordinary targets remain individually reachable", () => {
  const combined = grouping.combineCoordinateTargets([
    { indices: [0, 1], coordinateKey: "13,100", buildingKind: "condominium", buildingGroup: true },
    { indices: [2], coordinateKey: "13,100", buildingKind: "", buildingGroup: false }
  ]);

  assert.deepEqual(combined.indices, [0, 1, 2]);
  assert.equal(combined.mixedCoordinate, true);
  assert.equal(combined.buildingRecordCount, 2);
  assert.equal(combined.ordinaryRecordCount, 1);
  assert.equal(combined.buildingGroup, false);
  assert.equal(combined.hasNumberedBuildingGroup, true);
});

test("ordinary exact-coordinate targets cycle without becoming a building group", () => {
  const combined = grouping.combineCoordinateTargets([
    { indices: [0], coordinateKey: "13,100", buildingKind: "", buildingGroup: false },
    { indices: [1], coordinateKey: "13,100", buildingKind: "", buildingGroup: false }
  ]);

  assert.deepEqual(combined.indices, [0, 1]);
  assert.equal(combined.coordinateStack, true);
  assert.equal(combined.buildingGroup, false);
});

test("sub-pixel ordinary markers cycle without a numbered group", () => {
  const markers = [
    { indices: [0], coordinateKey: "13.0000000,100.0000000", buildingKind: "", buildingGroup: false, point: { x: 10, y: 10 } },
    { indices: [1], coordinateKey: "13.0000000,100.0000002", buildingKind: "", buildingGroup: false, point: { x: 10.15, y: 10 } }
  ];
  const combined = grouping.combineOrdinaryScreenOverlaps(markers, markers[0], 2.5);

  assert.deepEqual(combined.indices, [0, 1]);
  assert.equal(combined.screenOverlap, true);
  assert.equal(combined.buildingGroup, false);
});
