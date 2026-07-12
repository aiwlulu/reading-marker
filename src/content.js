// Reading Marker content script: highlights + notes + TOC on any page.
// Marks live in the page DOM (inline-styled so site CSS can't break them);
// all other UI lives in a closed-off shadow root to avoid style collisions.
(() => {
  // DOM-based guard: a window flag can't stop double-injection across JS
  // worlds (extension isolated world vs page scripts on the test page).
  if (window.__readingMarkerLoaded || document.getElementById("reading-marker-host")) return;
  window.__readingMarkerLoaded = true;

  const chromeApi = globalThis.chrome;
  if (!chromeApi?.storage?.local) return;

  const {
    activeHeadingIndex,
    buildExportMarkdown,
    cleanAnnotations,
    hexToRgba,
    locateAnnotation,
    makeAnnotationAnchor,
    mergeSettings,
    pageKey,
    scrollButtonsVisible,
    scrollEdgeTarget,
  } = globalThis.ReadingMarker;

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "IFRAME", "CANVAS", "SVG", "INPUT", "SELECT", "MARK"]);
  const ACCENT = "#5b5fe9";

  const state = {
    settings: mergeSettings(null),
    annotations: [],
    storageKey: `ann:${pageKey(location.href)}`,
    pendingSelection: null,
    activeAnnotationId: null,
    notesOpen: false,
    tocOpen: false,
    tocHeadings: [],
    applying: false,
  };

  // ---- shadow-dom ui ----

  const host = document.createElement("div");
  host.id = "reading-marker-host";
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, "PingFang TC", "Microsoft JhengHei", sans-serif; }
      [hidden] { display: none !important; }
      button { font: inherit; cursor: pointer; color: inherit; }

      .bubble {
        position: fixed; z-index: 30; display: flex; align-items: center; gap: 8px;
        padding: 8px 10px; border: 1px solid #d8dae6; border-radius: 999px;
        background: #fff; color: #323a52; box-shadow: 0 8px 24px rgba(16,24,40,.18);
      }
      .swatch { width: 20px; height: 20px; padding: 0; border: 1px solid rgba(16,24,40,.18); border-radius: 50%; }
      .swatch.active { box-shadow: 0 0 0 2px #fff, 0 0 0 4px ${ACCENT}; }
      .divider { width: 1px; height: 18px; background: #d8dae6; }
      .note-btn { border: 0; background: none; font-size: 13px; font-weight: 600; white-space: nowrap; }
      .note-btn:hover { color: ${ACCENT}; }

      .popover {
        position: fixed; z-index: 31; display: flex; flex-direction: column; gap: 10px;
        width: 300px; max-width: calc(100vw - 24px); padding: 12px 14px;
        border: 1px solid #d8dae6; border-radius: 12px; background: #fff; color: #323a52;
        box-shadow: 0 8px 24px rgba(16,24,40,.18); font-size: 13.5px;
      }
      .popover-colors { display: flex; gap: 8px; }
      .popover-quote {
        display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
        margin: 0; padding-left: 10px; border-left: 3px solid #d8dae6; color: #8a91a3; font-size: 12.5px; line-height: 1.5;
      }
      .popover-note {
        resize: vertical; min-height: 60px; padding: 8px 10px; border: 1px solid #d8dae6;
        border-radius: 8px; background: #f8f9fc; color: inherit; font: inherit; font-size: 13.5px; line-height: 1.5;
      }
      .popover-actions { display: flex; align-items: center; justify-content: space-between; }
      .text-btn { border: 0; background: none; font-size: 12.5px; font-weight: 600; color: #8a91a3; }
      .text-btn:hover { color: ${ACCENT}; }
      .text-btn.danger { color: #dc2626; }

      .fabs { position: fixed; right: 22px; bottom: 76px; z-index: 29; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
      .fab {
        position: relative; display: grid; place-items: center; width: 42px; height: 42px;
        border-radius: 50%; border: 1px solid #d8dae6; background: #fff; color: #323a52;
        box-shadow: 0 8px 24px rgba(16,24,40,.18);
      }
      .fab:hover, .fab[aria-expanded="true"] { border-color: ${ACCENT}; color: ${ACCENT}; }
      .fab svg { width: 18px; height: 18px; }
      .fab-count {
        position: absolute; top: -3px; right: -3px; min-width: 16px; height: 16px; padding: 0 4px;
        border-radius: 999px; background: ${ACCENT}; color: #fff; font-size: 10px; font-weight: 700;
        line-height: 16px; text-align: center;
      }

      .panel {
        position: fixed; right: 22px; bottom: 182px; z-index: 29; display: flex; flex-direction: column;
        width: 288px; max-width: calc(100vw - 44px); max-height: min(60vh, 460px);
        border: 1px solid #d8dae6; border-radius: 12px; background: #fff; color: #323a52;
        box-shadow: 0 8px 24px rgba(16,24,40,.18); overflow: hidden;
      }
      .toc-panel { width: 360px; max-height: min(72vh, 560px); }
      .panel-head {
        display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;
        border-bottom: 1px solid #ecedf4; color: #8a91a3; font-size: 11px; font-weight: 700; letter-spacing: .1em;
      }
      .panel-title { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
      .panel-count {
        display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 6px;
        border-radius: 999px; background: #eef0ff; color: ${ACCENT}; font-size: 10px; letter-spacing: 0;
        font-variant-numeric: tabular-nums;
      }
      .panel-close { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; background: none; color: #8a91a3; }
      .panel-close:hover { background: #f4f5fa; color: #323a52; }
      .panel-body { display: flex; flex-direction: column; gap: 3px; padding: 8px; overflow-y: auto; overscroll-behavior: contain; }
      .panel-body::-webkit-scrollbar { width: 8px; }
      .panel-body::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: #c8ccd8; background-clip: content-box; }

      .toc-item {
        display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: start; gap: 8px;
        width: 100%; border: 0; border-radius: 9px; padding: 7px 10px; background: none;
        text-align: left; font-size: 12.5px; line-height: 1.45; color: inherit;
      }
      .toc-item:hover { background: #f4f5fa; }
      .toc-item.active { background: #edeeff; color: ${ACCENT}; font-weight: 650; }
      .toc-level {
        display: inline-grid; place-items: center; width: 22px; height: 18px; margin-top: 1px;
        border-radius: 6px; background: #f1f3f8; color: #8a91a3; font-size: 10px; font-weight: 700;
        letter-spacing: 0; font-variant-numeric: tabular-nums;
      }
      .toc-text {
        display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
        min-width: 0; overflow: hidden;
      }
      .toc-l1 { padding-left: 8px; }
      .toc-l2 { padding-left: 18px; }
      .toc-l3 { padding-left: 30px; color: #8a91a3; }
      .toc-l4 { padding-left: 42px; color: #8a91a3; }

      .note-item { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border: 0; border-radius: 8px; background: none; text-align: left; color: inherit; }
      .note-item:hover { background: #f4f5fa; }
      .note-item.orphan { opacity: .72; }
      .note-head { display: flex; align-items: center; gap: 6px; }
      .note-dot { width: 9px; height: 9px; border-radius: 50%; border: 1px solid rgba(16,24,40,.15); }
      .note-label { color: #8a91a3; font-size: 11px; font-weight: 700; }
      .note-orphan { margin-left: auto; padding: 1px 6px; border-radius: 999px; background: #fff4e0; color: #9a5b00; font-size: 10.5px; font-weight: 600; }
      .note-quote { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: 12.5px; line-height: 1.5; }
      .note-text { padding-left: 8px; border-left: 2px solid ${ACCENT}; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; }
      .empty { margin: 0; padding: 10px 8px; color: #8a91a3; font-size: 13px; line-height: 1.6; }

      .toast {
        position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 32;
        padding: 9px 14px; border-radius: 10px; background: #1e2433; color: #fff; font-size: 13px;
        box-shadow: 0 8px 24px rgba(16,24,40,.3);
      }

      @media (prefers-color-scheme: dark) {
        .bubble, .popover, .panel, .fab { background: #1c1e27; color: #c7cbd9; border-color: #3a3e4c; }
        .popover-note { background: #23262f; border-color: #3a3e4c; }
        .panel-head { border-bottom-color: #2b2e39; }
        .panel-close:hover, .toc-item:hover, .note-item:hover { background: #23262f; color: #c7cbd9; }
        .toc-item.active { background: #262844; color: #8b8ef5; }
        .toc-level { background: #252936; color: #8f96aa; }
        .panel-count { background: #262844; color: #a5a7ff; }
        .panel-body::-webkit-scrollbar-thumb { background-color: #4b5164; }
        .swatch.active { box-shadow: 0 0 0 2px #1c1e27, 0 0 0 4px #8b8ef5; }
        .note-orphan { background: #2c2413; color: #f0b357; }
        .divider { background: #3a3e4c; }
      }
    </style>
    <div class="bubble" part="bubble" role="toolbar" hidden></div>
    <div class="popover" role="dialog" hidden>
      <div class="popover-colors"></div>
      <blockquote class="popover-quote"></blockquote>
      <textarea class="popover-note" rows="3" placeholder="輸入筆記（Enter 送出，Shift+Enter 換行）"></textarea>
      <div class="popover-actions">
        <button class="text-btn danger" data-act="delete" type="button">刪除畫記</button>
        <button class="text-btn" data-act="close" type="button">完成</button>
      </div>
    </div>
    <section class="panel notes-panel" hidden>
      <div class="panel-head"><span>畫記筆記</span><button class="panel-close" data-act="close-notes" type="button" aria-label="關閉">✕</button></div>
      <div class="panel-body notes-body"></div>
    </section>
    <section class="panel toc-panel" hidden>
      <div class="panel-head"><span class="panel-title">目錄 <span class="panel-count toc-count">0</span></span><button class="panel-close" data-act="close-toc" type="button" aria-label="關閉">✕</button></div>
      <div class="panel-body toc-body"></div>
    </section>
    <div class="fabs">
      <button class="fab notes-fab" type="button" aria-expanded="false" title="畫記筆記" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"></path><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"></path></svg>
        <span class="fab-count" hidden>0</span>
      </button>
      <button class="fab toc-fab" type="button" aria-expanded="false" title="目錄" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M3 6h.01"></path><path d="M3 12h.01"></path><path d="M3 18h.01"></path></svg>
      </button>
      <button class="fab top-fab" type="button" title="回到頂端" aria-label="回到頂端" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14"></path><path d="m18 13-6-6-6 6"></path><path d="M12 7v14"></path></svg>
      </button>
      <button class="fab bottom-fab" type="button" title="跳到最下方" aria-label="跳到最下方" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v14"></path><path d="m6 11 6 6 6-6"></path><path d="M5 21h14"></path></svg>
      </button>
    </div>
    <div class="toast" hidden></div>
  `;
  document.documentElement.appendChild(host);

  const ui = {
    bubble: shadow.querySelector(".bubble"),
    popover: shadow.querySelector(".popover"),
    popoverColors: shadow.querySelector(".popover-colors"),
    popoverQuote: shadow.querySelector(".popover-quote"),
    popoverNote: shadow.querySelector(".popover-note"),
    notesPanel: shadow.querySelector(".notes-panel"),
    notesBody: shadow.querySelector(".notes-body"),
    tocPanel: shadow.querySelector(".toc-panel"),
    tocBody: shadow.querySelector(".toc-body"),
    tocCount: shadow.querySelector(".toc-count"),
    notesFab: shadow.querySelector(".notes-fab"),
    notesCount: shadow.querySelector(".fab-count"),
    tocFab: shadow.querySelector(".toc-fab"),
    topFab: shadow.querySelector(".top-fab"),
    bottomFab: shadow.querySelector(".bottom-fab"),
    toast: shadow.querySelector(".toast"),
  };

  function colorOf(colorKey) {
    return state.settings.colors.find((color) => color.key === colorKey) || state.settings.colors[0];
  }

  function colorKeys() {
    return state.settings.colors.map((color) => color.key);
  }

  function siteEnabled() {
    return !state.settings.disabledSites.includes(location.hostname);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  let toastTimer;
  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2400);
  }

  function inShadow(event) {
    return event.composedPath().includes(host);
  }

  // ---- text index / marks ----

  function acceptableTextNode(node) {
    if (!node.nodeValue) return false;
    for (let element = node.parentElement; element; element = element.parentElement) {
      if (element === host) return false;
      if (SKIP_TAGS.has(element.tagName) && !(element.tagName === "MARK" && element.dataset.rmId)) return false;
    }
    return true;
  }

  function buildTextIndex() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (acceptableTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const entries = [];
    const byNode = new Map();
    const parts = [];
    let length = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const entry = { node, start: length, end: length + node.nodeValue.length };
      entries.push(entry);
      byNode.set(node, entry);
      parts.push(node.nodeValue);
      length = entry.end;
    }
    return { text: parts.join(""), entries, byNode };
  }

  function styleMark(mark, annotation, active = false) {
    const color = colorOf(annotation.colorKey);
    mark.style.setProperty("background-color", hexToRgba(color.color, 0.5), "important");
    mark.style.setProperty("color", "inherit", "important");
    mark.style.setProperty("padding", "0", "important");
    mark.style.setProperty("margin", "0", "important");
    mark.style.setProperty("border-radius", "2px", "important");
    mark.style.setProperty("cursor", "pointer", "important");
    mark.style.setProperty("border-bottom", String(annotation.note || "").trim()
      ? `2px dotted ${hexToRgba(color.color, 0.95)}`
      : "0 none transparent", "important");
    mark.style.setProperty("box-shadow", active ? `0 0 0 2px ${hexToRgba(ACCENT.replace("#", "#"), 0.55)}` : "none", "important");
  }

  function marksFor(id) {
    return [...document.querySelectorAll(`mark[data-rm-id="${CSS.escape(id)}"]`)];
  }

  function wrapSegment(segment, annotation) {
    const target = segment.from > 0 ? segment.node.splitText(segment.from) : segment.node;
    if (segment.to - segment.from < target.nodeValue.length) target.splitText(segment.to - segment.from);
    const mark = document.createElement("mark");
    mark.dataset.rmId = annotation.id;
    styleMark(mark, annotation);
    target.parentNode.replaceChild(mark, target);
    mark.appendChild(target);
  }

  function applyAnnotation(annotation, index) {
    const range = locateAnnotation(index.text, annotation);
    if (!range) return false;
    const segments = [];
    for (const entry of index.entries) {
      if (entry.end <= range.start) continue;
      if (entry.start >= range.end) break;
      segments.push({
        node: entry.node,
        from: Math.max(0, range.start - entry.start),
        to: Math.min(entry.node.nodeValue.length, range.end - entry.start),
      });
    }
    segments.forEach((segment) => {
      if (!segment.node.nodeValue.slice(segment.from, segment.to).trim()) return;
      wrapSegment(segment, annotation);
    });
    return true;
  }

  function applyMissingAnnotations() {
    if (!siteEnabled() || !state.settings.notesEnabled) return;
    const missing = state.annotations.filter((annotation) => !marksFor(annotation.id).length);
    if (!missing.length) return;
    state.applying = true;
    // Rebuild the index per annotation: wrapping splits text nodes, but the
    // concatenated text is unchanged, so later locations stay valid.
    missing.forEach((annotation) => applyAnnotation(annotation, buildTextIndex()));
    state.applying = false;
  }

  function unwrapAllMarks() {
    state.applying = true;
    document.querySelectorAll("mark[data-rm-id]").forEach((mark) => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parent.normalize();
    });
    state.applying = false;
  }

  // ---- storage ----

  async function loadAnnotations() {
    const data = await chromeApi.storage.local.get(state.storageKey);
    state.annotations = cleanAnnotations(data[state.storageKey], colorKeys());
  }

  async function saveAnnotations() {
    if (state.annotations.length) {
      await chromeApi.storage.local.set({ [state.storageKey]: state.annotations });
    } else {
      await chromeApi.storage.local.remove(state.storageKey);
    }
  }

  // ---- selection bubble ----

  function hideBubble() {
    state.pendingSelection = null;
    ui.bubble.hidden = true;
  }

  function renderBubble() {
    ui.bubble.innerHTML = state.settings.colors.map((color) =>
      `<button class="swatch" type="button" data-color="${color.key}" title="${escapeHtml(color.label)}" style="background:${escapeHtml(color.color)}"></button>`,
    ).join("") + '<span class="divider"></span><button class="note-btn" type="button" data-note>＋筆記</button>';
  }

  function maybeShowBubble() {
    if (!siteEnabled() || !state.settings.notesEnabled) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      hideBubble();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!range.toString().trim()) {
      hideBubble();
      return;
    }
    const index = buildTextIndex();
    const startEntry = index.byNode.get(range.startContainer);
    const endEntry = index.byNode.get(range.endContainer);
    if (!startEntry || !endEntry) {
      hideBubble();
      return;
    }
    state.pendingSelection = {
      start: startEntry.start + range.startOffset,
      end: endEntry.start + range.endOffset,
      text: index.text,
    };

    const rect = range.getBoundingClientRect();
    ui.bubble.hidden = false;
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - ui.bubble.offsetWidth / 2),
      window.innerWidth - ui.bubble.offsetWidth - 8,
    );
    const above = rect.top - ui.bubble.offsetHeight - 10;
    ui.bubble.style.left = `${left}px`;
    ui.bubble.style.top = `${above >= 8 ? above : rect.bottom + 10}px`;
  }

  function createAnnotation(colorKey, withNote = false) {
    const pending = state.pendingSelection;
    if (!pending) return;
    const anchor = makeAnnotationAnchor(pending.text, pending.start, pending.end);
    if (!anchor.exact.trim()) return;
    const annotation = {
      id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `rm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...anchor,
      colorKey,
      note: "",
      createdAt: new Date().toISOString(),
    };
    state.annotations.push(annotation);
    hideBubble();
    window.getSelection()?.removeAllRanges();
    applyMissingAnnotations();
    saveAnnotations();
    refreshNotesUi();
    if (withNote) openPopover(annotation.id);
    else showToast(`已加入畫記（${colorOf(colorKey).label}）`);
  }

  // ---- note popover ----

  function findAnnotation(id) {
    return state.annotations.find((annotation) => annotation.id === id) || null;
  }

  function syncPopoverColors(colorKey) {
    ui.popoverColors.querySelectorAll("[data-color]").forEach((button) => {
      button.classList.toggle("active", button.dataset.color === colorKey);
    });
  }

  function openPopover(id, anchorRect = null) {
    const annotation = findAnnotation(id);
    if (!annotation) return;
    closePopover();
    hideBubble();
    state.activeAnnotationId = id;
    const marks = marksFor(id);
    marks.forEach((mark) => styleMark(mark, annotation, true));
    ui.popoverColors.innerHTML = state.settings.colors.map((color) =>
      `<button class="swatch" type="button" data-color="${color.key}" title="${escapeHtml(color.label)}" style="background:${escapeHtml(color.color)}"></button>`,
    ).join("");
    syncPopoverColors(annotation.colorKey);
    ui.popoverQuote.textContent = annotation.exact;
    ui.popoverNote.value = annotation.note || "";
    const rect = anchorRect || marks[0]?.getBoundingClientRect();
    if (!rect) return;
    ui.popover.hidden = false;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - ui.popover.offsetWidth - 8);
    let top = rect.bottom + 10;
    if (top + ui.popover.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - ui.popover.offsetHeight - 10);
    }
    ui.popover.style.left = `${left}px`;
    ui.popover.style.top = `${top}px`;
    ui.popoverNote.focus();
  }

  function closePopover() {
    if (ui.popover.hidden) return;
    ui.popover.hidden = true;
    const annotation = findAnnotation(state.activeAnnotationId);
    if (annotation) marksFor(annotation.id).forEach((mark) => styleMark(mark, annotation, false));
    state.activeAnnotationId = null;
  }

  function deleteActiveAnnotation() {
    const id = state.activeAnnotationId;
    if (!id) return;
    closePopover();
    state.annotations = state.annotations.filter((annotation) => annotation.id !== id);
    unwrapAllMarks();
    applyMissingAnnotations();
    saveAnnotations();
    refreshNotesUi();
    showToast("已刪除畫記");
  }

  // ---- notes panel ----

  function refreshNotesUi() {
    const count = state.annotations.length;
    ui.notesCount.textContent = String(count);
    ui.notesCount.hidden = count === 0;
    const available = siteEnabled() && state.settings.notesEnabled && count > 0;
    ui.notesFab.hidden = !available;
    if (!available) closeNotesPanel();
    if (state.notesOpen) renderNotesPanel();
  }

  function renderNotesPanel() {
    if (!state.annotations.length) {
      ui.notesBody.innerHTML = '<p class="empty">尚無畫記。選取網頁文字即可加上螢光筆與筆記。</p>';
      return;
    }
    const text = buildTextIndex().text;
    ui.notesBody.innerHTML = state.annotations.map((annotation) => {
      const orphan = !locateAnnotation(text, annotation);
      const color = colorOf(annotation.colorKey);
      const note = String(annotation.note || "").trim();
      return `
        <button class="note-item${orphan ? " orphan" : ""}" type="button" data-note-id="${escapeHtml(annotation.id)}">
          <span class="note-head">
            <span class="note-dot" style="background:${escapeHtml(color.color)}"></span>
            <span class="note-label">${escapeHtml(color.label)}</span>
            ${orphan ? '<span class="note-orphan">原文已變動</span>' : ""}
          </span>
          <span class="note-quote">${escapeHtml(annotation.exact)}</span>
          ${note ? `<span class="note-text">${escapeHtml(note)}</span>` : ""}
        </button>
      `;
    }).join("");
  }

  function closeNotesPanel() {
    state.notesOpen = false;
    ui.notesPanel.hidden = true;
    ui.notesFab.setAttribute("aria-expanded", "false");
  }

  function openNotesPanel() {
    closeTocPanel();
    state.notesOpen = true;
    renderNotesPanel();
    ui.notesPanel.hidden = false;
    ui.notesFab.setAttribute("aria-expanded", "true");
  }

  // Smooth scroll that self-corrects. Two real-world failure modes:
  // smooth scrolling can be silently ignored (hidden tabs), and lazy-loaded
  // content above the target can shift layout mid-scroll so the first jump
  // lands in the wrong place. After scrolling, re-check where the element
  // actually rests and nudge (instantly) until it settles, max 3 rounds.
  // Fixed/sticky bars overlaying the content top (site navbars) would cut
  // off a heading parked at the container's top edge. Measure the lowest
  // overlay bottom at the content top so landings sit just below it.
  function stickyObstructionBottom() {
    const base = containerViewportTop();
    const x = Math.min(window.innerWidth - 8, Math.max(8, window.innerWidth / 2));
    let bottom = base;
    for (const element of document.elementsFromPoint(x, base + 4)) {
      if (element === host || host.contains(element)) continue;
      const style = getComputedStyle(element);
      if (style.position !== "fixed" && style.position !== "sticky") continue;
      const rect = element.getBoundingClientRect();
      // Ignore near-full-screen fixed layers (overlays/backdrops), keep bars.
      if (rect.height <= window.innerHeight * 0.4 && rect.bottom > bottom) bottom = rect.bottom;
    }
    return bottom;
  }

  function expectedTop(element, block) {
    const base = stickyObstructionBottom() + 8;
    if (block !== "center") return base;
    return Math.max(base, (window.innerHeight - element.getBoundingClientRect().height) / 2);
  }

  function settleScroll(element, block, attempt = 0) {
    if (attempt >= 3) return;
    let checked = false;
    const check = () => {
      if (checked) return;
      checked = true;
      if (!element.isConnected) return;
      const delta = element.getBoundingClientRect().top - expectedTop(element, block);
      if (Math.abs(delta) <= 24) return;
      // Precise correction: scroll the container by the exact offset so the
      // heading clears sticky headers instead of hiding behind them.
      const container = scrollContainer || findScrollContainer();
      if (isDocumentContainer(container)) window.scrollBy(0, delta);
      else container.scrollTop += delta;
      settleScroll(element, block, attempt + 1);
    };
    // scrollend covers smooth scrolls of the window AND inner containers;
    // the timeout covers environments where no scroll ever happens.
    document.addEventListener("scrollend", () => setTimeout(check, 120), { once: true, capture: true });
    setTimeout(check, 900);
  }

  function scrollToElement(element) {
    const block = element.tagName === "MARK" ? "center" : "start";
    element.scrollIntoView({ behavior: "smooth", block });
    settleScroll(element, block);
  }

  function flashAnnotation(id) {
    const marks = marksFor(id);
    const annotation = findAnnotation(id);
    if (!marks.length || !annotation) {
      showToast("原文已變動，找不到對應文字");
      return;
    }
    scrollToElement(marks[0]);
    marks.forEach((mark) => styleMark(mark, annotation, true));
    setTimeout(() => marks.forEach((mark) => styleMark(mark, annotation, mark.dataset.rmId === state.activeAnnotationId)), 1500);
  }

  // ---- toc ----

  // Prefer headings inside the main article: recommended-article rails,
  // sidebars and footers pollute the TOC on blog sites. Fall back to the
  // whole document when no landmark with enough headings exists.
  function pickHeadingRoot() {
    const headingCount = (element) => element.querySelectorAll("h1, h2, h3, h4").length;
    for (const selector of ["article", "main", "[role='main']"]) {
      const candidates = [...document.querySelectorAll(selector)]
        .filter((element) => !host.contains(element)
          && !element.closest("aside, nav, footer")
          && headingCount(element) >= 2)
        .sort((a, b) => headingCount(b) - headingCount(a));
      if (candidates.length) return candidates[0];
    }
    return document;
  }

  function collectHeadings() {
    return [...pickHeadingRoot().querySelectorAll("h1, h2, h3, h4")]
      .filter((heading) => !host.contains(heading)
        && heading.textContent.trim()
        && heading.getClientRects().length > 0)
      .slice(0, 200);
  }

  let tocSignature = "";

  function refreshTocUi() {
    state.tocHeadings = siteEnabled() && state.settings.tocEnabled ? collectHeadings() : [];
    const available = state.tocHeadings.length >= 2;
    ui.tocFab.hidden = !available;
    ui.tocCount.textContent = String(state.tocHeadings.length);
    if (!available) {
      tocSignature = "";
      closeTocPanel();
      return;
    }
    // Mutation-heavy pages call this constantly; skip the innerHTML rebuild
    // when the heading list is unchanged (fresh element refs still stored).
    const signature = state.tocHeadings
      .map((heading) => `${heading.tagName}:${heading.textContent.trim()}`)
      .join("");
    if (signature === tocSignature) {
      updateActiveTocItem();
      return;
    }
    tocSignature = signature;
    ui.tocBody.innerHTML = state.tocHeadings.map((heading, index) => {
      const level = Number(heading.tagName.slice(1));
      const title = heading.textContent.trim();
      return `<button class="toc-item toc-l${level}" type="button" data-toc-index="${index}" title="${escapeHtml(title)}"><span class="toc-level">H${level}</span><span class="toc-text">${escapeHtml(title)}</span></button>`;
    }).join("");
    updateActiveTocItem();
  }

  function updateActiveTocItem() {
    if (!state.tocHeadings.length) return;
    // Anchor the reading line to the scroll container's top, not the
    // viewport's: on sites with sticky headers the landed heading rests
    // ~100px+ down and a viewport-based anchor highlights the previous one.
    const active = activeHeadingIndex(
      state.tocHeadings.map((heading) => heading.getBoundingClientRect().top),
      stickyObstructionBottom() + 96,
    );
    host.dataset.spyActive = String(active);
    ui.tocBody.querySelectorAll(".toc-item").forEach((item) => {
      const isActive = Number(item.dataset.tocIndex) === active;
      item.classList.toggle("active", isActive);
      if (isActive && state.tocOpen) item.scrollIntoView({ block: "nearest" });
    });
  }

  // Throttled timer instead of rAF: rAF freezes in hidden tabs, and a short
  // delay batches the burst of scroll events during smooth scrolling anyway.
  let spyTimer = null;
  function scheduleSpyUpdate() {
    if (spyTimer !== null || !state.tocHeadings.length) return;
    spyTimer = setTimeout(() => {
      spyTimer = null;
      updateActiveTocItem();
    }, 120);
  }

  function closeTocPanel() {
    state.tocOpen = false;
    ui.tocPanel.hidden = true;
    ui.tocFab.setAttribute("aria-expanded", "false");
  }

  function openTocPanel() {
    closeNotesPanel();
    state.tocOpen = true;
    refreshTocUi();
    ui.tocPanel.hidden = false;
    ui.tocFab.setAttribute("aria-expanded", "true");
  }

  // ---- scroll to top / bottom ----

  // Many sites (member areas, SPAs) keep the document itself unscrollable and
  // scroll an inner container instead. Find the real scrolling element:
  // the document if it scrolls, otherwise the largest scrollable box.
  let scrollContainer = null;

  function isDocumentContainer(container) {
    return !container
      || container === document.scrollingElement
      || container === document.documentElement
      || container === document.body;
  }

  function containerViewportTop() {
    const container = scrollContainer || findScrollContainer();
    return isDocumentContainer(container) ? 0 : Math.max(0, container.getBoundingClientRect().top);
  }

  // Bounded breadth-first search: main scroll containers live near the top
  // of the tree; scanning every element (and forcing style/layout on each
  // candidate) makes huge, busy pages jam the content script's event loop.
  function findScrollContainer() {
    const doc = document.scrollingElement || document.documentElement;
    if (scrollButtonsVisible(doc.scrollHeight, doc.clientHeight)) return doc;
    let best = doc;
    let bestArea = 0;
    const queue = [{ element: document.body, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      if (element === host) continue;
      if (scrollButtonsVisible(element.scrollHeight, element.clientHeight)) {
        const overflowY = getComputedStyle(element).overflowY;
        if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
          const rect = element.getBoundingClientRect();
          const area = rect.width * rect.height;
          if (area > bestArea) {
            bestArea = area;
            best = element;
          }
        }
      }
      if (depth < 6) {
        for (const child of element.children) queue.push({ element: child, depth: depth + 1 });
      }
    }
    return best;
  }

  function scrollContainerToEdge(edge) {
    const container = scrollContainer || findScrollContainer();
    const target = scrollEdgeTarget(edge, container.scrollHeight, container.clientHeight);
    const before = container.scrollTop;
    container.scrollTo({ top: target, behavior: "smooth" });
    // Instant fallback when smooth scrolling is ignored.
    setTimeout(() => {
      if (Math.abs(container.scrollTop - before) < 2 && Math.abs(before - target) > 8) {
        container.scrollTop = target;
      }
    }, 250);
  }

  function refreshScrollFabs() {
    scrollContainer = findScrollContainer();
    const show = siteEnabled()
      && scrollButtonsVisible(scrollContainer.scrollHeight, scrollContainer.clientHeight);
    ui.topFab.hidden = !show;
    ui.bottomFab.hidden = !show;
  }

  // One near-term and one late check (late content); more repeats just burn
  // CPU on busy pages since every mutation batch re-triggers this anyway.
  // Hidden tabs skip entirely — refreshAll runs when the tab is shown.
  function refreshScrollFabsSoon() {
    if (document.visibilityState !== "visible") return;
    requestAnimationFrame(refreshScrollFabs);
    setTimeout(refreshScrollFabs, 800);
  }

  // ---- enable / disable / refresh ----

  function refreshAll() {
    renderBubble();
    if (!siteEnabled() || !state.settings.notesEnabled) {
      hideBubble();
      closePopover();
      unwrapAllMarks();
    } else {
      state.annotations.forEach((annotation) => {
        marksFor(annotation.id).forEach((mark) => styleMark(mark, annotation, annotation.id === state.activeAnnotationId));
      });
      applyMissingAnnotations();
    }
    refreshNotesUi();
    refreshTocUi();
    refreshScrollFabs();
  }

  // ---- events ----

  document.addEventListener("mouseup", (event) => {
    if (inShadow(event)) return;
    setTimeout(maybeShowBubble, 0);
  });

  document.addEventListener("mousedown", (event) => {
    if (inShadow(event)) return;
    if (!ui.popover.hidden && !event.target.closest?.("mark[data-rm-id]")) closePopover();
    if (!ui.bubble.hidden) hideBubble();
  });

  document.addEventListener("click", (event) => {
    if (inShadow(event)) return;
    const mark = event.target.closest?.("mark[data-rm-id]");
    if (mark) {
      openPopover(mark.dataset.rmId, mark.getBoundingClientRect());
      return;
    }
    if (state.notesOpen) closeNotesPanel();
    if (state.tocOpen) closeTocPanel();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!ui.popover.hidden) closePopover();
    else if (!ui.bubble.hidden) hideBubble();
    else if (state.notesOpen) closeNotesPanel();
    else if (state.tocOpen) closeTocPanel();
  });

  // Capture-phase so inner scroll containers (not just the window) drive the
  // TOC highlight and dismiss the selection bubble.
  document.addEventListener("scroll", () => {
    hideBubble();
    scheduleSpyUpdate();
  }, { capture: true, passive: true });

  ui.bubble.addEventListener("mousedown", (event) => event.preventDefault());
  ui.bubble.addEventListener("click", (event) => {
    const swatch = event.target.closest("[data-color]");
    if (swatch) {
      createAnnotation(swatch.dataset.color);
      return;
    }
    if (event.target.closest("[data-note]")) createAnnotation(state.settings.colors[0].key, true);
  });

  ui.popoverNote.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    closePopover();
  });
  ui.popoverNote.addEventListener("input", () => {
    const annotation = findAnnotation(state.activeAnnotationId);
    if (!annotation) return;
    annotation.note = ui.popoverNote.value;
    marksFor(annotation.id).forEach((mark) => styleMark(mark, annotation, true));
    saveAnnotations();
    if (state.notesOpen) renderNotesPanel();
  });
  ui.popover.addEventListener("click", (event) => {
    const swatch = event.target.closest("[data-color]");
    if (swatch) {
      const annotation = findAnnotation(state.activeAnnotationId);
      if (!annotation) return;
      annotation.colorKey = swatch.dataset.color;
      syncPopoverColors(annotation.colorKey);
      marksFor(annotation.id).forEach((mark) => styleMark(mark, annotation, true));
      saveAnnotations();
      if (state.notesOpen) renderNotesPanel();
      return;
    }
    const action = event.target.closest("[data-act]")?.dataset.act;
    if (action === "delete") deleteActiveAnnotation();
    if (action === "close") closePopover();
  });

  ui.notesFab.addEventListener("click", () => (state.notesOpen ? closeNotesPanel() : openNotesPanel()));
  ui.tocFab.addEventListener("click", () => (state.tocOpen ? closeTocPanel() : openTocPanel()));
  ui.topFab.addEventListener("click", () => scrollContainerToEdge("top"));
  ui.bottomFab.addEventListener("click", () => scrollContainerToEdge("bottom"));
  window.addEventListener("resize", refreshScrollFabsSoon);
  window.addEventListener("load", refreshScrollFabsSoon);
  document.addEventListener("readystatechange", refreshScrollFabsSoon);
  ui.notesPanel.addEventListener("click", (event) => {
    if (event.target.closest("[data-act='close-notes']")) {
      closeNotesPanel();
      return;
    }
    const item = event.target.closest("[data-note-id]");
    if (!item) return;
    closePopover();
    flashAnnotation(item.dataset.noteId);
  });
  ui.tocPanel.addEventListener("click", (event) => {
    if (event.target.closest("[data-act='close-toc']")) {
      closeTocPanel();
      return;
    }
    const item = event.target.closest("[data-toc-index]");
    if (!item) return;
    const heading = state.tocHeadings[Number(item.dataset.tocIndex)];
    if (heading) scrollToElement(heading);
  });

  // ---- visibility gating ----
  // Background tabs do NO scan work: with many restored tabs, dozens of
  // content scripts churning the CPU makes the whole browser (including the
  // popup) feel sluggish. Hidden tabs only mark work as pending; everything
  // runs on the first switch back to the tab.

  let ready = false;
  let uiInitialized = false;
  let pendingHiddenRefresh = false;

  function pageVisible() {
    return document.visibilityState === "visible";
  }

  function ensureUiInitialized() {
    if (!ready || uiInitialized) return;
    uiInitialized = true;
    refreshAll();
  }

  function runMutationRefresh() {
    applyMissingAnnotations();
    refreshTocUi();
    refreshScrollFabsSoon();
    if (state.notesOpen) renderNotesPanel();
  }

  // Dynamic pages: re-apply lost marks and rebuild the TOC after DOM changes.
  let mutationTimer;
  const observer = new MutationObserver(() => {
    if (state.applying) return;
    if (!pageVisible() || !uiInitialized) {
      pendingHiddenRefresh = true;
      return;
    }
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(runMutationRefresh, 800);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  document.addEventListener("visibilitychange", () => {
    if (!pageVisible()) return;
    if (!uiInitialized) {
      ensureUiInitialized();
      pendingHiddenRefresh = false;
      return;
    }
    if (pendingHiddenRefresh) {
      pendingHiddenRefresh = false;
      runMutationRefresh();
    }
  });

  // SPA navigation: same tab, new logical page → swap the storage bucket.
  let lastKey = pageKey(location.href);
  setInterval(async () => {
    if (!uiInitialized) return;
    const currentKey = pageKey(location.href);
    if (currentKey === lastKey) return;
    lastKey = currentKey;
    state.storageKey = `ann:${currentKey}`;
    closePopover();
    hideBubble();
    unwrapAllMarks();
    await loadAnnotations();
    if (pageVisible()) refreshAll();
    else pendingHiddenRefresh = true;
  }, 1200);

  // Settings written by the popup take effect immediately (when visible).
  chromeApi.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    state.settings = mergeSettings(changes.settings.newValue);
    state.annotations = cleanAnnotations(state.annotations, colorKeys());
    if (!uiInitialized) return;
    if (pageVisible()) refreshAll();
    else pendingHiddenRefresh = true;
  });

  chromeApi.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    if (message?.type === "rm-status") {
      sendResponse({
        ok: true,
        hostname: location.hostname,
        count: state.annotations.length,
        siteEnabled: siteEnabled(),
      });
      return false;
    }
    if (message?.type === "rm-export") {
      const text = buildTextIndex().text;
      const located = state.annotations.map((annotation) => ({
        ...annotation,
        position: locateAnnotation(text, annotation),
      }));
      located.sort((a, b) => (a.position?.start ?? Infinity) - (b.position?.start ?? Infinity));
      sendResponse({
        ok: true,
        markdown: buildExportMarkdown({
          title: document.title,
          url: location.href,
          colors: state.settings.colors,
          annotations: located.map((annotation) => ({ ...annotation, orphan: !annotation.position })),
          includeLabels: state.settings.exportWithLabels === true,
        }),
      });
      return false;
    }
    return false;
  });

  // ---- init ----

  (async () => {
    const stored = await chromeApi.storage.local.get("settings");
    state.settings = mergeSettings(stored.settings);
    await loadAnnotations();
    ready = true;
    // Hidden tabs (session restore, background-opened) stay dormant until
    // first shown; the visibilitychange handler runs the deferred init.
    if (pageVisible()) {
      ensureUiInitialized();
      refreshScrollFabsSoon();
    }
  })();
})();
