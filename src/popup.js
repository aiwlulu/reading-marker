// Popup: feature toggles, per-site switch, 4 color slots, Markdown export.
// Zero-wait rendering: the HTML is a complete static UI; settings are
// reconciled synchronously from a localStorage cache, so first paint never
// waits on chrome.storage or the (possibly busy) page. Anything uncertain
// shows a loading state and fills in asynchronously.
(() => {
  const { mergeSettings } = globalThis.ReadingMarker;
  const CACHE_KEY = "rm-settings-cache";

  const el = {
    pageStatus: document.querySelector("#page-status"),
    notesEnabled: document.querySelector("#notes-enabled"),
    tocEnabled: document.querySelector("#toc-enabled"),
    siteEnabled: document.querySelector("#site-enabled"),
    exportLabels: document.querySelector("#export-labels"),
    colorRows: [...document.querySelectorAll("#color-rows .color-row")],
    exportMd: document.querySelector("#export-md"),
    actionStatus: document.querySelector("#action-status"),
  };

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function writeCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
    } catch {
      // Cache is best-effort only.
    }
  }

  let settings = mergeSettings(readCache());
  let hostname = "";
  let tabId = null;

  async function saveSettings() {
    writeCache();
    await chrome.storage.local.set({ settings });
  }

  function renderSettings() {
    el.notesEnabled.checked = settings.notesEnabled;
    el.tocEnabled.checked = settings.tocEnabled;
    el.exportLabels.checked = settings.exportWithLabels;
    el.colorRows.forEach((row, index) => {
      const color = settings.colors[index];
      row.querySelector('input[type="color"]').value = color.color;
      row.querySelector('input[type="text"]').value = color.label;
    });
  }

  function renderSiteToggle() {
    el.siteEnabled.checked = Boolean(hostname) && !settings.disabledSites.includes(hostname);
    el.siteEnabled.disabled = !hostname;
  }

  // A busy page can answer slowly (or never, on browser-internal pages);
  // never let that block the popup — give up after the timeout.
  function sendToTab(message, timeoutMs = 1500) {
    return new Promise((resolve) => {
      if (tabId === null) {
        resolve(null);
        return;
      }
      const timer = setTimeout(() => resolve(null), timeoutMs);
      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response);
      });
    });
  }

  el.notesEnabled.addEventListener("change", () => {
    settings.notesEnabled = el.notesEnabled.checked;
    saveSettings();
  });
  el.tocEnabled.addEventListener("change", () => {
    settings.tocEnabled = el.tocEnabled.checked;
    saveSettings();
  });
  el.exportLabels.addEventListener("change", () => {
    settings.exportWithLabels = el.exportLabels.checked;
    saveSettings();
  });
  el.siteEnabled.addEventListener("change", () => {
    if (!hostname) return;
    settings.disabledSites = el.siteEnabled.checked
      ? settings.disabledSites.filter((site) => site !== hostname)
      : [...new Set([...settings.disabledSites, hostname])];
    saveSettings();
  });
  el.colorRows.forEach((row, index) => {
    row.querySelector('input[type="color"]').addEventListener("input", (event) => {
      settings.colors[index].color = event.target.value;
      saveSettings();
    });
    row.querySelector('input[type="text"]').addEventListener("input", (event) => {
      settings.colors[index].label = event.target.value.trim() || settings.colors[index].label;
      saveSettings();
    });
  });

  el.exportMd.addEventListener("click", async () => {
    el.actionStatus.textContent = "匯出中…";
    el.actionStatus.classList.add("loading");
    const response = await sendToTab({ type: "rm-export" }, 5000);
    el.actionStatus.classList.remove("loading");
    if (!response?.ok) {
      el.actionStatus.textContent = "此頁面無法匯出（不支援的頁面）";
      return;
    }
    await navigator.clipboard.writeText(response.markdown);
    el.actionStatus.textContent = "已複製 Markdown 到剪貼簿 ✓";
  });

  // Paint immediately from the cache; everything below is reconciliation.
  renderSettings();

  (async () => {
    const stored = await chrome.storage.local.get("settings");
    settings = mergeSettings(stored.settings);
    writeCache();
    renderSettings();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
    try {
      hostname = tab?.url ? new URL(tab.url).hostname : "";
    } catch {
      hostname = "";
    }
    renderSiteToggle();
    el.pageStatus.textContent = hostname || "此頁面不支援（瀏覽器內建頁）";

    const status = await sendToTab({ type: "rm-status" });
    el.pageStatus.classList.remove("loading");
    if (status?.ok) {
      el.pageStatus.textContent = `${status.hostname}・本頁 ${status.count} 筆畫記`;
    } else {
      el.pageStatus.textContent = hostname
        ? `${hostname}（請重新整理頁面後再試）`
        : "此頁面不支援（瀏覽器內建頁）";
      el.exportMd.disabled = true;
    }
  })();
})();
