const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_SETTINGS,
  buildExportMarkdown,
  documentScrollHeight,
  hexToRgba,
  mergeSettings,
  pageKey,
} = require("../src/util");

test("pageKey keeps origin/path/query and drops the hash", () => {
  assert.equal(
    pageKey("https://example.com/posts/a1?p=2#section-3"),
    "https://example.com/posts/a1?p=2",
  );
  assert.equal(pageKey("https://example.com/posts/a1#x"), "https://example.com/posts/a1");
});

test("pageKey distinguishes different query strings", () => {
  assert.notEqual(pageKey("https://a.com/read?id=1"), pageKey("https://a.com/read?id=2"));
});

test("pageKey falls back to the raw string on unparsable input", () => {
  assert.equal(pageKey("not a url"), "not a url");
});

test("mergeSettings returns defaults when nothing is stored", () => {
  const merged = mergeSettings(undefined);
  assert.equal(merged.notesEnabled, true);
  assert.equal(merged.tocEnabled, true);
  assert.deepEqual(merged.disabledSites, []);
  assert.equal(merged.colors.length, 4);
  assert.deepEqual(merged.colors.map((c) => c.key), ["c1", "c2", "c3", "c4"]);
});

test("mergeSettings keeps stored values and repairs bad color entries", () => {
  const merged = mergeSettings({
    notesEnabled: false,
    disabledSites: ["example.com"],
    colors: [
      { key: "c1", color: "#ff0000", label: "存疑" },
      { key: "c2", color: "not-a-color", label: "" },
    ],
  });

  assert.equal(merged.notesEnabled, false);
  assert.equal(merged.tocEnabled, true);
  assert.deepEqual(merged.disabledSites, ["example.com"]);
  assert.equal(merged.colors.length, 4);
  assert.deepEqual(merged.colors[0], { key: "c1", color: "#ff0000", label: "存疑" });
  // Bad hex and empty label fall back to the default slot values.
  assert.deepEqual(merged.colors[1], DEFAULT_SETTINGS.colors[1]);
  assert.deepEqual(merged.colors[3], DEFAULT_SETTINGS.colors[3]);
});

test("hexToRgba converts hex to rgba with the given alpha", () => {
  assert.equal(hexToRgba("#fde047", 0.45), "rgba(253, 224, 71, 0.45)");
  assert.equal(hexToRgba("#F00", 1), "rgba(255, 0, 0, 1)");
  // Invalid input degrades to a visible yellow rather than throwing.
  assert.equal(hexToRgba("oops", 0.5), "rgba(253, 224, 71, 0.5)");
});

const EXPORT_ANNOTATIONS = [
  { exact: "第一句重點", colorKey: "c1", note: "" },
  { exact: "存疑的敘述", colorKey: "c2", note: "待確認出處\n第二行" },
  { exact: "找不到的舊畫記", colorKey: "c3", note: "", orphan: true },
];

test("buildExportMarkdown uses a bold title, autolink URL and unquoted plain lines by default", () => {
  const markdown = buildExportMarkdown({
    title: "測試文章",
    url: "https://example.com/a",
    colors: DEFAULT_SETTINGS.colors,
    annotations: EXPORT_ANNOTATIONS,
  });

  assert.match(markdown, /^\*\*測試文章\*\*\n\n<https:\/\/example\.com\/a>\n/);
  assert.doesNotMatch(markdown, /^#/m);
  assert.doesNotMatch(markdown, /\[https:/);
  assert.doesNotMatch(markdown, /匯出於/);
  assert.doesNotMatch(markdown, /【/);
  assert.doesNotMatch(markdown, /「|」/);
  assert.match(markdown, /- 第一句重點\n/);
  assert.match(markdown, /- 存疑的敘述\n {2}- 待確認出處\n {4}第二行/);
  assert.match(markdown, /- 找不到的舊畫記（原文已變動）/);
});

test("buildExportMarkdown includes color labels when asked", () => {
  const markdown = buildExportMarkdown({
    title: "測試文章",
    url: "https://example.com/a",
    colors: DEFAULT_SETTINGS.colors,
    annotations: EXPORT_ANNOTATIONS,
    includeLabels: true,
  });

  assert.match(markdown, /- 【重點】第一句重點\n/);
  assert.match(markdown, /- 【待確認】存疑的敘述\n {2}- 待確認出處\n {4}第二行/);
  assert.match(markdown, /- 【想補充・原文已變動】找不到的舊畫記/);
});

test("mergeSettings keeps exportWithLabels off by default and preserves an explicit true", () => {
  assert.equal(mergeSettings(undefined).exportWithLabels, false);
  assert.equal(mergeSettings({ exportWithLabels: true }).exportWithLabels, true);
  assert.equal(mergeSettings({ exportWithLabels: "yes" }).exportWithLabels, false);
});

test("buildExportMarkdown handles an empty annotation list", () => {
  const markdown = buildExportMarkdown({
    title: "空頁",
    url: "https://example.com",
    exportedAt: "2026-07-12",
    colors: DEFAULT_SETTINGS.colors,
    annotations: [],
  });
  assert.match(markdown, /尚無畫記/);
});

const { activeHeadingIndex } = require("../src/util");

test("activeHeadingIndex follows the last heading above the reading anchor", () => {
  assert.equal(activeHeadingIndex([-793, -496, 2, 65, 306, 547], 96), 3);
  assert.equal(activeHeadingIndex([140, 320], 96), 0);
  assert.equal(activeHeadingIndex([], 96), -1);
});

const { scrollButtonsVisible, scrollEdgeTarget } = require("../src/util");

test("scrollButtonsVisible only shows on pages that scroll meaningfully", () => {
  assert.equal(scrollButtonsVisible(3000, 800), true);
  assert.equal(scrollButtonsVisible(835, 828), false);   // 7px of scroll → noise
  assert.equal(scrollButtonsVisible(800, 800), false);
  assert.equal(scrollButtonsVisible(1001, 800, 200), true);
  assert.equal(scrollButtonsVisible(1000, 800, 200), false);
});

test("scrollEdgeTarget returns clamped top and bottom scroll targets", () => {
  assert.equal(scrollEdgeTarget("top", 3000, 800), 0);
  assert.equal(scrollEdgeTarget("bottom", 3000, 800), 2200);
  assert.equal(scrollEdgeTarget("bottom", 700, 800), 0);
});

test("documentScrollHeight uses the largest available document height", () => {
  assert.equal(documentScrollHeight({
    documentElement: { scrollHeight: 900, offsetHeight: 950, clientHeight: 800 },
    body: { scrollHeight: 2400, offsetHeight: 2300, clientHeight: 810 },
  }), 2400);
  assert.equal(documentScrollHeight({
    documentElement: { scrollHeight: 1200 },
    body: null,
  }), 1200);
  assert.equal(documentScrollHeight({}), 0);
});
