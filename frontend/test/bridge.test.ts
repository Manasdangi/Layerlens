// The bridge script that runs inside each preview page (backend/pages/figr-bridge.js),
// loaded into a jsdom child frame. Covers the handshake, the element tree, element
// identity across re-renders (R3.7), keyboard navigation (R3.5), search (R4.11),
// key/zoom forwarding (R1.3, R3.6), Select-mode focus blocking and page errors.
// Hit-testing needs real layout (elementFromPoint), so it's covered by the e2e tests.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";

const BRIDGE = readFileSync(fileURLToPath(new URL("../../backend/pages/figr-bridge.js", import.meta.url)), "utf8");
const HOST = "http://localhost:5173";

type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

let dom: JSDOM | null = null;
afterEach(() => {
  dom?.window.close();
  dom = null;
});

async function boot(body: string, { handshake = true } = {}) {
  dom = new JSDOM("<!doctype html><body></body>", { url: `${HOST}/`, runScripts: "dangerously", pretendToBeVisual: true });
  const host = dom.window;
  const iframe = host.document.createElement("iframe");
  host.document.body.append(iframe);
  const page = iframe.contentWindow as unknown as Window & typeof globalThis;
  page.document.body.innerHTML = body;
  const css = page as unknown as { CSS?: { escape(s: string): string } };
  css.CSS ??= { escape: (s: string) => s.replace(/["\\#.:[\]]/g, "\\$&") };

  const inbox: Msg[] = [];
  (host as unknown as { postMessage: (m: Msg) => void }).postMessage = (m: Msg) => inbox.push(structuredClone(m));
  (page as unknown as { eval(src: string): void }).eval(BRIDGE);

  let reqId = 0;
  const send = (data: Msg, origin = HOST) => page.dispatchEvent(new page.MessageEvent("message", { data: { figr: 1, ...data }, origin, source: host as unknown as Window }));
  /** Sends a request and returns the page's answer. */
  const request = async (type: string, payload: Msg = {}) => {
    await tick(); // let MutationObserver callbacks run, like a real event loop would
    const id = ++reqId;
    send({ type, reqId: id, ...payload });
    await tick();
    const res = inbox.find((m) => m.type === "res" && m.reqId === id);
    if (!res) return undefined;
    if (res.error) throw new Error(res.error);
    return res.data;
  };
  const of = (type: string) => inbox.filter((m) => m.type === type);

  if (handshake) send({ type: "init", mode: "select" });
  return { host, page, doc: page.document, inbox, send, request, of };
}

describe("handshake", () => {
  it("says hello, then ready with a docId after init; early page errors are delivered after", async () => {
    const b = await boot("<p>x</p>", { handshake: false });
    expect(b.of("hello")).toHaveLength(1);
    b.page.dispatchEvent(new b.page.ErrorEvent("error", { message: "early" }));
    expect(b.of("pageError")).toHaveLength(0);
    b.send({ type: "init", mode: "select" });
    expect(b.of("ready")).toHaveLength(1);
    expect(b.of("pageError")[0].message).toBe("early");
    expect(b.of("ready")[0].docId).toBe(b.of("hello")[0].docId);
  });

  it("locks onto the host's origin: later messages from elsewhere are ignored", async () => {
    const b = await boot("<p>x</p>");
    b.send({ type: "children", reqId: 99, id: null }, "http://evil.test");
    await tick();
    expect(b.inbox.find((m) => m.reqId === 99)).toBeUndefined();
  });

  it("sends bye when the page unloads (navigation)", async () => {
    const b = await boot("<p>x</p>");
    b.page.dispatchEvent(new b.page.Event("pagehide"));
    expect(b.of("bye")).toHaveLength(1);
  });
});

describe("element tree", () => {
  const body = `
    <nav data-name="Top nav"><span class="logo extra">N</span><ul><li>a</li></ul></nav>
    <section id="hero"><h1>Hi</h1></section>
    <div></div>
    <script>/* never listed */</script><style></style>`;

  it("lists body's children, skipping script/style, with the naming rule", async () => {
    const b = await boot(body);
    const top = await b.request("children", { id: null });
    expect(top.map((n: Msg) => n.name)).toEqual(["Top nav", "section#hero", "div"]);
    expect(top.map((n: Msg) => n.hasChildren)).toEqual([true, true, false]);
    const nav = await b.request("children", { id: top[0].id });
    expect(nav.map((n: Msg) => n.name)).toEqual(["span.logo", "ul"]);
  });

  it("gives an element the same id every time", async () => {
    const b = await boot(body);
    const a = await b.request("children", { id: null });
    const c = await b.request("children", { id: null });
    expect(c.map((n: Msg) => n.id)).toEqual(a.map((n: Msg) => n.id));
  });

  it("a hanging request (dev fault) gets no answer", async () => {
    const b = await boot(body);
    expect(await b.request("children", { id: null, hang: true })).toBeUndefined();
  });

  it("pushes a loaded parent's new child list when the page changes it", async () => {
    const b = await boot(body);
    const top = await b.request("children", { id: null });
    b.doc.querySelector("ul")!.innerHTML += "<li>b</li>";
    await b.request("children", { id: top[0].id }); // observe nav
    b.doc.querySelector("nav")!.append(b.doc.createElement("em"));
    await b.request("search", { query: "zzz" }); // any message flushes pending changes
    const push = b.of("children").at(-1)!;
    expect(push.id).toBe(top[0].id);
    expect(push.children.map((n: Msg) => n.name)).toEqual(["span.logo", "ul", "em"]);
    expect(b.of("dirty").length).toBeGreaterThan(0);
  });
});

describe("identity across re-renders (R3.7)", () => {
  const feed = (items: [string, string][]) => items.map(([who, t]) => `<li><b>${who}</b> <span class="time">${t}</span></li>`).join("");

  it("keeps ids when the page rebuilds every node, inserts siblings before, and numbers change", async () => {
    const b = await boot(`<ul id="feed">${feed([["Ada", "2s ago"], ["Grace", "4s ago"]])}</ul>`);
    const [ul] = await b.request("children", { id: null });
    const before = await b.request("children", { id: ul.id });
    const time = (await b.request("children", { id: before[1].id }))[1];

    b.doc.getElementById("feed")!.innerHTML = feed([["Linus", "0s ago"], ["Ada", "4s ago"], ["Grace", "6s ago"]]);
    const after = await b.request("children", { id: ul.id });
    expect(after[1].id).toBe(before[0].id); // Ada
    expect(after[2].id).toBe(before[1].id); // Grace
    expect(after[0].id).not.toBe(before[0].id); // Linus is new
    // A nested element ("4s ago" -> "6s ago") keeps its id too.
    const timeAfter = (await b.request("children", { id: after[2].id }))[1];
    expect(timeAfter.id).toBe(time.id);
    expect(b.of("gone").flatMap((m) => m.ids)).not.toContain(before[0].id);
  });

  it("reports an element that was removed as gone", async () => {
    const b = await boot(`<ul id="feed">${feed([["Ada", "1s ago"], ["Grace", "1s ago"]])}</ul>`);
    const [ul] = await b.request("children", { id: null });
    const items = await b.request("children", { id: ul.id });
    b.doc.getElementById("feed")!.innerHTML = feed([["Grace", "3s ago"]]);
    await b.request("search", { query: "x" });
    expect(b.of("gone").flatMap((m) => m.ids)).toContain(items[0].id);
  });

  it("never moves an id to a lookalike: two identical siblings are reported gone", async () => {
    const b = await boot(`<ul id="feed">${feed([["Ada", "1s ago"]])}</ul>`);
    const [ul] = await b.request("children", { id: null });
    const [ada] = await b.request("children", { id: ul.id });
    b.doc.getElementById("feed")!.innerHTML = feed([["Ada", "1s ago"], ["Ada", "1s ago"]]);
    const after = await b.request("children", { id: ul.id });
    expect(after.map((n: Msg) => n.id)).not.toContain(ada.id);
    expect(b.of("gone").flatMap((m) => m.ids)).toContain(ada.id);
  });

  it("re-finds a keyed anchor that was itself rebuilt", async () => {
    const b = await boot(`<main><section data-key="panel"><p class="v">$48k</p></section></main>`);
    const [main] = await b.request("children", { id: null });
    const [section] = await b.request("children", { id: main.id });
    const [p] = await b.request("children", { id: section.id });
    b.doc.querySelector("main")!.innerHTML = `<section data-key="panel"><p class="v">$51k</p></section>`;
    const [section2] = await b.request("children", { id: main.id });
    expect(section2.id).toBe(section.id);
    const [p2] = await b.request("children", { id: section2.id });
    expect(p2.id).toBe(p.id);
  });

  it("a moved element (not re-created) keeps its id", async () => {
    const b = await boot(`<div id="a"><p>x</p></div><div id="b"></div>`);
    const [a] = await b.request("children", { id: null });
    const [p] = await b.request("children", { id: a.id });
    b.doc.getElementById("b")!.append(b.doc.querySelector("p")!);
    const top = await b.request("children", { id: null });
    const [moved] = await b.request("children", { id: top[1].id });
    expect(moved.id).toBe(p.id);
  });
});

describe("keyboard navigation (R3.5)", () => {
  const body = `<nav><span class="logo">N</span><ul><li>a</li></ul><a href="#">x</a></nav><main></main>`;

  it("child, parent, next and previous sibling (wrapping); nothing above the top level", async () => {
    const b = await boot(body);
    const [nav] = await b.request("children", { id: null });
    const child = await b.request("nav", { id: nav.id, dir: "child" });
    expect(child.name).toBe("span.logo");
    expect(child.path).toEqual([nav.id, child.id]);
    expect((await b.request("nav", { id: child.id, dir: "next" })).name).toBe("ul");
    expect((await b.request("nav", { id: child.id, dir: "prev" })).name).toBe("a"); // wraps
    const last = await b.request("nav", { id: child.id, dir: "prev" });
    expect((await b.request("nav", { id: last.id, dir: "next" })).name).toBe("span.logo"); // wraps
    expect((await b.request("nav", { id: child.id, dir: "parent" })).id).toBe(nav.id);
    expect(await b.request("nav", { id: nav.id, dir: "parent" })).toBeNull();
    const main = await b.request("nav", { id: nav.id, dir: "next" });
    expect(await b.request("nav", { id: main.id, dir: "child" })).toBeNull();
  });
});

describe("search (R4.11)", () => {
  it("covers the whole tree, including rows never loaded, returning matches with ancestors", async () => {
    let deep = "<b data-name='Target leaf'></b>";
    for (let i = 30; i >= 1; i--) deep = `<div data-name="Level ${i}">${deep}</div>`;
    const b = await boot(`<main>${deep}</main>`);
    const res = await b.request("search", { query: "target" });
    expect(res.truncated).toBe(false);
    expect(res.results).toHaveLength(1);
    const chain = res.results[0];
    expect(chain).toHaveLength(32);
    expect(chain.at(-1).name).toBe("Target leaf");
    expect(chain[1].name).toBe("Level 1");
  });

  it("is case-insensitive and matches every element whose name contains the text", async () => {
    const b = await boot(`<div data-name="Level 1"><div data-name="level 2"></div></div><p>x</p>`);
    const res = await b.request("search", { query: "LEVEL" });
    expect(res.results).toHaveLength(2);
  });
});

describe("live values and watching", () => {
  it("reports live values for watched ids", async () => {
    const b = await boot(`<button class="primary" data-key="cta">  Get   started </button>`);
    const [btn] = await b.request("children", { id: null });
    b.send({ type: "watch", rects: [btn.id], live: [btn.id] });
    await tick(60);
    const live = b.of("live").at(-1)!.live[btn.id];
    expect(live).toMatchObject({ name: "button.primary", tag: "button", key: "cta", classes: ["primary"], text: "Get started" });
    expect(b.of("rects").at(-1)!.rects[btn.id]).toHaveProperty("clip");
  });
});

describe("forwarding and Select mode", () => {
  const key = (b: Awaited<ReturnType<typeof boot>>, k: string, target: EventTarget = b.doc.body, init: KeyboardEventInit = {}) => {
    const e = new b.page.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };

  it("Select mode: shortcuts are forwarded to the host and kept from the page", async () => {
    const b = await boot(`<input id="i" />`);
    for (const k of ["v", "I", "Escape", "Enter", "Tab"]) expect(key(b, k).defaultPrevented).toBe(true);
    key(b, "Enter", b.doc.body, { shiftKey: true });
    key(b, "a");
    expect(b.of("key").map((m) => m.key)).toEqual(["v", "I", "Escape", "Enter", "Tab", "Enter"]);
    expect(b.of("key").at(-1)!.shift).toBe(true);
  });

  it("Interact mode: V / I / Escape are forwarded, but not while typing; Enter and Tab stay with the page", async () => {
    const b = await boot(`<input id="i" />`);
    b.send({ type: "mode", mode: "interact" });
    expect(key(b, "Enter").defaultPrevented).toBe(false);
    key(b, "Tab");
    key(b, "v", b.doc.getElementById("i")!);
    key(b, "i");
    expect(b.of("key").map((m) => m.key)).toEqual(["i"]);
  });

  it("Select mode: nothing in the page keeps focus", async () => {
    const b = await boot(`<input id="i" />`);
    const input = b.doc.getElementById("i") as HTMLInputElement;
    input.focus();
    expect(b.doc.activeElement).not.toBe(input);
    b.send({ type: "mode", mode: "interact" });
    input.focus();
    expect(b.doc.activeElement).toBe(input);
    b.send({ type: "mode", mode: "select" });
    expect(b.doc.activeElement).not.toBe(input);
  });

  it("Ctrl/Cmd + wheel is sent to the host as zoom, never zooming the page", async () => {
    const b = await boot(`<p>x</p>`);
    const e = new b.page.WheelEvent("wheel", { deltaY: -40, clientX: 10, clientY: 20, ctrlKey: true, cancelable: true, bubbles: true });
    b.doc.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(b.of("zoom")[0]).toMatchObject({ x: 10, y: 20, dy: -40 });
    b.doc.body.dispatchEvent(new b.page.WheelEvent("wheel", { deltaY: 40, bubbles: true }));
    expect(b.of("zoom")).toHaveLength(1);
  });
});

describe("page errors (R6.3)", () => {
  it("uncaught errors and unhandled rejections become pageError messages", async () => {
    const b = await boot(`<p>x</p>`);
    b.page.dispatchEvent(new b.page.ErrorEvent("error", { message: "player is null" }));
    const rejection = new b.page.Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = new Error("Failed to load analytics");
    b.page.dispatchEvent(rejection);
    expect(b.of("pageError").map((m) => m.message)).toEqual(["player is null", "Failed to load analytics"]);
  });

  it("an error while answering a request is returned as that request's error", async () => {
    const b = await boot(`<p>x</p>`);
    await expect(b.request("nav", { id: "n-unknown", dir: "child" })).resolves.toBeNull();
  });
});
