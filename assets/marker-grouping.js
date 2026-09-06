(function attachCityChatMarkerGrouping(root) {
  "use strict";

  const MULTI_UNIT_PLACE_TYPES = Object.freeze({
    "อาคารชุด": "condominium",
    "คอนโดมิเนียม": "condominium",
    condominium: "condominium",
    condo: "condominium",
    "สำนักงาน": "office",
    "อาคารสำนักงาน": "office",
    office: "office",
    "office building": "office"
  });

  const clean = (value) => String(value ?? "").trim();

  const coordinateKey = (row) => {
    if (!Number.isFinite(row?.lat) || !Number.isFinite(row?.lon)) return "";
    return `${Number(row.lat).toFixed(7)},${Number(row.lon).toFixed(7)}`;
  };

  const canonicalPlaceType = (value) => clean(value).toLowerCase();

  const semanticBuildingKind = (row) => {
    const placeType = canonicalPlaceType(row?.place_type);
    const placeKind = Object.prototype.hasOwnProperty.call(MULTI_UNIT_PLACE_TYPES, placeType)
      ? MULTI_UNIT_PLACE_TYPES[placeType]
      : "";
    if (placeKind) return placeKind;
    return row?.geom_level === "building" ? "building" : "";
  };

  const layoutGroups = (indices, rows) => {
    const individualMarkers = [];
    const buildingGroups = new Map();

    for (const index of Array.isArray(indices) ? indices : []) {
      if (!Number.isInteger(index)) continue;
      const row = rows?.[index];
      const coordinate = coordinateKey(row);
      if (!coordinate) continue;
      const buildingKind = semanticBuildingKind(row);
      if (!buildingKind) {
        individualMarkers.push({
          indices: [index],
          coordinateKey: coordinate,
          buildingKind: "",
          buildingGroup: false
        });
        continue;
      }

      const key = coordinate;
      if (!buildingGroups.has(key)) {
        buildingGroups.set(key, {
          indices: [],
          coordinateKey: coordinate,
          buildingKinds: [],
          buildingGroup: false
        });
      }
      const group = buildingGroups.get(key);
      group.indices.push(index);
      if (!group.buildingKinds.includes(buildingKind)) group.buildingKinds.push(buildingKind);
    }

    return individualMarkers.concat([...buildingGroups.values()].map((group) => {
      const buildingKind = group.buildingKinds.length === 1 ? group.buildingKinds[0] : "building";
      return {
        indices: group.indices,
        coordinateKey: group.coordinateKey,
        buildingKind,
        buildingGroup: group.indices.length > 1
      };
    }));
  };

  const combineCoordinateTargets = (targets) => {
    const validTargets = (Array.isArray(targets) ? targets : [])
      .filter((target) => Array.isArray(target?.indices) && target.indices.length);
    if (!validTargets.length) return null;
    if (validTargets.length === 1) return validTargets[0];

    const indices = [...new Set(validTargets.flatMap((target) => target.indices))];
    const buildingRecordCount = validTargets.reduce((count, target) => (
      count + (target.buildingKind ? target.indices.length : 0)
    ), 0);
    const ordinaryRecordCount = indices.length - buildingRecordCount;
    const buildingKinds = [...new Set(validTargets.map((target) => target.buildingKind).filter(Boolean))];
    const hasNumberedBuildingGroup = validTargets.some((target) => target.buildingGroup);

    return {
      ...validTargets[validTargets.length - 1],
      indices,
      buildingKind: ordinaryRecordCount ? "" : (buildingKinds.length === 1 ? buildingKinds[0] : "building"),
      buildingGroup: ordinaryRecordCount === 0 && buildingRecordCount > 1,
      coordinateStack: ordinaryRecordCount > 1 && buildingRecordCount === 0,
      mixedCoordinate: ordinaryRecordCount > 0 && buildingRecordCount > 0,
      buildingRecordCount,
      ordinaryRecordCount,
      hasNumberedBuildingGroup
    };
  };

  const combineOrdinaryScreenOverlaps = (markers, anchor, maxDistance = 2.5) => {
    if (!anchor || anchor.buildingKind || !Number.isFinite(anchor.point?.x) || !Number.isFinite(anchor.point?.y)) {
      return anchor || null;
    }
    const distanceLimit = Number.isFinite(maxDistance) && maxDistance >= 0 ? maxDistance : 0;
    const overlaps = (Array.isArray(markers) ? markers : []).filter((marker) => {
      if (marker?.buildingKind || !Array.isArray(marker?.indices)) return false;
      if (!Number.isFinite(marker.point?.x) || !Number.isFinite(marker.point?.y)) return false;
      return Math.hypot(marker.point.x - anchor.point.x, marker.point.y - anchor.point.y) <= distanceLimit;
    });
    if (overlaps.length <= 1) return anchor;
    const indices = [...new Set(overlaps.flatMap((marker) => marker.indices))];
    const coordinateKeys = new Set(overlaps.map((marker) => marker.coordinateKey));
    return {
      ...anchor,
      indices,
      buildingKind: "",
      buildingGroup: false,
      coordinateStack: coordinateKeys.size === 1,
      screenOverlap: coordinateKeys.size > 1
    };
  };

  const api = Object.freeze({
    MULTI_UNIT_PLACE_TYPES,
    coordinateKey,
    semanticBuildingKind,
    layoutGroups,
    combineCoordinateTargets,
    combineOrdinaryScreenOverlaps
  });

  root.CityChatMarkerGrouping = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
