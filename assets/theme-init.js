(() => {
  "use strict";

  let topLevel = false;
  let hadOpener = true;
  try {
    window.name = "";
    topLevel = window.top === window.self;
    hadOpener = window.opener !== null;
  } catch (_) {
    topLevel = false;
  }

  try {
    window.opener = null;
  } catch (_) {
    // The review desk remains fail-closed when the opener cannot be cleared.
  }

  if (!topLevel || hadOpener) {
    document.documentElement.dataset.embeddingBlocked = "true";
    try {
      window.location.replace(new URL("embedded-blocked.html", window.location.href).href);
    } catch (_) {
      // The review desk remains disabled if the browser refuses replacement.
    }
  } else {
    document.documentElement.dataset.topLevelSafe = "true";
  }

  try {
    const savedTheme = localStorage.getItem("saensuk-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      document.documentElement.dataset.theme = savedTheme;
    }
  } catch (_) {
    // The page remains usable when browser storage is unavailable.
  }
})();
