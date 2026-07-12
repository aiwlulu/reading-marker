const assert = require("node:assert/strict");
const test = require("node:test");

const { cleanAnnotations, locateAnnotation, makeAnnotationAnchor } = require("../src/anchor");

test("makeAnnotationAnchor captures the exact quote with surrounding context", () => {
  const text = "開頭句子。這裡是被畫記的重點文字。結尾句子。";
  const start = text.indexOf("被畫記的重點");
  const anchor = makeAnnotationAnchor(text, start, start + 6);

  assert.equal(anchor.exact, "被畫記的重點");
  assert.equal(anchor.prefix, "開頭句子。這裡是");
  assert.equal(anchor.suffix, "文字。結尾句子。");
});

test("locateAnnotation picks the occurrence whose context matches best", () => {
  const text = "第一段提到成長策略。第二段結尾也提到成長策略。";
  const lastIndex = text.lastIndexOf("成長策略");
  const anchor = makeAnnotationAnchor(text, lastIndex, lastIndex + 4);

  assert.deepEqual(locateAnnotation(text, anchor), { start: lastIndex, end: lastIndex + 4 });
});

test("locateAnnotation still finds the quote after unrelated edits", () => {
  const original = "前文。這一句是關鍵論點。後文。";
  const start = original.indexOf("這一句是關鍵論點");
  const anchor = makeAnnotationAnchor(original, start, start + 8);

  const edited = "全新的開場白。這一句是關鍵論點。後文改寫過了。";
  assert.deepEqual(locateAnnotation(edited, anchor), {
    start: edited.indexOf("這一句是關鍵論點"),
    end: edited.indexOf("這一句是關鍵論點") + 8,
  });
});

test("locateAnnotation returns null when the quote no longer exists", () => {
  assert.equal(locateAnnotation("完全不同的內容。", { exact: "已被刪除的文字", prefix: "", suffix: "" }), null);
  assert.equal(locateAnnotation("任何內容", { exact: "", prefix: "", suffix: "" }), null);
});

test("cleanAnnotations keeps well-formed entries and defaults bad color keys", () => {
  const cleaned = cleanAnnotations([
    { id: "a1", exact: "重點", prefix: "前", suffix: "後", colorKey: "c2", note: "待確認", createdAt: "2026-07-12T00:00:00.000Z" },
    { id: "a2", exact: "另一段", colorKey: "nope", note: 42 },
    { id: "a3", exact: "" },
    null,
    "junk",
  ], ["c1", "c2", "c3", "c4"]);

  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].colorKey, "c2");
  assert.equal(cleaned[1].colorKey, "c1");
  assert.equal(cleaned[1].note, "42");
});
