(() => {
  "use strict";

  const root = document.documentElement;
  root.classList.add("js");

  const menuButton = document.querySelector(".menu-toggle");
  const navPanel = document.getElementById("site-nav");

  if (menuButton && navPanel) {
    menuButton.hidden = false;
    navPanel.hidden = true;

    const closeMenu = ({ restoreFocus = false } = {}) => {
      navPanel.hidden = true;
      menuButton.setAttribute("aria-expanded", "false");
      if (restoreFocus) menuButton.focus();
    };

    const openMenu = () => {
      navPanel.hidden = false;
      menuButton.setAttribute("aria-expanded", "true");
      const firstLink = navPanel.querySelector("a");
      if (firstLink) firstLink.focus();
    };

    menuButton.addEventListener("click", () => {
      const isOpen = menuButton.getAttribute("aria-expanded") === "true";
      if (isOpen) closeMenu();
      else openMenu();
    });

    navPanel.addEventListener("click", (event) => {
      const link = event.target.closest("a[href^='#']");
      if (!link) return;

      const section = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      const focusTarget = section?.matches("h1, h2, h3") ? section : section?.querySelector("h1, h2, h3");
      closeMenu();

      if (focusTarget) {
        requestAnimationFrame(() => {
          const hadTabindex = focusTarget.hasAttribute("tabindex");
          if (!hadTabindex) focusTarget.setAttribute("tabindex", "-1");
          focusTarget.focus({ preventScroll: true });
          if (!hadTabindex) {
            focusTarget.addEventListener("blur", () => focusTarget.removeAttribute("tabindex"), { once: true });
          }
        });
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !navPanel.hidden) {
        closeMenu({ restoreFocus: true });
      }
    });

    document.addEventListener("pointerdown", (event) => {
      if (!navPanel.hidden && !navPanel.contains(event.target) && !menuButton.contains(event.target)) {
        closeMenu();
      }
    });
  }

  const themeButtons = [...document.querySelectorAll("[data-theme-choice]")];
  const themeColor = document.querySelector("meta[name='theme-color']");

  const getSavedTheme = () => {
    try {
      const saved = localStorage.getItem("saensuk-theme");
      return saved === "light" || saved === "dark" ? saved : "auto";
    } catch (_) {
      return "auto";
    }
  };

  const updateThemeColor = (choice) => {
    if (!themeColor) return;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = choice === "dark" || (choice === "auto" && systemDark);
    themeColor.setAttribute("content", isDark ? "#11191D" : "#1D4497");
  };

  const applyTheme = (choice) => {
    if (choice === "light" || choice === "dark") root.dataset.theme = choice;
    else delete root.dataset.theme;

    themeButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice));
    });

    try {
      if (choice === "auto") localStorage.removeItem("saensuk-theme");
      else localStorage.setItem("saensuk-theme", choice);
    } catch (_) {}

    updateThemeColor(choice);
  };

  let activeTheme = getSavedTheme();
  applyTheme(activeTheme);

  themeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeTheme = button.dataset.themeChoice;
      applyTheme(activeTheme);
    });
  });

  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  systemTheme.addEventListener?.("change", () => {
    if (activeTheme === "auto") updateThemeColor("auto");
  });

  const tabRoot = document.querySelector("[data-tabs]");
  if (tabRoot) {
    const tabs = [...tabRoot.querySelectorAll("[role='tab']")];
    const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));

    const activateTab = (index, { focus = false } = {}) => {
      tabs.forEach((tab, tabIndex) => {
        const active = tabIndex === index;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        if (panels[tabIndex]) panels[tabIndex].hidden = !active;
      });
      if (focus) tabs[index].focus();
    };

    activateTab(0);

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activateTab(index));
      tab.addEventListener("keydown", (event) => {
        let nextIndex = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        if (nextIndex !== null) {
          event.preventDefault();
          activateTab(nextIndex, { focus: true });
        }
      });
    });
  }

  const precisionData = {
    parcel: {
      kicker: "ชั้นที่ 01 · เจาะจงมากกว่า",
      title: "ระดับแปลง",
      count: "4,916",
      percent: "11.6%",
      meaning: "มีหลักฐานเชื่อมทะเบียนบ้านกับรูปแปลง แต่ยังต้องสุ่มตรวจภาคสนามก่อนเปิดใช้เป็นข้อมูลยืนยัน",
      next: "นำกลุ่มหลักฐานแข็งแรงกว่า (A) และกลุ่มหลักฐานรองลงมา (B) มาสุ่มวัดความคลาดเคลื่อนจริงในพื้นที่"
    },
    building: {
      kicker: "ชั้นที่ 02 · หนึ่งจุดอาจแทนหลายห้อง",
      title: "ระดับอาคาร",
      count: "7,412",
      percent: "17.4%",
      meaning: "ตำแหน่งผูกกับอาคารชุดหรือสิ่งปลูกสร้าง หลายแถวจึงใช้จุดอาคารเดียวกันโดยตั้งใจ ไม่ใช่ข้อมูลซ้ำ",
      next: "ให้กองช่างยืนยันอาคารค้าง จุดที่มีหลายผู้สมัคร และกรณีที่หลักฐานห่างกันมาก"
    },
    cluster: {
      kicker: "ชั้นที่ 03 · พื้นที่กลุ่มบ้าน",
      title: "ระดับกลุ่มบ้าน",
      count: "14,265",
      percent: "33.5%",
      meaning: "หลายบ้านใช้จุดกลางของกลุ่มร่วมกัน จึงต้องอ่านพร้อมรัศมี ไม่ใช่หมุดที่หน้าบ้านแต่ละหลัง",
      next: "ใช้จัดพื้นที่ตรวจและค่อยยกระดับเมื่อมีหลักฐานสิ่งปลูกสร้างหรือผลภาคสนาม"
    },
    interpolated: {
      kicker: "ชั้นที่ 04 · ประมาณจากเพื่อนบ้าน",
      title: "แทรกระหว่างเพื่อนบ้าน",
      count: "4,542",
      percent: "10.7%",
      meaning: "ตำแหน่งคำนวณจากลำดับบ้านใกล้เคียงและมีขอบเขตความคลาดเคลื่อน จึงไม่ควรแสดงเป็นจุดยืนยัน",
      next: "ตรวจตัวอย่างและใช้ภาพถ่ายทางอากาศหรือทะเบียนสิ่งปลูกสร้างช่วยลดวงประมาณ"
    },
    road: {
      kicker: "ชั้นที่ 05 · รู้แนว แต่ยังไม่รู้หลัง",
      title: "ระดับซอย/ถนน",
      count: "7,566",
      percent: "17.8%",
      meaning: "ข้อมูลพอบอกแนวซอยหรือถนน แต่ยังแยกตำแหน่งบ้านรายหลังไม่ได้",
      next: "จัดเป็นคิวตามถนนและหลีกเลี่ยงการแสดงเป็นหมุดบ้านบนหน้าสาธารณะ"
    },
    community: {
      kicker: "ชั้นที่ 06 · รู้เพียงพื้นที่กว้าง",
      title: "ระดับชุมชน",
      count: "355",
      percent: "0.8%",
      meaning: "ข้อมูลบอกได้เพียงชุมชน จุดนี้ใช้แทนพื้นที่กว้าง ไม่ใช่ตำแหน่งของบ้านจริง",
      next: "ใช้เพื่อจัดคิวสำรวจเท่านั้น และหาแหล่งข้อมูลที่ละเอียดขึ้นก่อนนำไปใช้รายหลัง"
    },
    review: {
      kicker: "ชั้นที่ 07 · ระบบเลือกหยุด",
      title: "งดเดา—รอคนตรวจ",
      count: "3,468",
      percent: "8.2%",
      meaning: "มีหลายแปลงเป็นไปได้หรือหลักฐานไม่พอ ระบบจึงเว้นพิกัดแทนการสร้างความแน่นอนที่ไม่มีจริง",
      next: "ส่งให้เจ้าหน้าที่เลือกจากหลักฐานเพิ่มเติม โดยเก็บเหตุผลและผลการตรวจทุกครั้ง"
    }
  };

  const precisionButtons = [...document.querySelectorAll("[data-precision]")];
  const precisionFields = {
    kicker: document.getElementById("precision-kicker"),
    title: document.getElementById("precision-detail-title"),
    count: document.getElementById("precision-detail-count"),
    percent: document.getElementById("precision-detail-percent"),
    meaning: document.getElementById("precision-detail-meaning"),
    next: document.getElementById("precision-detail-next")
  };

  const selectPrecision = (button, { focus = false } = {}) => {
    const item = precisionData[button.dataset.precision];
    if (!item) return;

    precisionButtons.forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-pressed", String(active));
    });

    Object.entries(precisionFields).forEach(([key, element]) => {
      if (element) element.textContent = item[key];
    });

    if (focus) button.focus();
  };

  precisionButtons.forEach((button, index) => {
    button.addEventListener("click", () => selectPrecision(button));
    button.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (index + 1) % precisionButtons.length;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (index - 1 + precisionButtons.length) % precisionButtons.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = precisionButtons.length - 1;
      if (nextIndex !== null) {
        event.preventDefault();
        selectPrecision(precisionButtons[nextIndex], { focus: true });
      }
    });
  });

  const placeChart = document.querySelector("[data-place-chart]");
  if (placeChart) {
    const metricButtons = [...placeChart.querySelectorAll("[data-place-metric]")];
    const rows = [...placeChart.querySelectorAll(".place-row")];

    const setPlaceMetric = (metric) => {
      metricButtons.forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.placeMetric === metric));
      });

      rows.forEach((row) => {
        const missing = Number(row.dataset.missing);
        const coverage = Number(row.dataset.coverage);
        const value = row.querySelector(".place-value");
        const fill = row.querySelector(".place-fill");
        const track = row.querySelector(".place-track");

        if (metric === "coverage") {
          value.textContent = `${coverage.toFixed(2)}%`;
          fill.style.setProperty("--bar", `${coverage}%`);
          track.setAttribute("aria-label", `${row.dataset.place} มีตำแหน่งตั้งต้น ${coverage.toFixed(2)} เปอร์เซ็นต์`);
        } else {
          const width = (missing / 427) * 100;
          value.textContent = `${missing.toLocaleString("th-TH")} รายการ`;
          fill.style.setProperty("--bar", `${width}%`);
          track.setAttribute("aria-label", `${row.dataset.place} ยังไม่มีจุด ${missing.toLocaleString("th-TH")} รายการ`);
        }
      });
    };

    metricButtons.forEach((button) => {
      button.addEventListener("click", () => setPlaceMetric(button.dataset.placeMetric));
    });

    setPlaceMetric("missing");
  }
})();
