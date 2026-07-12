// Popup: feature toggles, per-site switch, 4 color slots, Markdown export.
// Settings are written to chrome.storage; content scripts react via onChanged.
(() => {
  const { mergeSettings } = globalThis.ReadingMarker;

  const el = {
    pageStatus: document.querySelector("#page-status"),
    notesEnabled: document.querySelector("#notes-enabled"),
    tocEnabled: document.querySelector("#toc-enabled"),
    siteEnabled: document.querySelector("#site-enabled"),
    colorRows: document.querySelector("#color-rows"),
    exportMd: document.querySelector("#export-md"),
    actionStatus: document.querySelector("#action-status"),
  };

  let settings = mergeSettings(null);
  let hostname = "";
  let tabId = null;

  async function saveSettings() {
    await chrome.storage.local.set({ settings });
  }

  function renderToggles() {
    el.notesEnabled.checked = settings.notesEnabled;
    el.tocEnabled.checked = settings.tocEnabled;
    el.siteEnabled.checked = Boolean(hostname) && !settings.disabledSites.includes(hostname);
    el.siteEnabled.disabled = !hostname;
  }

  function renderColors() {
    el.colorRows.innerHTML = "";
    settings.colors.forEach((color, index) => {
      const row = document.createElement("div");
      row.className = "color-row";

      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = color.color;
      picker.addEventListener("input", () => {
        settings.colors[index].color = picker.value;
        saveSettings();
      });

      const label = document.createElement("input");
      label.type = "text";
      label.value = color.label;
      label.maxLength = 12;
      label.placeholder = "說明";
      label.addEventListener("input", () => {
        settings.colors[index].label = label.value.trim() || settings.colors[index].label;
        saveSettings();
      });

      row.append(picker, label);
      el.colorRows.append(row);
    });
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
  el.siteEnabled.addEventListener("change", () => {
    if (!hostname) return;
    settings.disabledSites = el.siteEnabled.checked
      ? settings.disabledSites.filter((site) => site !== hostname)
      : [...new Set([...settings.disabledSites, hostname])];
    saveSettings();
  });

  el.exportMd.addEventListener("click", async () => {
    el.actionStatus.textContent = "匯出中…";
    const response = await sendToTab({ type: "rm-export" }, 5000);
    if (!response?.ok) {
      el.actionStatus.textContent = "此頁面無法匯出（不支援的頁面）";
      return;
    }
    await navigator.clipboard.writeText(response.markdown);
    el.actionStatus.textContent = "已複製 Markdown 到剪貼簿 ✓";
  });

  (async () => {
    // Fetch settings and the active tab in parallel, render controls
    // immediately, then fill in the page status once the tab answers —
    // the popup must never wait on the page to become interactive.
    const [stored, tabs] = await Promise.all([
      chrome.storage.local.get("settings"),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]);
    settings = mergeSettings(stored.settings);
    const tab = tabs[0];
    tabId = tab?.id ?? null;
    try {
      hostname = tab?.url ? new URL(tab.url).hostname : "";
    } catch {
      hostname = "";
    }

    renderToggles();
    renderColors();
    el.pageStatus.textContent = hostname || "此頁面不支援（瀏覽器內建頁）";

    const status = await sendToTab({ type: "rm-status" });
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
