(() => {
  "use strict";

  const explorer = document.querySelector("[data-explorer]");
  if (!explorer) return;

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
  const NUMBER = new Intl.NumberFormat("th-TH");
  const BAD_STREETVIEW_FLAGS = [
    "large_parcel",
    "shared_parcel_cross_soi",
    "citymeter_far",
    "bl1_web_conflict",
    "condo_unit_matched_as_house",
    "duplicate_registry_key"
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

  const REVIEW_RESULTS_BY_SOURCE = Object.freeze({
    "google-street-view": new Set(["plate-matches", "plate-conflicts", "plate-not-visible", "no-imagery", "field-visit"]),
    "google-maps": new Set(["no-imagery", "field-visit"]),
    "field-observation": new Set(["plate-matches", "plate-conflicts", "plate-not-visible", "field-visit"]),
    "agency-evidence": new Set(["plate-matches", "plate-conflicts", "plate-not-visible", "field-visit"]),
    "table-review": new Set(["field-visit"])
  });

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
    duplicate_registry_key: "ที่อยู่ทะเบียนซ้ำ"
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
    toggleTiles: explorer.querySelector("[data-toggle-tiles]"),
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
    tileLayer: null,
    tilesVisible: false,
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

  const coordinateKey = (row) => row.lat === null || row.lon === null
    ? ""
    : `${Number(row.lat).toFixed(7)},${Number(row.lon).toFixed(7)}`;

  const hasBadStreetviewFlag = (row) => {
    const flags = String(row.flags || "");
    return BAD_STREETVIEW_FLAGS.some((flag) => flags.includes(flag));
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
      hashing: "กำลังตรวจลายนิ้วมือ เพื่อยืนยันว่าเป็นไฟล์ v3 ที่ตรงกับผลสรุป",
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
    elements.alertDetail.textContent = `${clean(error?.message, "ไฟล์ไม่ผ่านการตรวจรุ่นและโครงสร้าง", 220)}${rowHint} กรุณาเลือก master table v3 ฉบับวันที่ 5 ก.ย. 2569`;
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
      state.worker = new Worker("assets/record-worker.js");
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
      showError({ message: "ผลตรวจไฟล์ไม่ครบตามตารางหลัก v3" });
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
        row.status,
        row.flags
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
    state.reviewFilter = "";
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

    state.filtered = state.baseOrder.filter((index) => {
      const row = state.rows[index];
      if (query && !state.searchIndex[index].includes(query)) return false;
      if (geometry && row.geom_level !== geometry) return false;
      if (community && row.community !== community) return false;
      const reviewed = state.reviews.has(index);
      if (state.reviewFilter === "pending" && reviewed) return false;
      if (state.reviewFilter === "reviewed" && !reviewed) return false;
      return true;
    });

    const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages - 1);
    elements.filteredCount.textContent = NUMBER.format(state.filtered.length);
    elements.resultNote.textContent = state.filtered.length
      ? `พบ ${NUMBER.format(state.filtered.length)} รายการ · แผนที่แสดงเฉพาะรายการที่มีพิกัด`
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
    const allowed = REVIEW_RESULTS_BY_SOURCE[elements.reviewSource.value] || new Set();
    [...elements.reviewResult.options].forEach((option) => {
      option.disabled = Boolean(option.value) && !allowed.has(option.value);
    });
    elements.reviewResult.value = allowed.has(preferredResult) ? preferredResult : "";
  };

  const formatFlags = (value) => {
    const flags = String(value || "").split(";").map((item) => item.trim()).filter(Boolean);
    if (!flags.length) return "ไม่พบธงเตือนเพิ่มเติม";
    return flags.map((flag) => {
      const key = flag.includes("=") ? flag.slice(0, flag.indexOf("=")) : flag;
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
    appendChip(statusLabel(row.status), row.status === "needs-review" ? "truth-chip-warning" : "");
    if (row.tier) appendChip(`Tier ${clean(row.tier)}`);
    if (row.radius_m === 0) appendChip("รัศมี 0 ไม่ได้แปลว่าแม่นยำ", "truth-chip-warning");
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
    appendField("วิธี", row.method, { data: true });
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

    elements.reviewSource.value = review?.evidenceSource || "";
    syncReviewResultOptions(review?.result || "");
    elements.reviewNote.value = review?.note || "";
    elements.reviewSource.setCustomValidity("");
    elements.reviewResult.setCustomValidity("");
    elements.reviewNote.setCustomValidity("");
  };

  const cssColor = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  const pointColor = (row) => {
    if (["parcel", "building"].includes(row.geom_level)) return cssColor("--series-5", "#007A58");
    if (["cluster", "interpolated"].includes(row.geom_level)) return cssColor("--series-7", "#147A9F");
    return cssColor("--series-3", "#A87B00");
  };

  const createPointLayer = () => {
    const CanvasPointLayer = L.Layer.extend({
      initialize() {
        this._indices = [];
        this._selected = null;
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
        const seenCells = new Set();

        for (const index of this._indices) {
          if (index === this._selected) continue;
          const row = state.rows[index];
          if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;
          const point = this._map.latLngToContainerPoint([row.lat, row.lon]);
          if (point.x < -8 || point.y < -8 || point.x > size.x + 8 || point.y > size.y + 8) continue;
          const cell = `${Math.round(point.x / 3)}:${Math.round(point.y / 3)}`;
          if (seenCells.has(cell)) continue;
          seenCells.add(cell);
          const radius = this._map.getZoom() >= 16 ? 4 : 3;
          const fine = ["parcel", "building"].includes(row.geom_level);
          const estimated = ["cluster", "interpolated"].includes(row.geom_level);
          context.save();
          context.translate(point.x, point.y);
          context.beginPath();
          if (fine) {
            context.arc(0, 0, radius, 0, Math.PI * 2);
          } else if (estimated) {
            context.rotate(Math.PI / 4);
            context.rect(-radius, -radius, radius * 2, radius * 2);
          } else {
            context.moveTo(0, -radius - 1);
            context.lineTo(radius + 1, radius + 1);
            context.lineTo(-radius - 1, radius + 1);
            context.closePath();
          }
          context.fillStyle = pointColor(row);
          context.globalAlpha = 0.78;
          context.fill();
          context.globalAlpha = 1;
          context.strokeStyle = cssColor("--surface-raised", "#FFFFFF");
          context.lineWidth = 1;
          context.stroke();
          context.restore();
        }
        context.globalAlpha = 1;
      }
    });
    return new CanvasPointLayer();
  };

  const addBoundaryLayer = () => {
    if (!state.map || !state.boundaries || state.boundaryLayer) return;
    const tooltipClass = "community-tooltip";
    state.boundaryLayer = L.geoJSON(state.boundaries, {
      interactive: true,
      style: () => ({
        color: "#007A58",
        weight: 1.5,
        opacity: 0.8,
        fillColor: "#0AD69C",
        fillOpacity: 0.08
      }),
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
    state.map.on("click", (event) => selectNearestPoint(event.containerPoint));
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
    state.selectionMarker = L.circleMarker(location, {
      radius: 9,
      color: cssColor("--text-primary", "#182327"),
      weight: 3,
      opacity: 1,
      fillColor: markerColor,
      fillOpacity: 1,
      interactive: false
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

  const selectNearestPoint = (containerPoint) => {
    if (!state.map || !state.rows.length) return;
    let nearestIndex = null;
    let nearestDistance = 18 * 18;
    for (const index of state.filtered) {
      const row = state.rows[index];
      if (!Number.isFinite(row?.lat) || !Number.isFinite(row?.lon)) continue;
      const point = state.map.latLngToContainerPoint([row.lat, row.lon]);
      const dx = point.x - containerPoint.x;
      const dy = point.y - containerPoint.y;
      const distance = dx * dx + dy * dy;
      if (distance <= nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    if (nearestIndex !== null) selectRecord(nearestIndex, { moveMap: false });
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

  const toggleTiles = () => {
    ensureMap();
    if (!state.map) return;
    state.tilesVisible = !state.tilesVisible;
    if (state.tilesVisible) {
      if (!state.tileLayer) {
        state.tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: 'พื้นหลังถนน © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
          crossOrigin: false
        });
      }
      state.tileLayer.addTo(state.map);
      state.tileLayer.bringToBack();
      elements.mapDisclosure.textContent = "พื้นหลังถนนจาก OpenStreetMap เปิดอยู่ ผู้ให้บริการอาจได้รับ IP และพื้นที่แผนที่ที่เปิดดู แต่เว็บไม่ส่งเลขที่บ้าน รหัสทะเบียน หรือไฟล์ CSV · ระดับแปลงยังแสดงเป็นจุดอ้างอิง เพราะ CSV ไม่มีรูปแปลง";
    } else {
      if (state.tileLayer && state.map.hasLayer(state.tileLayer)) state.map.removeLayer(state.tileLayer);
      elements.mapDisclosure.textContent = "พื้นหลังถนนปิดอยู่ จึงยังไม่ส่งพื้นที่ที่ดูออกไปภายนอก หากเปิด OpenStreetMap ผู้ให้บริการอาจได้รับ IP และพื้นที่ที่ดู · ระดับแปลงแสดงเป็นจุดอ้างอิง เพราะ CSV มีรหัสแปลงแต่ไม่มีรูปแปลง · ขอบเขตชุมชนใช้เพื่อสื่อสารและ QA ไม่ใช่แนวเขตทางกฎหมาย";
    }
    elements.toggleTiles.setAttribute("aria-pressed", String(state.tilesVisible));
    elements.toggleTiles.textContent = state.tilesVisible ? "ปิดพื้นหลังถนน" : "เปิดพื้นหลังถนน";
  };

  const openExternalMap = (mode) => {
    const row = state.rows[state.selectedIndex];
    if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)) return;
    if (mode === "streetview" && !streetviewEligibility(row).allowed) return;
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
    const opened = window.open(url.toString(), "_blank", "noopener,noreferrer");
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
      if (!REVIEW_RESULTS_BY_SOURCE[evidenceSource]?.has(result)) {
        elements.reviewResult.setCustomValidity("ผลที่เลือกไม่สอดคล้องกับแหล่งหลักฐาน กรุณาเลือกผลที่เปิดใช้งาน");
        elements.reviewResult.reportValidity();
        return;
      }
      if (["plate-matches", "plate-conflicts"].includes(result) && !note) {
        elements.reviewNote.setCustomValidity("กรุณาบันทึกเหตุผลหรือสิ่งที่เห็น เมื่อระบุว่าป้ายตรงหรือขัดกัน");
        elements.reviewNote.reportValidity();
        return;
      }
      state.reviews.set(state.selectedIndex, {
        index: state.selectedIndex,
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
      "source_status",
      "review_status",
      "evidence_source",
      "review_result",
      "review_note",
      "reviewed_at",
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
          row.status,
          "draft-unverified",
          review.evidenceSource,
          review.result,
          review.note,
          review.reviewedAt,
          state.summary?.sha256 || ""
        ].map(csvCell).join(","));
      });
    const blob = new Blob(["\uFEFF", lines.join("\r\n"), "\r\n"], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "citychat-saensuk-review-draft-v3.csv";
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
  elements.toggleTiles.addEventListener("click", toggleTiles);
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

  loadBoundaries();
  showOnly("gate");
})();
