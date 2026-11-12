(function attachParcelChangeExamples(root) {
  "use strict";
  const STATUSES = Object.freeze(["code-not-found", "point-missing", "point-outside-geometry", "point-inside-geometry"]);
  const GROUPS = Object.freeze(["same-address-missing-new-code", "changed-address", "both-historical-points", "one-or-no-historical-point", "large-historical-separation"]);
  const ROW_FIELDS = Object.freeze(["sample_id", "house_no_before", "house_no_after", "road_before", "road_after", "old_parcel_code", "new_parcel_code", "address_changed", "old_ltax_point", "new_ltax_point", "old_ltax_status", "new_ltax_status", "historical_point_separation_m", "group"]);
  const SUMMARY_FIELDS = Object.freeze(["retained_building_ids", "changed_parcel_codes", "address_unchanged", "address_changed", "old_ltax_code_found", "new_ltax_code_found", "new_ltax_code_not_found", "old_ltax_status_counts", "new_ltax_status_counts", "both_historical_points", "both_historical_points_over_50m", "both_historical_points_over_500m", "both_historical_points_max_separation_m", "example_count", "example_groups"]);
  const ROADS = new Set(["", "บางแสนสาย 2", "ลงหาดบางแสน", "สุขุมวิท", "แสนสุข", "บางแสนสาย 4 ใต้", "สันติเกษม", "บางแสนล่าง", "เนตรดี", "รอบเขาสามมุข", "มิตรสัมพันธ์", "บางแสน-อ่างศิลา", "บางแสนสาย 3", "บางแสนสาย 1", "เปรมใจราษฎร์", "มาบมะยม", "หลังวัดกลางดอน", "บางแสนสาย 4 เหนือ", "ข้าวหลาม", "เทศบาลพัฒนา 1", "เทศบาลพัฒนา 2"]);
  const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
  const fail = () => { throw new Error("ชุดตัวอย่างไม่ตรงกับรุ่นหรือขอบเขตข้อมูลที่กำหนด"); };
  const count = (value) => Number.isInteger(value) && value >= 0 && value <= 100000;
  const distanceMeters = (a, b) => {
    const radians = (x) => x * Math.PI / 180;
    const h = Math.sin(radians(b.lat - a.lat) / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lon - a.lon) / 2) ** 2;
    return 12742017.6 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  };
  const roadKey = (value) => String(value).replace(/^ถนน\s*/u, "");
  const safeHouse = (value) => typeof value === "string" && value.length <= 60
    && !/[0-9]{4}-[0-9]{6}-[0-9]/u.test(value)
    && (value === "" || /^[0-9๐-๙]{1,6}(?:[\/, .\-]+[0-9๐-๙]{1,6})*(?: ?[ก-ฮ]\.?)?$/u.test(value));
  const safePoint = (point) => exactKeys(point, ["lat", "lon"]) && Number.isFinite(point.lat) && Number.isFinite(point.lon)
    && point.lat >= 12.9 && point.lat <= 13.7 && point.lon >= 100.5 && point.lon <= 101.3;
  const validateParcelChangeExamples = (data) => {
    if (!exactKeys(data, ["schema_version", "release_id", "summary", "source_hashes", "records"])) fail();
    if (data.schema_version !== "saensuk-parcel-code-change-examples-1" || data.release_id !== "parcel-code-changes-20261112") fail();
    if (!exactKeys(data.source_hashes, ["old_buildings_sha256", "new_buildings_sha256", "ltax_sha256"]) || Object.values(data.source_hashes).some((value) => typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))) fail();
    const summary = data.summary;
    if (!exactKeys(summary, SUMMARY_FIELDS)) fail();
    for (const key of SUMMARY_FIELDS.filter((key) => !["old_ltax_status_counts", "new_ltax_status_counts", "example_groups", "both_historical_points_max_separation_m"].includes(key))) if (!count(summary[key])) fail();
    if (summary.changed_parcel_codes !== 5069 || summary.retained_building_ids < summary.changed_parcel_codes || summary.address_unchanged + summary.address_changed !== 5069) fail();
    for (const key of ["old_ltax_status_counts", "new_ltax_status_counts"]) {
      if (!exactKeys(summary[key], STATUSES) || Object.values(summary[key]).some((value) => !count(value)) || Object.values(summary[key]).reduce((sum, value) => sum + value, 0) !== 5069) fail();
    }
    if (summary.old_ltax_code_found !== 5069 - summary.old_ltax_status_counts["code-not-found"] || summary.new_ltax_code_found !== 5069 - summary.new_ltax_status_counts["code-not-found"] || summary.new_ltax_code_not_found !== summary.new_ltax_status_counts["code-not-found"]) fail();
    if (summary.both_historical_points_over_500m > summary.both_historical_points_over_50m || summary.both_historical_points_over_50m > summary.both_historical_points || summary.both_historical_points > Math.min(summary.old_ltax_status_counts["point-inside-geometry"], summary.new_ltax_status_counts["point-inside-geometry"])) fail();
    if (summary.both_historical_points_max_separation_m !== null && (!Number.isFinite(summary.both_historical_points_max_separation_m) || summary.both_historical_points_max_separation_m < 0)) fail();
    if (!exactKeys(summary.example_groups, GROUPS) || Object.values(summary.example_groups).some((value) => !count(value))) fail();
    if (!Array.isArray(data.records) || data.records.length !== summary.example_count || data.records.length < 1 || data.records.length > 100) fail();
    const groups = Object.fromEntries(GROUPS.map((key) => [key, 0]));
    data.records.forEach((row, index) => {
      if (!exactKeys(row, ROW_FIELDS) || row.sample_id !== `R${String(index + 1).padStart(3, "0")}`) fail();
      if (!safeHouse(row.house_no_before) || !safeHouse(row.house_no_after)) fail();
      for (const field of ["road_before", "road_after"]) if (typeof row[field] !== "string" || row[field].length > 40 || !ROADS.has(roadKey(row[field]))) fail();
      for (const field of ["old_parcel_code", "new_parcel_code"]) if (typeof row[field] !== "string" || row[field].length > 32 || !/^[0-9]{1,3}[A-Z][0-9]{1,6}(?:[\/_][0-9]{1,6})*$/u.test(row[field])) fail();
      if (row.old_parcel_code === row.new_parcel_code || typeof row.address_changed !== "boolean" || row.address_changed !== (row.house_no_before !== row.house_no_after || row.road_before !== row.road_after)) fail();
      for (const side of ["old", "new"]) {
        const status = row[`${side}_ltax_status`];
        const point = row[`${side}_ltax_point`];
        if (!STATUSES.includes(status) || (status === "point-inside-geometry" ? !safePoint(point) : point !== null)) fail();
      }
      if (!GROUPS.includes(row.group)) fail();
      groups[row.group] += 1;
      const both = row.old_ltax_point !== null && row.new_ltax_point !== null;
      if (both) {
        if (!Number.isFinite(row.historical_point_separation_m) || row.historical_point_separation_m < 0 || Math.abs(row.historical_point_separation_m - distanceMeters(row.old_ltax_point, row.new_ltax_point)) > Math.max(2, row.historical_point_separation_m * 0.005)) fail();
      } else if (row.historical_point_separation_m !== null) fail();
      if (row.group === "same-address-missing-new-code" && (row.address_changed || row.new_ltax_status !== "code-not-found")) fail();
      if (row.group === "changed-address" && !row.address_changed) fail();
      if (["both-historical-points", "large-historical-separation"].includes(row.group) && !both) fail();
      if (row.group === "large-historical-separation" && row.historical_point_separation_m <= 50) fail();
      if (row.group === "one-or-no-historical-point" && both) fail();
    });
    if (GROUPS.some((key) => groups[key] !== summary.example_groups[key])) fail();
    return data;
  };
  const matchesExampleFilter = (row, filter) => {
    switch (filter) {
      case "all": return true;
      case "current-code-found": return row.new_ltax_status !== "code-not-found";
      case "current-code-missing": return row.new_ltax_status === "code-not-found";
      case "address-changed": return row.address_changed;
      case "both-points": return row.old_ltax_point !== null && row.new_ltax_point !== null;
      default: return false;
    }
  };
  const normalizeSearch = (value) => String(value ?? "").trim().toLocaleLowerCase("th-TH").replace(/[๐-๙]/gu, (digit) => String(digit.charCodeAt(0) - 0x0e50));
  const matchesExampleSearch = (row, query) => {
    const text = normalizeSearch(query);
    if (!text) return true;
    const house = text.match(/^([0-9]{1,6}(?:\/{1,2}[0-9]{1,6})?(?: ?[ก-ฮ]\.?)?)(?=\s|$)/u);
    let rest = text;
    if (house) {
      const key = (value) => normalizeSearch(value).replace(/\s/gu, "").replace(/\.$/u, "");
      if (![row.house_no_before, row.house_no_after].some((value) => key(value) === key(house[1]))) return false;
      rest = text.slice(house[0].length).trim();
    }
    const searchable = normalizeSearch([row.sample_id, row.house_no_before, row.house_no_after, row.road_before, row.road_after, row.old_parcel_code, row.new_parcel_code].join(" "));
    return rest.split(/\s+/u).filter(Boolean).every((token) => searchable.includes(token));
  };
  const api = Object.freeze({ validateParcelChangeExamples, matchesExampleFilter, matchesExampleSearch, distanceMeters, STATUSES, GROUPS, ROW_FIELDS });
  root.CityChatParcelChangeExamples = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);

