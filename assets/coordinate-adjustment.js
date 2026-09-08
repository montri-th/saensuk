(function attachCityChatCoordinateAdjustment(root) {
  "use strict";

  const EARTH_RADIUS_M = 6371008.8;
  const MIN_NUDGE_M = 0.1;
  const MAX_NUDGE_M = 1000;
  const MIN_NOTE_CHARS = 5;
  const MAX_NOTE_CHARS = 500;
  const MAX_REFERENCE_CHARS = 240;
  const COORDINATE_CRS = "EPSG:4326";
  const ADJUSTMENT_STATUS = "draft-unverified";

  const POSITION_REVIEW_FLAGS = new Set([
    "anchor_contradicted",
    "building_register_conflict",
    "building_register_moved",
    "building_register_multi_site",
    "community_conflict",
    "community_conflict_reestimated",
    "far_from_named_soi",
    "far_from_road",
    "frontage_no_road",
    "frontage_none",
    "frontage_off_parcel",
    "nearer_to_another_soi",
    "outside_community_polygon",
    "snap_outside_community",
    "soi_name_needs_review"
  ]);

  const MULTI_UNIT_PLACE_TYPES = new Set([
    "อาคารชุด",
    "คอนโดมิเนียม",
    "condominium",
    "condo",
    "สำนักงาน",
    "อาคารสำนักงาน",
    "office",
    "office building"
  ]);

  const ADJUSTMENT_REASONS = new Set([
    "place_missing_coordinate",
    "source_point_conflicts_evidence",
    "field_position_observed",
    "frontage_or_access_correction",
    "road_or_soi_context",
    "building_or_parcel_evidence",
    "other_authorized_reason"
  ]);

  const PLACE_MISSING_REASONS = new Set([
    "place_missing_coordinate",
    "field_position_observed",
    "building_or_parcel_evidence",
    "other_authorized_reason"
  ]);

  const EVIDENCE_SOURCES = new Set([
    "field-observation",
    "agency-evidence",
    "google-street-view",
    "google-maps",
    "satellite-imagery",
    "other-authorized-source"
  ]);

  const STRONG_EVIDENCE_SOURCES = new Set([
    "field-observation",
    "agency-evidence",
    "google-street-view"
  ]);

  const EXPORT_HEADERS = Object.freeze([
    "house_reg_id",
    "source_lat",
    "source_lon",
    "proposed_lat",
    "proposed_lon",
    "movement_m",
    "coordinate_crs",
    "adjustment_action",
    "adjustment_reason_code",
    "adjustment_reason_note",
    "evidence_source",
    "evidence_reference",
    "evidence_observed_at",
    "reviewer_code",
    "adjustment_status",
    "adjustment_id",
    "adjusted_at_utc",
    "export_batch_id",
    "source_pipeline_run_id",
    "source_sha256",
    "source_dataset_contract",
    "source_confidence_band",
    "source_status",
    "source_geom_level",
    "source_radius_m",
    "source_review_flags",
    "tool_release"
  ]);

  const FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
  const SAFE_CODE = /^[0-9A-Za-z._:-]+$/;

  class AdjustmentError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "AdjustmentError";
      this.code = code;
    }
  }

  const cleanText = (value, max = Infinity) => String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(FORBIDDEN_CONTROLS, "")
    .replace(BIDI_CONTROLS, "")
    .trim()
    .slice(0, max);

  const isMissing = (value) => value === null || value === undefined || value === "";

  const isCoordinate = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0);

  const sourceCoordinateState = (row) => {
    const latMissing = isMissing(row?.lat);
    const lonMissing = isMissing(row?.lon);
    if (latMissing && lonMissing) return { kind: "missing", point: null };
    if (latMissing !== lonMissing) return { kind: "invalid", point: null };
    if (!isCoordinate(row?.lat, row?.lon)) return { kind: "invalid", point: null };
    return { kind: "present", point: { lat: Number(row.lat), lon: Number(row.lon) } };
  };

  const splitFlags = (value) => String(value ?? "")
    .split(";")
    .map((flag) => flag.trim().split("=")[0])
    .filter(Boolean);

  const isMultiUnit = (row) => {
    const placeType = cleanText(row?.place_type, 80).toLocaleLowerCase("th-TH");
    return row?.geom_level === "building" || MULTI_UNIT_PLACE_TYPES.has(placeType);
  };

  const classifyEligibility = (row) => {
    const houseRegId = cleanText(row?.house_reg_id);
    const source = sourceCoordinateState(row);
    if (!row || !houseRegId || source.kind === "invalid") {
      return Object.freeze({
        allowed: false,
        action: "",
        recommendation: "invalid_source",
        recommended: false,
        requiresStrongEvidence: false,
        reasonCodes: Object.freeze([!houseRegId ? "house_reg_id_missing" : "source_coordinate_invalid"])
      });
    }

    if (source.kind === "missing") {
      return Object.freeze({
        allowed: true,
        action: "place_missing",
        recommendation: "place_missing",
        recommended: true,
        requiresStrongEvidence: true,
        reasonCodes: Object.freeze(["source_missing_coordinate"])
      });
    }

    const flags = splitFlags(row.review_flags);
    const positionFlags = flags.filter((flag) => POSITION_REVIEW_FLAGS.has(flag));
    const hasReviewPriority = Boolean(cleanText(row.review_priority, 20));
    const recommended = hasReviewPriority || positionFlags.length > 0;
    const requiresStrongEvidence = row.tier === "A0" || isMultiUnit(row);
    const reasonCodes = [];
    if (hasReviewPriority) reasonCodes.push("source_review_queue");
    if (positionFlags.length) reasonCodes.push("source_position_flag");
    if (row.tier === "A0") reasonCodes.push("source_tier_a0");
    if (isMultiUnit(row)) reasonCodes.push("source_multi_unit_or_building");
    if (!reasonCodes.length) reasonCodes.push("no_source_adjustment_signal");

    return Object.freeze({
      allowed: true,
      action: "move_existing",
      recommendation: recommended ? "review_before_move" : "available_with_evidence",
      recommended,
      requiresStrongEvidence,
      reasonCodes: Object.freeze(reasonCodes)
    });
  };

  const requirePoint = (point) => {
    if (!point || !isCoordinate(point.lat, point.lon)) {
      throw new AdjustmentError("INVALID_COORDINATE", "พิกัดต้องเป็นตัวเลข WGS84 ที่สมบูรณ์และไม่ใช่ 0,0");
    }
    return { lat: Number(point.lat), lon: Number(point.lon) };
  };

  const toRadians = (degrees) => degrees * Math.PI / 180;
  const toDegrees = (radians) => radians * 180 / Math.PI;
  const roundCoordinate = (value) => Number(Number(value).toFixed(7));
  const roundDistance = (value) => Number(Number(value).toFixed(3));

  const distanceMeters = (left, right) => {
    const from = requirePoint(left);
    const to = requirePoint(right);
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const deltaLat = lat2 - lat1;
    const deltaLon = toRadians(to.lon - from.lon);
    const a = Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  };

  const nudgeCoordinate = (point, direction, metres) => {
    const source = requirePoint(point);
    const bearings = { north: 0, east: 90, south: 180, west: 270 };
    if (!Object.prototype.hasOwnProperty.call(bearings, direction)) {
      throw new AdjustmentError("INVALID_DIRECTION", "ทิศทางต้องเป็น north, east, south หรือ west");
    }
    if (!Number.isFinite(metres) || metres < MIN_NUDGE_M || metres > MAX_NUDGE_M) {
      throw new AdjustmentError("INVALID_NUDGE_DISTANCE", `ระยะขยับต้องไม่น้อยกว่า ${MIN_NUDGE_M} และไม่เกิน ${MAX_NUDGE_M} เมตร`);
    }

    const angularDistance = metres / EARTH_RADIUS_M;
    const bearing = toRadians(bearings[direction]);
    const lat1 = toRadians(source.lat);
    const lon1 = toRadians(source.lon);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );
    const normalizedLon = ((toDegrees(lon2) + 540) % 360) - 180;
    return Object.freeze({ lat: roundCoordinate(toDegrees(lat2)), lon: roundCoordinate(normalizedLon) });
  };

  const isCalendarDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };

  const isUtcInstant = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(value);
    if (!match) return false;
    const [, year, month, day, hour, minute, second, millisecond = "000"] = match;
    const date = new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond)
    ));
    return date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() === Number(month) - 1 &&
      date.getUTCDate() === Number(day) &&
      date.getUTCHours() === Number(hour) &&
      date.getUTCMinutes() === Number(minute) &&
      date.getUTCSeconds() === Number(second) &&
      date.getUTCMilliseconds() === Number(millisecond);
  };

  const validateAdjustment = (draft, row) => {
    const errors = [];
    const warnings = [];
    const eligibility = classifyEligibility(row);
    const source = sourceCoordinateState(row);

    if (!row || !cleanText(row?.house_reg_id)) errors.push("HOUSE_REG_ID_REQUIRED");
    if (source.kind === "invalid") errors.push("SOURCE_COORDINATE_INVALID");
    if (!eligibility.allowed && !errors.length) errors.push("SOURCE_NOT_ADJUSTABLE");

    const expectedAction = source.kind === "missing" ? "place_missing" : source.kind === "present" ? "move_existing" : "";
    const action = cleanText(draft?.adjustment_action, 40);
    if (!action) errors.push("ACTION_REQUIRED");
    else if (!expectedAction || action !== expectedAction) errors.push("ACTION_MISMATCH");

    const proposedLat = draft?.proposed_lat;
    const proposedLon = draft?.proposed_lon;
    const proposed = isCoordinate(proposedLat, proposedLon)
      ? { lat: roundCoordinate(proposedLat), lon: roundCoordinate(proposedLon) }
      : null;
    if (isMissing(proposedLat) || isMissing(proposedLon)) errors.push("PROPOSED_COORDINATE_REQUIRED");
    else if (!proposed) errors.push("PROPOSED_COORDINATE_INVALID");

    let movementM = null;
    if (proposed && source.kind === "present") {
      movementM = roundDistance(distanceMeters(source.point, proposed));
      if (movementM <= 0.01) errors.push("UNCHANGED_COORDINATE");
      if (Number.isFinite(row.radius_m) && movementM > Number(row.radius_m)) {
        warnings.push("MOVE_EXCEEDS_SOURCE_RADIUS");
      }
    }

    const reasonCode = cleanText(draft?.adjustment_reason_code, 80);
    if (!reasonCode) errors.push("REASON_REQUIRED");
    else if (!ADJUSTMENT_REASONS.has(reasonCode)) errors.push("REASON_UNSUPPORTED");
    else if (
      (action === "place_missing" && !PLACE_MISSING_REASONS.has(reasonCode)) ||
      (action === "move_existing" && reasonCode === "place_missing_coordinate")
    ) {
      errors.push("REASON_ACTION_MISMATCH");
    }

    const reasonNote = cleanText(draft?.adjustment_reason_note, MAX_NOTE_CHARS + 1);
    if (!reasonNote) errors.push("REASON_NOTE_REQUIRED");
    else if (reasonNote.length < MIN_NOTE_CHARS) errors.push("REASON_NOTE_TOO_SHORT");
    else if (reasonNote.length > MAX_NOTE_CHARS) errors.push("REASON_NOTE_TOO_LONG");

    const evidenceSource = cleanText(draft?.evidence_source, 80);
    if (!evidenceSource) errors.push("EVIDENCE_SOURCE_REQUIRED");
    else if (!EVIDENCE_SOURCES.has(evidenceSource)) errors.push("EVIDENCE_SOURCE_UNSUPPORTED");
    else if (eligibility.requiresStrongEvidence && !STRONG_EVIDENCE_SOURCES.has(evidenceSource)) {
      errors.push("STRONG_EVIDENCE_REQUIRED");
    }

    const evidenceReference = cleanText(draft?.evidence_reference, MAX_REFERENCE_CHARS + 1);
    if (!evidenceReference) errors.push("EVIDENCE_REFERENCE_REQUIRED");
    else if (evidenceReference.length > MAX_REFERENCE_CHARS) errors.push("EVIDENCE_REFERENCE_TOO_LONG");

    const evidenceObservedAt = cleanText(draft?.evidence_observed_at);
    if (!evidenceObservedAt) errors.push("EVIDENCE_DATE_REQUIRED");
    else if (!isCalendarDate(evidenceObservedAt)) errors.push("EVIDENCE_DATE_INVALID");

    const reviewerCode = cleanText(draft?.reviewer_code, 65);
    if (!reviewerCode) errors.push("REVIEWER_CODE_REQUIRED");
    else if (reviewerCode.length > 64 || !SAFE_CODE.test(reviewerCode)) errors.push("REVIEWER_CODE_INVALID");

    const adjustmentId = cleanText(draft?.adjustment_id, 97);
    if (!adjustmentId) errors.push("ADJUSTMENT_ID_REQUIRED");
    else if (adjustmentId.length > 96 || !SAFE_CODE.test(adjustmentId)) errors.push("ADJUSTMENT_ID_INVALID");

    const adjustedAtUtc = cleanText(draft?.adjusted_at_utc, 40);
    if (!adjustedAtUtc) errors.push("ADJUSTED_AT_REQUIRED");
    else if (!isUtcInstant(adjustedAtUtc)) errors.push("ADJUSTED_AT_INVALID");

    const normalized = errors.length ? null : Object.freeze({
      adjustment_action: action,
      proposed_lat: proposed.lat,
      proposed_lon: proposed.lon,
      movement_m: movementM,
      adjustment_reason_code: reasonCode,
      adjustment_reason_note: reasonNote,
      evidence_source: evidenceSource,
      evidence_reference: evidenceReference,
      evidence_observed_at: evidenceObservedAt,
      reviewer_code: reviewerCode,
      adjustment_id: adjustmentId,
      adjusted_at_utc: adjustedAtUtc
    });

    return Object.freeze({
      valid: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
      normalized,
      eligibility
    });
  };

  const hardenSpreadsheetCell = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new AdjustmentError("INVALID_EXPORT_NUMBER", "ไม่สามารถส่งออกตัวเลขที่ไม่สมบูรณ์");
      return String(value);
    }
    const text = cleanText(value);
    return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  };

  const csvCell = (value) => `"${hardenSpreadsheetCell(value).replace(/"/g, '""')}"`;

  const toCsv = (records, headers = EXPORT_HEADERS) => {
    if (!Array.isArray(records) || !Array.isArray(headers) || !headers.length) {
      throw new AdjustmentError("INVALID_EXPORT_ROWS", "ข้อมูลส่งออกต้องเป็นตารางที่มีหัวคอลัมน์");
    }
    const lines = [headers.map(csvCell).join(",")];
    for (const record of records) {
      lines.push(headers.map((header) => csvCell(record?.[header])).join(","));
    }
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  };

  const requireProvenance = (provenance) => {
    const sourceSha256 = cleanText(provenance?.source_sha256);
    const sourceDatasetContract = cleanText(provenance?.source_dataset_contract);
    const toolRelease = cleanText(provenance?.tool_release);
    const exportBatchId = cleanText(provenance?.export_batch_id);
    if (!/^[0-9a-f]{64}$/.test(sourceSha256)) {
      throw new AdjustmentError("INVALID_SOURCE_SHA256", "source_sha256 ต้องเป็น SHA-256 ตัวพิมพ์เล็ก 64 ตัว");
    }
    for (const [code, value] of [
      ["SOURCE_DATASET_CONTRACT_REQUIRED", sourceDatasetContract],
      ["TOOL_RELEASE_REQUIRED", toolRelease],
      ["EXPORT_BATCH_ID_REQUIRED", exportBatchId]
    ]) {
      if (!value) throw new AdjustmentError(code, "ข้อมูล provenance สำหรับส่งออกไม่ครบ");
    }
    if (sourceDatasetContract.length > 120) {
      throw new AdjustmentError("SOURCE_DATASET_CONTRACT_TOO_LONG", "source_dataset_contract ยาวเกินขีดจำกัด");
    }
    if (toolRelease.length > 120) {
      throw new AdjustmentError("TOOL_RELEASE_TOO_LONG", "tool_release ยาวเกินขีดจำกัด");
    }
    if (exportBatchId.length > 96 || !SAFE_CODE.test(exportBatchId)) {
      throw new AdjustmentError("INVALID_EXPORT_BATCH_ID", "export_batch_id มีรูปแบบที่ไม่รองรับ");
    }
    return { sourceSha256, sourceDatasetContract, toolRelease, exportBatchId };
  };

  const normalizeDraftEntries = (drafts) => {
    if (drafts instanceof Map) return [...drafts.values()];
    if (Array.isArray(drafts)) return [...drafts];
    throw new AdjustmentError("INVALID_ADJUSTMENTS", "รายการร่างต้องเป็น Array หรือ Map");
  };

  const buildAdjustmentExport = (drafts, provenance) => {
    const source = requireProvenance(provenance);
    const entries = normalizeDraftEntries(drafts);
    if (!entries.length) throw new AdjustmentError("NO_ADJUSTMENTS", "ไม่มีร่างปรับจุดให้ส่งออก");

    const records = [];
    const houseIds = new Set();
    const adjustmentIds = new Set();
    for (const entry of entries) {
      const row = entry?.row;
      const draft = entry?.draft;
      const validation = validateAdjustment(draft, row);
      if (!validation.valid) {
        const error = new AdjustmentError("INVALID_ADJUSTMENT", "พบร่างปรับจุดที่ไม่ผ่านการตรวจ");
        error.validationErrors = [...validation.errors];
        throw error;
      }
      const houseRegId = cleanText(row.house_reg_id);
      if (houseIds.has(houseRegId)) throw new AdjustmentError("DUPLICATE_HOUSE_REG_ID", "พบ house_reg_id ซ้ำในชุดส่งออก");
      if (adjustmentIds.has(validation.normalized.adjustment_id)) throw new AdjustmentError("DUPLICATE_ADJUSTMENT_ID", "พบ adjustment_id ซ้ำในชุดส่งออก");
      houseIds.add(houseRegId);
      adjustmentIds.add(validation.normalized.adjustment_id);

      const sourceCoordinate = sourceCoordinateState(row);
      const sourcePipelineRunId = cleanText(row.pipeline_run_id);
      if (!sourcePipelineRunId) throw new AdjustmentError("SOURCE_PIPELINE_RUN_ID_REQUIRED", "แถวต้นทางไม่มี pipeline_run_id");
      const record = {
        house_reg_id: houseRegId,
        source_lat: sourceCoordinate.kind === "present" ? roundCoordinate(sourceCoordinate.point.lat) : "",
        source_lon: sourceCoordinate.kind === "present" ? roundCoordinate(sourceCoordinate.point.lon) : "",
        proposed_lat: validation.normalized.proposed_lat,
        proposed_lon: validation.normalized.proposed_lon,
        movement_m: validation.normalized.movement_m === null ? "" : validation.normalized.movement_m,
        coordinate_crs: COORDINATE_CRS,
        adjustment_action: validation.normalized.adjustment_action,
        adjustment_reason_code: validation.normalized.adjustment_reason_code,
        adjustment_reason_note: validation.normalized.adjustment_reason_note,
        evidence_source: validation.normalized.evidence_source,
        evidence_reference: validation.normalized.evidence_reference,
        evidence_observed_at: validation.normalized.evidence_observed_at,
        reviewer_code: validation.normalized.reviewer_code,
        adjustment_status: ADJUSTMENT_STATUS,
        adjustment_id: validation.normalized.adjustment_id,
        adjusted_at_utc: validation.normalized.adjusted_at_utc,
        export_batch_id: source.exportBatchId,
        source_pipeline_run_id: sourcePipelineRunId,
        source_sha256: source.sourceSha256,
        source_dataset_contract: source.sourceDatasetContract,
        source_confidence_band: cleanText(row.confidence_band),
        source_status: cleanText(row.status),
        source_geom_level: cleanText(row.geom_level),
        source_radius_m: Number.isFinite(row.radius_m) ? Number(row.radius_m) : "",
        source_review_flags: cleanText(row.review_flags),
        tool_release: source.toolRelease
      };
      records.push(Object.freeze(record));
    }

    records.sort((left, right) => left.house_reg_id < right.house_reg_id ? -1 : left.house_reg_id > right.house_reg_id ? 1 : 0);
    const frozenRecords = Object.freeze(records);
    return Object.freeze({
      headers: EXPORT_HEADERS,
      records: frozenRecords,
      csv: toCsv(frozenRecords, EXPORT_HEADERS)
    });
  };

  const api = Object.freeze({
    ADJUSTMENT_REASONS: Object.freeze([...ADJUSTMENT_REASONS]),
    ADJUSTMENT_STATUS,
    COORDINATE_CRS,
    EVIDENCE_SOURCES: Object.freeze([...EVIDENCE_SOURCES]),
    EXPORT_HEADERS,
    POSITION_REVIEW_FLAGS: Object.freeze([...POSITION_REVIEW_FLAGS]),
    STRONG_EVIDENCE_SOURCES: Object.freeze([...STRONG_EVIDENCE_SOURCES]),
    AdjustmentError,
    classifyEligibility,
    distanceMeters,
    nudgeCoordinate,
    validateAdjustment,
    buildAdjustmentExport,
    hardenSpreadsheetCell,
    csvCell,
    toCsv
  });

  root.CityChatCoordinateAdjustment = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
