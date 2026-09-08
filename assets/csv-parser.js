(function attachCityChatCsv(root) {
  "use strict";

  const HEADERS = Object.freeze([
    "house_reg_id",
    "house_no",
    "trok",
    "soi",
    "road",
    "community",
    "place_type",
    "lat",
    "lon",
    "radius_m",
    "tier",
    "confidence_band",
    "method",
    "status",
    "geom_level",
    "frontage_heading",
    "frontage_road",
    "frontage_road_layer",
    "frontage_road_source",
    "dist_named_soi_m",
    "soi_check",
    "business_count",
    "business_names",
    "business_status",
    "business_match_confidence",
    "review_priority",
    "review_score",
    "review_flags",
    "pipeline_run_id"
  ]);

  const GEOM_DISTRIBUTION = Object.freeze({
    parcel: 12713,
    building: 7151,
    cluster: 10321,
    interpolated: 2911,
    soi_road: 7130,
    community: 10,
    review: 2288
  });

  const CONFIDENCE_DISTRIBUTION = Object.freeze({
    "A0 สำรวจสิ่งปลูกสร้างของเทศบาล": 10114,
    "A จับคู่จากที่อยู่เจ้าของ": 1855,
    "B จับคู่แบบมีเงื่อนไข": 744,
    "C ยังไม่มีพิกัด ต้องตรวจ": 2288,
    "D ค่าประมาณกลุ่ม": 27523
  });

  const REVIEW_PRIORITY_DISTRIBUTION = Object.freeze({
    "สูง": 500,
    "กลาง": 2044,
    "ต่ำ": 3102
  });

  const PIPELINE_RUN_ID = "20260908T044243_f3b4ba_38e4d7_rules1.8.0";
  const FRONTAGE_LAYERS = new Set(["", "municipal", "osm"]);
  const FRONTAGE_SOURCES = new Set(["", "road+soi", "road_name", "nearest"]);

  const PRODUCTION_POLICY = Object.freeze({
    expectedSha256: "4f68b1c5a7f962a2ddc06e4e9f7bd6a9959e94c42bd65e2c94354153a04c19d5",
    expectedRowCount: 42524,
    expectedValidCoordinateCount: 40236,
    expectedNoCoordinateCount: 2288,
    expectedGeomDistribution: GEOM_DISTRIBUTION,
    expectedConfidenceDistribution: CONFIDENCE_DISTRIBUTION,
    expectedReviewPriorityDistribution: REVIEW_PRIORITY_DISTRIBUTION,
    expectedBusinessRowCount: 1379,
    expectedBusinessTagCount: 2048,
    expectedFrontageHeadingCount: 13960,
    expectedNamedFrontageCount: 8036,
    expectedMunicipalFrontageCount: 9630,
    expectedPipelineRunId: PIPELINE_RUN_ID,
    maxBytes: 20 * 1024 * 1024,
    maxCellChars: 4096,
    maxRowChars: 32768,
    maxColumns: HEADERS.length,
    maxDataRows: 42524,
    maxRadiusM: 100000
  });

  const FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;

  class CsvValidationError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = "CsvValidationError";
      this.code = code;
      if (details && Number.isInteger(details.rowNumber)) this.rowNumber = details.rowNumber;
      if (details && typeof details.columnName === "string") this.columnName = details.columnName;
    }
  }

  function fail(code, message, details) {
    throw new CsvValidationError(code, message, details);
  }

  function emitProgress(callback, detail) {
    if (typeof callback !== "function") return;
    try {
      callback(Object.freeze({ ...detail }));
    } catch (_) {
      // Progress reporting must never change parsing or validation results.
    }
  }

  function sanitizeText(value) {
    return String(value)
      .replace(/\r\n?/g, "\n")
      .replace(FORBIDDEN_CONTROLS, "")
      .replace(BIDI_CONTROLS, "")
      .trim();
  }

  function decodeUtf8Strict(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      fail("INVALID_BYTES", "ข้อมูลไฟล์อยู่ในรูปแบบที่อ่านไม่ได้");
    }

    let decoded;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_) {
      fail("INVALID_UTF8", "ไฟล์ต้องเข้ารหัสเป็น UTF-8 ที่สมบูรณ์");
    }

    return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
  }

  async function sha256Hex(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      fail("INVALID_BYTES", "ข้อมูลไฟล์อยู่ในรูปแบบที่อ่านไม่ได้");
    }
    if (!root.crypto || !root.crypto.subtle) {
      fail("CRYPTO_UNAVAILABLE", "เบราว์เซอร์นี้ไม่รองรับการตรวจลายนิ้วมือไฟล์อย่างปลอดภัย");
    }

    const start = bytes.byteOffset;
    const end = start + bytes.byteLength;
    const input = start === 0 && end === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.buffer.slice(start, end);
    const digest = await root.crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function validateHeader(header) {
    if (!Array.isArray(header)) {
      fail("MISSING_HEADER", "ไม่พบหัวตาราง CSV");
    }

    const seen = new Set();
    for (const name of header) {
      if (seen.has(name)) {
        fail("DUPLICATE_HEADER", "หัวตารางมีชื่อคอลัมน์ซ้ำ");
      }
      seen.add(name);
    }

    const missing = HEADERS.filter((name) => !seen.has(name));
    if (missing.length > 0) {
      fail("MISSING_HEADER", "หัวตารางขาดคอลัมน์ที่จำเป็น");
    }

    if (header.length !== HEADERS.length) {
      fail("HEADER_COUNT", `หัวตารางต้องมี ${HEADERS.length} คอลัมน์เท่านั้น`);
    }

    for (let index = 0; index < HEADERS.length; index += 1) {
      if (header[index] !== HEADERS[index]) {
        fail("HEADER_ORDER", "ชื่อหรือลำดับคอลัมน์ไม่ตรงกับชุดข้อมูลสำหรับหน้าแผนที่");
      }
    }
  }

  function parseCsvText(text, options) {
    if (typeof text !== "string") {
      fail("INVALID_TEXT", "ข้อมูล CSV ต้องเป็นข้อความ");
    }

    const limits = {
      maxCellChars: PRODUCTION_POLICY.maxCellChars,
      maxRowChars: PRODUCTION_POLICY.maxRowChars,
      maxColumns: PRODUCTION_POLICY.maxColumns,
      maxRows: PRODUCTION_POLICY.maxDataRows + 1,
      ...(options || {})
    };
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    let quoteClosed = false;
    let logicalRowChars = 0;
    let endedWithRecordBreak = false;

    function append(character) {
      field += character;
      logicalRowChars += character.length;
      if (field.length > limits.maxCellChars) {
        fail("CELL_TOO_LONG", "พบช่องข้อมูลที่ยาวเกินขีดจำกัด", { rowNumber: rows.length + 1 });
      }
      if (logicalRowChars > limits.maxRowChars) {
        fail("ROW_TOO_LONG", "พบแถวข้อมูลที่ยาวเกินขีดจำกัด", { rowNumber: rows.length + 1 });
      }
    }

    function finishField() {
      row.push(field);
      if (row.length > limits.maxColumns) {
        fail("TOO_MANY_COLUMNS", "พบแถวที่มีคอลัมน์เกินขีดจำกัด", { rowNumber: rows.length + 1 });
      }
      field = "";
      quoteClosed = false;
    }

    function finishRow() {
      finishField();
      rows.push(row);
      if (rows.length > limits.maxRows) {
        fail("TOO_MANY_ROWS", "ไฟล์มีจำนวนแถวเกินขีดจำกัด");
      }
      row = [];
      logicalRowChars = 0;
    }

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      endedWithRecordBreak = false;

      if (inQuotes) {
        if (character === '"') {
          if (text[index + 1] === '"') {
            append('"');
            index += 1;
          } else {
            inQuotes = false;
            quoteClosed = true;
          }
        } else {
          append(character);
        }
        continue;
      }

      if (quoteClosed) {
        if (character === ",") {
          finishField();
          continue;
        }
        if (character === "\r" || character === "\n") {
          if (character === "\r" && text[index + 1] === "\n") index += 1;
          finishRow();
          endedWithRecordBreak = true;
          continue;
        }
        fail("CHAR_AFTER_QUOTE", "พบอักขระที่ไม่ถูกต้องหลังเครื่องหมายคำพูด", {
          rowNumber: rows.length + 1
        });
      }

      if (character === '"') {
        if (field.length !== 0) {
          fail("UNEXPECTED_QUOTE", "พบเครื่องหมายคำพูดในตำแหน่งที่ไม่ถูกต้อง", {
            rowNumber: rows.length + 1
          });
        }
        inQuotes = true;
        continue;
      }

      if (character === ",") {
        finishField();
        continue;
      }

      if (character === "\r" || character === "\n") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        finishRow();
        endedWithRecordBreak = true;
        continue;
      }

      append(character);
    }

    if (inQuotes) {
      fail("UNCLOSED_QUOTE", "พบช่องข้อมูลที่เปิดเครื่องหมายคำพูดไว้แต่ไม่ปิด", {
        rowNumber: rows.length + 1
      });
    }

    if (!endedWithRecordBreak && (field.length > 0 || row.length > 0 || quoteClosed)) {
      finishRow();
    }

    return rows;
  }

  function numberOrNull(value, columnName, rowNumber, constraints) {
    if (value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number)) {
      fail("INVALID_NUMBER", `คอลัมน์ ${columnName} ต้องเป็นตัวเลขที่สมบูรณ์`, { rowNumber, columnName });
    }
    if (constraints && (number < constraints.min || number > constraints.max)) {
      fail("NUMBER_OUT_OF_RANGE", `คอลัมน์ ${columnName} อยู่นอกช่วงที่ยอมรับ`, { rowNumber, columnName });
    }
    return number;
  }

  function normalizePolicy(policy) {
    const candidate = { ...PRODUCTION_POLICY, ...(policy || {}) };
    candidate.expectedGeomDistribution = Object.freeze({ ...(candidate.expectedGeomDistribution || {}) });
    candidate.expectedConfidenceDistribution = Object.freeze({ ...(candidate.expectedConfidenceDistribution || {}) });
    candidate.expectedReviewPriorityDistribution = Object.freeze({ ...(candidate.expectedReviewPriorityDistribution || {}) });
    return candidate;
  }

  function sanitizeAndValidateRows(parsedRows, policy, onProgress) {
    const rules = normalizePolicy(policy);
    if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
      fail("MISSING_HEADER", "ไม่พบหัวตาราง CSV");
    }

    // Header names and order are part of the approved display-dataset contract. Do not
    // normalize them: even otherwise harmless whitespace must fail closed.
    const header = parsedRows[0];
    validateHeader(header);

    const dataRows = parsedRows.slice(1);
    if (dataRows.length !== rules.expectedRowCount) {
      fail("ROW_COUNT_MISMATCH", `จำนวนแถวข้อมูลต้องเท่ากับ ${rules.expectedRowCount.toLocaleString("en-US")}`);
    }

    const geomCounts = Object.create(null);
    for (const key of Object.keys(rules.expectedGeomDistribution)) geomCounts[key] = 0;
    const confidenceCounts = Object.create(null);
    for (const key of Object.keys(rules.expectedConfidenceDistribution)) confidenceCounts[key] = 0;
    const reviewPriorityCounts = Object.create(null);
    for (const key of Object.keys(rules.expectedReviewPriorityDistribution)) reviewPriorityCounts[key] = 0;

    let validCoordinateCount = 0;
    let noCoordinateCount = 0;
    let businessRowCount = 0;
    let businessTagCount = 0;
    let frontageHeadingCount = 0;
    let namedFrontageCount = 0;
    let municipalFrontageCount = 0;
    const houseIds = new Set();
    const rows = new Array(dataRows.length);

    for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
      const source = dataRows[rowIndex];
      const rowNumber = rowIndex + 2;
      if (source.length !== HEADERS.length) {
        fail("ROW_WIDTH", `แถวข้อมูลต้องมี ${HEADERS.length} คอลัมน์`, { rowNumber });
      }

      const values = source.map(sanitizeText);
      const row = {};
      for (let columnIndex = 0; columnIndex < HEADERS.length; columnIndex += 1) {
        row[HEADERS[columnIndex]] = values[columnIndex];
      }

      const lat = numberOrNull(row.lat, "lat", rowNumber, { min: -90, max: 90 });
      const lon = numberOrNull(row.lon, "lon", rowNumber, { min: -180, max: 180 });
      if ((lat === null) !== (lon === null)) {
        fail("INCOMPLETE_COORDINATE", "ละติจูดและลองจิจูดต้องมีครบทั้งคู่หรือเว้นว่างทั้งคู่", { rowNumber });
      }
      if (lat === null) noCoordinateCount += 1;
      else validCoordinateCount += 1;

      const radius = numberOrNull(row.radius_m, "radius_m", rowNumber, {
        min: 0,
        max: rules.maxRadiusM
      });
      if ((radius === null) !== (lat === null)) {
        fail("RADIUS_COORDINATE_CONFLICT", "รัศมีต้องมีเมื่อมีพิกัด และเว้นว่างเมื่อยังไม่มีพิกัด", {
          rowNumber,
          columnName: "radius_m"
        });
      }

      const frontageHeading = numberOrNull(row.frontage_heading, "frontage_heading", rowNumber, {
        min: 0,
        max: 360
      });
      if (frontageHeading !== null && lat === null) {
        fail("HEADING_WITHOUT_COORDINATE", "ทิศหน้าบ้านใช้ได้เฉพาะแถวที่มีพิกัด", {
          rowNumber,
          columnName: "frontage_heading"
        });
      }
      if (!FRONTAGE_LAYERS.has(row.frontage_road_layer) || !FRONTAGE_SOURCES.has(row.frontage_road_source)) {
        fail("UNKNOWN_FRONTAGE_SOURCE", "พบแหล่งแนวถนนหรือวิธีเลือกแนวถนนที่ไม่รองรับ", {
          rowNumber,
          columnName: "frontage_road_source"
        });
      }
      const hasFrontageMetadata = Boolean(row.frontage_road_layer || row.frontage_road_source);
      if ((frontageHeading !== null) !== hasFrontageMetadata || (frontageHeading !== null && (!row.frontage_road_layer || !row.frontage_road_source))) {
        fail("FRONTAGE_METADATA_CONFLICT", "ทิศหน้าบ้านและข้อมูลแนวถนนต้องมีพร้อมกันหรือเว้นว่างพร้อมกัน", {
          rowNumber,
          columnName: "frontage_heading"
        });
      }
      if (frontageHeading !== null) frontageHeadingCount += 1;
      if (["road+soi", "road_name"].includes(row.frontage_road_source)) namedFrontageCount += 1;
      if (row.frontage_road_layer === "municipal") municipalFrontageCount += 1;

      const distNamedSoiM = numberOrNull(row.dist_named_soi_m, "dist_named_soi_m", rowNumber, {
        min: 0,
        max: rules.maxRadiusM
      });

      const businessCount = numberOrNull(row.business_count, "business_count", rowNumber, {
        min: 0,
        max: 100000
      });
      if (!Number.isInteger(businessCount)) {
        fail("INVALID_INTEGER", "คอลัมน์ business_count ต้องเป็นจำนวนเต็ม", {
          rowNumber,
          columnName: "business_count"
        });
      }
      const hasBusinessDetails = Boolean(row.business_names || row.business_status || row.business_match_confidence);
      if ((businessCount > 0) !== hasBusinessDetails) {
        fail("BUSINESS_FIELDS_CONFLICT", "จำนวนกิจการไม่สอดคล้องกับรายละเอียดกิจการ", {
          rowNumber,
          columnName: "business_count"
        });
      }
      if (businessCount > 0 && (!row.business_names || !row.business_status || !row.business_match_confidence)) {
        fail("MISSING_BUSINESS_DETAIL", "แถวที่มีกิจการต้องมีชื่อ สถานะ และระดับการจับคู่", {
          rowNumber,
          columnName: "business_names"
        });
      }
      if (businessCount > 0) businessRowCount += 1;
      businessTagCount += businessCount;

      const reviewScore = numberOrNull(row.review_score, "review_score", rowNumber, {
        min: 0,
        max: 100000
      });
      if (reviewScore !== null && row.review_priority === "") {
        fail("REVIEW_SCORE_CONFLICT", "คะแนนจัดคิวต้องอ้างถึงแถวที่มีลำดับการตรวจ", {
          rowNumber,
          columnName: "review_score"
        });
      }

      if (!Object.prototype.hasOwnProperty.call(geomCounts, row.geom_level)) {
        fail("UNKNOWN_GEOM_LEVEL", "พบระดับตำแหน่งที่ไม่อยู่ในชุดข้อมูลสำหรับหน้าแผนที่", {
          rowNumber,
          columnName: "geom_level"
        });
      }
      geomCounts[row.geom_level] += 1;

      if (!Object.prototype.hasOwnProperty.call(confidenceCounts, row.confidence_band)) {
        fail("UNKNOWN_CONFIDENCE_BAND", "พบชั้นความเชื่อมั่นที่ไม่อยู่ในชุดข้อมูลสำหรับหน้าแผนที่", {
          rowNumber,
          columnName: "confidence_band"
        });
      }
      confidenceCounts[row.confidence_band] += 1;

      if (row.review_priority) {
        if (!Object.prototype.hasOwnProperty.call(reviewPriorityCounts, row.review_priority)) {
          fail("UNKNOWN_REVIEW_PRIORITY", "พบลำดับการตรวจที่ไม่รองรับ", {
            rowNumber,
            columnName: "review_priority"
          });
        }
        reviewPriorityCounts[row.review_priority] += 1;
      }

      if ((row.geom_level === "review") !== (lat === null)) {
        fail("GEOM_COORDINATE_CONFLICT", "ระดับตำแหน่งไม่สอดคล้องกับการมีหรือไม่มีพิกัด", {
          rowNumber,
          columnName: "geom_level"
        });
      }

      if (rules.expectedPipelineRunId !== null && row.pipeline_run_id !== rules.expectedPipelineRunId) {
        fail("PIPELINE_RUN_MISMATCH", "รหัสรอบประมวลผลไม่ตรงกับชุดข้อมูลที่กำหนด", {
          rowNumber,
          columnName: "pipeline_run_id"
        });
      }

      if (!row.house_reg_id || houseIds.has(row.house_reg_id)) {
        fail("HOUSE_ID_CONFLICT", "รหัสประจำบ้านต้องมีค่าและไม่ซ้ำกัน", {
          rowNumber,
          columnName: "house_reg_id"
        });
      }
      houseIds.add(row.house_reg_id);

      row.lat = lat;
      row.lon = lon;
      row.radius_m = radius;
      row.frontage_heading = frontageHeading;
      row.dist_named_soi_m = distNamedSoiM;
      row.business_count = businessCount;
      row.review_score = reviewScore;
      rows[rowIndex] = row;

      if ((rowIndex + 1) % 2048 === 0 || rowIndex + 1 === dataRows.length) {
        emitProgress(onProgress, {
          stage: "parsing",
          rowsParsed: rowIndex + 1,
          totalRows: dataRows.length
        });
      }
    }

    if (validCoordinateCount !== rules.expectedValidCoordinateCount) {
      fail("COORDINATE_COUNT_MISMATCH", "จำนวนแถวที่มีพิกัดไม่ตรงกับชุดข้อมูลสำหรับหน้าแผนที่");
    }
    if (noCoordinateCount !== rules.expectedNoCoordinateCount) {
      fail("NO_COORDINATE_COUNT_MISMATCH", "จำนวนแถวที่ไม่มีพิกัดไม่ตรงกับชุดข้อมูลสำหรับหน้าแผนที่");
    }

    for (const [level, expected] of Object.entries(rules.expectedGeomDistribution)) {
      if (geomCounts[level] !== expected) {
        fail("GEOM_DISTRIBUTION_MISMATCH", "การกระจายระดับตำแหน่งไม่ตรงกับชุดข้อมูลสำหรับหน้าแผนที่");
      }
    }

    for (const [band, expected] of Object.entries(rules.expectedConfidenceDistribution)) {
      if (confidenceCounts[band] !== expected) {
        fail("CONFIDENCE_DISTRIBUTION_MISMATCH", "การกระจายชั้นความเชื่อมั่นไม่ตรงกับชุดข้อมูลสำหรับหน้าแผนที่");
      }
    }
    for (const [priority, expected] of Object.entries(rules.expectedReviewPriorityDistribution)) {
      if (reviewPriorityCounts[priority] !== expected) {
        fail("REVIEW_PRIORITY_DISTRIBUTION_MISMATCH", "จำนวนรายการตามลำดับการตรวจไม่ตรงกับชุดข้อมูลสำหรับหน้าแผนที่");
      }
    }
    if (rules.expectedBusinessRowCount !== null && businessRowCount !== rules.expectedBusinessRowCount) {
      fail("BUSINESS_ROW_COUNT_MISMATCH", "จำนวนแถวที่มีกิจการไม่ตรงกับชุดข้อมูลสำหรับหน้าแผนที่");
    }
    if (rules.expectedBusinessTagCount !== null && businessTagCount !== rules.expectedBusinessTagCount) {
      fail("BUSINESS_TAG_COUNT_MISMATCH", "จำนวนป้ายกิจการไม่ตรงกับชุดข้อมูลสำหรับหน้าแผนที่");
    }
    if (rules.expectedFrontageHeadingCount !== null && frontageHeadingCount !== rules.expectedFrontageHeadingCount) {
      fail("FRONTAGE_HEADING_COUNT_MISMATCH", "จำนวนแถวที่มีทิศหน้าบ้านไม่ตรงกับชุดข้อมูลสำหรับหน้าแผนที่");
    }
    if (rules.expectedNamedFrontageCount !== null && namedFrontageCount !== rules.expectedNamedFrontageCount) {
      fail("NAMED_FRONTAGE_COUNT_MISMATCH", "จำนวนแถวที่จับคู่แนวถนนจากชื่อไม่ตรงกับชุดข้อมูลสำหรับหน้าแผนที่");
    }
    if (rules.expectedMunicipalFrontageCount !== null && municipalFrontageCount !== rules.expectedMunicipalFrontageCount) {
      fail("MUNICIPAL_FRONTAGE_COUNT_MISMATCH", "จำนวนแถวที่ใช้แนวถนนเทศบาลไม่ตรงกับชุดข้อมูลสำหรับหน้าแผนที่");
    }

    return {
      rows,
      summary: {
        rowCount: rows.length,
        columnCount: HEADERS.length,
        validCoordinateCount,
        noCoordinateCount,
        geomDistribution: { ...geomCounts },
        confidenceDistribution: { ...confidenceCounts },
        reviewPriorityDistribution: { ...reviewPriorityCounts },
        businessRowCount,
        businessTagCount,
        frontageHeadingCount,
        namedFrontageCount,
        municipalFrontageCount,
        pipelineRunId: rules.expectedPipelineRunId
      }
    };
  }

  function parseAndValidateText(text, policy, onProgress) {
    const rules = normalizePolicy(policy);
    const parsedRows = parseCsvText(text, {
      maxCellChars: rules.maxCellChars,
      maxRowChars: rules.maxRowChars,
      maxColumns: rules.maxColumns,
      maxRows: rules.maxDataRows + 1
    });
    return sanitizeAndValidateRows(parsedRows, rules, onProgress);
  }

  async function parseVerifiedBytes(bytes, onProgress) {
    if (!(bytes instanceof Uint8Array)) {
      fail("INVALID_BYTES", "ข้อมูลไฟล์อยู่ในรูปแบบที่อ่านไม่ได้");
    }
    if (bytes.byteLength === 0) fail("EMPTY_FILE", "ไฟล์ว่างเปล่า");
    if (bytes.byteLength > PRODUCTION_POLICY.maxBytes) {
      fail("FILE_TOO_LARGE", "ไฟล์มีขนาดเกิน 20 MB");
    }

    emitProgress(onProgress, { stage: "hashing", completed: 0, total: bytes.byteLength });
    const checksum = await sha256Hex(bytes);
    emitProgress(onProgress, { stage: "hashing", completed: bytes.byteLength, total: bytes.byteLength });
    if (checksum !== PRODUCTION_POLICY.expectedSha256) {
      fail("CHECKSUM_MISMATCH", "ไฟล์ไม่ตรงกับชุดข้อมูลหน้าแผนที่ฉบับวันที่ 8 ก.ย. 2569");
    }

    emitProgress(onProgress, { stage: "decoding", completed: 0, total: bytes.byteLength });
    const text = decodeUtf8Strict(bytes);
    emitProgress(onProgress, { stage: "decoding", completed: bytes.byteLength, total: bytes.byteLength });
    const result = parseAndValidateText(text, PRODUCTION_POLICY, onProgress);
    result.summary.sha256 = checksum;
    result.summary.byteLength = bytes.byteLength;
    return result;
  }

  async function parseVerifiedFile(file, onProgress) {
    if (!file || typeof file.arrayBuffer !== "function" || !Number.isFinite(file.size)) {
      fail("INVALID_FILE", "กรุณาเลือกไฟล์ CSV จากเครื่อง");
    }
    if (file.size === 0) fail("EMPTY_FILE", "ไฟล์ว่างเปล่า");
    if (file.size > PRODUCTION_POLICY.maxBytes) {
      fail("FILE_TOO_LARGE", "ไฟล์มีขนาดเกิน 20 MB");
    }

    emitProgress(onProgress, { stage: "reading", completed: 0, total: file.size });
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (_) {
      fail("FILE_READ_FAILED", "ไม่สามารถอ่านไฟล์จากเครื่องได้");
    }
    emitProgress(onProgress, { stage: "reading", completed: file.size, total: file.size });
    return parseVerifiedBytes(new Uint8Array(buffer), onProgress);
  }

  const api = Object.freeze({
    HEADERS,
    GEOM_DISTRIBUTION,
    CONFIDENCE_DISTRIBUTION,
    REVIEW_PRIORITY_DISTRIBUTION,
    PIPELINE_RUN_ID,
    PRODUCTION_POLICY,
    CsvValidationError,
    sanitizeText,
    decodeUtf8Strict,
    sha256Hex,
    validateHeader,
    parseCsvText,
    sanitizeAndValidateRows,
    parseAndValidateText,
    parseVerifiedBytes,
    parseVerifiedFile
  });

  Object.defineProperty(root, "CityChatCsv", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: api
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