(() => {
  "use strict";
  if (typeof document === "undefined") return;
  const root = document.querySelector("[data-parcel-change-examples]");
  if (!root) return;
  if (document.documentElement.dataset.topLevelSafe !== "true") return;
  const { validateParcelChangeExamples, matchesExampleFilter, matchesExampleSearch } = window.CityChatParcelChangeExamples;
  const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 });
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, action) => {
    const node = el("button", "parcel-examples-button", text);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  };
  const status = root.querySelector("[data-examples-fallback]") || el("p", "parcel-examples-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  if (!status.isConnected) root.append(status);
  const retry = button("ลองเปิดตัวอย่างอีกครั้ง", () => void load());
  retry.hidden = true;
  root.append(retry);
  const app = el("div", "parcel-examples-app");
  app.hidden = true;
  root.append(app);
  const state = { data: null, filtered: [], filter: "all", query: "", selected: null, map: null, marks: null, base: "none", baseLayer: null, busy: false };
  const toolbar = el("div", "parcel-examples-toolbar");
  const searchLabel = el("label", "parcel-examples-search-label", "ค้นหาบ้านเลขที่ ถนน หรือรหัสแปลง");
  const search = el("input", "parcel-examples-search");
  search.type = "search";
  search.placeholder = "เช่น 657 หรือรหัสแปลงเก่า/ใหม่";
  search.setAttribute("data-parcel-examples-search", "");
  searchLabel.append(search);
  toolbar.append(searchLabel);
  const filters = el("div", "parcel-examples-filters");
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "กรองตัวอย่างการเปลี่ยนรหัสแปลง");
  const filterLabels = [["all", "ทุกตัวอย่าง"], ["current-code-missing", "รหัสใหม่ไม่พบใน LTAX เดิม"], ["current-code-found", "รหัสใหม่พบใน LTAX เดิม"], ["address-changed", "ข้อมูลที่อยู่ต่างกัน"], ["both-points", "มีจุดอ้างอิงสองรหัส"]];
  for (const [value, label] of filterLabels) {
    const control = button(label, () => { state.filter = value; applyFilters(); });
    control.dataset.parcelExamplesFilter = value;
    filters.append(control);
  }
  toolbar.append(filters);
  const result = el("p", "parcel-examples-result");
  result.setAttribute("role", "status");
  result.setAttribute("aria-live", "polite");
  const layout = el("div", "parcel-examples-layout");
  const listPanel = el("div", "parcel-examples-list-panel");
  listPanel.append(el("h3", "", "เลือกตัวอย่างเพื่อเทียบ"));
  const list = el("ol", "parcel-examples-list");
  list.setAttribute("aria-label", "ตัวอย่างรหัสแปลงที่เปลี่ยน");
  listPanel.append(list);
  const detail = el("div", "parcel-examples-detail");
  const navigation = el("div", "parcel-examples-navigation");
  const previous = button("← ตัวอย่างก่อนหน้า", () => step(-1));
  const next = button("ตัวอย่างถัดไป →", () => step(1));
  previous.dataset.parcelExamplesPrevious = "";
  next.dataset.parcelExamplesNext = "";
  const position = el("span", "parcel-examples-position");
  position.setAttribute("aria-live", "polite");
  position.setAttribute("aria-atomic", "true");
  navigation.append(previous, position, next);
  const title = el("h3", "parcel-examples-detail-title");
  const comparison = el("div", "parcel-examples-comparison");
  const conclusion = el("p", "parcel-examples-conclusion");
  const mapHeading = el("h4", "", "จุดอ้างอิงจากรหัสแปลง");
  const mapNote = el("p", "parcel-examples-map-note", "ตำแหน่งจาก LTAX เดิมตามรหัสที่ค้นพบ ไม่ใช่ผลสำรวจตำแหน่งใหม่ เส้นเชื่อมแสดงระยะระหว่างจุดอ้างอิง ไม่ได้บอกว่าบ้านย้ายที่");
  const mapControls = el("div", "parcel-examples-map-controls");
  mapControls.setAttribute("role", "group");
  mapControls.setAttribute("aria-label", "เลือกแผนที่พื้นหลังของตัวอย่าง");
  for (const [value, label] of [["none", "ปิดแผนที่พื้นหลัง"], ["road", "เปิดแผนที่ถนน"], ["satellite", "เปิดภาพดาวเทียม"]]) {
    const control = button(label, () => setBasemap(value));
    control.dataset.parcelExamplesBasemap = value;
    control.setAttribute("aria-pressed", String(value === "none"));
    mapControls.append(control);
  }
  const outbound = el("p", "parcel-examples-map-disclosure", "เมื่อเลือกแผนที่ถนนหรือภาพดาวเทียม ผู้ให้บริการจะได้รับ IP และบริเวณที่ดู ภาพพื้นหลังไม่ยืนยันบ้านหรือแนวเขตแปลง");
  const mapElement = el("div", "parcel-examples-map");
  mapElement.setAttribute("role", "region");
  mapElement.setAttribute("aria-label", "แผนที่เปรียบเทียบจุดอ้างอิง LTAX เดิมของรหัสเก่าและรหัสใหม่");
  const mapStatus = el("p", "parcel-examples-map-status");
  const legend = el("p", "parcel-examples-map-legend", "● เก่า: รหัสในทะเบียนเดิม  ·  ◯ ใหม่: รหัสในทะเบียนใหม่ — ทั้งสองใช้พิกัดจากชั้น LTAX เดียวกัน");
  detail.append(navigation, title, comparison, conclusion, mapHeading, mapNote, mapControls, outbound, mapElement, mapStatus, legend);
  layout.append(listPanel, detail);
  app.append(toolbar, result, layout);

  const address = (house, road) => [house ? `บ้านเลขที่ ${house}` : "ต้นทางไม่ระบุบ้านเลขที่", road || "ต้นทางไม่ระบุถนน"].join(" · ");
  const statusText = (value) => ({ "code-not-found": "ไม่พบรหัสนี้ใน LTAX เดิม จึงไม่มีจุดให้เทียบ", "point-missing": "พบรหัส แต่ไม่มีจุดอ้างอิงที่ใช้ได้", "point-outside-geometry": "พบรหัส แต่จุดอยู่นอกแปลง จึงไม่นำมาวาง", "point-inside-geometry": "พบรหัสและจุดอยู่ภายในรูปแปลงเดิม" })[value];
  const current = () => state.filtered.find((row) => row.sample_id === state.selected) || null;
  const renderList = () => {
    const focused = document.activeElement?.dataset?.parcelExampleId;
    list.replaceChildren();
    for (const row of state.filtered) {
      const item = el("li", "");
      const control = button("", () => { state.selected = row.sample_id; render(); });
      control.className = "parcel-examples-choice";
      control.dataset.parcelExampleId = row.sample_id;
      control.setAttribute("aria-pressed", String(row.sample_id === state.selected));
      control.append(el("span", "parcel-examples-choice-id", row.sample_id), el("strong", "parcel-examples-choice-code", `${row.old_parcel_code} → ${row.new_parcel_code}`), el("span", "", address(row.house_no_after, row.road_after)), el("span", "parcel-examples-choice-state", row.address_changed ? "ข้อมูลที่อยู่ต่างกัน" : "บ้านเลขที่และถนนเดิม"));
      item.append(control);
      list.append(item);
      if (focused === row.sample_id) control.focus({ preventScroll: true });
    }
    if (!state.filtered.length) list.append(el("li", "parcel-examples-empty", "ไม่พบตัวอย่างที่ตรงเงื่อนไข ลองเปลี่ยนคำค้นหรือตัวกรอง"));
  };
  const appendPair = (label, value, target) => { target.append(el("dt", "", label), el("dd", "", value)); };
  const renderDetail = () => {
    const row = current();
    detail.hidden = !row;
    if (!row) return;
    const index = state.filtered.indexOf(row);
    previous.disabled = index === 0;
    next.disabled = index === state.filtered.length - 1;
    position.textContent = `${row.sample_id} · ${number.format(index + 1)} / ${number.format(state.filtered.length)}`;
    title.textContent = `${row.sample_id} · ${row.address_changed ? "รหัสแปลงและข้อมูลที่อยู่ต่างจากเดิม" : "ที่อยู่เดิม แต่รหัสแปลงเปลี่ยน"}`;
    comparison.replaceChildren();
    for (const [side, heading, house, road, code] of [["old", "ทะเบียนเดิม", row.house_no_before, row.road_before, row.old_parcel_code], ["new", "ทะเบียนใหม่", row.house_no_after, row.road_after, row.new_parcel_code]]) {
      const panel = el("section", "parcel-examples-side");
      panel.append(el("h4", "", heading));
      const fields = el("dl", "parcel-examples-fields");
      appendPair("บ้านเลขที่", house || "ต้นทางไม่ระบุ", fields);
      appendPair("ถนน", road || "ต้นทางไม่ระบุ", fields);
      appendPair("รหัสแปลง", code, fields);
      appendPair("เทียบกับ LTAX เดิม", statusText(row[`${side}_ltax_status`]), fields);
      const point = row[`${side}_ltax_point`];
      if (point) appendPair("จุดอ้างอิง LTAX เดิม", `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`, fields);
      panel.append(fields);
      comparison.append(panel);
    }
    conclusion.textContent = row.new_ltax_status === "code-not-found"
      ? "รหัสใหม่ไม่อยู่ใน LTAX ชุดที่มี จึงเชื่อมด้วยรหัสตรงตัวไม่ได้ การไม่พบนี้ไม่ได้แปลว่าบ้านหรือแปลงหายไป ต้องมีตารางเชื่อมรหัสเดิม–ใหม่หรือชั้นแปลงรุ่นเดียวกับทะเบียนใหม่"
      : row.historical_point_separation_m !== null
        ? `จุดอ้างอิงสองรหัสใน LTAX เดิมห่างกัน ${number.format(row.historical_point_separation_m)} เมตร ระยะนี้ไม่ใช่การย้ายบ้านหรือผลเพิ่มความแม่นยำ ต้องตรวจว่ารหัสใหม่อ้างถึงแปลงใดจริง`
        : "พบรหัสใหม่ใน LTAX เดิม แต่ยังไม่มีจุดอ้างอิงสองด้านที่ผ่านเงื่อนไข จึงไม่สร้างตำแหน่งหรือระยะขึ้นมาแทน";
    renderMap();
  };
  const ensureMap = () => {
    if (state.map) return true;
    if (!window.L) { mapStatus.textContent = "ยังเปิดแผนที่ไม่ได้ อ่านรหัสและสถานะการเชื่อมต่อจากตารางด้านบนได้"; return false; }
    state.map = L.map(mapElement, { scrollWheelZoom: false }).setView([13.28, 100.93], 13);
    state.marks = L.layerGroup().addTo(state.map);
    return true;
  };
  const renderMap = () => {
    if (!ensureMap()) return;
    const row = current();
    state.marks.clearLayers();
    if (!row) return;
    const styles = getComputedStyle(document.documentElement);
    const color = (key) => styles.getPropertyValue(key).trim() || styles.getPropertyValue("--text-primary").trim();
    const bounds = L.latLngBounds([]);
    const points = [];
    for (const [side, label, ink, radius, fill] of [["old", "เก่า", color("--series-1"), 7, true], ["new", "ใหม่", color("--series-2"), 12, false]]) {
      const point = row[`${side}_ltax_point`];
      if (!point) continue;
      const coordinate = [point.lat, point.lon];
      const mark = L.circleMarker(coordinate, { radius, color: ink, weight: 3, opacity: 1, fill, fillColor: ink, fillOpacity: 1 }).addTo(state.marks);
      mark.bindTooltip(el("span", "parcel-examples-point-label", `${label} · ${row[`${side}_parcel_code`]}`), { permanent: true, direction: side === "old" ? "top" : "bottom", offset: [0, side === "old" ? -7 : 12] });
      points.push(coordinate);
      bounds.extend(coordinate);
    }
    if (points.length === 2) L.polyline(points, { color: color("--text-secondary"), weight: 2, opacity: 1, dashArray: "6 6", interactive: false }).addTo(state.marks);
    mapStatus.textContent = points.length === 0 ? "ตัวอย่างนี้ไม่มีพิกัดอ้างอิงที่ผ่านเงื่อนไข จึงไม่มีหมุดบนแผนที่" : points.length === 1 ? "มีจุดอ้างอิงที่ใช้ได้ด้านเดียว อีกด้านไม่ถูกวางแทนด้วยจุดคาดเดา" : "สองหมุดอ้างอิงรหัสเก่าและรหัสใหม่ใน LTAX เดิม ไม่ใช่พิกัดบ้านก่อน–หลังการย้าย";
    requestAnimationFrame(() => { state.map.invalidateSize(); if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 18 }); });
  };
  const setBasemap = (value) => {
    if (!ensureMap()) return;
    if (state.baseLayer) state.map.removeLayer(state.baseLayer);
    state.baseLayer = null;
    state.base = value;
    if (value === "road") state.baseLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' });
    if (value === "satellite") state.baseLayer = L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community" });
    if (state.baseLayer) state.baseLayer.addTo(state.map);
    mapControls.querySelectorAll("button").forEach((control) => control.setAttribute("aria-pressed", String(control.dataset.parcelExamplesBasemap === value)));
  };
  const render = () => { renderList(); renderDetail(); };
  const applyFilters = () => {
    if (!state.data) return;
    state.filtered = state.data.records.filter((row) => matchesExampleFilter(row, state.filter) && matchesExampleSearch(row, state.query));
    if (!state.filtered.some((row) => row.sample_id === state.selected)) state.selected = state.filtered[0]?.sample_id || null;
    for (const control of filters.querySelectorAll("button")) control.setAttribute("aria-pressed", String(control.dataset.parcelExamplesFilter === state.filter));
    result.textContent = `แสดง ${number.format(state.filtered.length)} จาก ${number.format(state.data.records.length)} ตัวอย่างที่คัดไว้ ไม่ใช่รายการทั้งหมด ${number.format(state.data.summary.changed_parcel_codes)} รายการ`;
    render();
  };
  const step = (direction) => {
    const index = state.filtered.findIndex((row) => row.sample_id === state.selected);
    const target = state.filtered[index + direction];
    if (target) { state.selected = target.sample_id; render(); }
  };
  search.addEventListener("input", () => { state.query = search.value; applyFilters(); });
  const load = async () => {
    if (state.busy) return;
    state.busy = true;
    retry.hidden = true;
    status.hidden = false;
    status.textContent = "กำลังเปิดตัวอย่างการเปลี่ยนรหัสแปลง…";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const url = root.dataset.examplesUrl || "";
      const expectedHash = root.dataset.examplesSha256 || "";
      const expectedBytes = Number(root.dataset.examplesBytes);
      if (!/^assets\/data\/parcel-code-change-examples-[a-f0-9]{12}\.json$/u.test(url) || !/^[a-f0-9]{64}$/u.test(expectedHash) || !url.includes(expectedHash.slice(0, 12)) || !Number.isInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 1024 * 1024) throw new Error("ตำแหน่งหรือรุ่นของชุดตัวอย่างไม่ครบ");
      const response = await fetch(url, { signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-cache" });
      if (response.status !== 200 || !/application\/json/iu.test(response.headers.get("content-type") || "")) throw new Error("ยังโหลดชุดตัวอย่างไม่ได้");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== expectedBytes || !window.crypto?.subtle) throw new Error("ขนาดชุดตัวอย่างไม่ตรงหรือเบราว์เซอร์ตรวจข้อมูลไม่ได้");
      const hash = [...new Uint8Array(await window.crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
      if (hash !== expectedHash) throw new Error("ชุดตัวอย่างไม่ตรงกับรุ่นของหน้าเว็บ");
      state.data = validateParcelChangeExamples(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      app.hidden = false;
      status.hidden = true;
      for (const control of filters.querySelectorAll("button")) {
        const value = control.dataset.parcelExamplesFilter;
        control.textContent = `${filterLabels.find(([key]) => key === value)[1]} ${number.format(state.data.records.filter((row) => matchesExampleFilter(row, value)).length)}`;
      }
      applyFilters();
    } catch (error) {
      app.hidden = true;
      status.textContent = error?.name === "AbortError" ? "เปิดตัวอย่างใช้เวลานานเกินไป กรุณาลองใหม่" : error?.message || "ยังเปิดตัวอย่างไม่ได้";
      retry.hidden = false;
    } finally {
      clearTimeout(timer);
      state.busy = false;
    }
  };
  const themeObserver = new MutationObserver(() => { if (state.map && current()) renderMap(); });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.map && current()) renderMap(); });
  void load();
})();
