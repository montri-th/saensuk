(() => {
  "use strict";

  const explorer = document.querySelector("[data-explorer]");
  if (!explorer) return;

  const fallbackCoordinateKey = (row) => Number.isFinite(row?.lat) && Number.isFinite(row?.lon)
    ? `${Number(row.lat).toFixed(7)},${Number(row.lon).toFixed(7)}`
    : "";
  const markerGrouping = window.CityChatMarkerGrouping || {
    coordinateKey: fallbackCoordinateKey,
    layoutGroups: (indices, rows) => (Array.isArray(indices) ? indices : [])
      .filter((index) => Number.isInteger(index) && Number.isFinite(rows?.[index]?.lat) && Number.isFinite(rows?.[index]?.lon))
      .map((index) => ({ indices: [index], coordinateKey: fallbackCoordinateKey(rows[index]), buildingKind: "", buildingGroup: false })),
    combineCoordinateTargets: (targets) => {
      const valid = (Array.isArray(targets) ? targets : []).filter((target) => Array.isArray(target?.indices));
      if (!valid.length) return null;
      const indices = [...new Set(valid.flatMap((target) => target.indices))];
      return { ...valid[valid.length - 1], indices, coordinateStack: indices.length > 1 };
    },
    combineOrdinaryScreenOverlaps: (_markers, anchor) => anchor || null
  };

  const isSafeTopLevel = () => {
    try {
      return window.top === window.self && document.documentElement.dataset.topLevelSafe === "true";
    } catch (_) {
      return false;
    }
  };
  const guardedFileInput = explorer.querySelector("[data-file-input]");
  if (!isSafeTopLevel()) {
    if (guardedFileInput) guardedFileInput.disabled = true;
    document.querySelectorAll("[data-file-label]").forEach((label) => {
      label.setAttribute("aria-disabled", "true");
      label.tabIndex = -1;
    });
    const warning = explorer.querySelector("[data-embedding-warning]");
    if (warning) warning.hidden = false;
    return;
  }
  if (guardedFileInput) guardedFileInput.disabled = false;

  const PAGE_SIZE = 30;
  const DATASET_CONTRACT = "housemapdisplaydataset";
  const TOOL_RELEASE = "citychat-saensuk-v9-point-adjustment-20260908";
  const WORKER_URL = "assets/record-worker.js?v=20260908-display-v3-r3";
  const NUMBER = new Intl.NumberFormat("th-TH");
  const csvParser = window.CityChatCsv || null;
  const csvParserReady = Boolean(
    csvParser &&
    typeof csvParser.parseVerifiedFile === "function" &&
    typeof csvParser.CsvValidationError === "function" &&
    csvParser.PRODUCTION_POLICY?.expectedFileName === "03CityChat__housemapdisplaydataset__v3__20260908.csv" &&
    csvParser.PRODUCTION_POLICY?.expectedByteLength === 15709401 &&
    csvParser.PRODUCTION_POLICY?.expectedSha256 === "a57f1462fdc5b23f88d90856b0e2556d2d231d6e0b17af3468e133ed2770d8f5" &&
    csvParser.PRODUCTION_POLICY?.expectedRowCount === 42524
  );
  const adjustmentTools = window.CityChatCoordinateAdjustment || null;
  const REQUIRED_ADJUSTMENT_API = Object.freeze([
    "classifyEligibility",
    "distanceMeters",
    "nudgeCoordinate",
    "validateAdjustment",
    "buildAdjustmentExport"
  ]);
  const adjustmentApiReady = Boolean(
    adjustmentTools &&
    REQUIRED_ADJUSTMENT_API.every((name) => typeof adjustmentTools[name] === "function") &&
    Array.isArray(adjustmentTools.ADJUSTMENT_REASONS) &&
    Array.isArray(adjustmentTools.EVIDENCE_SOURCES) &&
    Array.isArray(adjustmentTools.POSITION_REVIEW_FLAGS) &&
    Array.isArray(adjustmentTools.STRONG_EVIDENCE_SOURCES)
  );

  const CONFIDENCE_KEYS = Object.freeze({
    "A0 สำรวจสิ่งปลูกสร้างของเทศบาล": "a0",
    "A จับคู่จากที่อยู่เจ้าของ": "a",
    "B จับคู่แบบมีเงื่อนไข": "b",
    "C ยังไม่มีพิกัด ต้องตรวจ": "c",
    "D ค่าประมาณกลุ่ม": "d"
  });

  const REVIEW_PRIORITY_RANK = Object.freeze({ "สูง": 0, "กลาง": 1, "ต่ำ": 2 });

  const GEOM_LABELS = Object.freeze({
    parcel: "ระดับแปลง",
    building: "ระดับอาคาร",
    cluster: "ระดับกลุ่มบ้าน",
    interpolated: "แทรกระหว่างเพื่อนบ้าน",
    soi_road: "ระดับซอย/ถนน",
    community: "ระดับชุมชน",
    review: "งดเดา—รอคนตรวจ"
  });

  const STATUS_LABELS = Object.freeze({
    "approximate-unverified": "ตำแหน่งประมาณ—ยังไม่ยืนยัน",
    "prototype-unverified": "ผลต้นแบบ—ยังไม่ยืนยัน",
    "needs-review": "ต้องให้คนตรวจ",
    "desk-lookup-unverified": "ค้นจากโต๊ะทำงาน—ยังไม่ยืนยัน",
    "building-lookup-pending": "รอค้นอาคาร"
  });

  const METHOD_LABELS = Object.freeze({
    A0: "สำรวจสิ่งปลูกสร้างของเทศบาลผูกบ้านกับแปลง",
    A1: "จับคู่ที่อยู่เจ้าของกับแปลงเดียวและชื่อถนนตรง",
    A2: "จับคู่ที่อยู่เจ้าของกับแปลงเดียว โดยเพื่อนบ้านช่วยยืนยัน",
    B2: "จับคู่ที่อยู่ที่ข้อมูลซอยไม่ครบ โดยถนนและเพื่อนบ้านช่วยยืนยัน",
    B3: "จับคู่ที่อยู่ที่ข้อมูลซอยไม่ครบ โดยเพื่อนบ้านช่วยยืนยัน",
    B4: "เลือกไซต์ของเจ้าของที่อยู่ใกล้บ้านอ้างอิง",
    B5: "มีหลักฐานบางส่วนขัดกัน แต่เพื่อนบ้านช่วยยืนยัน",
    B6: "แปลงผู้สมัครเดียวอยู่ในขอบเขตชุมชน",
    B7: "เลือกไซต์เดียวที่อยู่ในขอบเขตชุมชน",
    C1: "มีหลายแปลงผู้สมัครและยังเลือกไม่ได้",
    C2: "ถนนหรือซอยขัดกันและยังไม่มีเพื่อนบ้านยืนยัน",
    C3: "จับคู่ที่อยู่ได้ แต่ยังไม่มีหลักฐานตำแหน่งช่วยยืนยัน",
    C4: "จับคู่ที่อยู่ที่ข้อมูลซอยไม่ครบ และยังไม่มีเพื่อนบ้านยืนยัน",
    C5: "จับคู่ได้เฉพาะบ้านเลขที่ และยังไม่มีเพื่อนบ้านยืนยัน",
    E1: "ใช้จุดกลางของกลุ่มบ้านเลขที่หลักเดียวกัน",
    E2a: "ใช้จุดกลางกลุ่มบ้านเลขที่ย่อยใกล้เคียง",
    E2b: "ใช้จุดกลางกลุ่มบ้านเลขที่หลักเดียวกันในระดับซอยหรือถนน",
    E3: "อ้างอิงบ้านเลขที่หลักเดียวกันเพียงจุดเดียว",
    I1: "แทรกตำแหน่งระหว่างบ้านเลขที่ข้างเคียงระยะใกล้",
    I2: "แทรกตำแหน่งระหว่างบ้านเลขที่ข้างเคียงระยะไกล",
    S: "ใช้จุดกลางบ้านอ้างอิงในถนนและซอยเดียวกัน",
    K: "ใช้จุดกลางบ้านอ้างอิงในชุมชนเดียวกัน",
    BL1: "ผูกอาคารกับแปลงจากทะเบียนนิติบุคคลที่อยู่เป็นกลุ่มเดียวกัน",
    "desk-lookup": "ค้นตำแหน่งโครงการจากหลักฐานสาธารณะ",
    "condo-pending": "ใช้จุดกลางกลุ่มห้องชุดชั่วคราว ระหว่างรอค้นอาคาร"
  });

  const REVIEW_LABELS = Object.freeze({
    "plate-matches": "เห็นป้ายทะเบียนบ้านตรงกับรายการ",
    "plate-conflicts": "เห็นป้าย แต่เลขไม่ตรงกับรายการ",
    "plate-not-visible": "มองไม่เห็นหรืออ่านป้ายไม่ได้",
    "building-context-matches": "บริบทอาคารสอดคล้องกับรายการ",
    "building-context-conflicts": "บริบทอาคารไม่สอดคล้องกับรายการ",
    "building-context-not-visible": "มองไม่เห็นหรือระบุอาคารไม่ได้",
    "no-imagery": "ไม่มีภาพถนนใช้ตรวจ",
    "field-visit": "ต้องส่งลงพื้นที่"
  });

  const EVIDENCE_SOURCE_LABELS = Object.freeze({
    "google-street-view": "Google Street View",
    "google-maps": "Google Maps (ดูบริเวณ)",
    "field-observation": "สำรวจภาคสนาม",
    "agency-evidence": "ภาพหรือเอกสารภายในหน่วยงาน",
    "table-review": "ตรวจจากข้อมูลในตาราง"
  });

  const REVIEW_RESULTS_BY_SCOPE = Object.freeze({
    "house-plate": Object.freeze({
      "google-street-view": new Set(["plate-matches", "plate-conflicts", "plate-not-visible", "no-imagery", "field-visit"]),
      "google-maps": new Set(["no-imagery", "field-visit"]),
      "field-observation": new Set(["plate-matches", "plate-conflicts", "plate-not-visible", "field-visit"]),
      "agency-evidence": new Set(["plate-matches", "plate-conflicts", "plate-not-visible", "field-visit"]),
      "table-review": new Set(["field-visit"])
    }),
    "building-context": Object.freeze({
      "google-street-view": new Set(["building-context-matches", "building-context-conflicts", "building-context-not-visible", "no-imagery", "field-visit"]),
      "google-maps": new Set(["no-imagery", "field-visit"]),
      "field-observation": new Set(["building-context-matches", "building-context-conflicts", "building-context-not-visible", "field-visit"]),
      "agency-evidence": new Set(["building-context-matches", "building-context-conflicts", "building-context-not-visible", "field-visit"]),
      "table-review": new Set(["field-visit"])
    })
  });

  const STRONG_REVIEW_RESULTS = new Set([
    "plate-matches",
    "plate-conflicts",
    "building-context-matches",
    "building-context-conflicts"
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

  const FLAG_LABELS = Object.freeze({
    cluster_centroid: "ใช้จุดกลางกลุ่มบ้าน",
    pending_step5_6: "รอขั้นตรวจถัดไป",
    pending_building_lookup: "รอค้นอาคาร",
    snap_none_no_free_parcel: "ยังเลือกแปลงไม่ได้",
    shared_parcel_cross_soi: "แปลงร่วมข้ามซอย",
    large_parcel: "แปลงขนาดใหญ่",
    citymeter_far: "หลักฐาน CityMETER อยู่ไกล",
    citymeter_agrees: "CityMETER สอดคล้อง",
    bl1_web_conflict: "หลักฐานเว็บขัดกัน",
    bl1_web_agrees: "หลักฐานเว็บสอดคล้อง",
    condo_unit_matched_as_house: "ห้องชุดจับคู่แบบบ้าน",
    duplicate_registry_key: "ที่อยู่ทะเบียนซ้ำ",
    desk_lookup_project: "รหัสโครงการจากการค้นโต๊ะทำงาน",
    citymeter_name_matches_ltax_company: "ชื่อ CityMETER ตรงกับชื่อนิติบุคคลใน LTAX",
    building_register_agrees: "ทะเบียนสิ่งปลูกสร้างตรงกับแปลงเดิม",
    building_register_moved: "ทะเบียนสิ่งปลูกสร้างชี้ไปคนละแปลง",
    building_register_conflict: "หลักฐานใหม่กับเดิมห่างกันเกิน 50 ม.",
    building_register_multi_site: "บ้านเลขที่–ถนนชี้ได้หลายไซต์",
    far_from_road: "จุดอยู่ห่างโครงข่ายถนนเกิน 50 ม.",
    survey_row_kept: "คงผลสำรวจแม้ชุมชนหรือเพื่อนบ้านขัดกัน",
    community_conflict: "หลักฐานชุมชนขัดกัน",
    community_conflict_reestimated: "ประมาณใหม่เพราะหลักฐานชุมชนขัดกัน",
    outside_community_polygon: "จุดอยู่นอกขอบเขตชุมชนที่ระบุ",
    anchor_contradicted: "จุดอ้างอิงถูกหลักฐานอื่นคัดค้าน",
    anchor_isolated: "จุดอ้างอิงอยู่โดดเดี่ยว",
    estate_outlier: "จุดต่างจากกลุ่มโครงการ",
    neighbours_other_community: "เพื่อนบ้านอ้างต่างชุมชน",
    soi_mixes_communities: "ซอยเดียวมีหลายชุมชน",
    owner_multi_parcel: "ที่อยู่เจ้าของเชื่อมได้หลายแปลง",
    owner_major_holder: "แปลงของผู้ถือครองรายใหญ่",
    house_on_institutional_land: "ตำแหน่งตกบนที่ดินสถาบัน",
    snap_multi_house_parcel: "หลายบ้านใช้แปลงเดียวกัน",
    snap_outside_community: "จุดประมาณอยู่นอกชุมชนที่ระบุ",
    snap_landlord_block: "จุดประมาณอยู่ในกลุ่มแปลงผู้ถือครองเดียว",
    soi_disambiguated_by_community: "ใช้ชุมชนช่วยแยกซอยที่กำกวม",
    community_confirmed: "ขอบเขตชุมชนสอดคล้อง",
    community_polygon_only: "อ้างอิงเฉพาะรูปชุมชน",
    frontage_road_by_name: "ทิศหน้าบ้านอ้างอิงจากชื่อถนน",
    far_from_named_soi: "จุดอยู่ห่างจากซอยที่ระบุ",
    soi_name_needs_review: "ชื่อซอยนี้ต้องให้เทศบาลตรวจตำแหน่งหรือที่อยู่ทะเบียน",
    frontage_none: "ยังหาด้านติดถนนของแปลงไม่ได้",
    frontage_no_road: "ยังไม่พบแนวถนนใกล้แปลง",
    frontage_off_parcel: "จุดหน้าบ้านอาจอยู่นอกแปลง",
    condo_unit: "รายการนี้เป็นห้องชุด"
  });

  const FRONTAGE_SOURCE_LABELS = Object.freeze({
    "road+soi": "จับคู่จากชื่อถนนและซอย",
    road_name: "จับคู่จากชื่อถนน",
    soi: "จับคู่จากชื่อซอย",
    nearest: "เลือกแนวถนนที่ใกล้แปลงที่สุด"
  });

  const FRONTAGE_LAYER_LABELS = Object.freeze({
    municipal: "ทะเบียนถนนของเทศบาล",
    osm: "OpenStreetMap"
  });

  const CRITICAL_FLAG_CHIPS = Object.freeze({
    building_register_conflict: "หลักฐานตำแหน่งขัดกันเกิน 50 ม.",
    building_register_multi_site: "บ้านเลขที่–ถนนชี้ได้หลายไซต์",
    far_from_road: "จุดห่างโครงข่ายถนนเกิน 50 ม.",
    building_register_moved: "ทะเบียนสิ่งปลูกสร้างชี้ไปคนละแปลง"
  });

  const elements = {
    fileGate: explorer.querySelector("[data-file-gate]"),
    fileInput: explorer.querySelector("[data-file-input]"),
    parseState: explorer.querySelector("[data-parse-state]"),
    parseTitle: explorer.querySelector("[data-parse-title]"),
    parseDetail: explorer.querySelector("[data-parse-detail]"),
    alert: explorer.querySelector("[data-explorer-alert]"),
    alertTitle: explorer.querySelector("[data-alert-title]"),
    alertDetail: explorer.querySelector("[data-alert-detail]"),
    alertReset: explorer.querySelector("[data-alert-reset]"),
    workspace: explorer.querySelector("[data-workspace]"),
    datasetRows: explorer.querySelector("[data-dataset-rows]"),
    changeFile: explorer.querySelector("[data-change-file]"),
    clearFile: explorer.querySelector("[data-clear-file]"),
    exportButton: explorer.querySelector("[data-export]"),
    reviewCount: explorer.querySelector("[data-review-count]"),
    answer: explorer.querySelector("[data-workspace-answer]"),
    mobileTabs: [...explorer.querySelectorAll("[data-mobile-panel]")],
    reviewGrid: explorer.querySelector(".review-grid"),
    queuePane: explorer.querySelector("[data-panel=\"queue\"]"),
    detailPane: explorer.querySelector("[data-panel=\"detail\"]"),
    search: explorer.querySelector("[data-search]"),
    geomFilter: explorer.querySelector("[data-geom-filter]"),
    communityFilter: explorer.querySelector("[data-community-filter]"),
    roadFilter: explorer.querySelector("[data-road-filter]"),
    placeFilter: explorer.querySelector("[data-place-filter]"),
    confidenceFilter: explorer.querySelector("[data-confidence-filter]"),
    businessFilter: explorer.querySelector("[data-business-filter]"),
    priorityFilter: explorer.querySelector("[data-priority-filter]"),
    evidenceFilter: explorer.querySelector("[data-evidence-filter]"),
    reviewFilters: [...explorer.querySelectorAll("[data-review-filter]")],
    filteredCount: explorer.querySelector("[data-filtered-count]"),
    filteredWithCoordinate: explorer.querySelector("[data-filtered-with-coordinate]"),
    filteredWithoutCoordinate: explorer.querySelector("[data-filtered-without-coordinate]"),
    filteredBusiness: explorer.querySelector("[data-filtered-business]"),
    filteredReview: explorer.querySelector("[data-filtered-review]"),
    resultNote: explorer.querySelector("[data-result-note]"),
    list: explorer.querySelector("[data-record-list]"),
    pagePrev: explorer.querySelector("[data-page-prev]"),
    pageNext: explorer.querySelector("[data-page-next]"),
    pageLabel: explorer.querySelector("[data-page-label]"),
    mapElement: explorer.querySelector("#record-map"),
    mapLoading: explorer.querySelector("[data-map-loading]"),
    mapDisclosure: explorer.querySelector("[data-map-disclosure]"),
    mapFocus: explorer.querySelector("[data-map-focus]"),
    mapFocusLabel: explorer.querySelector("[data-map-focus-label]"),
    fitResults: explorer.querySelector("[data-fit-results]"),
    toggleCommunityBoundaries: explorer.querySelector("[data-toggle-community-boundaries]"),
    toggleInferredFrame: explorer.querySelector("[data-toggle-inferred-frame]"),
    basemapButtons: [...explorer.querySelectorAll("[data-basemap]")],
    detailEmpty: explorer.querySelector("[data-detail-empty]"),
    detail: explorer.querySelector("[data-record-detail]"),
    detailId: explorer.querySelector("[data-detail-id]"),
    detailHouse: explorer.querySelector("[data-detail-house]"),
    detailAnswer: explorer.querySelector("[data-detail-answer]"),
    detailChips: explorer.querySelector("[data-detail-chips]"),
    recordFields: explorer.querySelector("[data-record-fields]"),
    streetviewButton: explorer.querySelector("[data-streetview]"),
    mapsButton: explorer.querySelector("[data-google-map]"),
    streetviewNote: explorer.querySelector("[data-streetview-note]"),
    reviewForm: explorer.querySelector("[data-review-form]"),
    reviewScopeNote: explorer.querySelector("[data-review-scope-note]"),
    reviewResultLabel: explorer.querySelector("[data-review-result-label]"),
    reviewNoteLabel: explorer.querySelector("[data-review-note-label]"),
    reviewSource: explorer.querySelector("[data-review-source]"),
    reviewResult: explorer.querySelector("[data-review-result]"),
    reviewNote: explorer.querySelector("[data-review-note]"),
    adjustmentGuidance: explorer.querySelector("[data-adjustment-guidance]"),
    adjustmentStatus: explorer.querySelector("[data-adjustment-status]"),
    startAdjustment: explorer.querySelector("[data-start-adjustment]"),
    placeAdjustment: explorer.querySelector("[data-place-adjustment]"),
    adjustmentLat: explorer.querySelector("[data-adjustment-lat]"),
    adjustmentLon: explorer.querySelector("[data-adjustment-lon]"),
    nudgeDistance: explorer.querySelector("[data-nudge-distance]"),
    nudgeDirections: [...explorer.querySelectorAll("[data-nudge-direction]")],
    adjustmentReason: explorer.querySelector("[data-adjustment-reason]"),
    adjustmentSource: explorer.querySelector("[data-adjustment-source]"),
    adjustmentObservedAt: explorer.querySelector("[data-adjustment-observed-at]"),
    adjustmentReference: explorer.querySelector("[data-adjustment-reference]"),
    adjustmentReviewer: explorer.querySelector("[data-adjustment-reviewer]"),
    adjustmentNote: explorer.querySelector("[data-adjustment-note]"),
    saveAdjustment: explorer.querySelector("[data-save-adjustment]"),
    undoAdjustment: explorer.querySelector("[data-undo-adjustment]"),
    resetAdjustment: explorer.querySelector("[data-reset-adjustment]"),
    exportAdjustments: explorer.querySelector("[data-export-adjustments]"),
    adjustmentCount: explorer.querySelector("[data-adjustment-count]"),
    proposedStreetview: explorer.querySelector("[data-proposed-streetview]"),
    proposedMap: explorer.querySelector("[data-proposed-map]")
  };

  const REQUIRED_ADJUSTMENT_ELEMENTS = Object.freeze([
    "adjustmentGuidance",
    "adjustmentStatus",
    "startAdjustment",
    "placeAdjustment",
    "adjustmentLat",
    "adjustmentLon",
    "nudgeDistance",
    "adjustmentReason",
    "adjustmentSource",
    "adjustmentObservedAt",
    "adjustmentReference",
    "adjustmentReviewer",
    "adjustmentNote",
    "saveAdjustment",
    "undoAdjustment",
    "resetAdjustment",
    "exportAdjustments",
    "adjustmentCount"
  ]);
  const adjustmentUiReady = Boolean(
    adjustmentApiReady &&
    REQUIRED_ADJUSTMENT_ELEMENTS.every((name) => elements[name]) &&
    elements.nudgeDirections.length === 4 &&
    [...elements.adjustmentReason.options]
      .filter((option) => option.value)
      .every((option) => adjustmentTools.ADJUSTMENT_REASONS.includes(option.value)) &&
    [...elements.adjustmentSource.options]
      .filter((option) => option.value)
      .every((option) => adjustmentTools.EVIDENCE_SOURCES.includes(option.value))
  );
  if (elements.adjustmentReference) elements.adjustmentReference.maxLength = 240;
  if (elements.adjustmentReviewer) elements.adjustmentReviewer.maxLength = 64;
  const adjustmentControls = [
    elements.startAdjustment,
    elements.placeAdjustment,
    elements.adjustmentLat,
    elements.adjustmentLon,
    elements.nudgeDistance,
    ...elements.nudgeDirections,
    elements.adjustmentReason,
    elements.adjustmentSource,
    elements.adjustmentObservedAt,
    elements.adjustmentReference,
    elements.adjustmentReviewer,
    elements.adjustmentNote,
    elements.saveAdjustment,
    elements.undoAdjustment,
    elements.resetAdjustment,
    elements.proposedStreetview,
    elements.proposedMap
  ].filter(Boolean);
  if (!adjustmentUiReady) {
    adjustmentControls.forEach((control) => { control.disabled = true; });
    if (elements.exportAdjustments) elements.exportAdjustments.disabled = true;
    if (elements.adjustmentGuidance) {
      elements.adjustmentGuidance.textContent = "เครื่องมือตรวจและส่งออกร่างพิกัดโหลดไม่ครบ จึงปิดการเสนอจุดเพื่อป้องกันข้อมูลไม่ผ่านกติกา";
      elements.adjustmentGuidance.dataset.level = "none";
    }
    if (elements.adjustmentStatus) {
      elements.adjustmentStatus.textContent = "เครื่องมือเสนอจุดไม่พร้อมใช้งาน";
      elements.adjustmentStatus.dataset.tone = "error";
    }
  }

  const fileLabels = [...document.querySelectorAll("[data-file-label]")];

  const state = {
    requestId: 0,
    worker: null,
    rows: [],
    summary: null,
    searchIndex: [],
    rowIndexById: new Map(),
    baseOrder: [],
    filtered: [],
    selectedIndex: null,
    page: 0,
    mapFocus: false,
    evidenceFilter: "",
    roadFilter: "",
    placeFilter: "",
    confidenceFilter: "",
    businessFilter: "",
    priorityFilter: "",
    reviewFilter: "",
    reviews: new Map(),
    adjustmentWorking: new Map(),
    adjustments: new Map(),
    adjustmentMode: "select",
    coordinateCounts: new Map(),
    communityBoundaries: null,
    communityBoundaryLayer: null,
    communityBoundariesVisible: true,
    inferredOuterFrame: null,
    inferredFrameLayer: null,
    inferredFrameVisible: true,
    spatialContextReady: false,
    initialSpatialFitDone: false,
    map: null,
    selectionRenderer: null,
    pointLayer: null,
    selectionMarker: null,
    proposedMarker: null,
    adjustmentConnector: null,
    radiusLayer: null,
    unknownRadiusLayer: null,
    basemap: "none",
    basemapLayers: {
      streets: null,
      satellite: null
    },
    searchTimer: null
  };

  const clean = (value, fallback = "—", max = 500) => {
    const text = String(value ?? "").trim();
    return text ? text.slice(0, max) : fallback;
  };

  const normalizeCommunity = (value) => clean(value, "", 160)
    .replace(/^ชุมชน\s*/u, "")
    .trim();

  const geometryLabel = (value) => GEOM_LABELS[value] || clean(value);
  const statusLabel = (value) => STATUS_LABELS[value] || clean(value);
  const confidenceLabel = (value) => clean(value, "ยังไม่ระบุชั้นความเชื่อมั่น", 160);
  const methodLabel = (value) => METHOD_LABELS[value] || "ประมาณจากข้อมูลต้นทางและบริบทพื้นที่";

  const addressPart = (label, value) => {
    const text = clean(value, "", 180);
    if (!text || text === "-") return "";
    return text.startsWith(label) ? text : `${label} ${text}`;
  };

  const addressLine = (row) => {
    const parts = [`บ้านเลขที่ ${clean(row.house_no)}`];
    const soi = addressPart("ซอย", row.soi);
    const road = addressPart("ถนน", row.road);
    if (soi) parts.push(soi);
    if (road) parts.push(road);
    return parts.join(" · ");
  };

  const coordinateKey = (row) => markerGrouping.coordinateKey(row);

  const splitFlags = (value) => new Set(
    String(value || "").split(";").map((flag) => flag.trim()).filter(Boolean)
  );

  const verificationScope = (row) => {
    const placeType = clean(row?.place_type, "", 80).toLocaleLowerCase("th-TH");
    return row?.geom_level === "building" || MULTI_UNIT_PLACE_TYPES.has(placeType)
      ? "building-context"
      : "house-plate";
  };

  const allowedReviewResults = (evidenceSource, row) => {
    const scope = verificationScope(row);
    return REVIEW_RESULTS_BY_SCOPE[scope]?.[evidenceSource] || new Set();
  };

  const matchesEvidenceFilter = (row, filter) => {
    if (!filter) return true;
    const flags = splitFlags(row?.review_flags);
    if (filter === "tier-a0") return row?.tier === "A0";
    if (filter === "building-register-conflict") return flags.has("building_register_conflict");
    if (filter === "building-register-multi-site") return flags.has("building_register_multi_site");
    if (filter === "far-from-road") return flags.has("far_from_road");
    if (filter === "far-from-named-soi") return flags.has("far_from_named_soi");
    if (filter === "soi-name-needs-review") return flags.has("soi_name_needs_review");
    if (filter === "source-needs-review") return row?.status === "needs-review";
    if (filter === "no-coordinate") return !Number.isFinite(row?.lat) || !Number.isFinite(row?.lon);
    if (filter === "with-business") return Number(row?.business_count) > 0;
    if (filter === "without-business") return Number(row?.business_count) === 0;
    if (filter === "review-high") return row?.review_priority === "สูง";
    if (filter === "review-mid") return row?.review_priority === "กลาง";
    if (filter === "review-low") return row?.review_priority === "ต่ำ";
    return false;
  };

  const POSITION_REVIEW_FLAGS = new Set(adjustmentApiReady ? adjustmentTools.POSITION_REVIEW_FLAGS : []);

  const adjustmentInstruction = (row) => {
    if (!Number.isFinite(row?.lat) || !Number.isFinite(row?.lon)) {
      return {
        level: "place",
        title: "วางจุดใหม่จากหลักฐาน",
        detail: "รายการนี้ยังไม่มีพิกัด อย่าวางจากการคาดเดา—ใช้เอกสารหน่วยงาน ภาพที่ระบุตำแหน่งได้ หรือผลสำรวจ แล้วบันทึกเป็นจุดเสนอ"
      };
    }
    const flags = splitFlags(row.review_flags);
    if (flags.has("soi_name_needs_review")) {
      return {
        level: "move",
        title: "ตรวจว่าจุดหรือที่อยู่ทะเบียนผิดซอย",
        detail: "ชื่อแนวถนนได้รับการตรวจแล้ว แต่คีย์นี้ยังต้องให้เทศบาลตัดสิน ควรเทียบจุดกับเอกสารและภาพพื้นที่ก่อนเสนอเลื่อน"
      };
    }
    if ([...flags].some((flag) => POSITION_REVIEW_FLAGS.has(flag))) {
      return {
        level: "move",
        title: "ตรวจและพิจารณาเลื่อนจุด",
        detail: `เหตุผลนำ: ${formatFlags(row.review_flags).split(" · ")[0]} เปิดภาพถนนหรือดาวเทียมแล้วเสนอจุดใหม่เฉพาะเมื่อมีหลักฐาน`
      };
    }
    if (row.review_priority) {
      return {
        level: "review",
        title: "ตรวจหลักฐานก่อนตัดสินใจ",
        detail: "รายการนี้อยู่ในคิวตรวจ แต่ข้อมูลยังไม่ชี้ว่าต้องย้ายแน่นอน ตรวจป้ายและบริบทก่อนเสนอแก้"
      };
    }
    return {
      level: "none",
      title: "ยังไม่มีธงที่แนะนำให้ย้าย",
      detail: "ยังเสนอจุดใหม่ได้เมื่อมีหลักฐานชัดเจน โดยจุดต้นทางจะคงอยู่และไฟล์ส่งออกจะระบุว่าเป็นร่างที่ยังไม่ยืนยัน"
    };
  };

  const adjustmentKey = (row) => String(row?.house_reg_id ?? "").trim();

  const getWorkingAdjustment = (row) => state.adjustmentWorking.get(adjustmentKey(row)) || null;

  const ADJUSTMENT_EDIT_FIELDS = Object.freeze([
    "houseRegId",
    "sourceLat",
    "sourceLon",
    "proposedLat",
    "proposedLon",
    "action",
    "reasonCode",
    "evidenceSource",
    "evidenceObservedAt",
    "evidenceReference",
    "reviewerCode",
    "reasonNote"
  ]);

  const adjustmentMatchesSaved = (working, saved) => Boolean(
    working &&
    saved &&
    ADJUSTMENT_EDIT_FIELDS.every((field) => Object.is(working[field], saved[field]))
  );

  const dirtyAdjustmentCount = () => {
    let count = 0;
    state.adjustmentWorking.forEach((working, key) => {
      const saved = state.adjustments.get(key);
      if (!working?.saved || !adjustmentMatchesSaved(working, saved)) count += 1;
    });
    return count;
  };

  const hasDatasetDraftState = () => Boolean(
    state.reviews.size ||
    state.adjustments.size ||
    state.adjustmentWorking.size
  );

  const proposedPoint = (row) => {
    const working = getWorkingAdjustment(row);
    if (!working || !Number.isFinite(working.proposedLat) || !Number.isFinite(working.proposedLon)) return null;
    return { lat: working.proposedLat, lon: working.proposedLon };
  };

  const streetviewEligibility = (row) => {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) {
      return { allowed: false, reason: "รายการนี้ยังไม่มีพิกัด จึงเปิดภาพถนนไม่ได้" };
    }
    return { allowed: true, reason: "" };
  };

  const externalMapUrl = (row, mode, coordinateOverride = null) => {
    const hasCoordinateOverride = coordinateOverride !== null;
    const lat = hasCoordinateOverride ? coordinateOverride?.lat : row?.lat;
    const lon = hasCoordinateOverride ? coordinateOverride?.lon : row?.lon;
    if (!row || !Number.isFinite(lat) || !Number.isFinite(lon)) return "";
    if (mode === "streetview" && !coordinateOverride && !streetviewEligibility(row).allowed) return "";
    if (mode !== "streetview" && mode !== "map") return "";
    if (mode === "streetview") {
      const viewpoint = `${Number(lat).toFixed(7)},${Number(lon).toFixed(7)}`;
      const heading = !hasCoordinateOverride && Number.isFinite(row.frontage_heading)
        ? `&heading=${Number(row.frontage_heading)}`
        : "";
      return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${viewpoint}${heading}&pitch=0&fov=80`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${Number(lat).toFixed(7)},${Number(lon).toFixed(7)}`;
  };

  const rowSortPriority = (row) => {
    if (Object.prototype.hasOwnProperty.call(REVIEW_PRIORITY_RANK, row?.review_priority)) {
      return REVIEW_PRIORITY_RANK[row.review_priority];
    }
    return 3;
  };

  const showOnly = (visible) => {
    elements.fileGate.hidden = visible !== "gate";
    elements.parseState.hidden = visible !== "parsing";
    elements.alert.hidden = visible !== "error";
    elements.workspace.hidden = visible !== "workspace";
  };

  const setParseProgress = (progress, { mainThreadFallback = false } = {}) => {
    const stage = progress?.stage;
    const parsed = Number(progress?.rowsParsed || 0);
    const total = Number(progress?.totalRows || 42524);
    const details = {
      reading: "กำลังอ่านไฟล์เข้าสู่หน่วยความจำชั่วคราว",
      hashing: "กำลังตรวจลายนิ้วมือ เพื่อยืนยันว่าเป็นชุดข้อมูลที่ตรงกับผลสรุป",
      decoding: "กำลังตรวจว่าไฟล์เป็น UTF-8 ที่สมบูรณ์",
      parsing: parsed > 0
        ? `ตรวจแล้ว ${NUMBER.format(parsed)} จาก ${NUMBER.format(total)} รายการ`
        : "กำลังตรวจโครงสร้าง 29 คอลัมน์และทุกแถว"
    };
    const detail = details[stage] || "กำลังตรวจโครงสร้างก่อนเปิดข้อมูลรายบ้าน";
    elements.parseTitle.textContent = mainThreadFallback
      ? "กำลังตรวจไฟล์ด้วยวิธีสำรอง…"
      : stage === "parsing" ? "กำลังเตรียมโต๊ะตรวจ…" : "กำลังตรวจไฟล์ในเครื่อง…";
    elements.parseDetail.textContent = mainThreadFallback
      ? `ตัวอ่านแบบแยกงานเปิดไม่ได้ · กำลังตรวจไฟล์เดิมในหน้าเว็บนี้ · ${detail}`
      : detail;
  };

  const showError = (error) => {
    state.worker?.terminate();
    state.worker = null;
    showOnly("error");
    elements.alertTitle.textContent = "เปิดไฟล์นี้ไม่ได้";
    const rowHint = Number.isInteger(error?.rowNumber) ? ` (ใกล้แถวที่ ${NUMBER.format(error.rowNumber)})` : "";
    const guidance = error?.category === "loader"
      ? "ข้อมูลยังไม่ได้ถูกเปิด กรุณารีโหลดหน้าเว็บแล้วเลือกไฟล์เดิมอีกครั้ง"
      : "กรุณาเลือกชุดข้อมูลหน้าแผนที่ฉบับวันที่ 8 ก.ย. 2569";
    elements.alertDetail.textContent = `${clean(error?.message, "ไฟล์ไม่ผ่านการตรวจรุ่นและโครงสร้าง", 220)}${rowHint} ${guidance}`;
    elements.alert.focus();
  };

  const clearMapSelection = () => {
    if (!state.map) return;
    if (state.selectionMarker) state.map.removeLayer(state.selectionMarker);
    if (state.radiusLayer) state.map.removeLayer(state.radiusLayer);
    if (state.unknownRadiusLayer) state.map.removeLayer(state.unknownRadiusLayer);
    if (state.proposedMarker) state.map.removeLayer(state.proposedMarker);
    if (state.adjustmentConnector) state.map.removeLayer(state.adjustmentConnector);
    state.selectionMarker = null;
    state.radiusLayer = null;
    state.unknownRadiusLayer = null;
    state.proposedMarker = null;
    state.adjustmentConnector = null;
    state.pointLayer?.setSelection(null);
  };

  const clearDatasetDraftState = () => {
    state.reviews.clear();
    state.adjustmentWorking.clear();
    state.adjustments.clear();
    state.adjustmentMode = "select";
    elements.mapElement?.classList.remove("is-placing-coordinate");
  };

  const resetData = ({ focusPicker = false } = {}) => {
    state.worker?.terminate();
    state.worker = null;
    state.requestId += 1;
    state.rows = [];
    state.summary = null;
    state.searchIndex = [];
    state.rowIndexById.clear();
    state.baseOrder = [];
    state.filtered = [];
    state.selectedIndex = null;
    state.page = 0;
    clearDatasetDraftState();
    state.coordinateCounts.clear();
    state.pointLayer?.setIndices([]);
    clearMapSelection();
    elements.fileInput.value = "";
    elements.search.value = "";
    elements.geomFilter.value = "";
    elements.communityFilter.replaceChildren(new Option("ทุกชุมชน", ""));
    if (elements.roadFilter) elements.roadFilter.replaceChildren(new Option("ทุกถนน", ""));
    if (elements.placeFilter) elements.placeFilter.replaceChildren(new Option("ทุกประเภทสถานที่", ""));
    if (elements.confidenceFilter) elements.confidenceFilter.value = "";
    if (elements.businessFilter) elements.businessFilter.value = "";
    if (elements.priorityFilter) {
      elements.priorityFilter.value = elements.priorityFilter.querySelector('option[value="สูง"]') ? "สูง" : "";
    }
    if (elements.evidenceFilter) elements.evidenceFilter.value = "";
    state.evidenceFilter = "";
    state.roadFilter = "";
    state.placeFilter = "";
    state.confidenceFilter = "";
    state.businessFilter = "";
    state.priorityFilter = elements.priorityFilter?.value || "";
    elements.reviewFilters.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.reviewFilter === "")));
    elements.reviewCount.textContent = "0";
    elements.exportButton.disabled = true;
    if (elements.adjustmentCount) elements.adjustmentCount.textContent = "0";
    if (elements.exportAdjustments) elements.exportAdjustments.disabled = true;
    elements.mapElement?.classList.remove("is-placing-coordinate");
    setMapFocus(false);
    showOnly("gate");
    if (focusPicker) fileLabels.find((label) => explorer.contains(label))?.focus({ preventScroll: true });
  };

  const startParse = (file) => {
    if (!isSafeTopLevel()) {
      elements.fileInput.value = "";
      return;
    }
    if (!file) return;
    if (
      state.rows.length &&
      hasDatasetDraftState() &&
      !window.confirm("การเปิดชุดข้อมูลใหม่จะล้างร่างผลตรวจ จุดเสนอที่เก็บแล้ว และงานแก้ที่ยังไม่เก็บในแท็บนี้เมื่อไฟล์ใหม่ผ่านการตรวจ ต้องการดำเนินการต่อหรือไม่?")
    ) {
      elements.fileInput.value = "";
      elements.answer.textContent = "ยกเลิกการเปลี่ยนไฟล์แล้ว ร่างเดิมยังอยู่ครบ";
      return;
    }
    state.worker?.terminate();
    state.worker = null;
    state.requestId += 1;
    const requestId = state.requestId;
    showOnly("parsing");
    explorer.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start"
    });
    setParseProgress({ stage: "reading" });

    let worker = null;
    let finished = false;
    let fallbackAttempted = false;

    const isCurrentRequest = () => state.requestId === requestId;
    const stopWorker = () => {
      worker?.terminate();
      if (state.worker === worker) state.worker = null;
      worker = null;
    };
    const finishWithError = (error) => {
      if (finished || !isCurrentRequest()) return;
      finished = true;
      stopWorker();
      showError(error);
    };
    const finishWithSuccess = (result) => {
      if (finished || !isCurrentRequest()) return;
      finished = true;
      stopWorker();
      prepareWorkspace(result?.rows, result?.summary);
    };
    const retryOnMainThread = async (workerFailureMessage) => {
      if (finished || fallbackAttempted || !isCurrentRequest()) return;
      fallbackAttempted = true;
      stopWorker();
      showOnly("parsing");
      elements.parseTitle.textContent = "กำลังเปลี่ยนไปใช้ตัวอ่านสำรอง…";
      elements.parseDetail.textContent = `${workerFailureMessage} · จะตรวจไฟล์เดิมในหน้าเว็บนี้หนึ่งครั้ง โดยไม่อัปโหลดข้อมูล`;

      if (!csvParserReady) {
        finishWithError({
          category: "loader",
          message: "ตัวอ่านแบบแยกงานหยุด และตัวอ่านสำรองในหน้าเว็บโหลดไม่ครบ"
        });
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 0));
      if (finished || !isCurrentRequest()) return;

      try {
        const result = await csvParser.parseVerifiedFile(file, (progress) => {
          if (!finished && isCurrentRequest()) setParseProgress(progress, { mainThreadFallback: true });
        });
        finishWithSuccess(result);
      } catch (error) {
        if (error instanceof csvParser.CsvValidationError) {
          finishWithError(error);
          return;
        }
        finishWithError({
          category: "loader",
          message: "ตัวอ่านทั้งแบบแยกงานและวิธีสำรองหยุดก่อนตรวจไฟล์เสร็จ"
        });
      }
    };

    try {
      worker = new Worker(WORKER_URL);
      state.worker = worker;
    } catch (_) {
      void retryOnMainThread("เบราว์เซอร์เปิดตัวอ่านแบบแยกงานไม่ได้");
      return;
    }

    worker.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.requestId !== requestId) return;
      if (message.type === "progress") {
        setParseProgress(message.progress);
        return;
      }
      if (message.type === "error") {
        // A parser-reported error is authoritative. Retrying the same bytes
        // cannot turn a validation failure into an approved dataset.
        finishWithError(message.error);
        return;
      }
      if (message.type === "success") {
        finishWithSuccess(message);
      }
    });

    worker.addEventListener("error", (event) => {
      event.preventDefault();
      void retryOnMainThread("ตัวอ่านแบบแยกงานหยุดก่อนตรวจเสร็จ");
    });

    worker.addEventListener("messageerror", () => {
      void retryOnMainThread("เบราว์เซอร์รับผลจากตัวอ่านแบบแยกงานไม่ได้");
    });

    try {
      worker.postMessage({ type: "parse", requestId, file });
    } catch (_) {
      void retryOnMainThread("เบราว์เซอร์ส่งไฟล์ไปยังตัวอ่านแบบแยกงานไม่ได้");
    }
  };

  const prepareWorkspace = (rows, summary) => {
    if (!Array.isArray(rows) || rows.length !== 42524 || summary?.rowCount !== 42524) {
      showError({ message: "ผลตรวจไฟล์ไม่ครบตามชุดข้อมูลหน้าแผนที่" });
      return;
    }

    const sourceRows = Object.freeze(rows.map((row) => Object.freeze({ ...row })));
    const nextRowIndexById = new Map();
    const nextCoordinateCounts = new Map();
    const nextSearchIndex = new Array(sourceRows.length);
    const nextBaseOrder = sourceRows.map((_, index) => index);

    for (let index = 0; index < sourceRows.length; index += 1) {
      const row = sourceRows[index];
      const key = adjustmentKey(row);
      if (!key || nextRowIndexById.has(key)) {
        showError({ message: "ผลตรวจไฟล์มีรหัสทะเบียนว่างหรือซ้ำ จึงไม่เปิดพื้นที่ทำงาน" });
        return;
      }
      nextRowIndexById.set(key, index);
      const searchable = [
        row.house_reg_id,
        row.house_no,
        row.trok,
        row.soi,
        row.road,
        row.community,
        row.place_type,
        row.tier,
        row.confidence_band,
        row.method,
        row.status,
        row.frontage_road,
        row.frontage_road_layer,
        row.frontage_road_source,
        row.soi_name_check,
        row.soi_name_check_confidence,
        row.business_names,
        row.business_status,
        row.business_match_confidence,
        row.review_priority,
        row.review_flags,
        formatFlags(row.review_flags)
      ].join(" ").toLocaleLowerCase("th-TH");
      nextSearchIndex[index] = searchable;

      const coordKey = coordinateKey(row);
      if (coordKey) nextCoordinateCounts.set(coordKey, (nextCoordinateCounts.get(coordKey) || 0) + 1);
    }

    nextBaseOrder.sort((leftIndex, rightIndex) => {
      const left = sourceRows[leftIndex];
      const right = sourceRows[rightIndex];
      const priority = rowSortPriority(left) - rowSortPriority(right);
      if (priority !== 0) return priority;
      const score = (right.review_score ?? -1) - (left.review_score ?? -1);
      if (score !== 0) return score;
      return leftIndex - rightIndex;
    });

    const communities = [...new Set(sourceRows.map((row) => clean(row.community, "", 160)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "th"));
    const roads = [...new Set(sourceRows.map((row) => clean(row.road, "", 180)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "th"));
    const placeTypes = [...new Set(sourceRows.map((row) => clean(row.place_type, "", 120)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "th"));

    clearMapSelection();
    clearDatasetDraftState();
    state.rows = sourceRows;
    state.summary = Object.freeze({ ...summary });
    state.searchIndex = Object.freeze(nextSearchIndex);
    state.rowIndexById = nextRowIndexById;
    state.coordinateCounts = nextCoordinateCounts;
    state.baseOrder = Object.freeze(nextBaseOrder);
    state.filtered = [];
    state.selectedIndex = null;

    const options = [new Option("ทุกชุมชน", "")];
    communities.forEach((community) => options.push(new Option(community, community)));
    elements.communityFilter.replaceChildren(...options);
    if (elements.roadFilter) {
      elements.roadFilter.replaceChildren(
        new Option("ทุกถนน", ""),
        ...roads.map((road) => new Option(road, road))
      );
    }
    if (elements.placeFilter) {
      elements.placeFilter.replaceChildren(
        new Option("ทุกประเภทสถานที่", ""),
        ...placeTypes.map((placeType) => new Option(placeType, placeType))
      );
    }
    elements.datasetRows.textContent = NUMBER.format(summary.rowCount);
    state.page = 0;
    if (elements.evidenceFilter) elements.evidenceFilter.value = "";
    state.evidenceFilter = "";
    state.roadFilter = elements.roadFilter?.value || "";
    state.placeFilter = elements.placeFilter?.value || "";
    state.confidenceFilter = elements.confidenceFilter?.value || "";
    state.businessFilter = elements.businessFilter?.value || "";
    state.priorityFilter = elements.priorityFilter?.value || "";
    state.reviewFilter = "";
    elements.reviewFilters.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.reviewFilter === ""));
    });
    updateReviewSummary();
    showOnly("workspace");
    applyFilters({ selectFirst: true });

    if (window.matchMedia("(min-width: 768px)").matches) ensureMap();
    const queueTitle = document.getElementById("queue-title");
    if (queueTitle) {
      queueTitle.tabIndex = -1;
      queueTitle.focus({ preventScroll: true });
    }
  };

  const applyFilters = ({ selectFirst = false } = {}) => {
    if (!state.rows.length) return;
    const query = elements.search.value.trim().toLocaleLowerCase("th-TH");
    const geometry = elements.geomFilter.value;
    const community = elements.communityFilter.value;
    const road = state.roadFilter;
    const placeType = state.placeFilter;
    const confidence = state.confidenceFilter;
    const business = state.businessFilter;
    const priorityFilter = state.priorityFilter;
    const evidenceFilter = state.evidenceFilter;

    state.filtered = state.baseOrder.filter((index) => {
      const row = state.rows[index];
      if (query && !state.searchIndex[index].includes(query)) return false;
      if (geometry && row.geom_level !== geometry) return false;
      if (community && row.community !== community) return false;
      if (road && row.road !== road) return false;
      if (placeType && row.place_type !== placeType) return false;
      if (confidence && row.confidence_band !== confidence) return false;
      if (business === "with-business" && row.business_count <= 0) return false;
      if (business === "without-business" && row.business_count !== 0) return false;
      if (priorityFilter && row.review_priority !== priorityFilter) return false;
      if (!matchesEvidenceFilter(row, evidenceFilter)) return false;
      const reviewed = state.reviews.has(index);
      if (state.reviewFilter === "pending" && reviewed) return false;
      if (state.reviewFilter === "reviewed" && !reviewed) return false;
      return true;
    });

    const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages - 1);
    elements.filteredCount.textContent = NUMBER.format(state.filtered.length);
    const filteredStats = state.filtered.reduce((counts, index) => {
      const row = state.rows[index];
      if (Number.isFinite(row?.lat) && Number.isFinite(row?.lon)) counts.withCoordinate += 1;
      else counts.withoutCoordinate += 1;
      if (Number(row?.business_count) > 0) counts.withBusiness += 1;
      if (row?.review_priority) counts.inReviewQueue += 1;
      return counts;
    }, { withCoordinate: 0, withoutCoordinate: 0, withBusiness: 0, inReviewQueue: 0 });
    if (elements.filteredWithCoordinate) elements.filteredWithCoordinate.textContent = NUMBER.format(filteredStats.withCoordinate);
    if (elements.filteredWithoutCoordinate) elements.filteredWithoutCoordinate.textContent = NUMBER.format(filteredStats.withoutCoordinate);
    if (elements.filteredBusiness) elements.filteredBusiness.textContent = NUMBER.format(filteredStats.withBusiness);
    if (elements.filteredReview) elements.filteredReview.textContent = NUMBER.format(filteredStats.inReviewQueue);
    elements.resultNote.textContent = state.filtered.length
      ? `พบ ${NUMBER.format(state.filtered.length)} รายการ · มีพิกัด ${NUMBER.format(filteredStats.withCoordinate)} · ยังไม่มีพิกัด ${NUMBER.format(filteredStats.withoutCoordinate)} · บ้านที่มีข้อมูลทะเบียนกิจการ ${NUMBER.format(filteredStats.withBusiness)}`
      : "ไม่พบรายการที่ตรงตัวกรอง ลองลดเงื่อนไขหรือเปลี่ยนคำค้น";

    state.pointLayer?.setIndices(state.filtered);

    if (selectFirst || (state.selectedIndex !== null && !state.filtered.includes(state.selectedIndex))) {
      if (state.filtered.length) selectRecord(state.filtered[0], { moveMap: false, switchPanel: false });
      else clearSelection();
    } else {
      renderList();
    }
  };

  const renderList = () => {
    elements.list.replaceChildren();
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages - 1);
    const start = state.page * PAGE_SIZE;
    const pageIndices = state.filtered.slice(start, start + PAGE_SIZE);

    if (!pageIndices.length) {
      const empty = document.createElement("li");
      empty.className = "record-empty";
      empty.textContent = "ไม่มีรายการในคิวนี้";
      elements.list.append(empty);
    }

    pageIndices.forEach((index) => {
      const row = state.rows[index];
      const item = document.createElement("li");
      item.className = "record-item";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "record-button";
      button.dataset.recordIndex = String(index);
      button.setAttribute("aria-current", String(index === state.selectedIndex));

      const address = document.createElement("span");
      address.className = "record-address";
      address.textContent = addressLine(row);
      const id = document.createElement("span");
      id.className = "record-id";
      id.textContent = row.review_priority
        ? `รายการตรวจลำดับ${row.review_priority}${row.review_score === null ? "" : ` · ${NUMBER.format(row.review_score)} คะแนน`}`
        : "รายการสำรวจตำแหน่ง";
      const meta = document.createElement("span");
      meta.className = "record-meta";
      const businessMeta = row.business_count > 0 ? ` · รายการทะเบียนกิจการต้นทาง ${NUMBER.format(row.business_count)}` : "";
      meta.textContent = `${confidenceLabel(row.confidence_band)} · ${clean(row.community)}${businessMeta}`;
      const radius = document.createElement("span");
      radius.className = "record-radius";
      const review = state.reviews.get(index);
      const adjustment = state.adjustments.get(adjustmentKey(row));
      const workingAdjustment = getWorkingAdjustment(row);
      const adjustmentDirty = Boolean(workingAdjustment && !workingAdjustment.saved);
      const instruction = adjustmentInstruction(row);
      const radiusText = row.radius_m === null
        ? "ไม่มีจุดให้วัดรัศมี"
        : row.radius_m === 0
          ? "ต้นทางระบุรัศมี 0 ม. (ยังไม่ถือว่าแม่นยำ)"
          : `รัศมีประมาณ ${NUMBER.format(row.radius_m)} ม.`;
      const queueReason = row.review_priority && row.review_flags
        ? `ควรตรวจ: ${formatFlags(row.review_flags).split(" · ")[0]}`
        : "";
      radius.textContent = [
        adjustmentDirty
          ? "◇ มีจุดเสนอที่แก้ค้างและยังไม่เก็บ"
          : adjustment
            ? "◆ มีจุดเสนอแก้ที่เก็บเป็นร่างแล้ว"
            : `งานที่แนะนำ: ${instruction.title}`,
        review ? `● ${REVIEW_LABELS[review.result] || "มีบันทึกร่าง"}` : "",
        queueReason,
        radiusText
      ].filter(Boolean).join(" · ");

      button.append(address, id, meta, radius);
      const quickActions = document.createElement("div");
      quickActions.className = "record-quick-actions";

      const streetViewUrl = externalMapUrl(row, "streetview");
      const streetViewAction = document.createElement(streetViewUrl ? "a" : "span");
      streetViewAction.className = "record-quick-action";
      streetViewAction.textContent = streetViewUrl ? "Street View ↗" : "ไม่มี Street View";
      if (streetViewUrl) {
        streetViewAction.href = streetViewUrl;
        streetViewAction.target = "_blank";
        streetViewAction.rel = "noopener noreferrer";
        streetViewAction.setAttribute("aria-label", `เปิด Street View ของ ${addressLine(row)} ในแท็บใหม่`);
      } else {
        streetViewAction.setAttribute("aria-disabled", "true");
      }

      const satelliteAction = document.createElement("button");
      satelliteAction.type = "button";
      satelliteAction.className = "record-quick-action";
      satelliteAction.dataset.satelliteIndex = String(index);
      satelliteAction.textContent = "เทียบภาพดาวเทียม";
      satelliteAction.disabled = !Number.isFinite(row.lat) || !Number.isFinite(row.lon);
      satelliteAction.setAttribute("aria-label", `เลือก ${addressLine(row)} แล้วเปิดพื้นหลังภาพดาวเทียม`);

      quickActions.append(streetViewAction, satelliteAction);
      item.append(button, quickActions);
      elements.list.append(item);
    });

    elements.pageLabel.textContent = `หน้า ${NUMBER.format(state.page + 1)} จาก ${NUMBER.format(totalPages)}`;
    elements.pagePrev.disabled = state.page <= 0;
    elements.pageNext.disabled = state.page >= totalPages - 1 || state.filtered.length === 0;
  };

  const clearSelection = () => {
    state.selectedIndex = null;
    elements.detailEmpty.hidden = false;
    elements.detail.hidden = true;
    elements.answer.textContent = "ยังไม่มีรายการตรงตัวกรองให้เลือก";
    clearMapSelection();
    renderList();
  };

  const selectRecord = (index, options = {}) => {
    const row = state.rows[index];
    if (!row) return;
    if (state.selectedIndex !== null && state.selectedIndex !== index) {
      const previousRow = state.rows[state.selectedIndex];
      const previousWorking = previousRow ? getWorkingAdjustment(previousRow) : null;
      if (previousWorking) {
        captureAdjustmentMetadata(previousWorking);
        previousWorking.saved = adjustmentMatchesSaved(
          previousWorking,
          state.adjustments.get(adjustmentKey(previousRow))
        );
        updateReviewSummary();
      }
      state.adjustmentMode = "select";
      elements.mapElement?.classList.remove("is-placing-coordinate");
    }
    const activatedFromList = Boolean(document.activeElement?.closest?.("[data-record-index]"));
    state.selectedIndex = index;
    const position = state.filtered.indexOf(index);
    if (position >= 0) state.page = Math.floor(position / PAGE_SIZE);
    renderList();
    renderDetail();
    updateMapSelection(options.moveMap !== false);
    elements.answer.textContent = `${confidenceLabel(row.confidence_band)} · ${statusLabel(row.status)} · ${row.radius_m === null ? "ยังไม่มีรัศมี" : `รัศมี ${NUMBER.format(row.radius_m)} ม.`}`;
    if (options.switchPanel !== false && window.matchMedia("(max-width: 767px)").matches) {
      setMobilePanel("detail", { focus: false });
      requestAnimationFrame(() => elements.detailHouse.focus({ preventScroll: false }));
    } else if (activatedFromList) {
      elements.list.querySelector(`[data-record-index="${index}"]`)?.focus({ preventScroll: true });
    }
  };

  const appendField = (label, value, { data = false } = {}) => {
    const wrapper = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = clean(value);
    if (data) detail.classList.add("data-value");
    wrapper.append(term, detail);
    elements.recordFields.append(wrapper);
  };

  const appendChip = (label, className = "") => {
    const chip = document.createElement("span");
    chip.className = `truth-chip ${className}`.trim();
    chip.textContent = label;
    elements.detailChips.append(chip);
  };

  const syncReviewResultOptions = (preferredResult = elements.reviewResult.value) => {
    const row = state.rows[state.selectedIndex];
    const scope = verificationScope(row);
    const allowed = allowedReviewResults(elements.reviewSource.value, row);
    [...elements.reviewResult.options].forEach((option) => {
      const optionScope = option.dataset.reviewScope || "";
      const wrongScope = Boolean(optionScope) && optionScope !== scope;
      option.hidden = wrongScope;
      option.disabled = Boolean(option.value) && (wrongScope || !allowed.has(option.value));
    });
    elements.reviewResult.value = allowed.has(preferredResult) ? preferredResult : "";
  };

  const formatFlags = (value) => {
    const flags = [...splitFlags(value)];
    if (!flags.length) return "ไม่พบธงเตือนเพิ่มเติม";
    return flags.map((flag) => {
      const separator = flag.indexOf("=");
      const key = separator >= 0 ? flag.slice(0, separator) : flag;
      const parameter = separator >= 0
        ? clean(flag.slice(separator + 1), "", 40).replace(/[^0-9A-Za-z._-]/g, "").slice(0, 32)
        : "";
      if (/^community_disambiguated\(\d+\)$/.test(key)) return "ใช้ลำดับขอบเขตช่วยแยกชุมชนที่กำกวม";
      if (key === "desk_lookup_project") {
        return parameter ? `${FLAG_LABELS[key]}: ${parameter}` : FLAG_LABELS[key];
      }
      return FLAG_LABELS[key] || "มีเหตุให้ตรวจสอบตำแหน่งเพิ่มเติม";
    }).join(" · ");
  };

  const businessNamesPreview = (row) => {
    const names = [...new Set(
      String(row?.business_names || "")
        .split(" | ")
        .map((name) => clean(name, "", 240))
        .filter(Boolean)
    )];
    if (!names.length) return "";
    const shown = names.slice(0, 3).join(" · ");
    const remaining = Math.max(0, names.length - 3);
    return remaining > 0 ? `${shown} · และอีก ${NUMBER.format(remaining)} รายชื่อ` : shown;
  };

  const businessMatchLabel = (value) => ({
    unique_house_key: "ตรงจากบ้านเลขที่ชุดเดียว",
    soi_resolved: "ใช้ข้อมูลซอยช่วยแยกตำแหน่ง"
  })[value] || (value ? "ผูกจากทะเบียนกิจการ" : "");

  const pointInRing = (lon, lat, ring) => {
    let inside = false;
    for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
      const [x1, y1] = ring[current];
      const [x2, y2] = ring[previous];
      const crosses = ((y1 > lat) !== (y2 > lat)) &&
        (lon < ((x2 - x1) * (lat - y1)) / ((y2 - y1) || Number.EPSILON) + x1);
      if (crosses) inside = !inside;
    }
    return inside;
  };

  const pointInPolygon = (lon, lat, coordinates) => {
    if (!coordinates?.length || !pointInRing(lon, lat, coordinates[0])) return false;
    for (let hole = 1; hole < coordinates.length; hole += 1) {
      if (pointInRing(lon, lat, coordinates[hole])) return false;
    }
    return true;
  };

  const communityAt = (lat, lon) => {
    if (!state.communityBoundaries || !Number.isFinite(lon) || !Number.isFinite(lat)) return "";
    for (const feature of state.communityBoundaries.features) {
      const geometry = feature.geometry;
      const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
      if (polygons.some((polygon) => pointInPolygon(lon, lat, polygon))) {
        return clean(feature.properties?.name, "", 160);
      }
    }
    return "";
  };

  const containingCommunity = (row) => communityAt(row?.lat, row?.lon);

  const setAdjustmentStatus = (message, tone = "") => {
    if (!elements.adjustmentStatus) return;
    elements.adjustmentStatus.textContent = message;
    elements.adjustmentStatus.dataset.tone = tone;
  };

  const adjustmentDistance = (row, working) => {
    if (!adjustmentUiReady || !working || !Number.isFinite(row?.lat) || !Number.isFinite(row?.lon)) return null;
    try {
      return adjustmentTools.distanceMeters(
        { lat: row.lat, lon: row.lon },
        { lat: working.proposedLat, lon: working.proposedLon }
      );
    } catch (_) {
      return null;
    }
  };

  const captureAdjustmentMetadata = (working) => {
    if (!working) return working;
    working.reasonCode = clean(elements.adjustmentReason?.value, "", 80);
    working.evidenceSource = clean(elements.adjustmentSource?.value, "", 80);
    working.evidenceObservedAt = clean(elements.adjustmentObservedAt?.value, "", 40);
    working.evidenceReference = clean(elements.adjustmentReference?.value, "", 240);
    working.reviewerCode = clean(elements.adjustmentReviewer?.value, "", 64);
    working.reasonNote = clean(elements.adjustmentNote?.value, "", 500);
    return working;
  };

  const ensureWorkingAdjustment = (row) => {
    if (!adjustmentUiReady) return null;
    const key = adjustmentKey(row);
    let working = state.adjustmentWorking.get(key);
    if (working) return working;
    const saved = state.adjustments.get(key);
    working = saved
      ? { ...saved, history: [], saved: true }
      : {
          houseRegId: key,
          sourceLat: Number.isFinite(row.lat) ? row.lat : null,
          sourceLon: Number.isFinite(row.lon) ? row.lon : null,
          proposedLat: Number.isFinite(row.lat) ? row.lat : null,
          proposedLon: Number.isFinite(row.lon) ? row.lon : null,
          action: Number.isFinite(row.lat) && Number.isFinite(row.lon) ? "move_existing" : "place_missing",
          reasonCode: "",
          evidenceSource: "",
          evidenceObservedAt: "",
          evidenceReference: "",
          reviewerCode: "",
          reasonNote: "",
          history: [],
          saved: false
        };
    state.adjustmentWorking.set(key, working);
    return working;
  };

  const updateAdjustmentCoordinates = (row, lat, lon, { remember = true } = {}) => {
    if (!adjustmentUiReady) {
      setAdjustmentStatus("เครื่องมือเสนอจุดไม่พร้อมใช้งาน", "error");
      return false;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) {
      setAdjustmentStatus("พิกัดต้องเป็นตัวเลข WGS84 ที่สมบูรณ์และไม่ใช่ 0,0", "error");
      return false;
    }
    const working = ensureWorkingAdjustment(row);
    if (remember) {
      working.history.push(Number.isFinite(working.proposedLat) && Number.isFinite(working.proposedLon)
        ? { lat: working.proposedLat, lon: working.proposedLon }
        : null);
      if (working.history.length > 50) working.history.shift();
    }
    working.proposedLat = Number(lat.toFixed(7));
    working.proposedLon = Number(lon.toFixed(7));
    working.saved = false;
    state.adjustmentWorking.set(adjustmentKey(row), working);
    updateReviewSummary();
    renderAdjustmentEditor(row);
    renderList();
    updateMapSelection(false);
    return true;
  };

  const renderAdjustmentEditor = (row) => {
    if (!elements.adjustmentGuidance) return;
    if (!adjustmentUiReady) {
      adjustmentControls.forEach((control) => { control.disabled = true; });
      elements.adjustmentGuidance.textContent = "เครื่องมือตรวจและส่งออกร่างพิกัดโหลดไม่ครบ จึงปิดการเสนอจุดเพื่อป้องกันข้อมูลไม่ผ่านกติกา";
      elements.adjustmentGuidance.dataset.level = "none";
      setAdjustmentStatus("เครื่องมือเสนอจุดไม่พร้อมใช้งาน", "error");
      return;
    }
    const instruction = adjustmentInstruction(row);
    const working = getWorkingAdjustment(row);
    const saved = state.adjustments.get(adjustmentKey(row));
    const eligibility = adjustmentTools.classifyEligibility(row);
    const strongEvidenceNote = eligibility.requiresStrongEvidence
      ? " รายการนี้ต้องใช้ผลสำรวจ ภาพ/เอกสารหน่วยงาน หรือ Street View ที่เห็นหลักฐานชัด"
      : "";
    elements.adjustmentGuidance.textContent = `${instruction.title} — ${instruction.detail}${strongEvidenceNote}`;
    elements.adjustmentGuidance.dataset.level = instruction.level;

    const hasProposed = Number.isFinite(working?.proposedLat) && Number.isFinite(working?.proposedLon);
    if (elements.adjustmentLat) elements.adjustmentLat.value = hasProposed ? Number(working.proposedLat).toFixed(7) : "";
    if (elements.adjustmentLon) elements.adjustmentLon.value = hasProposed ? Number(working.proposedLon).toFixed(7) : "";
    if (elements.adjustmentReason) {
      const placementReasons = new Set(["place_missing_coordinate", "field_position_observed", "building_or_parcel_evidence", "other_authorized_reason"]);
      [...elements.adjustmentReason.options].forEach((option) => {
        if (!option.value) return;
        option.disabled = eligibility.action === "place_missing"
          ? !placementReasons.has(option.value)
          : option.value === "place_missing_coordinate";
      });
      elements.adjustmentReason.value = working?.reasonCode || "";
      if (elements.adjustmentReason.selectedOptions[0]?.disabled) elements.adjustmentReason.value = "";
    }
    if (elements.adjustmentSource) {
      const strongSources = new Set(adjustmentTools.STRONG_EVIDENCE_SOURCES);
      [...elements.adjustmentSource.options].forEach((option) => {
        if (!option.value) return;
        option.disabled = Boolean(eligibility.requiresStrongEvidence) && !strongSources.has(option.value);
      });
      elements.adjustmentSource.value = working?.evidenceSource || "";
      if (elements.adjustmentSource.selectedOptions[0]?.disabled) elements.adjustmentSource.value = "";
    }
    if (elements.adjustmentObservedAt) elements.adjustmentObservedAt.value = working?.evidenceObservedAt || "";
    if (elements.adjustmentReference) elements.adjustmentReference.value = working?.evidenceReference || "";
    if (elements.adjustmentReviewer) elements.adjustmentReviewer.value = working?.reviewerCode || "";
    if (elements.adjustmentNote) elements.adjustmentNote.value = working?.reasonNote || "";
    if (elements.undoAdjustment) elements.undoAdjustment.disabled = !working?.history?.length;
    if (elements.resetAdjustment) elements.resetAdjustment.disabled = !working && !saved;
    if (elements.resetAdjustment) {
      const hasSource = Number.isFinite(row.lat) && Number.isFinite(row.lon);
      elements.resetAdjustment.textContent = hasSource ? "กลับจุดต้นทาง" : "ล้างจุดเสนอ";
      elements.resetAdjustment.setAttribute("aria-label", hasSource
        ? "ล้างร่างและกลับไปแสดงจุดต้นทาง"
        : "ล้างจุดเสนอ รายการต้นทางยังไม่มีพิกัด");
    }
    if (elements.saveAdjustment) elements.saveAdjustment.disabled = !hasProposed;
    if (elements.placeAdjustment) {
      elements.placeAdjustment.setAttribute("aria-pressed", String(state.adjustmentMode === "place"));
      elements.placeAdjustment.textContent = state.adjustmentMode === "place" ? "แตะตำแหน่งใหม่บนแผนที่…" : "เลือกตำแหน่งบนแผนที่";
    }
    if (elements.startAdjustment) {
      elements.startAdjustment.setAttribute("aria-pressed", String(state.adjustmentMode !== "select"));
      elements.startAdjustment.textContent = state.adjustmentMode === "select" ? "เริ่มเสนอปรับจุด" : "กำลังแก้จุด";
    }
    elements.nudgeDirections.forEach((button) => { button.disabled = !hasProposed; });

    if (hasProposed) {
      const distance = adjustmentDistance(row, working);
      const originalCommunity = communityAt(row.lat, row.lon);
      const proposedCommunity = communityAt(working.proposedLat, working.proposedLon);
      const warnings = [];
      if (Number.isFinite(distance) && Number.isFinite(row.radius_m) && distance > row.radius_m) warnings.push("ไกลกว่ารัศมีต้นทาง");
      if (originalCommunity && proposedCommunity && originalCommunity !== proposedCommunity) warnings.push(`ข้ามแนวชุมชนประกอบไป ${proposedCommunity}`);
      const movement = Number.isFinite(distance)
        ? `เลื่อนจากจุดต้นทาง ${NUMBER.format(Number(distance.toFixed(1)))} เมตร`
        : "กำลังเสนอจุดให้รายการที่เดิมไม่มีพิกัด";
      const status = saved && working?.saved
        ? `เก็บร่างแล้ว · ${movement}`
        : `ยังไม่เก็บ · ${movement}`;
      setAdjustmentStatus(`${status}${warnings.length ? ` · ควรอธิบายเพิ่ม: ${warnings.join(" และ ")}` : ""}`, warnings.length ? "warning" : (working?.saved ? "saved" : "editing"));
    } else {
      setAdjustmentStatus("ยังไม่มีจุดเสนอ กดเลือกตำแหน่งบนแผนที่แล้วแตะบริเวณที่มีหลักฐานรองรับ", "idle");
    }

    const candidate = hasProposed ? { lat: working.proposedLat, lon: working.proposedLon } : null;
    if (elements.proposedStreetview) elements.proposedStreetview.disabled = !candidate;
    if (elements.proposedMap) elements.proposedMap.disabled = !candidate;
  };

  const renderDetail = () => {
    const row = state.rows[state.selectedIndex];
    if (!row) return;
    elements.detailEmpty.hidden = true;
    elements.detail.hidden = false;
    elements.detailId.textContent = "รายละเอียดรายการทะเบียน";
    elements.detailHouse.textContent = `บ้านเลขที่ ${clean(row.house_no)}`;

    const radiusPhrase = row.radius_m === null
      ? "ไม่มีค่ารัศมี"
      : row.radius_m === 0
        ? "ต้นทางระบุรัศมี 0 ม. แต่จุดยังเป็นผลประมาณ"
        : `รัศมีประมาณ ±${NUMBER.format(row.radius_m)} ม.`;
    elements.detailAnswer.textContent = `${geometryLabel(row.geom_level)} · ${radiusPhrase} · ยังไม่ผ่านการตรวจภาคสนาม`;

    elements.detailChips.replaceChildren();
    appendChip(confidenceLabel(row.confidence_band), row.confidence_band?.startsWith("C ") ? "truth-chip-warning" : "truth-chip-specific");
    appendChip(geometryLabel(row.geom_level), ["parcel", "building"].includes(row.geom_level) ? "truth-chip-specific" : "");
    appendChip(statusLabel(row.status), ["needs-review", "building-lookup-pending"].includes(row.status) ? "truth-chip-warning" : "");
    if (row.tier === "A0") {
      appendChip("A0 · สำรวจเทศบาลผูกถึงแปลง", "truth-chip-specific");
      appendChip("A0 ยังไม่ตรวจหน้างาน", "truth-chip-warning");
    }
    if (row.radius_m === 0) appendChip("รัศมี 0 ไม่ได้แปลว่าแม่นยำ", "truth-chip-warning");
    if (row.business_count > 0) appendChip(`พบรายการทะเบียนกิจการต้นทาง ${NUMBER.format(row.business_count)}`, "truth-chip-specific");
    if (row.review_priority) appendChip(`ลำดับตรวจ ${clean(row.review_priority)}`, row.review_priority === "สูง" ? "truth-chip-warning" : "");
    const rowFlags = splitFlags(row.review_flags);
    Object.entries(CRITICAL_FLAG_CHIPS).forEach(([flag, label]) => {
      if (rowFlags.has(flag)) appendChip(label, "truth-chip-warning");
    });
    const review = state.reviews.get(state.selectedIndex);
    if (review) appendChip(REVIEW_LABELS[review.result] || "มีบันทึกร่าง", "truth-chip-specific");
    if (review?.evidenceSource) appendChip(EVIDENCE_SOURCE_LABELS[review.evidenceSource] || clean(review.evidenceSource));
    const workingAdjustment = getWorkingAdjustment(row);
    if (workingAdjustment && !workingAdjustment.saved) appendChip("มีจุดเสนอที่แก้ค้าง—ต้องเก็บก่อนส่งออก", "truth-chip-warning");
    else if (state.adjustments.has(adjustmentKey(row))) appendChip("มีจุดเสนอแก้—ยังไม่ยืนยัน", "truth-chip-warning");

    const boundaryCommunity = containingCommunity(row);
    const declaredCommunity = normalizeCommunity(row.community);
    if (boundaryCommunity && declaredCommunity && boundaryCommunity !== declaredCommunity) {
      appendChip("ชื่อชุมชนกับขอบเขตไม่ตรงกัน", "truth-chip-warning");
    }

    elements.recordFields.replaceChildren();
    appendField("ที่อยู่ย่อ", addressLine(row));
    appendField("ตรอก", row.trok);
    appendField("ซอย", row.soi);
    appendField("ถนน", row.road);
    appendField("ชุมชนในทะเบียน", row.community);
    if (boundaryCommunity) appendField("ชุมชนตามชั้นประกอบที่จุดตกอยู่", `${boundaryCommunity}${boundaryCommunity !== declaredCommunity ? " (แสดงเพื่อ QA—ไม่เขียนทับทะเบียน)" : ""}`);
    appendField("ประเภทสถานที่", row.place_type);
    appendField("ละติจูด", row.lat === null ? "ไม่มีพิกัด" : Number(row.lat).toFixed(7), { data: true });
    appendField("ลองจิจูด", row.lon === null ? "ไม่มีพิกัด" : Number(row.lon).toFixed(7), { data: true });
    appendField("ชั้นความเชื่อมั่น", confidenceLabel(row.confidence_band));
    appendField("ระดับตำแหน่ง", geometryLabel(row.geom_level));
    if (row.method) appendField("วิธีได้ตำแหน่ง", methodLabel(row.method));
    appendField("สถานะการยืนยัน", statusLabel(row.status));
    appendField("รัศมีต้นทาง", row.radius_m === null ? "ไม่มีค่า" : `${NUMBER.format(row.radius_m)} เมตร`, { data: true });
    appendField("ใช้พิกัดนี้ร่วมกัน", coordinateKey(row) ? `${NUMBER.format(state.coordinateCounts.get(coordinateKey(row)) || 1)} รายการ` : "ไม่มีพิกัด");
    if (row.frontage_heading !== null) appendField("ทิศที่กล้องหัน", `${NUMBER.format(row.frontage_heading)} องศา`, { data: true });
    if (row.frontage_road) appendField("ถนนด้านหน้าที่ใช้เปิดภาพ", row.frontage_road);
    if (row.frontage_road_layer) appendField("แหล่งแนวถนนด้านหน้า", FRONTAGE_LAYER_LABELS[row.frontage_road_layer] || "แหล่งข้อมูลแนวถนน");
    if (row.frontage_road_source) appendField("วิธีเลือกถนนด้านหน้า", FRONTAGE_SOURCE_LABELS[row.frontage_road_source] || "เลือกจากแนวถนนใกล้แปลง");
    if (row.soi_name_check && row.soi_name_check_confidence) {
      appendField("ผลตรวจชื่อถนนและซอย", row.soi_name_check);
      appendField("ความมั่นใจของผลตรวจชื่อ", row.soi_name_check_confidence);
    }
    if (row.business_count > 0) {
      appendField("รายชื่อกิจการที่ปรากฏในข้อมูล", businessNamesPreview(row));
      appendField("สถานะทะเบียนกิจการ", row.business_status);
      appendField("วิธีผูกกิจการกับบ้าน", businessMatchLabel(row.business_match_confidence));
      appendField("จำนวนรายการทะเบียนกิจการจากต้นทาง", NUMBER.format(row.business_count), { data: true });
    }
    if (row.review_priority) {
      appendField("ลำดับการตรวจ", row.review_priority);
      if (row.review_score !== null) appendField("คะแนนจัดคิว", NUMBER.format(row.review_score), { data: true });
    }
    appendField("เหตุผลที่ควรตรวจ", formatFlags(row.review_flags));
    appendField("รอบประมวลผล", row.pipeline_run_id, { data: true });

    const eligibility = streetviewEligibility(row);
    elements.streetviewButton.disabled = !eligibility.allowed;
    elements.mapsButton.disabled = !Number.isFinite(row.lat) || !Number.isFinite(row.lon);
    elements.streetviewButton.textContent = eligibility.allowed
      ? "เปิด Street View ที่จุดต้นทาง ↗"
      : "จุดต้นทางยังเปิด Street View ไม่ได้";
    elements.mapsButton.textContent = Number.isFinite(row.lat) && Number.isFinite(row.lon)
      ? "เปิด Google Maps ที่จุดต้นทาง ↗"
      : "จุดต้นทางยังเปิด Google Maps ไม่ได้";
    elements.streetviewNote.textContent = eligibility.allowed
      ? "ลิงก์มีพิกัดที่เลือกโดยไม่ใส่เลขที่บ้านหรือรหัสทะเบียน Google ยังอาจได้รับ IP ข้อมูลการเชื่อมต่อ และข้อมูลบัญชีหรือเซสชันตามปกติ ภาพถนนเป็นหลักฐานประกอบ ไม่ใช่การยืนยันตำแหน่งโดยลำพัง"
      : `${eligibility.reason} หากเปิด Google Maps ลิงก์จะมีพิกัดที่เลือก และ Google อาจได้รับ IP ข้อมูลการเชื่อมต่อ และข้อมูลบัญชีหรือเซสชันตามปกติ`;

    const scope = verificationScope(row);
    if (scope === "building-context") {
      elements.reviewScopeNote.textContent = "รายการนี้เป็นอาคารหรือห้องชุด จึงบันทึกได้เฉพาะบริบทของอาคาร ไม่ใช้ผลว่าเห็นป้ายทะเบียนบ้านรายห้องตรงหรือขัดกัน";
      elements.reviewResultLabel.textContent = "ผลที่พบเกี่ยวกับอาคาร";
      elements.reviewNoteLabel.textContent = "เหตุผล/บันทึก (จำเป็นเมื่อระบุว่าบริบทอาคารตรงหรือขัดกัน · ไม่เกิน 500 ตัวอักษร)";
    } else {
      elements.reviewScopeNote.textContent = "รายการนี้บันทึกผลจากป้ายทะเบียนบ้านได้เมื่อหลักฐานที่เลือกแสดงป้ายหรือมาจากการสำรวจจริง";
      elements.reviewResultLabel.textContent = "ผลที่พบเกี่ยวกับป้ายทะเบียนบ้าน";
      elements.reviewNoteLabel.textContent = "เหตุผล/บันทึก (จำเป็นเมื่อระบุว่าป้ายตรงหรือขัดกัน · ไม่เกิน 500 ตัวอักษร)";
    }
    elements.reviewSource.value = review?.evidenceSource || "";
    syncReviewResultOptions(review?.result || "");
    elements.reviewNote.value = review?.note || "";
    elements.reviewSource.setCustomValidity("");
    elements.reviewResult.setCustomValidity("");
    elements.reviewNote.setCustomValidity("");
    renderAdjustmentEditor(row);
  };

  const cssColor = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  const markerBucket = (row) => {
    if (["parcel", "building"].includes(row.geom_level)) return "specific";
    if (["cluster", "interpolated"].includes(row.geom_level)) return "estimated";
    return "coarse";
  };

  const confidenceKey = (row) => CONFIDENCE_KEYS[row?.confidence_band] || "unknown";

  const pointColor = (row) => {
    if (window.matchMedia("(forced-colors: active)").matches) return "CanvasText";
    const key = confidenceKey(row);
    return cssColor(`--confidence-${key}`, "CanvasText");
  };

  const markerPalette = () => {
    if (window.matchMedia("(forced-colors: active)").matches) {
      return {
        halo: "Canvas",
        stroke: "CanvasText",
        active: "Highlight",
        selected: "Highlight",
        clusterFill: "Canvas",
        clusterText: "CanvasText",
        specific: "CanvasText",
        estimated: "CanvasText",
        coarse: "CanvasText"
      };
    }
    return {
      halo: cssColor("--map-marker-halo", "Canvas"),
      stroke: cssColor("--map-marker-stroke", "CanvasText"),
      active: cssColor("--map-active", "Highlight"),
      selected: cssColor("--map-selected", "Highlight"),
      clusterFill: cssColor("--surface-raised", "Canvas"),
      clusterText: cssColor("--text-primary", "CanvasText"),
      specific: cssColor("--series-5", "CanvasText"),
      estimated: cssColor("--series-7", "CanvasText"),
      coarse: cssColor("--series-3", "CanvasText")
    };
  };

  const tracePointShape = (context, bucket, radius) => {
    context.beginPath();
    if (bucket === "specific") {
      const arm = radius * 0.4;
      context.moveTo(-arm, -radius);
      context.lineTo(arm, -radius);
      context.lineTo(arm, -arm);
      context.lineTo(radius, -arm);
      context.lineTo(radius, arm);
      context.lineTo(arm, arm);
      context.lineTo(arm, radius);
      context.lineTo(-arm, radius);
      context.lineTo(-arm, arm);
      context.lineTo(-radius, arm);
      context.lineTo(-radius, -arm);
      context.lineTo(-arm, -arm);
      context.closePath();
      return;
    }
    if (bucket === "estimated") {
      for (let corner = 0; corner < 6; corner += 1) {
        const angle = -Math.PI / 2 + corner * Math.PI / 3;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (corner === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      return;
    }
    context.moveTo(0, -radius);
    context.lineTo(radius, radius);
    context.lineTo(-radius, radius);
    context.closePath();
  };

  const drawA0Indicator = (context, row, radius, palette, x = 0, y = 0) => {
    if (confidenceKey(row) !== "a0") return;
    context.beginPath();
    context.arc(x, y, Math.max(1.5, Math.min(2.25, radius * 0.28)), 0, Math.PI * 2);
    context.fillStyle = palette.halo;
    context.fill();
    context.strokeStyle = palette.stroke;
    context.lineWidth = 1.1;
    context.stroke();
  };

  const drawPointSymbol = (context, row, point, radius, palette) => {
    const bucket = markerBucket(row);
    context.save();
    context.translate(point.x, point.y);
    context.lineJoin = "round";
    tracePointShape(context, bucket, radius);
    context.strokeStyle = palette.halo;
    context.lineWidth = 5;
    context.stroke();
    context.fillStyle = pointColor(row);
    context.fill();
    context.strokeStyle = palette.stroke;
    context.lineWidth = 1.5;
    context.stroke();
    if (bucket === "estimated") {
      context.beginPath();
      context.moveTo(-radius * 0.66, radius * 0.56);
      context.lineTo(radius * 0.66, -radius * 0.56);
      context.strokeStyle = palette.halo;
      context.lineWidth = 3.5;
      context.lineCap = "round";
      context.stroke();
      context.strokeStyle = palette.stroke;
      context.lineWidth = 1.15;
      context.stroke();
    }
    drawA0Indicator(context, row, radius, palette);
    context.restore();
  };

  const drawUncertaintyCircle = (context, row, point, zoom, palette) => {
    if (!Number.isFinite(row?.radius_m) || row.radius_m <= 100) return;
    const metersPerPixel = 156543.03392 * Math.cos(Number(row.lat) * Math.PI / 180) / (2 ** zoom);
    const pixelRadius = Math.max(3, row.radius_m / Math.max(metersPerPixel, Number.EPSILON));
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, pixelRadius, 0, Math.PI * 2);
    context.fillStyle = pointColor(row);
    context.globalAlpha = 0.055;
    context.fill();
    context.globalAlpha = 0.72;
    context.strokeStyle = pointColor(row);
    context.lineWidth = 1.25;
    context.setLineDash([5, 4]);
    context.stroke();
    context.restore();
  };

  const clusterLabel = (count) => count >= 1000 ? `${Math.floor(count / 1000)}k` : String(count);

  const drawClusterSymbol = (context, point, count, palette, row) => {
    const label = clusterLabel(count);
    const radius = label.length >= 4 ? 17 : label.length === 3 ? 15 : 13;
    context.save();
    context.translate(point.x, point.y);
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.strokeStyle = palette.halo;
    context.lineWidth = 6;
    context.stroke();
    context.fillStyle = palette.clusterFill;
    context.fill();
    context.strokeStyle = pointColor(row);
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = palette.clusterText;
    context.font = `600 ${label.length >= 4 ? 8 : 9}px "JetBrains Mono", monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 0, 0.5);
    drawA0Indicator(context, row, radius, palette, radius * 0.58, -radius * 0.58);
    context.restore();
    return radius;
  };

  const selectedMarkerMarkup = (row) => {
    const bucket = markerBucket(row);
    let shape;
    if (bucket === "specific") {
      shape = '<path class="selected-marker-halo" d="M18 12h6v6h6v6h-6v6h-6v-6h-6v-6h6Z"></path><path class="selected-marker-core selected-marker-specific" d="M18 12h6v6h6v6h-6v6h-6v-6h-6v-6h6Z"></path>';
    } else if (bucket === "estimated") {
      shape = '<path class="selected-marker-halo" d="m21 11 9 5v10l-9 5-9-5V16Z"></path><path class="selected-marker-core selected-marker-estimated" d="m21 11 9 5v10l-9 5-9-5V16Z"></path><path class="selected-marker-detail-halo" d="m14 27 14-12"></path><path class="selected-marker-detail" d="m14 27 14-12"></path>';
    } else {
      shape = '<path class="selected-marker-halo" d="m21 11 10 20H11Z"></path><path class="selected-marker-core selected-marker-coarse" d="m21 11 10 20H11Z"></path>';
    }
    const a0Indicator = confidenceKey(row) === "a0"
      ? '<circle class="selected-marker-detail-halo" cx="21" cy="21" r="2.6"></circle><circle class="selected-marker-detail" cx="21" cy="21" r="2.6"></circle>'
      : "";
    return `<svg class="selected-marker-confidence-${confidenceKey(row)}" viewBox="0 0 42 42" aria-hidden="true"><circle class="selected-marker-ring-halo" cx="21" cy="21" r="17"></circle><circle class="selected-marker-ring" cx="21" cy="21" r="17"></circle>${shape}${a0Indicator}</svg>`;
  };

  const selectedMarkerIcon = (row, className = "selected-record-marker") => L.divIcon({
    className,
    html: selectedMarkerMarkup(row),
    iconSize: [42, 42],
    iconAnchor: [21, 21]
  });

  const proposedMarkerIcon = (row) => L.divIcon({
    className: "coordinate-adjustment-proposed-marker",
    html: '<span class="coordinate-adjustment-proposed-core" aria-hidden="true"></span>',
    iconSize: [46, 46],
    iconAnchor: [23, 23]
  });

  const createPointLayer = () => {
    const CanvasPointLayer = L.Layer.extend({
      initialize() {
        this._indices = [];
        this._selected = null;
        this._drawn = [];
        this._coordinateTargets = new Map();
      },
      onAdd(map) {
        this._map = map;
        this._canvas = L.DomUtil.create("canvas", "citychat-point-layer");
        this._canvas.setAttribute("aria-hidden", "true");
        this._canvas.style.position = "absolute";
        this._canvas.style.pointerEvents = "none";
        map.getPane("overlayPane").appendChild(this._canvas);
        map.on("moveend zoomend resize viewreset", this._reset, this);
        this._reset();
      },
      onRemove(map) {
        map.off("moveend zoomend resize viewreset", this._reset, this);
        this._canvas?.remove();
        this._canvas = null;
        this._map = null;
      },
      setIndices(indices) {
        this._indices = Array.isArray(indices) ? indices : [];
        this._reset();
      },
      setSelection(index) {
        this._selected = Number.isInteger(index) ? index : null;
        this._reset();
      },
      redraw() {
        this._reset();
      },
      hitTest(containerPoint) {
        let best = null;
        for (let index = this._drawn.length - 1; index >= 0; index -= 1) {
          const marker = this._drawn[index];
          const dx = marker.point.x - containerPoint.x;
          const dy = marker.point.y - containerPoint.y;
          const distance = dx * dx + dy * dy;
          const threshold = marker.hitRadius + 7;
          if (distance > threshold * threshold) continue;
          if (!best || distance < best.distance || (distance === best.distance && marker.indices.length > best.marker.indices.length)) {
            best = { marker, distance };
          }
        }
        const marker = best?.marker || null;
        if (!marker) return null;
        const coordinateTargets = this._coordinateTargets.get(marker.coordinateKey) || [marker];
        const combined = markerGrouping.combineCoordinateTargets(coordinateTargets) || marker;
        const target = { ...combined, point: marker.point, hitRadius: marker.hitRadius };
        if (this._map.getZoom() < 18 || target.buildingKind || target.mixedCoordinate) return target;
        return markerGrouping.combineOrdinaryScreenOverlaps(this._drawn, target, 2.5) || target;
      },
      _reset() {
        if (!this._map || !this._canvas) return;
        const size = this._map.getSize();
        if (!size.x || !size.y) return;
        const topLeft = this._map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this._canvas.width = Math.round(size.x * dpr);
        this._canvas.height = Math.round(size.y * dpr);
        this._canvas.style.width = `${size.x}px`;
        this._canvas.style.height = `${size.y}px`;
        const context = this._canvas.getContext("2d");
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, size.x, size.y);
        const zoom = this._map.getZoom();
        const palette = markerPalette();
        this._drawn = markerGrouping.layoutGroups(this._indices, state.rows)
          .map((group) => {
            const row = state.rows[group.indices[0]];
            if (!row) return null;
            const point = this._map.latLngToContainerPoint([row.lat, row.lon]);
            if (point.x < -24 || point.y < -24 || point.x > size.x + 24 || point.y > size.y + 24) return null;
            return { ...group, point };
          })
          .filter(Boolean)
          .sort((left, right) => Number(left.buildingGroup) - Number(right.buildingGroup));
        this._coordinateTargets.clear();
        for (const marker of this._drawn) {
          if (!this._coordinateTargets.has(marker.coordinateKey)) this._coordinateTargets.set(marker.coordinateKey, []);
          this._coordinateTargets.get(marker.coordinateKey).push(marker);
        }

        const uncertaintyKeys = new Set();
        for (const marker of this._drawn) {
          for (const index of marker.indices) {
            const row = state.rows[index];
            if (!row || !Number.isFinite(row.radius_m) || row.radius_m <= 100) continue;
            const key = `${marker.coordinateKey}|${row.radius_m}|${confidenceKey(row)}`;
            if (uncertaintyKeys.has(key)) continue;
            uncertaintyKeys.add(key);
            drawUncertaintyCircle(context, row, marker.point, zoom, palette);
          }
        }

        for (const marker of this._drawn) {
          if (marker.buildingGroup) {
            marker.hitRadius = drawClusterSymbol(context, marker.point, marker.indices.length, palette, state.rows[marker.indices[0]]);
          } else {
            const radius = zoom >= 18 ? 7 : zoom >= 16 ? 6 : 5.5;
            for (const index of marker.indices) {
              const row = state.rows[index];
              if (row) drawPointSymbol(context, row, marker.point, radius, palette);
            }
            marker.hitRadius = radius + 3;
          }
        }
      }
    });
    return new CanvasPointLayer();
  };

  const communityBoundaryStyle = () => ({
    color: cssColor("--map-active", "Highlight"),
    weight: 1.75,
    dashArray: "7 5",
    opacity: 0.92,
    fillColor: cssColor("--citychat-primary", "CanvasText"),
    fillOpacity: 0.045
  });

  const inferredFrameStyle = () => ({
    color: cssColor("--map-selected", "Highlight"),
    weight: 4,
    opacity: 1,
    fill: false,
    fillOpacity: 0
  });

  const ensureSpatialPanes = () => {
    if (!state.map) return;
    const inferredPane = state.map.getPane("inferred-frame-pane") || state.map.createPane("inferred-frame-pane");
    inferredPane.style.zIndex = "360";
    inferredPane.style.pointerEvents = "none";
    const communityPane = state.map.getPane("community-boundary-pane") || state.map.createPane("community-boundary-pane");
    communityPane.style.zIndex = "370";
  };

  const fitSpatialContextOnce = () => {
    if (!state.map || !state.spatialContextReady || state.initialSpatialFitDone) return;
    const inferredBounds = state.inferredFrameLayer?.getBounds();
    const communityBounds = state.communityBoundaryLayer?.getBounds();
    const bounds = inferredBounds?.isValid()
      ? inferredBounds
      : communityBounds?.isValid()
        ? communityBounds
        : null;
    if (bounds) state.map.fitBounds(bounds, { padding: [18, 18] });
    state.initialSpatialFitDone = true;
  };

  const addSpatialLayers = () => {
    if (!state.map) return;
    ensureSpatialPanes();
    if (state.inferredOuterFrame && !state.inferredFrameLayer) {
      state.inferredFrameLayer = L.geoJSON(state.inferredOuterFrame, {
        pane: "inferred-frame-pane",
        interactive: false,
        style: inferredFrameStyle
      });
      if (state.inferredFrameVisible) state.inferredFrameLayer.addTo(state.map);
    }
    if (state.communityBoundaries && !state.communityBoundaryLayer) {
      const tooltipClass = "community-tooltip";
      state.communityBoundaryLayer = L.geoJSON(state.communityBoundaries, {
        pane: "community-boundary-pane",
        interactive: true,
        style: communityBoundaryStyle,
        onEachFeature: (feature, layer) => {
          const label = document.createElement("span");
          label.textContent = clean(feature.properties?.name, "ไม่ระบุชื่อ", 160);
          layer.bindTooltip(label, { sticky: true, className: tooltipClass });
        }
      });
      if (state.communityBoundariesVisible) state.communityBoundaryLayer.addTo(state.map);
    }
    fitSpatialContextOnce();
  };

  const ensureMap = () => {
    if (state.map || !window.L || !elements.mapElement) {
      state.map?.invalidateSize();
      return;
    }

    state.map = L.map(elements.mapElement, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      minZoom: 11,
      maxZoom: 20
    }).setView([13.2784, 100.9340], 13);
    state.selectionRenderer = L.svg({ padding: 0.5 });
    L.control.zoom({
      position: "topleft",
      zoomInTitle: "ขยายแผนที่",
      zoomOutTitle: "ย่อแผนที่"
    }).addTo(state.map);
    state.map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>');
    state.map.attributionControl.addAttribution("แนวชุมชนและกรอบพื้นที่อนุมาน: จากข้อมูลที่ผู้ใช้จัดเตรียม");
    state.pointLayer = createPointLayer();
    state.pointLayer.addTo(state.map);
    state.pointLayer.setIndices(state.filtered);
    state.map.on("click", (event) => selectMapPoint(event));
    addSpatialLayers();
    if (state.selectedIndex !== null) updateMapSelection(false);
    requestAnimationFrame(() => state.map?.invalidateSize());
  };

  const updateMapSelection = (moveMap) => {
    if (!state.map) return;
    clearMapSelection();
    const row = state.rows[state.selectedIndex];
    if (!row) return;
    const hasSource = Number.isFinite(row.lat) && Number.isFinite(row.lon);
    const working = getWorkingAdjustment(row);
    const candidate = proposedPoint(row);
    if (!hasSource && !candidate) return;
    const location = hasSource ? [row.lat, row.lon] : null;
    const markerColor = pointColor(row);
    if (hasSource) {
      state.selectionMarker = L.marker(location, {
        icon: selectedMarkerIcon(row, candidate ? "selected-record-marker coordinate-adjustment-source-marker" : "selected-record-marker"),
        interactive: false,
        keyboard: false,
        opacity: candidate ? 0.58 : 1,
        zIndexOffset: 1000
      }).addTo(state.map);

      if (Number.isFinite(row.radius_m) && row.radius_m > 0) {
        state.radiusLayer = L.circle(location, {
          radius: row.radius_m,
          color: markerColor,
          weight: 2,
          dashArray: "6 6",
          opacity: 0.95,
          fillColor: markerColor,
          fillOpacity: 0.08,
          interactive: false
        }).addTo(state.map);
      } else if (row.radius_m === 0) {
        state.unknownRadiusLayer = L.circleMarker(location, {
          className: "unknown-radius-ring",
          renderer: state.selectionRenderer || undefined,
          radius: 24,
          color: markerColor,
          weight: 2,
          dashArray: "4 5",
          opacity: 0.9,
          fill: false,
          interactive: false
        }).addTo(state.map);
      }
    }
    state.pointLayer?.setSelection(state.selectedIndex);

    if (candidate) {
      const proposedLocation = [candidate.lat, candidate.lon];
      state.proposedMarker = L.marker(proposedLocation, {
        icon: proposedMarkerIcon(row),
        draggable: state.adjustmentMode !== "select",
        keyboard: false,
        riseOnHover: true,
        title: "จุดเสนอแก้—ยังไม่ยืนยัน",
        zIndexOffset: 1400
      }).addTo(state.map);
      state.proposedMarker.on("dragend", (event) => {
        const point = event.target.getLatLng();
        updateAdjustmentCoordinates(row, point.lat, point.lng);
        elements.adjustmentLat?.focus({ preventScroll: true });
      });
      if (hasSource) {
        state.adjustmentConnector = L.polyline([location, proposedLocation], {
          className: "coordinate-adjustment-connector",
          color: cssColor("--map-selected", "Highlight"),
          weight: 3,
          opacity: 0.92,
          dashArray: "7 6",
          interactive: false
        }).addTo(state.map);
      }
    }

    if (moveMap) {
      if (candidate && hasSource) {
        state.map.fitBounds(L.latLngBounds([location, [candidate.lat, candidate.lon]]), { padding: [54, 54], maxZoom: 19 });
      } else if (candidate) {
        state.map.setView([candidate.lat, candidate.lon], Math.max(state.map.getZoom(), 18));
      } else if (state.radiusLayer) {
        state.map.fitBounds(state.radiusLayer.getBounds(), { padding: [54, 54], maxZoom: 18 });
      } else if (state.unknownRadiusLayer) {
        state.map.setView(location, Math.min(Math.max(state.map.getZoom(), 14), 15));
      } else {
        state.map.setView(location, Math.max(state.map.getZoom(), 17));
      }
    }
  };

  const selectMapPoint = (event) => {
    if (!state.map || !state.rows.length) return;
    if (state.adjustmentMode === "place") {
      const row = state.rows[state.selectedIndex];
      if (!row) return;
      updateAdjustmentCoordinates(row, event.latlng.lat, event.latlng.lng);
      state.adjustmentMode = "move";
      elements.mapElement?.classList.remove("is-placing-coordinate");
      renderAdjustmentEditor(row);
      elements.answer.textContent = "วางจุดเสนอแล้ว ตรวจเหตุผลและหลักฐาน จากนั้นกดเก็บร่าง";
      return;
    }
    const marker = state.pointLayer?.hitTest(event.containerPoint);
    if (!marker?.indices?.length) return;

    if ((marker.buildingGroup || marker.hasNumberedBuildingGroup) && state.map.getZoom() < 18) {
      const nextZoom = Math.min(18, state.map.getZoom() + 2);
      const center = state.map.containerPointToLatLng(marker.point);
      state.map.setView(center, nextZoom, {
        animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      });
      const extra = marker.mixedCoordinate
        ? ` และมีทะเบียนแยก ${NUMBER.format(marker.ordinaryRecordCount)} รายการที่พิกัดเดียวกัน`
        : "";
      elements.answer.textContent = `ขยายไปยังหมุดอาคารพิกัดเดียวกัน ${NUMBER.format(marker.buildingRecordCount || marker.indices.length)} รายการแล้ว${extra}`;
      return;
    }

    const current = marker.indices.indexOf(state.selectedIndex);
    const nextIndex = marker.indices[(current + 1) % marker.indices.length];
    selectRecord(nextIndex, { moveMap: false });
    if (marker.indices.length > 1) {
      const position = marker.indices.indexOf(nextIndex) + 1;
      if (marker.mixedCoordinate) {
        elements.answer.textContent = `พิกัดนี้มีทะเบียนในอาคาร ${NUMBER.format(marker.buildingRecordCount)} รายการ และทะเบียนแยก ${NUMBER.format(marker.ordinaryRecordCount)} รายการ · กำลังดู ${NUMBER.format(position)} จาก ${NUMBER.format(marker.indices.length)} · คลิกจุดซ้ำเพื่อดูรายการถัดไป`;
      } else if (marker.buildingGroup) {
        const scope = marker.buildingKind === "condominium"
          ? "กลุ่มอาคารชุดพิกัดนี้"
          : marker.buildingKind === "office"
            ? "กลุ่มสำนักงานพิกัดนี้"
            : "กลุ่มอาคารพิกัดนี้";
        elements.answer.textContent = `${scope} มีทะเบียน ${NUMBER.format(marker.indices.length)} รายการ · กำลังดู ${NUMBER.format(position)} จาก ${NUMBER.format(marker.indices.length)} · คลิกหมุดซ้ำเพื่อดูรายการถัดไป`;
      } else if (marker.screenOverlap) {
        elements.answer.textContent = `มีจุดทะเบียน ${NUMBER.format(marker.indices.length)} จุดซ้อนกันในระดับซูมนี้ แต่ไม่ได้รวมเป็นอาคาร · กำลังดู ${NUMBER.format(position)} จาก ${NUMBER.format(marker.indices.length)} · คลิกจุดซ้ำเพื่อดูรายการถัดไป`;
      } else {
        elements.answer.textContent = `ทะเบียน ${NUMBER.format(marker.indices.length)} รายการใช้พิกัดประมาณเดียวกัน แต่ไม่ได้ถูกรวมเป็นอาคาร · กำลังดู ${NUMBER.format(position)} จาก ${NUMBER.format(marker.indices.length)} · คลิกจุดซ้ำเพื่อดูรายการถัดไป`;
      }
    }
  };

  const fitFilteredResults = () => {
    ensureMap();
    if (!state.map) return;
    const bounds = L.latLngBounds([]);
    state.filtered.forEach((index) => {
      const row = state.rows[index];
      if (Number.isFinite(row?.lat) && Number.isFinite(row?.lon)) bounds.extend([row.lat, row.lon]);
    });
    if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 18 });
  };

  const toggleSpatialLayer = (layerKey, visibleKey, button) => {
    ensureMap();
    const layer = state[layerKey];
    if (!state.map || !layer || !button) return;
    state[visibleKey] = !state[visibleKey];
    if (state[visibleKey]) layer.addTo(state.map);
    else state.map.removeLayer(layer);
    button.setAttribute("aria-pressed", String(state[visibleKey]));
  };

  const toggleCommunityBoundaries = () => toggleSpatialLayer(
    "communityBoundaryLayer",
    "communityBoundariesVisible",
    elements.toggleCommunityBoundaries
  );

  const toggleInferredFrame = () => toggleSpatialLayer(
    "inferredFrameLayer",
    "inferredFrameVisible",
    elements.toggleInferredFrame
  );

  const SPATIAL_CONTEXT_DISCLOSURE = "แนวแบ่งชุมชนและกรอบพื้นที่อนุมานจากขอบนอก 23 ชุมชนเป็นชั้นประกอบ ไม่ใช่เขตเทศบาล แนวเขตทางกฎหมาย หรือแนวเขตสิทธิ";

  const BASEMAP_DISCLOSURES = {
    none: `พื้นหลังปิดอยู่ จึงยังไม่ส่งพื้นที่ที่ดูออกไปภายนอก เลือกถนน (OpenStreetMap) หรือดาวเทียม (Esri World Imagery) เมื่อต้องการเปรียบเทียบ · ${SPATIAL_CONTEXT_DISCLOSURE} · ทะเบียนคนละหลังไม่ถูกรวมเพราะอยู่ใกล้กัน หมุดตัวเลขใช้เฉพาะอาคารชุด สำนักงาน หรือรายการพิกัดระดับอาคารที่ใช้พิกัดเดียวกันในข้อมูล · ภาพถ่ายอาจต่างช่วงเวลาและความละเอียด ไม่ใช่การยืนยันตำแหน่ง · ระดับแปลงแสดงเป็นจุดอ้างอิง เพราะ CSV ไม่มีรูปแปลง`,
    streets: `พื้นหลังถนนจาก OpenStreetMap เปิดอยู่ ผู้ให้บริการอาจได้รับ IP และพื้นที่แผนที่ที่เปิดดู แต่เว็บไม่ส่งเลขที่บ้าน รหัสทะเบียน หรือไฟล์ CSV · ${SPATIAL_CONTEXT_DISCLOSURE} · ทะเบียนคนละหลังไม่ถูกรวมเพราะอยู่ใกล้กัน หมุดตัวเลขใช้เฉพาะอาคารชุด สำนักงาน หรือรายการพิกัดระดับอาคารที่ใช้พิกัดเดียวกันในข้อมูล · ระดับแปลงยังแสดงเป็นจุดอ้างอิง เพราะ CSV ไม่มีรูปแปลง`,
    satellite: `ภาพถ่ายดาวเทียม Esri World Imagery เปิดอยู่ ผู้ให้บริการอาจได้รับ IP และพื้นที่แผนที่ที่เปิดดู แต่เว็บไม่ส่งเลขที่บ้าน รหัสทะเบียน หรือไฟล์ CSV · ${SPATIAL_CONTEXT_DISCLOSURE} · ทะเบียนคนละหลังไม่ถูกรวมเพราะอยู่ใกล้กัน หมุดตัวเลขใช้เฉพาะอาคารชุด สำนักงาน หรือรายการพิกัดระดับอาคารที่ใช้พิกัดเดียวกันในข้อมูล · ภาพอาจมาจากหลายช่วงเวลาและหลายแหล่ง ใช้เปรียบเทียบบริบท ไม่ใช่หลักฐานสิทธิหรือความสดของข้อมูล`
  };

  const createBasemapLayer = (mode) => {
    if (mode === "streets") {
      return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: 'พื้นหลังถนน © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
        crossOrigin: false,
        referrerPolicy: "no-referrer"
      });
    }
    if (mode === "satellite") {
      return L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 20,
        attribution: '<a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noreferrer">Esri World Imagery</a> · Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
        crossOrigin: false,
        referrerPolicy: "no-referrer"
      });
    }
    return null;
  };

  const setBasemap = (mode) => {
    ensureMap();
    if (!state.map) return;

    const nextMode = Object.prototype.hasOwnProperty.call(BASEMAP_DISCLOSURES, mode) ? mode : "none";
    Object.entries(state.basemapLayers).forEach(([layerMode, layer]) => {
      if (layerMode !== nextMode && layer && state.map.hasLayer(layer)) state.map.removeLayer(layer);
    });

    if (nextMode !== "none") {
      if (!state.basemapLayers[nextMode]) state.basemapLayers[nextMode] = createBasemapLayer(nextMode);
      state.basemapLayers[nextMode].addTo(state.map);
      state.basemapLayers[nextMode].bringToBack();
    }

    state.basemap = nextMode;
    elements.mapDisclosure.textContent = BASEMAP_DISCLOSURES[nextMode];
    elements.basemapButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.basemap === nextMode));
    });
  };

  const openExternalMap = (mode) => {
    const row = state.rows[state.selectedIndex];
    const href = externalMapUrl(row, mode);
    if (!href) return;
    const opened = window.open(href, "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
  };

  const openProposedExternalMap = (mode) => {
    const row = state.rows[state.selectedIndex];
    const candidate = proposedPoint(row);
    const href = candidate ? externalMapUrl(row, mode, candidate) : "";
    if (!href) return;
    const opened = window.open(href, "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
  };

  const beginAdjustment = () => {
    const row = state.rows[state.selectedIndex];
    if (!row) return;
    if (!adjustmentUiReady) {
      setAdjustmentStatus("เครื่องมือเสนอจุดไม่พร้อมใช้งาน", "error");
      return;
    }
    ensureMap();
    const working = ensureWorkingAdjustment(row);
    state.adjustmentMode = Number.isFinite(working.proposedLat) && Number.isFinite(working.proposedLon) ? "move" : "place";
    elements.mapElement?.classList.toggle("is-placing-coordinate", state.adjustmentMode === "place");
    renderAdjustmentEditor(row);
    updateReviewSummary();
    updateMapSelection(true);
    if (window.matchMedia("(max-width: 767px)").matches) setMobilePanel("map", { focus: false });
    elements.answer.textContent = state.adjustmentMode === "place"
      ? "แตะตำแหน่งที่มีหลักฐานรองรับบนแผนที่"
      : "ลากหมุดเสนอ หรือใช้ปุ่มขยับทีละระยะ แล้วกลับมากรอกหลักฐาน";
  };

  const activateAdjustmentPlacement = () => {
    const row = state.rows[state.selectedIndex];
    if (!row) return;
    if (!adjustmentUiReady) {
      setAdjustmentStatus("เครื่องมือเสนอจุดไม่พร้อมใช้งาน", "error");
      return;
    }
    ensureWorkingAdjustment(row);
    ensureMap();
    state.adjustmentMode = "place";
    elements.mapElement?.classList.add("is-placing-coordinate");
    renderAdjustmentEditor(row);
    updateReviewSummary();
    if (window.matchMedia("(max-width: 767px)").matches) setMobilePanel("map", { focus: false });
    elements.answer.textContent = "แตะหนึ่งครั้งบนแผนที่เพื่อวางจุดเสนอ—การแตะนี้ไม่แก้จุดต้นทาง";
  };

  const nudgeAdjustment = (direction) => {
    if (!adjustmentUiReady) {
      setAdjustmentStatus("เครื่องมือเสนอจุดไม่พร้อมใช้งาน", "error");
      return;
    }
    const row = state.rows[state.selectedIndex];
    const working = row ? ensureWorkingAdjustment(row) : null;
    if (!row || !working || !Number.isFinite(working.proposedLat) || !Number.isFinite(working.proposedLon)) return;
    elements.nudgeDistance.setCustomValidity("");
    const rawMetres = elements.nudgeDistance.value.trim();
    const metres = Number(rawMetres);
    if (!rawMetres || !elements.nudgeDistance.checkValidity() || !Number.isFinite(metres) || metres < 0.1 || metres > 1000) {
      elements.nudgeDistance.setCustomValidity("ระยะขยับต้องไม่น้อยกว่า 0.1 และไม่เกิน 1,000 เมตร");
      elements.nudgeDistance.reportValidity();
      setAdjustmentStatus("ยังไม่ได้ขยับจุด—กรุณาตรวจระยะขยับ", "error");
      return;
    }
    let next;
    try {
      next = adjustmentTools.nudgeCoordinate(
        { lat: working.proposedLat, lon: working.proposedLon },
        direction,
        metres
      );
    } catch (_) {
      setAdjustmentStatus("ยังไม่ได้ขยับจุด—ทิศหรือระยะขยับไม่ผ่านการตรวจ", "error");
      return;
    }
    updateAdjustmentCoordinates(row, Number(next.lat), Number(next.lon));
    state.adjustmentMode = "move";
    elements.answer.textContent = `ขยับจุดเสนอ ${NUMBER.format(metres)} เมตรแล้ว—ยังไม่ได้เก็บเป็นร่าง`;
  };

  const syncCoordinateInputs = () => {
    const row = state.rows[state.selectedIndex];
    if (!row) return;
    if (!adjustmentUiReady) {
      setAdjustmentStatus("เครื่องมือเสนอจุดไม่พร้อมใช้งาน", "error");
      return false;
    }
    elements.adjustmentLat.setCustomValidity("");
    elements.adjustmentLon.setCustomValidity("");
    const latText = elements.adjustmentLat.value.trim();
    const lonText = elements.adjustmentLon.value.trim();
    if (!latText || !lonText) {
      const working = ensureWorkingAdjustment(row);
      if (working) working.saved = false;
      if (!latText) elements.adjustmentLat.setCustomValidity("กรุณากรอกละติจูดพร้อมลองจิจูด");
      if (!lonText) elements.adjustmentLon.setCustomValidity("กรุณากรอกลองจิจูดพร้อมละติจูด");
      updateReviewSummary();
      setAdjustmentStatus("พิกัดจุดเสนอต้องกรอกให้ครบทั้งละติจูดและลองจิจูด", "error");
      return false;
    }
    if (!elements.adjustmentLat.checkValidity() || !elements.adjustmentLon.checkValidity()) {
      setAdjustmentStatus("พิกัดจุดเสนออยู่นอกช่วง WGS84 หรือมีรูปแบบไม่ถูกต้อง", "error");
      return false;
    }
    const lat = Number(latText);
    const lon = Number(lonText);
    const working = ensureWorkingAdjustment(row);
    if (working && Object.is(working.proposedLat, lat) && Object.is(working.proposedLon, lon)) return true;
    return updateAdjustmentCoordinates(row, lat, lon);
  };

  const markAdjustmentFieldError = (element, message) => {
    if (!element) return false;
    element.setCustomValidity(message);
    element.reportValidity();
    return true;
  };

  const validateAdjustmentForSave = (row, working) => {
    const fields = [
      elements.adjustmentReason,
      elements.adjustmentSource,
      elements.adjustmentObservedAt,
      elements.adjustmentReference,
      elements.adjustmentReviewer,
      elements.adjustmentNote,
      elements.adjustmentLat,
      elements.adjustmentLon
    ];
    fields.forEach((field) => field?.setCustomValidity(""));
    if (!Number.isFinite(working?.proposedLat) || !Number.isFinite(working?.proposedLon)) {
      return !markAdjustmentFieldError(elements.adjustmentLat, "กรุณาวางจุดเสนอให้ครบก่อน");
    }
    if (Number.isFinite(row.lat) && Number.isFinite(row.lon)) {
      const distance = adjustmentDistance(row, working);
      if (!Number.isFinite(distance) || distance < 0.05) {
        return !markAdjustmentFieldError(elements.adjustmentLat, "จุดเสนอต้องต่างจากจุดต้นทางอย่างน้อยเล็กน้อย");
      }
    }
    if (!working.reasonCode) return !markAdjustmentFieldError(elements.adjustmentReason, "กรุณาเลือกเหตุผลที่เสนอแก้จุด");
    if (!working.evidenceSource) return !markAdjustmentFieldError(elements.adjustmentSource, "กรุณาเลือกแหล่งหลักฐาน");
    if (!working.evidenceReference) return !markAdjustmentFieldError(elements.adjustmentReference, "กรุณาระบุเลขเอกสาร วันเวลาภาพ หรือคำอ้างอิงที่ตามตรวจได้");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(working.evidenceObservedAt)) {
      return !markAdjustmentFieldError(elements.adjustmentObservedAt, "กรุณาระบุวันที่ตรวจหลักฐาน");
    }
    if (!working.reviewerCode) return !markAdjustmentFieldError(elements.adjustmentReviewer, "กรุณาระบุรหัสผู้ปฏิบัติงานที่ไม่ใช่ชื่อบุคคล");
    if (!/^[0-9A-Za-z._:-]{1,64}$/.test(working.reviewerCode)) {
      return !markAdjustmentFieldError(elements.adjustmentReviewer, "ใช้รหัสหน่วยงานเป็น A–Z, 0–9, จุด ขีด หรือขีดล่าง ไม่ใช้ชื่อบุคคล");
    }
    if (!working.reasonNote || working.reasonNote.length < 5) {
      return !markAdjustmentFieldError(elements.adjustmentNote, "กรุณาอธิบายสิ่งที่เห็นหรือเหตุผลอย่างน้อย 5 ตัวอักษร");
    }
    if (/[?&](?:access_token|token|key|credential|password|secret)=/i.test(working.evidenceReference)) {
      return !markAdjustmentFieldError(elements.adjustmentReference, "อย่าวางลิงก์ที่มี token, key หรือข้อมูลลับในช่องอ้างอิง");
    }
    return true;
  };

  const adjustmentDraftPayload = (working, adjustmentId, adjustedAtUtc) => ({
    adjustment_action: working.action,
    proposed_lat: working.proposedLat,
    proposed_lon: working.proposedLon,
    adjustment_reason_code: working.reasonCode,
    adjustment_reason_note: working.reasonNote,
    evidence_source: working.evidenceSource,
    evidence_reference: working.evidenceReference,
    evidence_observed_at: working.evidenceObservedAt,
    reviewer_code: working.reviewerCode,
    adjustment_id: adjustmentId,
    adjusted_at_utc: adjustedAtUtc
  });

  const ADJUSTMENT_ERROR_MESSAGES = Object.freeze({
    REASON_ACTION_MISMATCH: "เหตุผลที่เลือกไม่ตรงกับการวางจุดใหม่หรือการย้ายจุดเดิม",
    REASON_UNSUPPORTED: "เหตุผลที่เลือกไม่อยู่ในชุดที่รองรับ",
    EVIDENCE_SOURCE_UNSUPPORTED: "แหล่งหลักฐานที่เลือกไม่อยู่ในชุดที่รองรับ",
    STRONG_EVIDENCE_REQUIRED: "รายการนี้ต้องใช้ผลสำรวจ ภาพ/เอกสารหน่วยงาน หรือ Street View ที่เห็นหลักฐานชัด",
    EVIDENCE_REFERENCE_REQUIRED: "กรุณาระบุหลักฐานอ้างอิงที่ตามตรวจได้",
    REVIEWER_CODE_INVALID: "รหัสผู้ปฏิบัติงานมีรูปแบบไม่ถูกต้อง",
    UNCHANGED_COORDINATE: "จุดเสนอยังตรงกับจุดต้นทาง"
  });

  const saveAdjustment = (event) => {
    event?.preventDefault();
    if (!adjustmentUiReady) {
      setAdjustmentStatus("เครื่องมือเสนอจุดไม่พร้อมใช้งาน จึงไม่เก็บร่าง", "error");
      return;
    }
    const row = state.rows[state.selectedIndex];
    if (!row) return;
    captureAdjustmentMetadata(ensureWorkingAdjustment(row));
    if (!syncCoordinateInputs()) return;
    const working = captureAdjustmentMetadata(getWorkingAdjustment(row));
    if (!validateAdjustmentForSave(row, working)) return;
    const now = new Date().toISOString();
    const adjustmentId = working.adjustmentId || (window.crypto?.randomUUID?.() || `adj-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`);
    const exportDraft = adjustmentDraftPayload(working, adjustmentId, now);
    const validation = adjustmentTools.validateAdjustment(exportDraft, row);
    if (!validation.valid) {
      const firstError = validation.errors[0];
      setAdjustmentStatus(ADJUSTMENT_ERROR_MESSAGES[firstError] || "ร่างแก้จุดยังมีข้อมูลไม่ครบหรือไม่สอดคล้อง กรุณาตรวจทุกช่อง", "error");
      if (firstError === "STRONG_EVIDENCE_REQUIRED") elements.adjustmentSource.focus();
      else elements.adjustmentReason.focus();
      return;
    }
    const saved = {
      ...working,
      history: [],
      saved: true,
      movementM: adjustmentDistance(row, working),
      adjustmentId,
      adjustedAtUtc: now,
      exportDraft
    };
    state.adjustments.set(adjustmentKey(row), { ...saved });
    state.adjustmentWorking.set(adjustmentKey(row), { ...saved, history: [] });
    state.adjustmentMode = "select";
    elements.mapElement?.classList.remove("is-placing-coordinate");
    updateReviewSummary();
    renderDetail();
    renderList();
    updateMapSelection(false);
    elements.answer.textContent = "เก็บจุดเสนอเป็นร่างแล้ว—จุดต้นทางและระดับความเชื่อมั่นไม่ได้ถูกแก้";
  };

  const undoAdjustment = () => {
    const row = state.rows[state.selectedIndex];
    const working = row ? getWorkingAdjustment(row) : null;
    if (!row || !working?.history?.length) return;
    const previous = working.history.pop();
    working.proposedLat = previous ? previous.lat : null;
    working.proposedLon = previous ? previous.lon : null;
    const key = adjustmentKey(row);
    const saved = state.adjustments.get(key);
    working.saved = adjustmentMatchesSaved(working, saved);
    state.adjustmentWorking.set(key, working);
    updateReviewSummary();
    renderAdjustmentEditor(row);
    updateMapSelection(false);
    renderList();
    elements.answer.textContent = working.saved
      ? "ย้อนการขยับล่าสุดและกลับมาที่ร่างที่เก็บไว้แล้ว"
      : "ย้อนการขยับล่าสุดแล้ว—การแก้ปัจจุบันยังไม่ได้เก็บเป็นร่าง";
  };

  const resetAdjustment = () => {
    const row = state.rows[state.selectedIndex];
    if (!row) return;
    const key = adjustmentKey(row);
    const hasSource = Number.isFinite(row.lat) && Number.isFinite(row.lon);
    const confirmation = hasSource
      ? "ต้องการลบร่างจุดเสนอของรายการนี้และกลับไปแสดงจุดต้นทางหรือไม่?"
      : "ต้องการล้างจุดเสนอของรายการนี้หรือไม่? รายการต้นทางจะยังคงไม่มีพิกัด";
    if ((state.adjustments.has(key) || state.adjustmentWorking.has(key)) && !window.confirm(confirmation)) return;
    state.adjustments.delete(key);
    state.adjustmentWorking.delete(key);
    state.adjustmentMode = "select";
    elements.mapElement?.classList.remove("is-placing-coordinate");
    updateReviewSummary();
    renderDetail();
    updateMapSelection(false);
    renderList();
    elements.answer.textContent = hasSource ? "กลับมาใช้จุดต้นทางแล้ว" : "ล้างจุดเสนอแล้ว รายการต้นทางยังไม่มีพิกัด";
  };

  const cancelUnsavedAdjustment = () => {
    const row = state.rows[state.selectedIndex];
    if (!row || state.adjustmentMode === "select") return;
    const key = adjustmentKey(row);
    const saved = state.adjustments.get(key);
    if (saved) state.adjustmentWorking.set(key, { ...saved, history: [], saved: true });
    else state.adjustmentWorking.delete(key);
    state.adjustmentMode = "select";
    elements.mapElement?.classList.remove("is-placing-coordinate");
    updateReviewSummary();
    renderAdjustmentEditor(row);
    updateMapSelection(false);
    elements.answer.textContent = "ยกเลิกการแก้ที่ยังไม่เก็บแล้ว";
  };

  const updateReviewSummary = () => {
    elements.reviewCount.textContent = NUMBER.format(state.reviews.size);
    elements.exportButton.disabled = state.reviews.size === 0;
    if (elements.adjustmentCount) elements.adjustmentCount.textContent = NUMBER.format(state.adjustments.size);
    if (elements.exportAdjustments) {
      const dirtyCount = dirtyAdjustmentCount();
      elements.exportAdjustments.disabled = !adjustmentUiReady || state.adjustments.size === 0 || dirtyCount > 0;
      if (!adjustmentUiReady) {
        elements.exportAdjustments.title = "เครื่องมือตรวจร่างโหลดไม่ครบ จึงส่งออกไม่ได้";
      } else if (dirtyCount > 0) {
        elements.exportAdjustments.title = `มีงานแก้ที่ยังไม่เก็บ ${NUMBER.format(dirtyCount)} รายการ กรุณาเก็บหรือยกเลิกก่อนส่งออก`;
      } else {
        elements.exportAdjustments.removeAttribute("title");
      }
    }
  };

  const saveReview = (event) => {
    event.preventDefault();
    const row = state.rows[state.selectedIndex];
    if (!row) return;
    const evidenceSource = elements.reviewSource.value;
    const result = elements.reviewResult.value;
    const note = clean(elements.reviewNote.value, "", 500);
    elements.reviewSource.setCustomValidity("");
    elements.reviewResult.setCustomValidity("");
    elements.reviewNote.setCustomValidity("");
    if (!result && !evidenceSource && !note) {
      state.reviews.delete(state.selectedIndex);
      elements.answer.textContent = "ลบร่างของรายการนี้แล้ว";
    } else {
      if (!evidenceSource) {
        elements.reviewSource.setCustomValidity("กรุณาเลือกแหล่งหลักฐานที่ใช้ตรวจ");
        elements.reviewSource.reportValidity();
        return;
      }
      if (!result) {
        elements.reviewResult.setCustomValidity("กรุณาเลือกผลที่พบ");
        elements.reviewResult.reportValidity();
        return;
      }
      if (!allowedReviewResults(evidenceSource, row).has(result)) {
        elements.reviewResult.setCustomValidity("ผลที่เลือกไม่สอดคล้องกับแหล่งหลักฐาน กรุณาเลือกผลที่เปิดใช้งาน");
        elements.reviewResult.reportValidity();
        return;
      }
      if (STRONG_REVIEW_RESULTS.has(result) && !note) {
        elements.reviewNote.setCustomValidity("กรุณาบันทึกเหตุผลหรือสิ่งที่เห็น เมื่อระบุว่าหลักฐานตรงหรือขัดกัน");
        elements.reviewNote.reportValidity();
        return;
      }
      state.reviews.set(state.selectedIndex, {
        index: state.selectedIndex,
        verificationScope: verificationScope(row),
        evidenceSource,
        result,
        note,
        reviewedAt: new Date().toISOString()
      });
      elements.answer.textContent = "เก็บบันทึกร่างไว้ในแท็บนี้แล้ว — ยังไม่ใช่ผลยืนยันทางราชการ";
    }
    updateReviewSummary();
    renderDetail();
    applyFilters();
  };

  const csvCell = (value) => {
    let text = String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };

  const exportAdjustments = () => {
    if (!adjustmentUiReady) {
      setAdjustmentStatus("เครื่องมือตรวจร่างโหลดไม่ครบ จึงส่งออกไม่ได้", "error");
      return;
    }
    if (!state.adjustments.size) return;
    const dirtyCount = dirtyAdjustmentCount();
    if (dirtyCount > 0) {
      setAdjustmentStatus(`ยังส่งออกไม่ได้ มีงานแก้ที่ยังไม่เก็บ ${NUMBER.format(dirtyCount)} รายการ กรุณาเก็บหรือยกเลิกก่อน`, "error");
      return;
    }
    const accepted = window.confirm("ไฟล์นี้มีรหัสทะเบียนและพิกัดต้นทาง/จุดเสนอ โปรดเก็บในพื้นที่งานที่มีสิทธิ์เข้าถึงเท่านั้น ต้องการดาวน์โหลดร่างแก้จุดหรือไม่?");
    if (!accepted) return;
    const exportBatchId = window.crypto?.randomUUID?.() || `batch-${Date.now()}`;
    let csv;
    try {
      const entries = [...state.adjustments.values()].map((saved) => {
        const sourceIndex = state.rowIndexById.get(saved.houseRegId);
        if (!Number.isInteger(sourceIndex)) throw new Error("source row unavailable");
        return {
          row: state.rows[sourceIndex],
          draft: saved.exportDraft || adjustmentDraftPayload(saved, saved.adjustmentId, saved.adjustedAtUtc)
        };
      });
      csv = adjustmentTools.buildAdjustmentExport(entries, {
        source_sha256: state.summary?.sha256 || "",
        source_dataset_contract: `${DATASET_CONTRACT}-v3`,
        tool_release: TOOL_RELEASE,
        export_batch_id: exportBatchId
      }).csv;
    } catch (_) {
      setAdjustmentStatus("ส่งออกไม่ได้ เพราะร่างหรือข้อมูลที่มาไม่ผ่านการตรวจ กรุณาเปิดแต่ละรายการแล้วเก็บร่างใหม่", "error");
      return;
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    anchor.download = `citychat-saensuk-point-adjustment-draft-${timestamp}.csv`;
    anchor.rel = "noopener";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    elements.answer.textContent = `ดาวน์โหลดร่างแก้จุด ${NUMBER.format(state.adjustments.size)} รายการแล้ว—ไฟล์ต้นฉบับไม่เปลี่ยน`;
  };

  const exportReviews = () => {
    if (!state.reviews.size) return;
    const accepted = window.confirm("ไฟล์ส่งออกมีรหัสทะเบียน บ้านเลขที่ และพิกัด โปรดเก็บในพื้นที่งานที่มีสิทธิ์เข้าถึงเท่านั้น ต้องการส่งออกหรือไม่?");
    if (!accepted) return;
    const headers = [
      "house_reg_id",
      "house_no",
      "community",
      "lat",
      "lon",
      "geom_level",
      "confidence_band",
      "source_status",
      "source_tier",
      "source_method",
      "source_radius_m",
      "frontage_heading",
      "frontage_road",
      "frontage_road_layer",
      "frontage_road_source",
      "soi_name_check",
      "soi_name_check_confidence",
      "business_count",
      "business_names",
      "business_status",
      "business_match_confidence",
      "source_review_priority",
      "source_review_score",
      "source_review_flags",
      "pipeline_run_id",
      "dataset_contract",
      "review_status",
      "verification_scope",
      "evidence_source",
      "review_result",
      "review_note",
      "reviewed_at",
      "streetview_url",
      "google_maps_url",
      "source_sha256"
    ];
    const lines = [headers.map(csvCell).join(",")];
    [...state.reviews.values()]
      .sort((left, right) => left.index - right.index)
      .forEach((review) => {
        const row = state.rows[review.index];
        lines.push([
          row.house_reg_id,
          row.house_no,
          row.community,
          row.lat,
          row.lon,
          row.geom_level,
          row.confidence_band,
          row.status,
          row.tier,
          row.method,
          row.radius_m,
          row.frontage_heading,
          row.frontage_road,
          row.frontage_road_layer,
          row.frontage_road_source,
          row.soi_name_check,
          row.soi_name_check_confidence,
          row.business_count,
          row.business_names,
          row.business_status,
          row.business_match_confidence,
          row.review_priority,
          row.review_score,
          row.review_flags,
          row.pipeline_run_id,
          DATASET_CONTRACT,
          "draft-unverified",
          review.verificationScope || verificationScope(row),
          review.evidenceSource,
          review.result,
          review.note,
          review.reviewedAt,
          externalMapUrl(row, "streetview"),
          externalMapUrl(row, "map"),
          state.summary?.sha256 || ""
        ].map(csvCell).join(","));
      });
    const blob = new Blob(["\uFEFF", lines.join("\r\n"), "\r\n"], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "citychat-saensuk-review-draft-v9-20260908.csv";
    anchor.rel = "noopener";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    elements.answer.textContent = `ส่งออกร่าง ${NUMBER.format(state.reviews.size)} รายการแล้ว — ไฟล์ต้นฉบับในแท็บยังไม่เปลี่ยน`;
  };

  const setMapFocus = (active, { focus = false } = {}) => {
    if (!elements.workspace || !elements.mapFocus || !elements.mapFocusLabel) return;
    const next = Boolean(active) && window.matchMedia("(min-width: 768px)").matches;
    state.mapFocus = next;
    elements.workspace.dataset.mapFocused = String(next);
    elements.mapFocus.setAttribute("aria-pressed", String(next));
    elements.mapFocus.setAttribute(
      "aria-label",
      next ? "กลับไปดูคิว แผนที่ และรายละเอียด" : "ขยายแผนที่และซ่อนคิวกับรายละเอียดชั่วคราว"
    );
    elements.mapFocus.title = next ? "กด Esc เพื่อกลับโต๊ะตรวจ" : "";
    elements.mapFocusLabel.textContent = next ? "กลับโต๊ะตรวจ" : "ดูแผนที่เต็มพื้นที่";
    [elements.queuePane, elements.detailPane].forEach((pane) => {
      if (!pane) return;
      pane.inert = next;
      if (next) pane.setAttribute("aria-hidden", "true");
      else pane.removeAttribute("aria-hidden");
    });
    if (next && !state.map && state.rows.length) ensureMap();
    requestAnimationFrame(() => {
      state.map?.invalidateSize();
      updateMapSelection(false);
      if (focus) elements.mapFocus.focus({ preventScroll: true });
    });
  };

  const setMobilePanel = (panel, { focus = false } = {}) => {
    if (!elements.reviewGrid) return;
    elements.reviewGrid.dataset.activePanel = panel;
    elements.mobileTabs.forEach((button) => {
      const active = button.dataset.mobilePanel === panel;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    if (panel === "map") {
      ensureMap();
      requestAnimationFrame(() => {
        state.map?.invalidateSize();
        updateMapSelection(false);
      });
    }
  };

  const loadGeoJson = async (path) => {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) throw new Error("spatial response");
    return response.json();
  };

  const validateCommunityBoundaries = (data) => {
    if (data?.type !== "FeatureCollection" || data.features?.length !== 23) throw new Error("community shape");
    const names = new Set();
    for (const feature of data.features) {
      const name = clean(feature?.properties?.name, "", 160);
      if (!name || names.has(name) || !["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)) {
        throw new Error("community content");
      }
      names.add(name);
    }
    return data;
  };

  const validateInferredOuterFrame = (data) => {
    if (data?.type !== "FeatureCollection" || data.features?.length !== 1) throw new Error("frame shape");
    const feature = data.features[0];
    const properties = feature?.properties || {};
    const geometry = feature?.geometry;
    const ring = geometry?.coordinates?.[0];
    const propertyKeys = Object.keys(properties).sort().join(",");
    if (
      propertyKeys !== "name,role,source_features" ||
      properties.name !== "กรอบพื้นที่อนุมานจากขอบนอก 23 ชุมชน" ||
      properties.role !== "inferred_outer_frame" ||
      properties.source_features !== 23 ||
      geometry?.type !== "Polygon" ||
      geometry.coordinates?.length !== 1 ||
      !Array.isArray(ring) ||
      ring.length !== 528 ||
      JSON.stringify(data.bbox) !== "[100.8974531,13.2383789,100.9643072,13.3175765]"
    ) {
      throw new Error("frame content");
    }
    return data;
  };

  const disableSpatialControl = (button, label) => {
    if (!button) return;
    button.disabled = true;
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", `${label}โหลดไม่ได้`);
  };

  const loadSpatialContext = async () => {
    const [communityResult, frameResult] = await Promise.allSettled([
      loadGeoJson("assets/data/saensuk-community-boundaries.geojson").then(validateCommunityBoundaries),
      loadGeoJson("assets/data/saensuk-community-outer-frame.geojson").then(validateInferredOuterFrame)
    ]);

    if (communityResult.status === "fulfilled") {
      state.communityBoundaries = communityResult.value;
    } else {
      state.communityBoundariesVisible = false;
      disableSpatialControl(elements.toggleCommunityBoundaries, "แนวชุมชน ");
    }
    if (frameResult.status === "fulfilled") {
      state.inferredOuterFrame = frameResult.value;
    } else {
      state.inferredFrameVisible = false;
      disableSpatialControl(elements.toggleInferredFrame, "กรอบพื้นที่อนุมาน ");
    }

    state.spatialContextReady = true;
    addSpatialLayers();
    if (state.selectedIndex !== null && state.communityBoundaries) renderDetail();
    if (state.communityBoundaries || state.inferredOuterFrame) {
      elements.mapLoading.hidden = true;
    } else {
      elements.mapLoading.textContent = "เปิดชั้นพื้นที่ประกอบไม่ได้ แต่ยังตรวจรายการจากตารางได้";
    }
  };

  elements.fileInput.addEventListener("change", () => startParse(elements.fileInput.files?.[0]));
  fileLabels.forEach((label) => {
    label.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      elements.fileInput.click();
    });
  });
  const openFilePicker = () => {
    elements.fileInput.value = "";
    elements.fileInput.click();
  };
  elements.alertReset.addEventListener("click", openFilePicker);
  elements.changeFile.addEventListener("click", openFilePicker);
  elements.clearFile.addEventListener("click", () => {
    if (hasDatasetDraftState() && !window.confirm("ร่างผลตรวจ จุดเสนอที่เก็บแล้ว และงานแก้ที่ยังไม่เก็บทั้งหมดในแท็บนี้จะถูกล้างและกู้คืนไม่ได้ ต้องการล้างข้อมูลหรือไม่?")) return;
    resetData({ focusPicker: true });
  });
  [elements.reviewSource, elements.reviewResult, elements.reviewNote].forEach((control) => {
    control.addEventListener("input", () => control.setCustomValidity(""));
  });
  elements.reviewSource.addEventListener("change", () => syncReviewResultOptions());
  elements.exportButton.addEventListener("click", exportReviews);
  elements.exportAdjustments?.addEventListener("click", exportAdjustments);
  elements.startAdjustment?.addEventListener("click", beginAdjustment);
  elements.placeAdjustment?.addEventListener("click", activateAdjustmentPlacement);
  elements.saveAdjustment?.addEventListener("click", saveAdjustment);
  elements.undoAdjustment?.addEventListener("click", undoAdjustment);
  elements.resetAdjustment?.addEventListener("click", resetAdjustment);
  elements.proposedStreetview?.addEventListener("click", () => openProposedExternalMap("streetview"));
  elements.proposedMap?.addEventListener("click", () => openProposedExternalMap("map"));
  elements.nudgeDirections.forEach((button) => {
    button.addEventListener("click", () => nudgeAdjustment(button.dataset.nudgeDirection));
  });
  elements.nudgeDistance?.addEventListener("input", () => elements.nudgeDistance.setCustomValidity(""));
  [elements.adjustmentLat, elements.adjustmentLon].forEach((control) => {
    control?.addEventListener("change", syncCoordinateInputs);
    control?.addEventListener("input", () => {
      control.setCustomValidity("");
      const row = state.rows[state.selectedIndex];
      const working = row ? getWorkingAdjustment(row) : null;
      if (working) {
        working.saved = false;
        updateReviewSummary();
        setAdjustmentStatus("พิกัดในช่องกำลังเปลี่ยน—กรอกให้ครบแล้วเก็บร่างก่อนส่งออก", "editing");
      }
    });
  });
  [
    elements.adjustmentReason,
    elements.adjustmentSource,
    elements.adjustmentObservedAt,
    elements.adjustmentReference,
    elements.adjustmentReviewer,
    elements.adjustmentNote
  ].forEach((control) => {
    control?.addEventListener("input", () => {
      control.setCustomValidity("");
      const row = state.rows[state.selectedIndex];
      const working = row ? getWorkingAdjustment(row) : null;
      if (working) {
        captureAdjustmentMetadata(working);
        working.saved = false;
        updateReviewSummary();
        setAdjustmentStatus("ข้อมูลร่างเปลี่ยนแล้ว—กดเก็บร่างก่อนดาวน์โหลด", "editing");
      }
    });
    control?.addEventListener("change", () => {
      control.setCustomValidity("");
      const row = state.rows[state.selectedIndex];
      const working = row ? getWorkingAdjustment(row) : null;
      if (working) {
        captureAdjustmentMetadata(working);
        working.saved = false;
        updateReviewSummary();
        renderList();
        setAdjustmentStatus("ข้อมูลร่างเปลี่ยนแล้ว—กดเก็บร่างก่อนดาวน์โหลด", "editing");
      }
    });
  });
  elements.search.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.page = 0;
      applyFilters({ selectFirst: true });
    }, 180);
  });
  elements.geomFilter.addEventListener("change", () => {
    state.page = 0;
    applyFilters({ selectFirst: true });
  });
  elements.communityFilter.addEventListener("change", () => {
    state.page = 0;
    applyFilters({ selectFirst: true });
  });
  const bindDatasetFilter = (element, stateKey) => {
    if (!element) return;
    element.addEventListener("change", () => {
      state[stateKey] = element.value;
      state.page = 0;
      applyFilters({ selectFirst: true });
    });
  };
  bindDatasetFilter(elements.roadFilter, "roadFilter");
  bindDatasetFilter(elements.placeFilter, "placeFilter");
  bindDatasetFilter(elements.confidenceFilter, "confidenceFilter");
  bindDatasetFilter(elements.businessFilter, "businessFilter");
  bindDatasetFilter(elements.priorityFilter, "priorityFilter");
  bindDatasetFilter(elements.evidenceFilter, "evidenceFilter");
  elements.reviewFilters.forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewFilter = button.dataset.reviewFilter;
      elements.reviewFilters.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      state.page = 0;
      applyFilters({ selectFirst: true });
    });
  });
  elements.list.addEventListener("click", (event) => {
    const satelliteButton = event.target.closest("[data-satellite-index]");
    if (satelliteButton) {
      const index = Number(satelliteButton.dataset.satelliteIndex);
      if (!Number.isInteger(index)) return;
      selectRecord(index, { switchPanel: false });
      setBasemap("satellite");
      if (window.matchMedia("(max-width: 767px)").matches) setMobilePanel("map", { focus: false });
      return;
    }
    const button = event.target.closest("[data-record-index]");
    if (!button) return;
    const index = Number(button.dataset.recordIndex);
    if (Number.isInteger(index)) selectRecord(index);
  });
  elements.pagePrev.addEventListener("click", () => {
    state.page = Math.max(0, state.page - 1);
    renderList();
    elements.list.querySelector("button")?.focus();
  });
  elements.pageNext.addEventListener("click", () => {
    const maxPage = Math.max(0, Math.ceil(state.filtered.length / PAGE_SIZE) - 1);
    state.page = Math.min(maxPage, state.page + 1);
    renderList();
    elements.list.querySelector("button")?.focus();
  });
  elements.mapFocus?.addEventListener("click", () => setMapFocus(!state.mapFocus));
  elements.fitResults.addEventListener("click", fitFilteredResults);
  elements.toggleCommunityBoundaries.addEventListener("click", toggleCommunityBoundaries);
  elements.toggleInferredFrame.addEventListener("click", toggleInferredFrame);
  elements.basemapButtons.forEach((button) => {
    button.addEventListener("click", () => setBasemap(button.dataset.basemap));
  });
  elements.streetviewButton.addEventListener("click", () => openExternalMap("streetview"));
  elements.mapsButton.addEventListener("click", () => openExternalMap("map"));
  elements.reviewForm.addEventListener("submit", saveReview);
  elements.mobileTabs.forEach((button, index) => {
    button.addEventListener("click", () => setMobilePanel(button.dataset.mobilePanel));
    button.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % elements.mobileTabs.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + elements.mobileTabs.length) % elements.mobileTabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = elements.mobileTabs.length - 1;
      if (nextIndex !== null) {
        event.preventDefault();
        setMobilePanel(elements.mobileTabs[nextIndex].dataset.mobilePanel, { focus: true });
      }
    });
  });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(max-width: 767px)").matches && state.mapFocus) setMapFocus(false);
    if (window.matchMedia("(min-width: 768px)").matches && state.rows.length) ensureMap();
    requestAnimationFrame(() => state.map?.invalidateSize());
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.adjustmentMode !== "select") {
      event.preventDefault();
      cancelUnsavedAdjustment();
      return;
    }
    if (state.mapFocus) {
      event.preventDefault();
      setMapFocus(false, { focus: true });
    }
  });

  const refreshMapPalette = () => {
    state.pointLayer?.redraw();
    state.communityBoundaryLayer?.setStyle(communityBoundaryStyle);
    state.inferredFrameLayer?.setStyle(inferredFrameStyle);
    const row = state.rows[state.selectedIndex];
    if (!row) return;
    const color = pointColor(row);
    state.radiusLayer?.setStyle({ color, fillColor: color });
    state.unknownRadiusLayer?.setStyle({ color });
    state.adjustmentConnector?.setStyle({ color: cssColor("--map-selected", "Highlight") });
  };
  new MutationObserver(refreshMapPalette).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"]
  });
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  if (typeof colorScheme.addEventListener === "function") colorScheme.addEventListener("change", refreshMapPalette);

  loadSpatialContext();
  showOnly("gate");
})();
