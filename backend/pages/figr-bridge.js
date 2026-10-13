// Figr bridge: the one <script> added to each preview page.
//
// The host app can't touch this page's DOM (different origin), so everything it
// needs goes through postMessage: hit-testing, element boxes, the element tree,
// live styles, scrolling, and page errors. Message shapes are mirrored in
// frontend/src/protocol.ts.
//
// Element identity: every element the host knows about gets an id ("n12"). When
// the page rebuilds its DOM, a lost id is re-bound to the new node only if a
// locator (nearest data-key / id ancestor, then tag+class+name+text steps) matches
// exactly one node. Otherwise the id is reported as gone. It never guesses.
(() => {
  "use strict";
  if (window.parent === window) return;
  // Dev fault: a "silent" page never answers, so the host's connect timeout fires.
  if (/[?&]figr_silent=1(&|$)/.test(location.search)) return;

  const docId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META", "TITLE", "HEAD"]);

  let hostOrigin = null; // locked by the first "init" from our parent
  let mode = "select";
  const outbox = []; // messages produced before the handshake (e.g. early page errors)

  function post(msg) {
    msg.figr = 1;
    msg.docId = docId;
    if (!hostOrigin) outbox.push(msg);
    else window.parent.postMessage(msg, hostOrigin);
  }

  // ---------- ids ----------

  let seq = 0;
  const idOf = new WeakMap(); // Element -> id
  const records = new Map(); // id -> { el, loc }

  function idFor(el) {
    let id = idOf.get(el);
    if (!id) {
      id = "n" + ++seq;
      idOf.set(el, id);
      records.set(id, { el, loc: locate(el) });
    }
    return id;
  }

  function elOf(id) {
    const rec = records.get(id);
    return rec && rec.el.isConnected ? rec.el : null;
  }

  // ---------- tree ----------

  function kids(el) {
    const out = [];
    if (!el) return out;
    for (const c of el.children) if (!SKIP.has(c.tagName.toUpperCase())) out.push(c);
    return out;
  }

  function nameOf(el) {
    const dataName = el.getAttribute("data-name");
    if (dataName) return dataName;
    const tag = el.tagName.toLowerCase();
    const cls = (el.getAttribute("class") || "").trim().split(/\s+/)[0];
    if (cls) return tag + "." + cls;
    if (el.id) return tag + "#" + el.id;
    return tag;
  }

  function info(el) {
    return {
      id: idFor(el),
      name: nameOf(el),
      tag: el.tagName.toLowerCase(),
      key: el.getAttribute("data-key"),
      hasChildren: kids(el).length > 0,
    };
  }

  // Ancestor ids from the top-level element (a child of <body>) down to el.
  function pathOf(el) {
    const ids = [];
    for (let c = el; c && c !== document.body; c = c.parentElement) ids.unshift(idFor(c));
    return ids;
  }

  function isPageElement(el) {
    return !!el && el !== document.documentElement && el !== document.body && document.body.contains(el);
  }

  // ---------- locators (identity across re-renders) ----------

  function sig(el) {
    return el.tagName + "|" + (el.getAttribute("class") || "") + "|" + (el.getAttribute("data-name") || "");
  }

  // Numbers are normalised so "2s ago" -> "4s ago" still matches.
  function text(el) {
    return (el.textContent || "").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 200);
  }

  function isAnchor(el) {
    return el === document.body || el.hasAttribute("data-key") || !!el.id;
  }

  function locate(el) {
    const steps = [];
    let cur = el;
    while (cur && !isAnchor(cur)) {
      steps.unshift({ sig: sig(cur), text: text(cur) });
      cur = cur.parentElement;
    }
    if (!cur) return null;
    if (cur === document.body) return { anchor: { body: true }, steps };
    return {
      anchor: { el: cur, key: cur.getAttribute("data-key"), id: cur.id, sig: sig(cur) },
      steps,
    };
  }

  function resolve(loc) {
    const a = loc.anchor;
    let cur;
    if (a.body) cur = document.body;
    else if (a.el.isConnected) cur = a.el;
    else {
      const selector = a.key ? `[data-key="${CSS.escape(a.key)}"]` : `#${CSS.escape(a.id)}`;
      const found = document.querySelectorAll(selector);
      if (found.length !== 1 || sig(found[0]) !== a.sig) return null;
      cur = found[0];
    }
    for (const step of loc.steps) {
      const matches = kids(cur).filter((c) => sig(c) === step.sig && text(c) === step.text);
      if (matches.length !== 1) return null; // ambiguous or missing: never guess
      cur = matches[0];
    }
    return cur;
  }

  // ---------- DOM changes ----------

  const observed = new Map(); // parent id ("" = body) -> JSON of the children last sent
  let flushTimer = 0;

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = 0;
    const gone = [];
    for (const [id, rec] of records) {
      if (rec.el.isConnected) continue;
      const el = rec.loc ? resolve(rec.loc) : null;
      if (el && !idOf.has(el)) {
        idOf.set(el, id);
        rec.el = el;
      } else {
        records.delete(id);
        gone.push(id);
      }
    }
    // Refresh locators so the next re-render is matched against the current DOM.
    for (const rec of records.values()) rec.loc = locate(rec.el);

    if (gone.length) post({ type: "gone", ids: gone });
    for (const [pid, last] of observed) {
      const parent = pid ? elOf(pid) : document.body;
      if (!parent) {
        observed.delete(pid);
        continue;
      }
      const list = kids(parent).map(info);
      const json = JSON.stringify(list);
      if (json !== last) {
        observed.set(pid, json);
        post({ type: "children", id: pid || null, children: list });
      }
    }
    post({ type: "dirty" });
  }

  const observer = new MutationObserver(() => {
    if (!flushTimer) flushTimer = setTimeout(flush, 30);
  });

  // ---------- geometry & live values ----------

  function rect(r) {
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  // The element's box plus the part of it actually visible: clipped by the
  // viewport and by every ancestor that clips overflow (inner scroll areas).
  function box(el) {
    const r = el.getBoundingClientRect();
    let left = 0;
    let top = 0;
    let right = document.documentElement.clientWidth;
    let bottom = document.documentElement.clientHeight;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const ar = a.getBoundingClientRect();
      left = Math.max(left, ar.left);
      top = Math.max(top, ar.top);
      right = Math.min(right, ar.right);
      bottom = Math.min(bottom, ar.bottom);
    }
    const cl = Math.max(left, r.left);
    const ct = Math.max(top, r.top);
    const cr = Math.min(right, r.right);
    const cb = Math.min(bottom, r.bottom);
    const visible = cr > cl && cb > ct;
    return {
      ...rect(r),
      clip: visible ? { x: cl, y: ct, w: cr - cl, h: cb - ct } : null,
      name: nameOf(el),
    };
  }

  function live(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      name: nameOf(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      classes: Array.from(el.classList),
      key: el.getAttribute("data-key"),
      width: Math.round(r.width),
      height: Math.round(r.height),
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
      color: s.color,
      background: s.backgroundColor,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
    };
  }

  // Watched ids are polled every frame while there are any: that covers page
  // scroll, inner scroll, animations and resizes with one mechanism.
  let watchRects = [];
  let watchLive = [];
  const lastSent = new Map();
  let looping = false;

  function setWatch(rects, liveIds) {
    watchRects = rects;
    watchLive = liveIds;
    lastSent.clear();
    if (!looping) {
      looping = true;
      requestAnimationFrame(tick);
    }
  }

  function collect(ids, prefix, read) {
    const out = {};
    let any = false;
    for (const id of ids) {
      const el = elOf(id);
      if (!el) continue;
      const value = read(el);
      const json = JSON.stringify(value);
      if (lastSent.get(prefix + id) === json) continue;
      lastSent.set(prefix + id, json);
      out[id] = value;
      any = true;
    }
    return any ? out : null;
  }

  function tick() {
    if (!watchRects.length && !watchLive.length) {
      looping = false;
      return;
    }
    if (flushTimer) flush();
    const rects = collect(watchRects, "r:", box);
    if (rects) post({ type: "rects", rects });
    const values = collect(watchLive, "l:", live);
    if (values) post({ type: "live", live: values });
    requestAnimationFrame(tick);
  }

  // ---------- requests ----------

  function hit(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!isPageElement(el)) return null;
    return { id: idFor(el), name: nameOf(el), path: pathOf(el), box: box(el) };
  }

  function nav(id, dir) {
    const el = elOf(id);
    if (!el) return null;
    let target = null;
    if (dir === "child") target = kids(el)[0] || null;
    else if (dir === "parent") target = el.parentElement !== document.body ? el.parentElement : null;
    else {
      const siblings = kids(el.parentElement);
      const i = siblings.indexOf(el);
      const n = siblings.length;
      target = siblings[(i + (dir === "next" ? 1 : -1) + n) % n];
    }
    return target ? { id: idFor(target), name: nameOf(target), path: pathOf(target), box: box(target) } : null;
  }

  function search(query) {
    const q = query.toLowerCase();
    const results = [];
    const LIMIT = 500;
    const chain = [];
    const walk = (parent) => {
      for (const c of kids(parent)) {
        if (results.length >= LIMIT) return;
        chain.push(c);
        if (nameOf(c).toLowerCase().includes(q)) results.push(chain.map(info));
        walk(c);
        chain.pop();
      }
    };
    walk(document.body);
    return { results, truncated: results.length >= LIMIT };
  }

  function scrollable(el, dx, dy) {
    const s = getComputedStyle(el);
    const sy = /(auto|scroll|overlay)/.test(s.overflowY);
    const sx = /(auto|scroll|overlay)/.test(s.overflowX);
    const canY = sy && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : dy < 0 && el.scrollTop > 0);
    const canX = sx && (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : dx < 0 && el.scrollLeft > 0);
    return canY || canX;
  }

  function wheel(x, y, dx, dy) {
    for (let el = document.elementFromPoint(x, y); isPageElement(el); el = el.parentElement) {
      if (scrollable(el, dx, dy)) {
        el.scrollBy(dx, dy);
        return;
      }
    }
    window.scrollBy(dx, dy);
  }

  // Scrolls only this page (never the host): adjusts each scrolling ancestor, then
  // the document. Element.scrollIntoView could also scroll the host page.
  function reveal(id) {
    const el = elOf(id);
    if (!el) return;
    const within = (top, bottom, r) => (r.top < top ? r.top - top : r.bottom > bottom ? Math.min(r.bottom - bottom, r.top - top) : 0);
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.scrollHeight <= a.clientHeight && a.scrollWidth <= a.clientWidth) continue;
      if (!/(auto|scroll|overlay)/.test(getComputedStyle(a).overflowY + getComputedStyle(a).overflowX)) continue;
      const ar = a.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      a.scrollTop += within(ar.top, ar.bottom, r);
      a.scrollLeft += r.left < ar.left ? r.left - ar.left : r.right > ar.right ? Math.min(r.right - ar.right, r.left - ar.left) : 0;
    }
    const r = el.getBoundingClientRect();
    const dy = within(0, document.documentElement.clientHeight, r);
    if (dy) window.scrollBy(0, dy);
  }

  function reply(m, data, error) {
    post({ type: "res", reqId: m.reqId, data: data === undefined ? null : data, error });
  }

  function handle(m) {
    switch (m.type) {
      case "mode":
        mode = m.mode === "interact" ? "interact" : "select";
        applyMode();
        return;
      case "watch":
        setWatch(Array.isArray(m.rects) ? m.rects : [], Array.isArray(m.live) ? m.live : []);
        return;
      case "wheel":
        wheel(m.x, m.y, m.dx, m.dy);
        return;
      case "reveal":
        reveal(m.id);
        return;
      case "hit":
        return reply(m, hit(m.x, m.y));
      case "nav":
        return reply(m, nav(m.id, m.dir));
      case "search":
        return reply(m, search(String(m.query || "")));
      case "children": {
        if (m.hang) return; // dev fault: never answer, so the host's row timeout fires
        const parent = m.id ? elOf(m.id) : document.body;
        if (!parent) return reply(m, null, "gone");
        const list = kids(parent).map(info);
        observed.set(m.id || "", JSON.stringify(list));
        return reply(m, list);
      }
    }
  }

  // ---------- modes, keys, zoom, errors ----------

  function applyMode() {
    const active = document.activeElement;
    if (mode === "select" && active && active !== document.body) active.blur();
  }

  const isEditable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  // Select mode: the page never keeps focus.
  window.addEventListener(
    "focusin",
    (e) => {
      if (mode === "select" && e.target && e.target.blur) e.target.blur();
    },
    true,
  );

  // Shortcuts pressed while the page has focus are forwarded to the host.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!hostOrigin || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      const modeKey = k === "v" || k === "V" || k === "i" || k === "I" || k === "Escape";
      const navKey = k === "Enter" || k === "Tab";
      if (mode === "select") {
        if (!modeKey && !navKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if (!modeKey || isEditable(e.target)) return;
      post({ type: "key", key: k, shift: e.shiftKey });
    },
    true,
  );

  // Ctrl/Cmd + wheel zooms the board, never the page (Interact mode).
  window.addEventListener(
    "wheel",
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      post({ type: "zoom", x: e.clientX, y: e.clientY, dy: e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY });
    },
    { passive: false, capture: true },
  );

  window.addEventListener("error", (e) => {
    post({ type: "pageError", message: e.message || String(e.error) });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    post({ type: "pageError", message: (reason && reason.message) || String(reason) });
  });

  window.addEventListener("pagehide", () => {
    if (hostOrigin) post({ type: "bye" });
  });

  // ---------- handshake ----------

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || m.figr !== 1 || typeof m.type !== "string") return;
    if (hostOrigin && e.origin !== hostOrigin) return;
    if (m.type === "init") {
      hostOrigin = e.origin;
      mode = m.mode === "interact" ? "interact" : "select";
      applyMode();
      window.parent.postMessage({ figr: 1, docId, type: "ready" }, hostOrigin);
      outbox.splice(0).forEach(post);
      return;
    }
    if (!hostOrigin) return;
    if (flushTimer) flush(); // answer against the current DOM
    try {
      handle(m);
    } catch (err) {
      if (m.reqId) reply(m, null, String((err && err.message) || err));
    }
  });

  function start() {
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    window.parent.postMessage({ figr: 1, docId, type: "hello" }, "*");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
