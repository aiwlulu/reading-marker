// Settings, page keys and export formatting — pure logic, unit-tested.
(function exposeUtil(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ReadingMarker = Object.assign(root.ReadingMarker || {}, api);
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function createUtil() {
  const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

  const DEFAULT_SETTINGS = {
    notesEnabled: true,
    tocEnabled: true,
    disabledSites: [],
    colors: [
      { key: "c1", color: "#fde047", label: "重點" },
      { key: "c2", color: "#fca5a5", label: "待確認" },
      { key: "c3", color: "#93c5fd", label: "想補充" },
      { key: "c4", color: "#86efac", label: "已確認" },
    ],
  };

  // One storage bucket per page: origin + path + query, hash dropped
  // (hash is in-page navigation, not a different document).
  // Scroll-spy: the active heading is the last one at or above the reading
  // anchor line; before the first heading, fall back to index 0.
  function activeHeadingIndex(headingTops, anchor = 96) {
    if (!Array.isArray(headingTops) || headingTops.length === 0) return -1;
    const index = headingTops.findLastIndex((top) => Number(top) <= anchor);
    return Math.max(0, index);
  }

  // Jump-to-top/bottom buttons only make sense when there is real distance
  // to travel; short pages would just show dead buttons.
  function scrollButtonsVisible(scrollHeight, viewportHeight, threshold = 200) {
    return (Number(scrollHeight) || 0) - (Number(viewportHeight) || 0) > threshold;
  }

  function scrollEdgeTarget(edge, scrollHeight, viewportHeight) {
    if (edge === "top") return 0;
    return Math.max(0, (Number(scrollHeight) || 0) - (Number(viewportHeight) || 0));
  }

  function documentScrollHeight({ documentElement, body } = {}) {
    return Math.max(
      Number(documentElement?.scrollHeight) || 0,
      Number(documentElement?.offsetHeight) || 0,
      Number(documentElement?.clientHeight) || 0,
      Number(body?.scrollHeight) || 0,
      Number(body?.offsetHeight) || 0,
      Number(body?.clientHeight) || 0,
    );
  }

  function pageKey(href) {
    try {
      const url = new URL(String(href));
      return `${url.origin}${url.pathname}${url.search}`;
    } catch {
      return String(href);
    }
  }

  // Fixed 4 slots: stored entries are matched by key; broken color/label
  // values fall back to that slot's default so the toolbar never breaks.
  function mergeSettings(stored) {
    const source = stored && typeof stored === "object" ? stored : {};
    const storedColors = Array.isArray(source.colors) ? source.colors : [];
    return {
      notesEnabled: source.notesEnabled !== false,
      tocEnabled: source.tocEnabled !== false,
      disabledSites: Array.isArray(source.disabledSites)
        ? source.disabledSites.map((site) => String(site)).filter(Boolean)
        : [],
      colors: DEFAULT_SETTINGS.colors.map((fallback) => {
        const entry = storedColors.find((item) => item && item.key === fallback.key);
        const color = HEX_COLOR.test(String(entry?.color || "")) ? entry.color : fallback.color;
        const label = String(entry?.label || "").trim() || fallback.label;
        return { key: fallback.key, color, label };
      }),
    };
  }

  function hexToRgba(hex, alpha) {
    let value = String(hex || "").replace(/^#/, "");
    if (value.length === 3) value = [...value].map((char) => char + char).join("");
    if (!/^[0-9a-f]{6}$/i.test(value)) value = "fde047";
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function buildExportMarkdown({ title, url, exportedAt, colors, annotations }) {
    const labelOf = (colorKey) => (colors.find((color) => color.key === colorKey) || colors[0]).label;
    const lines = [
      `# ${String(title || "未命名頁面").trim() || "未命名頁面"}`,
      "",
      `[${url}](${url})・匯出於 ${exportedAt}`,
      "",
    ];

    if (!annotations.length) {
      lines.push("尚無畫記。", "");
      return lines.join("\n");
    }

    annotations.forEach((annotation) => {
      const label = `${labelOf(annotation.colorKey)}${annotation.orphan ? "・原文已變動" : ""}`;
      lines.push(`- 【${label}】「${annotation.exact}」`);
      const note = String(annotation.note || "").trim();
      if (note) {
        const [first, ...rest] = note.split("\n");
        lines.push(`  - ${first}`);
        rest.forEach((line) => lines.push(`    ${line}`));
      }
    });
    lines.push("");
    return lines.join("\n");
  }

  return { DEFAULT_SETTINGS, activeHeadingIndex, buildExportMarkdown, documentScrollHeight, hexToRgba, mergeSettings, pageKey, scrollButtonsVisible, scrollEdgeTarget };
}));
