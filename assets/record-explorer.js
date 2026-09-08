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
  const NUMBER = new Intl.NumberFormat("th-TH");

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
    nearer_to_another_soi: "จุดอยู่ใกล้ซอยอื่นมากกว่าซอยที่ระบุ",
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
    fitResults: explorer.querySelector("[data-fit-results]"),
    toggleBoundaries: explorer.querySelector("[data-toggle-boundaries]"),
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
    reviewNote: explorer.querySelector("[data-review-note]")
  };

  const fileLabels = [...document.querySelectorAll("[data-file-label]")];

  const state = {
    requestId: 0,
    worker: null,
    rows: [],
    summary: null,
    searchIndex: [],
    baseOrder: [],
    filtered: [],
    selectedIndex: null,
    page: 0,
    evidenceFilter: "",
    roadFilter: "",
    placeFilter: "",
    confidenceFilter: "",
    businessFilter: "",
    priorityFilter: "",
    reviewFilter: "",
    reviews: new Map(),
    coordinateCounts: new Map(),
    boundaries: null,
    boundaryLayer: null,
    boundariesVisible: true,
    map: null,
    selectionRenderer: null,
    pointLayer: null,
    selectionMarker: null,
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
    if (filter === "nearer-to-another-soi") return flags.has("nearer_to_another_soi");
    if (filter === "source-needs-review") return row?.status === "needs-review";
    if (filter === "no-coordinate") return !Number.isFinite(row?.lat) || !Number.isFinite(row?.lon);
    if (filter === "with-business") return Number(row?.business_count) > 0;
    if (filter === "without-business") return Number(row?.business_count) === 0;
    if (filter === "review-high") return row?.review_priority === "สูง";
    if (filter === "review-mid") return row?.review_priority === "กลาง";
    if (filter === "review-low") return row?.review_priority === "ต่ำ";
    return false;
  };

  const streetviewEligibility = (row) => {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) {
      return { allowed: false, reason: "รายการนี้ยังไม่มีพิกัด จึงเปิดภาพถนนไม่ได้" };
    }
    return { allowed: true, reason: "" };
  };

  const externalMapUrl = (row, mode) => {
    if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)) return "";
    if (mode === "streetview" && !streetviewEligibility(row).allowed) return "";
    if (mode !== "streetview" && mode !== "map") return "";
    if (mode === "streetview") {
      const viewpoint = `${Number(row.lat).toFixed(7)},${Number(row.lon).toFixed(7)}`;
      const heading = Number.isFinite(row.frontage_heading) ? `&heading=${Number(row.frontage_heading)}` : "";
      return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${viewpoint}${heading}&pitch=0&fov=80`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${Number(row.lat).toFixed(7)},${Number(row.lon).toFixed(7)}`;
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

  const setParseProgress = (progress) => {
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
    elements.parseTitle.textContent = stage === "parsing" ? "กำลังเตรียมโต๊ะตรวจ…" : "กำลังตรวจไฟล์ในเครื่อง…";
    elements.parseDetail.textContent = details[stage] || "กำลังตรวจโครงสร้างก่อนเปิดข้อมูลรายบ้าน";
  };

  const showError = (error) => {
    state.worker?.terminate();
    state.worker = null;
    showOnly("error");
    elements.alertTitle.textContent = "เปิดไฟล์นี้ไม่ได้";
    const rowHint = Number.isInteger(error?.rowNumber) ? ` (ใกล้แถวที่ ${NUMBER.format(error.rowNumber)})` : "";
    elements.alertDetail.textContent = `${clean(error?.message, "ไฟล์ไม่ผ่านการตรวจรุ่นและโครงสร้าง", 220)}${rowHint} กรุณาเลือกชุดข้อมูลหน้าแผนที่ฉบับวันที่ 8 ก.ย. 2569`;
    elements.alert.focus();
  };

  const clearMapSelection = () => {
    if (!state.map) return;
    if (state.selectionMarker) state.map.removeLayer(state.selectionMarker);
    if (state.radiusLayer) state.map.removeLayer(state.radiusLayer);
    if (state.unknownRadiusLayer) state.map.removeLayer(state.unknownRadiusLayer);
    state.selectionMarker = null;
    state.radiusLayer = null;
    state.unknownRadiusLayer = null;
    state.pointLayer?.setSelection(null);
  };

  const resetData = ({ focusPicker = false } = {}) => {
    state.worker?.terminate();
    state.worker = null;
    state.requestId += 1;
    state.rows = [];
    state.summary = null;
    state.searchIndex = [];
    state.baseOrder = [];
    state.filtered = [];
    state.selectedIndex = null;
    state.page = 0;
    state.reviews.clear();
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
    showOnly("gate");
    if (focusPicker) fileLabels.find((label) => explorer.contains(label))?.focus({ preventScroll: true });
  };

  const startParse = (file) => {
    if (!isSafeTopLevel()) {
      elements.fileInput.value = "";
      return;
    }
    if (!file) return;
    state.worker?.terminate();
    state.requestId += 1;
    const requestId = state.requestId;
    showOnly("parsing");
    explorer.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start"
    });
    setParseProgress({ stage: "reading" });

    try {
      state.worker = new Worker("assets/record-worker.js?v=20260908-display-v2");
    } catch (_) {
      showError({ message: "เบราว์เซอร์นี้ไม่สามารถเปิดตัวอ่านไฟล์แบบแยกงานได้" });
      return;
    }

    state.worker.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.requestId !== requestId) return;
      if (message.type === "progress") {
        setParseProgress(message.progress);
        return;
      }
      if (message.type === "error") {
        showError(message.error);
        return;
      }
      if (message.type === "success") {
        state.worker?.terminate();
        state.worker = null;
        prepareWorkspace(message.rows, message.summary);
      }
    });

    state.worker.addEventListener("error", () => {
      showError({ message: "ตัวอ่านไฟล์หยุดทำงานก่อนตรวจเสร็จ" });
    });

    state.worker.postMessage({ type: "parse", requestId, file });
  };

  const prepareWorkspace = (rows, summary) => {
    if (!Array.isArray(rows) || rows.length !== 42524 || summary?.rowCount !== 42524) {
      showError({ message: "ผลตรวจไฟล์ไม่ครบตามชุดข้อมูลหน้าแผนที่" });
      return;
    }

    state.rows = rows;
    state.summary = summary;
    state.coordinateCounts.clear();
    state.searchIndex = new Array(rows.length);
    state.baseOrder = rows.map((_, index) => index);

    rows.forEach((row, index) => {
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
        row.soi_check,
        row.business_names,
        row.business_status,
        row.business_match_confidence,
        row.review_priority,
        row.review_flags,
        formatFlags(row.review_flags)
      ].join(" ").toLocaleLowerCase("th-TH");
      state.searchIndex[index] = searchable;

      const coordKey = coordinateKey(row);
      if (coordKey) state.coordinateCounts.set(coordKey, (state.coordinateCounts.get(coordKey) || 0) + 1);
    });

    state.baseOrder.sort((leftIndex, rightIndex) => {
      const left = rows[leftIndex];
      const right = rows[rightIndex];
      const priority = rowSortPriority(left) - rowSortPriority(right);
      if (priority !== 0) return priority;
      const score = (right.review_score ?? -1) - (left.review_score ?? -1);
      if (score !== 0) return score;
      return leftIndex - rightIndex;
    });

    const communities = [...new Set(rows.map((row) => clean(row.community, "", 160)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "th"));
    const options = [new Option("ทุกชุมชน", "")];
    communities.forEach((community) => options.push(new Option(community, community)));
    elements.communityFilter.replaceChildren(...options);
    if (elements.roadFilter) {
      const roads = [...new Set(rows.map((row) => clean(row.road, "", 180)).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "th"));
      elements.roadFilter.replaceChildren(
        new Option("ทุกถนน", ""),
        ...roads.map((road) => new Option(road, road))
      );
    }
    if (elements.placeFilter) {
      const placeTypes = [...new Set(rows.map((row) => clean(row.place_type, "", 120)).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "th"));
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
      const radiusText = row.radius_m === null
        ? "ไม่มีจุดให้วัดรัศมี"
        : row.radius_m === 0
          ? "ต้นทางระบุรัศมี 0 ม. (ยังไม่ถือว่าแม่นยำ)"
          : `รัศมีประมาณ ${NUMBER.format(row.radius_m)} ม.`;
      const queueReason = row.review_priority && row.review_flags
        ? `ควรตรวจ: ${formatFlags(row.review_flags).split(" · ")[0]}`
        : "";
      radius.textContent = [
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

  const containingCommunity = (row) => {
    if (!state.boundaries || !Number.isFinite(row.lon) || !Number.isFinite(row.lat)) return "";
    for (const feature of state.boundaries.features) {
      const geometry = feature.geometry;
      const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
      if (polygons.some((polygon) => pointInPolygon(row.lon, row.lat, polygon))) {
        return clean(feature.properties?.name, "", 160);
      }
    }
    return "";
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
    if (boundaryCommunity) appendField("ขอบเขตที่จุดตกอยู่", `${boundaryCommunity}${boundaryCommunity !== declaredCommunity ? " (แสดงเพื่อ QA—ไม่เขียนทับทะเบียน)" : ""}`);
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
    if (row.dist_named_soi_m !== null) appendField("ระยะถึงซอยที่ระบุ", `${NUMBER.format(row.dist_named_soi_m)} เมตร`, { data: true });
    if (row.soi_check) appendField("การตรวจชื่อซอย", row.soi_check);
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
      ? "เปิด Street View ดูบริบท ↗"
      : "Street View ยังไม่เหมาะกับรายการนี้";
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

  const selectedMarkerIcon = (row) => L.divIcon({
    className: "selected-record-marker",
    html: selectedMarkerMarkup(row),
    iconSize: [42, 42],
    iconAnchor: [21, 21]
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

  const boundaryStyle = () => ({
    color: cssColor("--map-active", "Highlight"),
    weight: 2,
    dashArray: "7 5",
    opacity: 0.9,
    fillColor: cssColor("--citychat-primary", "CanvasText"),
    fillOpacity: 0.06
  });

  const addBoundaryLayer = () => {
    if (!state.map || !state.boundaries || state.boundaryLayer) return;
    const tooltipClass = "community-tooltip";
    state.boundaryLayer = L.geoJSON(state.boundaries, {
      interactive: true,
      style: boundaryStyle,
      onEachFeature: (feature, layer) => {
        const label = document.createElement("span");
        label.textContent = clean(feature.properties?.name, "ไม่ระบุชื่อ", 160);
        layer.bindTooltip(label, { sticky: true, className: tooltipClass });
      }
    });
    if (state.boundariesVisible) state.boundaryLayer.addTo(state.map);
    if (state.boundaryLayer.getBounds().isValid()) {
      state.map.fitBounds(state.boundaryLayer.getBounds(), { padding: [18, 18] });
    }
    elements.mapLoading.hidden = true;
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
    state.map.attributionControl.addAttribution("ขอบเขตชุมชน: ชุดข้อมูลที่ผู้ใช้จัดเตรียม");
    state.pointLayer = createPointLayer();
    state.pointLayer.addTo(state.map);
    state.pointLayer.setIndices(state.filtered);
    state.map.on("click", (event) => selectMapPoint(event));
    addBoundaryLayer();
    if (state.selectedIndex !== null) updateMapSelection(false);
    requestAnimationFrame(() => state.map?.invalidateSize());
  };

  const updateMapSelection = (moveMap) => {
    if (!state.map) return;
    clearMapSelection();
    const row = state.rows[state.selectedIndex];
    if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)) return;
    const location = [row.lat, row.lon];
    const markerColor = pointColor(row);
    state.selectionMarker = L.marker(location, {
      icon: selectedMarkerIcon(row),
      interactive: false,
      keyboard: false,
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
    state.pointLayer?.setSelection(state.selectedIndex);

    if (moveMap) {
      if (state.radiusLayer) {
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

  const toggleBoundaries = () => {
    ensureMap();
    if (!state.map || !state.boundaryLayer) return;
    state.boundariesVisible = !state.boundariesVisible;
    if (state.boundariesVisible) state.boundaryLayer.addTo(state.map);
    else state.map.removeLayer(state.boundaryLayer);
    elements.toggleBoundaries.setAttribute("aria-pressed", String(state.boundariesVisible));
    elements.toggleBoundaries.textContent = state.boundariesVisible ? "ขอบเขตชุมชน" : "แสดงขอบเขตชุมชน";
  };

  const BASEMAP_DISCLOSURES = {
    none: "พื้นหลังปิดอยู่ จึงยังไม่ส่งพื้นที่ที่ดูออกไปภายนอก เลือกถนน (OpenStreetMap) หรือดาวเทียม (Esri World Imagery) เมื่อต้องการเปรียบเทียบ · ทะเบียนคนละหลังไม่ถูกรวมเพราะอยู่ใกล้กัน หมุดตัวเลขใช้เฉพาะอาคารชุด สำนักงาน หรือรายการพิกัดระดับอาคารที่ใช้พิกัดเดียวกันในข้อมูล · ภาพถ่ายอาจต่างช่วงเวลาและความละเอียด ไม่ใช่หลักฐานสิทธิหรือแนวเขต · ระดับแปลงแสดงเป็นจุดอ้างอิง เพราะ CSV ไม่มีรูปแปลง",
    streets: "พื้นหลังถนนจาก OpenStreetMap เปิดอยู่ ผู้ให้บริการอาจได้รับ IP และพื้นที่แผนที่ที่เปิดดู แต่เว็บไม่ส่งเลขที่บ้าน รหัสทะเบียน หรือไฟล์ CSV · ทะเบียนคนละหลังไม่ถูกรวมเพราะอยู่ใกล้กัน หมุดตัวเลขใช้เฉพาะอาคารชุด สำนักงาน หรือรายการพิกัดระดับอาคารที่ใช้พิกัดเดียวกันในข้อมูล · ระดับแปลงยังแสดงเป็นจุดอ้างอิง เพราะ CSV ไม่มีรูปแปลง",
    satellite: "ภาพถ่ายดาวเทียม Esri World Imagery เปิดอยู่ ผู้ให้บริการอาจได้รับ IP และพื้นที่แผนที่ที่เปิดดู แต่เว็บไม่ส่งเลขที่บ้าน รหัสทะเบียน หรือไฟล์ CSV · ทะเบียนคนละหลังไม่ถูกรวมเพราะอยู่ใกล้กัน หมุดตัวเลขใช้เฉพาะอาคารชุด สำนักงาน หรือรายการพิกัดระดับอาคารที่ใช้พิกัดเดียวกันในข้อมูล · ภาพอาจมาจากหลายช่วงเวลาและหลายแหล่ง ใช้เปรียบเทียบบริบท ไม่ใช่หลักฐานสิทธิ ความสดของข้อมูล หรือแนวเขต"
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

  const updateReviewSummary = () => {
    elements.reviewCount.textContent = NUMBER.format(state.reviews.size);
    elements.exportButton.disabled = state.reviews.size === 0;
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
      "dist_named_soi_m",
      "soi_check",
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
          row.dist_named_soi_m,
          row.soi_check,
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
    anchor.download = "citychat-saensuk-review-draft-20260908.csv";
    anchor.rel = "noopener";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    elements.answer.textContent = `ส่งออกร่าง ${NUMBER.format(state.reviews.size)} รายการแล้ว — ไฟล์ต้นฉบับในแท็บยังไม่เปลี่ยน`;
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

  const loadBoundaries = async () => {
    try {
      const response = await fetch("assets/data/saensuk-community-boundaries.geojson", { cache: "no-cache" });
      if (!response.ok) throw new Error("boundary response");
      const data = await response.json();
      if (data?.type !== "FeatureCollection" || data.features?.length !== 23) throw new Error("boundary shape");
      const names = new Set();
      for (const feature of data.features) {
        const name = clean(feature?.properties?.name, "", 160);
        if (!name || names.has(name) || !["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)) {
          throw new Error("boundary content");
        }
        names.add(name);
      }
      state.boundaries = data;
      addBoundaryLayer();
      if (state.selectedIndex !== null) renderDetail();
    } catch (_) {
      elements.mapLoading.textContent = "เปิดขอบเขตชุมชนไม่ได้ แต่ยังตรวจรายการจากตารางได้";
      elements.toggleBoundaries.disabled = true;
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
    if (state.reviews.size && !window.confirm("ร่างผลตรวจทั้งหมดในแท็บนี้จะถูกล้างและกู้คืนไม่ได้ ต้องการล้างข้อมูลหรือไม่?")) return;
    resetData({ focusPicker: true });
  });
  [elements.reviewSource, elements.reviewResult, elements.reviewNote].forEach((control) => {
    control.addEventListener("input", () => control.setCustomValidity(""));
  });
  elements.reviewSource.addEventListener("change", () => syncReviewResultOptions());
  elements.exportButton.addEventListener("click", exportReviews);
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
  elements.fitResults.addEventListener("click", fitFilteredResults);
  elements.toggleBoundaries.addEventListener("click", toggleBoundaries);
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
    if (window.matchMedia("(min-width: 768px)").matches && state.rows.length) ensureMap();
    requestAnimationFrame(() => state.map?.invalidateSize());
  });

  const refreshMapPalette = () => {
    state.pointLayer?.redraw();
    state.boundaryLayer?.setStyle(boundaryStyle);
    const row = state.rows[state.selectedIndex];
    if (!row) return;
    const color = pointColor(row);
    state.radiusLayer?.setStyle({ color, fillColor: color });
    state.unknownRadiusLayer?.setStyle({ color });
  };
  new MutationObserver(refreshMapPalette).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"]
  });
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  if (typeof colorScheme.addEventListener === "function") colorScheme.addEventListener("change", refreshMapPalette);

  loadBoundaries();
  showOnly("gate");
})();
