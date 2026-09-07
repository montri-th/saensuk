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
  const SNAPSHOT_RELEASE = "v6";
  const NUMBER = new Intl.NumberFormat("th-TH");
  const BAD_STREETVIEW_FLAGS = [
    "large_parcel",
    "shared_parcel_cross_soi",
    "citymeter_far",
    "bl1_web_conflict",
    "condo_unit_matched_as_house",
    "duplicate_registry_key",
    "building_register_conflict",
    "building_register_multi_site",
    "anchor_contradicted",
    "far_from_road"
  ];

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
    community_polygon_only: "อ้างอิงเฉพาะรูปชุมชน"
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
    evidenceFilter: explorer.querySelector("[data-evidence-filter]"),
    reviewFilters: [...explorer.querySelectorAll("[data-review-filter]")],
    filteredCount: explorer.querySelector("[data-filtered-count]"),
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
    reviewFilter: "",
    reviews: new Map(),
    coordinateCounts: new Map(),
    parcelCounts: new Map(),
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

  const maskId = (value) => {
    const text = clean(value, "", 120);
    if (!text) return "ไม่พบรหัส";
    if (text.length <= 6) return `••${text.slice(-3)}`;
    return `••••${text.slice(-6)}`;
  };

  const geometryLabel = (value) => GEOM_LABELS[value] || clean(value);
  const statusLabel = (value) => STATUS_LABELS[value] || clean(value);

  const addressLine = (row) => {
    const parts = [`บ้านเลขที่ ${clean(row.house_no)}`];
    if (row.soi && row.soi !== "-") parts.push(`ซอย ${clean(row.soi)}`);
    if (row.road && row.road !== "-") parts.push(`ถนน ${clean(row.road)}`);
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
    const flags = splitFlags(row?.flags);
    if (filter === "tier-a0") return row?.tier === "A0";
    if (filter === "building-register-conflict") return flags.has("building_register_conflict");
    if (filter === "building-register-multi-site") return flags.has("building_register_multi_site");
    if (filter === "far-from-road") return flags.has("far_from_road");
    if (filter === "source-needs-review") return row?.status === "needs-review";
    if (filter === "no-coordinate") return !Number.isFinite(row?.lat) || !Number.isFinite(row?.lon);
    return false;
  };

  const hasBadStreetviewFlag = (row) => {
    const flags = splitFlags(row.flags);
    return BAD_STREETVIEW_FLAGS.some((flag) => flags.has(flag));
  };

  const streetviewEligibility = (row) => {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) {
      return { allowed: false, reason: "รายการนี้ยังไม่มีพิกัด จึงเปิดภาพถนนไม่ได้" };
    }
    if (!["parcel", "building"].includes(row.geom_level)) {
      return {
        allowed: false,
        reason: `${geometryLabel(row.geom_level)} กว้างเกินกว่าจะใช้ภาพถนนตรวจป้ายบ้านรายหลังได้`
      };
    }
    if (["needs-review", "building-lookup-pending"].includes(row.status)) {
      return { allowed: false, reason: "หลักฐานของรายการนี้ยังขัดกันหรือรอค้นเพิ่ม ควรดูแผนที่บริเวณแทน" };
    }
    if (hasBadStreetviewFlag(row)) {
      return { allowed: false, reason: "รายการนี้มีธงเตือนด้านหลักฐาน จึงปิดการตรวจป้ายจากจุดเดียว" };
    }
    return { allowed: true, reason: "" };
  };

  const externalMapUrl = (row, mode) => {
    if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)) return "";
    if (mode === "streetview" && !streetviewEligibility(row).allowed) return "";
    if (mode !== "streetview" && mode !== "map") return "";
    const url = new URL(mode === "streetview"
      ? "https://www.google.com/maps/@"
      : "https://www.google.com/maps/search/");
    url.searchParams.set("api", "1");
    if (mode === "streetview") {
      url.searchParams.set("map_action", "pano");
      url.searchParams.set("viewpoint", `${Number(row.lat).toFixed(7)},${Number(row.lon).toFixed(7)}`);
    } else {
      url.searchParams.set("query", `${Number(row.lat).toFixed(7)},${Number(row.lon).toFixed(7)}`);
    }
    return url.toString();
  };

  const reviewPriority = (row) => {
    if (streetviewEligibility(row).allowed) return 0;
    if (["parcel", "building"].includes(row.geom_level)) return 1;
    if (row.geom_level === "cluster") return 2;
    if (row.geom_level === "interpolated") return 3;
    if (["soi_road", "community"].includes(row.geom_level)) return 4;
    return 5;
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
      hashing: "กำลังตรวจลายนิ้วมือ เพื่อยืนยันว่าเป็นไฟล์ v6 ที่ตรงกับผลสรุป",
      decoding: "กำลังตรวจว่าไฟล์เป็น UTF-8 ที่สมบูรณ์",
      parsing: parsed > 0
        ? `ตรวจแล้ว ${NUMBER.format(parsed)} จาก ${NUMBER.format(total)} รายการ`
        : "กำลังตรวจโครงสร้าง 22 คอลัมน์และทุกแถว"
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
    elements.alertDetail.textContent = `${clean(error?.message, "ไฟล์ไม่ผ่านการตรวจรุ่นและโครงสร้าง", 220)}${rowHint} กรุณาเลือก master table v6 ฉบับวันที่ 7 ก.ย. 2569`;
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
    state.parcelCounts.clear();
    state.pointLayer?.setIndices([]);
    clearMapSelection();
    elements.fileInput.value = "";
    elements.search.value = "";
    elements.geomFilter.value = "";
    elements.communityFilter.replaceChildren(new Option("ทุกชุมชน", ""));
    elements.evidenceFilter.value = "";
    state.evidenceFilter = "";
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
      state.worker = new Worker("assets/record-worker.js?v=20260907-v6");
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
      showError({ message: "ผลตรวจไฟล์ไม่ครบตามตารางหลัก v6" });
      return;
    }

    state.rows = rows;
    state.summary = summary;
    state.coordinateCounts.clear();
    state.parcelCounts.clear();
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
        row.source_parcel_id,
        row.tier,
        row.method,
        row.status,
        row.flags,
        formatFlags(row.flags)
      ].join(" ").toLocaleLowerCase("th-TH");
      state.searchIndex[index] = searchable;

      const coordKey = coordinateKey(row);
      if (coordKey) state.coordinateCounts.set(coordKey, (state.coordinateCounts.get(coordKey) || 0) + 1);
      if (row.source_parcel_id) {
        state.parcelCounts.set(row.source_parcel_id, (state.parcelCounts.get(row.source_parcel_id) || 0) + 1);
      }
    });

    state.baseOrder.sort((leftIndex, rightIndex) => {
      const left = rows[leftIndex];
      const right = rows[rightIndex];
      const priority = reviewPriority(left) - reviewPriority(right);
      if (priority !== 0) return priority;
      const radius = (left.radius_m ?? Number.MAX_SAFE_INTEGER) - (right.radius_m ?? Number.MAX_SAFE_INTEGER);
      return radius || leftIndex - rightIndex;
    });

    const communities = [...new Set(rows.map((row) => clean(row.community, "", 160)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "th"));
    const options = [new Option("ทุกชุมชน", "")];
    communities.forEach((community) => options.push(new Option(community, community)));
    elements.communityFilter.replaceChildren(...options);
    elements.datasetRows.textContent = NUMBER.format(summary.rowCount);
    state.page = 0;
    elements.evidenceFilter.value = "";
    state.evidenceFilter = "";
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
    const evidenceFilter = state.evidenceFilter;

    state.filtered = state.baseOrder.filter((index) => {
      const row = state.rows[index];
      if (query && !state.searchIndex[index].includes(query)) return false;
      if (geometry && row.geom_level !== geometry) return false;
      if (community && row.community !== community) return false;
      if (!matchesEvidenceFilter(row, evidenceFilter)) return false;
      const reviewed = state.reviews.has(index);
      if (state.reviewFilter === "pending" && reviewed) return false;
      if (state.reviewFilter === "reviewed" && !reviewed) return false;
      return true;
    });

    const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages - 1);
    elements.filteredCount.textContent = NUMBER.format(state.filtered.length);
    elements.resultNote.textContent = state.filtered.length
      ? `พบ ${NUMBER.format(state.filtered.length)} รายการ · ทะเบียนทั่วไปแสดงแยก หมุดตัวเลขใช้เฉพาะรายการอาคารที่ใช้พิกัดเดียวกันในข้อมูล`
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
      id.textContent = maskId(row.house_reg_id);
      const meta = document.createElement("span");
      meta.className = "record-meta";
      meta.textContent = `${geometryLabel(row.geom_level)} · ${clean(row.community)}`;
      const radius = document.createElement("span");
      radius.className = "record-radius";
      const review = state.reviews.get(index);
      const radiusText = row.radius_m === null
        ? "ไม่มีจุดให้วัดรัศมี"
        : row.radius_m === 0
          ? "ต้นทางระบุรัศมี 0 ม. (ยังไม่ถือว่าแม่นยำ)"
          : `รัศมีประมาณ ${NUMBER.format(row.radius_m)} ม.`;
      radius.textContent = review ? `● ${REVIEW_LABELS[review.result] || "มีบันทึกร่าง"} · ${radiusText}` : radiusText;

      button.append(address, id, meta, radius);
      item.append(button);
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
    elements.answer.textContent = `${geometryLabel(row.geom_level)} · ${statusLabel(row.status)} · ${row.radius_m === null ? "ยังไม่มีรัศมี" : `รัศมี ${NUMBER.format(row.radius_m)} ม.`}`;
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
      return FLAG_LABELS[key] || key;
    }).join(" · ");
  };

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
    elements.detailId.textContent = `รายการ ${maskId(row.house_reg_id)}`;
    elements.detailHouse.textContent = `บ้านเลขที่ ${clean(row.house_no)}`;

    const radiusPhrase = row.radius_m === null
      ? "ไม่มีค่ารัศมี"
      : row.radius_m === 0
        ? "ต้นทางระบุรัศมี 0 ม. แต่จุดยังเป็นผลประมาณ"
        : `รัศมีประมาณ ±${NUMBER.format(row.radius_m)} ม.`;
    elements.detailAnswer.textContent = `${geometryLabel(row.geom_level)} · ${radiusPhrase} · ยังไม่ผ่านการตรวจภาคสนาม`;

    elements.detailChips.replaceChildren();
    appendChip(geometryLabel(row.geom_level), ["parcel", "building"].includes(row.geom_level) ? "truth-chip-specific" : "");
    appendChip(statusLabel(row.status), ["needs-review", "building-lookup-pending"].includes(row.status) ? "truth-chip-warning" : "");
    if (row.tier === "A0") {
      appendChip("A0 · สำรวจเทศบาลผูกถึงแปลง", "truth-chip-specific");
      appendChip("A0 ยังไม่ตรวจหน้างาน", "truth-chip-warning");
    } else if (row.tier) appendChip(`Tier ${clean(row.tier)}`);
    if (row.radius_m === 0) appendChip("รัศมี 0 ไม่ได้แปลว่าแม่นยำ", "truth-chip-warning");
    const rowFlags = splitFlags(row.flags);
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
    appendField("รหัสทะเบียน", row.house_reg_id, { data: true });
    appendField("ที่อยู่ย่อ", addressLine(row));
    appendField("ตรอก", row.trok);
    appendField("ซอย", row.soi);
    appendField("ถนน", row.road);
    appendField("ชุมชนในทะเบียน", row.community);
    if (boundaryCommunity) appendField("ขอบเขตที่จุดตกอยู่", `${boundaryCommunity}${boundaryCommunity !== declaredCommunity ? " (แสดงเพื่อ QA—ไม่เขียนทับทะเบียน)" : ""}`);
    appendField("ตำบลตามชีต", row.subdistrict_sheet);
    appendField("ประเภทสถานที่", row.place_type);
    appendField("ฝั่งถนน", row.side);
    appendField("ละติจูด", row.lat === null ? "ไม่มีพิกัด" : Number(row.lat).toFixed(7), { data: true });
    appendField("ลองจิจูด", row.lon === null ? "ไม่มีพิกัด" : Number(row.lon).toFixed(7), { data: true });
    appendField("ระดับตำแหน่ง", geometryLabel(row.geom_level));
    appendField("วิธี", row.method === "A0" ? "A0 · ทะเบียนสิ่งปลูกสร้างเทศบาลผูกบ้านเลขที่กับแปลง" : row.method, { data: true });
    appendField("รัศมีต้นทาง", row.radius_m === null ? "ไม่มีค่า" : `${NUMBER.format(row.radius_m)} เมตร`, { data: true });
    appendField("ใช้พิกัดนี้ร่วมกัน", coordinateKey(row) ? `${NUMBER.format(state.coordinateCounts.get(coordinateKey(row)) || 1)} รายการ` : "ไม่มีพิกัด");
    appendField("รหัสแปลงต้นทาง", row.source_parcel_id, { data: true });
    if (row.source_parcel_id) appendField("ใช้แปลงนี้ร่วมกัน", `${NUMBER.format(state.parcelCounts.get(row.source_parcel_id) || 1)} รายการ`);
    appendField("ธงหลักฐาน", formatFlags(row.flags));
    appendField("ผลภาคสนามต้นฉบับ", row.field_result || "ยังไม่มีผล");

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

  const pointColor = (row) => {
    if (markerBucket(row) === "specific") return cssColor("--series-5", "#007A58");
    if (markerBucket(row) === "estimated") return cssColor("--series-7", "#147A9F");
    return cssColor("--series-3", "#A87B00");
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
      halo: cssColor("--map-marker-halo", "#FFFFFF"),
      stroke: cssColor("--map-marker-stroke", "#182327"),
      active: cssColor("--map-active", "#347DA8"),
      selected: cssColor("--map-selected", "#176B82"),
      clusterFill: cssColor("--surface-raised", "#FFFFFF"),
      clusterText: cssColor("--text-primary", "#182327"),
      specific: cssColor("--series-5", "#007A58"),
      estimated: cssColor("--series-7", "#147A9F"),
      coarse: cssColor("--series-3", "#A87B00")
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

  const drawPointSymbol = (context, row, point, radius, palette) => {
    const bucket = markerBucket(row);
    context.save();
    context.translate(point.x, point.y);
    context.lineJoin = "round";
    tracePointShape(context, bucket, radius);
    context.strokeStyle = palette.halo;
    context.lineWidth = 5;
    context.stroke();
    context.fillStyle = palette[bucket];
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
    context.restore();
  };

  const clusterLabel = (count) => count >= 1000 ? `${Math.floor(count / 1000)}k` : String(count);

  const drawClusterSymbol = (context, point, count, palette) => {
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
    context.strokeStyle = palette.active;
    context.lineWidth = 2.5;
    context.stroke();
    context.fillStyle = palette.clusterText;
    context.font = `600 ${label.length >= 4 ? 8 : 9}px "JetBrains Mono", monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 0, 0.5);
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
    return `<svg viewBox="0 0 42 42" aria-hidden="true"><circle class="selected-marker-ring-halo" cx="21" cy="21" r="17"></circle><circle class="selected-marker-ring" cx="21" cy="21" r="17"></circle>${shape}</svg>`;
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

        for (const marker of this._drawn) {
          if (marker.buildingGroup) {
            marker.hitRadius = drawClusterSymbol(context, marker.point, marker.indices.length, palette);
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
    color: cssColor("--map-active", "#347DA8"),
    weight: 2,
    dashArray: "7 5",
    opacity: 0.9,
    fillColor: cssColor("--citychat-primary", "#007A58"),
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
      "source_parcel_id",
      "source_status",
      "source_tier",
      "source_method",
      "source_radius_m",
      "source_flags",
      "snapshot_release",
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
          row.source_parcel_id,
          row.status,
          row.tier,
          row.method,
          row.radius_m,
          row.flags,
          SNAPSHOT_RELEASE,
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
    anchor.download = "citychat-saensuk-review-draft-v6.csv";
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
  elements.evidenceFilter.addEventListener("change", () => {
    state.evidenceFilter = elements.evidenceFilter.value;
    state.page = 0;
    applyFilters({ selectFirst: true });
  });
  elements.reviewFilters.forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewFilter = button.dataset.reviewFilter;
      elements.reviewFilters.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      state.page = 0;
      applyFilters({ selectFirst: true });
    });
  });
  elements.list.addEventListener("click", (event) => {
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
