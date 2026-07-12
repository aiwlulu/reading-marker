// Text-quote anchoring (W3C style): annotations store the quoted text plus
// surrounding context, never DOM positions, so they survive re-renders and
// unrelated edits. Ported from the manbao workbench (workbench-state.js).
(function exposeAnchor(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ReadingMarker = Object.assign(root.ReadingMarker || {}, api);
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function createAnchor() {
  const ANNOTATION_CONTEXT = 32;

  function makeAnnotationAnchor(text, start, end) {
    const source = String(text || "");
    const from = Math.max(0, Math.min(Number(start) || 0, Number(end) || 0));
    const to = Math.min(source.length, Math.max(Number(start) || 0, Number(end) || 0));
    return {
      exact: source.slice(from, to),
      prefix: source.slice(Math.max(0, from - ANNOTATION_CONTEXT), from),
      suffix: source.slice(to, to + ANNOTATION_CONTEXT),
    };
  }

  function contextScore(text, index, anchor) {
    const prefix = String(anchor.prefix || "");
    const suffix = String(anchor.suffix || "");
    const end = index + anchor.exact.length;
    let score = 0;
    for (let i = 0; i < prefix.length; i += 1) {
      if (text[index - 1 - i] !== prefix[prefix.length - 1 - i]) break;
      score += 1;
    }
    for (let i = 0; i < suffix.length; i += 1) {
      if (text[end + i] !== suffix[i]) break;
      score += 1;
    }
    return score;
  }

  function locateAnnotation(text, anchor) {
    const source = String(text || "");
    const exact = String(anchor?.exact || "");
    if (!exact) return null;

    let best = null;
    for (let index = source.indexOf(exact); index !== -1; index = source.indexOf(exact, index + 1)) {
      const score = contextScore(source, index, anchor);
      if (!best || score > best.score) best = { index, score };
    }
    return best ? { start: best.index, end: best.index + exact.length } : null;
  }

  function cleanAnnotations(annotations, colorKeys) {
    if (!Array.isArray(annotations)) return [];
    const keys = Array.isArray(colorKeys) && colorKeys.length ? colorKeys : ["c1", "c2", "c3", "c4"];
    return annotations
      .filter((entry) => entry && typeof entry === "object" && String(entry.exact || "").length > 0)
      .map((entry) => ({
        id: String(entry.id || ""),
        exact: String(entry.exact || ""),
        prefix: String(entry.prefix || ""),
        suffix: String(entry.suffix || ""),
        colorKey: keys.includes(entry.colorKey) ? entry.colorKey : keys[0],
        note: String(entry.note ?? ""),
        createdAt: String(entry.createdAt || ""),
      }));
  }

  return { cleanAnnotations, locateAnnotation, makeAnnotationAnchor };
}));
