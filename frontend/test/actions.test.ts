// Store actions: selection rules (R3), mode and camera (R1), page messages,
// layers loading (R4) and failure reporting (R6).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/report", () => ({ report: vi.fn() }));

import * as actions from "../src/actions";
import { Cancelled, ROW_TIMEOUT, type Connection } from "../src/connection";
import { MAX_ZOOM, MIN_ZOOM } from "../src/layout";
import { report } from "../src/report";
import { store, type Screen } from "../src/state";

const initial = store.get();
const screen = (n: number): Screen => ({ id: `scr-0${n}`, name: `S${n}`, url: `http://localhost:4001/page-${n}.html` });
const A = screen(1);
const B = screen(2);

/** A connected preview whose page messages we play by hand. */
function connected(s: Screen, onError = vi.fn()) {
  const postMessage = vi.fn();
  const conn = actions.connect(s, onError);
  conn.attach({ contentWindow: { postMessage } } as unknown as HTMLIFrameElement);
  conn.receive({ figr: 1, type: "ready", docId: `doc-${s.id}` });
  const fromPage = (msg: Record<string, unknown>) => conn.receive({ figr: 1, docId: conn.docId, ...msg });
  const sent = () => postMessage.mock.calls.map((c) => c[0]);
  const lastRequest = (type: string) => sent().filter((m) => m.type === type).at(-1);
  return { conn, fromPage, sent, lastRequest, onError };
}

beforeEach(() => {
  vi.useFakeTimers();
  store.set(initial);
  store.set({ screens: [A, B] });
});

afterEach(() => {
  for (const c of [...actions.connections.values()]) actions.disconnect(c as Connection);
  vi.useRealTimers();
  vi.mocked(report).mockClear();
});

describe("selection (R3)", () => {
  it("click selects, shift+click adds and removes in the same preview", () => {
    actions.select(A.id, "n1", ["n1"], false);
    actions.select(A.id, "n2", ["n2"], true);
    expect(store.get().selection).toEqual({ screenId: A.id, ids: ["n1", "n2"] });
    actions.select(A.id, "n1", ["n1"], true);
    expect(store.get().selection).toEqual({ screenId: A.id, ids: ["n2"] });
  });

  it("shift+click in a different preview replaces the selection", () => {
    actions.select(A.id, "n1", ["n1"], false);
    actions.select(B.id, "n9", ["n9"], true);
    expect(store.get().selection).toEqual({ screenId: B.id, ids: ["n9"] });
    expect(store.get().activeId).toBe(B.id);
  });

  it("removing the last selected id clears the selection", () => {
    actions.select(A.id, "n1", ["n1"], false);
    actions.select(A.id, "n1", ["n1"], true);
    expect(store.get().selection).toBeNull();
  });

  it("a click on page background (no hit) clears the selection", () => {
    actions.select(A.id, "n1", ["n1"], false);
    actions.selectFromHit(A.id, null, false);
    expect(store.get().selection).toBeNull();
  });

  it("Escape clears the selection; V and I switch modes", () => {
    actions.select(A.id, "n1", ["n1"], false);
    expect(actions.handleKey("Escape", false)).toBe(true);
    expect(store.get().selection).toBeNull();
    actions.handleKey("i", false);
    expect(store.get().mode).toBe("interact");
    actions.handleKey("V", false);
    expect(store.get().mode).toBe("select");
  });

  it("the selection is kept (hidden) in Interact mode", () => {
    actions.select(A.id, "n1", ["n1"], false);
    actions.setMode("interact");
    expect(store.get().selection?.ids).toEqual(["n1"]);
  });

  it("Enter / Tab act on the most recently selected element and replace the selection", async () => {
    const { lastRequest, fromPage } = connected(A);
    actions.select(A.id, "n1", ["n1"], false);
    actions.select(A.id, "n2", ["n2"], true);
    actions.handleKey("Tab", false);
    const req = lastRequest("nav");
    expect(req).toMatchObject({ id: "n2", dir: "next" });
    fromPage({ type: "res", reqId: req.reqId, data: { id: "n3", name: "x", path: ["n3"], box: { x: 0, y: 0, w: 1, h: 1, clip: null, name: "x" } } });
    await vi.runAllTimersAsync();
    expect(store.get().selection?.ids).toEqual(["n3"]);

    actions.handleKey("Enter", true);
    expect(lastRequest("nav")).toMatchObject({ id: "n3", dir: "parent" });
    actions.handleKey("Enter", false);
    expect(lastRequest("nav")).toMatchObject({ dir: "child" });
    actions.handleKey("Tab", true);
    expect(lastRequest("nav")).toMatchObject({ dir: "prev" });
  });

  it("Enter / Tab do nothing in Interact mode or with no selection", () => {
    expect(actions.handleKey("Enter", false)).toBe(false);
    actions.select(A.id, "n1", ["n1"], false);
    actions.setMode("interact");
    expect(actions.handleKey("Tab", false)).toBe(false);
  });

  it("a keyboard step the page doesn't answer fails that preview (R6)", async () => {
    const { onError } = connected(A);
    actions.select(A.id, "n1", ["n1"], false);
    actions.handleKey("Tab", false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).not.toBeInstanceOf(Cancelled);
  });
});

describe("page re-renders (R3.7)", () => {
  it("drops gone ids; if nothing remains, shows the 'no longer exists' notice", () => {
    const { fromPage } = connected(A);
    actions.select(A.id, "n1", ["n1"], false);
    actions.select(A.id, "n2", ["n2"], true);
    fromPage({ type: "gone", ids: ["n1"] });
    expect(store.get().selection?.ids).toEqual(["n2"]);
    expect(store.get().goneNotice).toBe(false);
    fromPage({ type: "gone", ids: ["n2"] });
    expect(store.get().selection).toBeNull();
    expect(store.get().goneNotice).toBe(true);
    actions.select(A.id, "n5", ["n5"], false);
    expect(store.get().goneNotice).toBe(false);
  });

  it("a gone hovered element clears the hover", () => {
    const { fromPage } = connected(A);
    actions.setHover({ screenId: A.id, id: "n1", path: ["n1"] });
    fromPage({ type: "gone", ids: ["n1"] });
    expect(store.get().hover).toBeNull();
  });
});

describe("navigation (R3.8)", () => {
  it("bye clears that preview's selection, hover and tree; the new page gets a fresh tree", () => {
    const { conn, fromPage } = connected(A);
    connected(B);
    actions.select(A.id, "n1", ["n1"], false);
    actions.setHover({ screenId: A.id, id: "n1", path: ["n1"] });
    fromPage({ type: "bye" });
    expect(store.get().selection).toBeNull();
    expect(store.get().hover).toBeNull();
    expect(store.get().trees[A.id]).toBeUndefined();
    expect(store.get().previews[A.id].status).toBe("connecting");
    conn.receive({ figr: 1, type: "ready", docId: "doc-next" });
    expect(store.get().trees[A.id].docId).toBe("doc-next");
    expect(store.get().activeId).toBe(A.id);
  });

  it("another preview's selection is untouched", () => {
    connected(A);
    const b = connected(B);
    actions.select(A.id, "n1", ["n1"], false);
    b.fromPage({ type: "bye" });
    expect(store.get().selection?.ids).toEqual(["n1"]);
  });
});

describe("watching (outlines stay glued)", () => {
  it("tells the page to report boxes for hover + selection and live values for the selection", () => {
    const { sent } = connected(A);
    actions.select(A.id, "n1", ["n1"], false);
    actions.setHover({ screenId: A.id, id: "n2", path: ["n2"] });
    expect(sent().filter((m) => m.type === "watch").at(-1)).toMatchObject({ rects: ["n1", "n2"], live: ["n1"] });
  });

  it("stores boxes and live values pushed by the page", () => {
    const { fromPage } = connected(A);
    const box = { x: 1, y: 2, w: 3, h: 4, clip: null, name: "x" };
    fromPage({ type: "rects", rects: { n1: box } });
    expect(store.get().rects[A.id].n1).toEqual(box);
  });

  it("keeps the last 5 page errors for the badge, without reporting them", () => {
    const { fromPage } = connected(A);
    for (let i = 0; i < 7; i++) fromPage({ type: "pageError", message: `e${i}` });
    expect(store.get().previews[A.id].pageErrors).toEqual(["e2", "e3", "e4", "e5", "e6"]);
    expect(report).not.toHaveBeenCalled();
  });
});

describe("mode and camera (R1)", () => {
  it("switching mode clears hover and tells every page", () => {
    const a = connected(A);
    actions.setHover({ screenId: A.id, id: "n1", path: ["n1"] });
    actions.setMode("interact");
    expect(store.get().hover).toBeNull();
    expect(a.sent().at(-1)).toMatchObject({ type: "mode", mode: "interact" });
  });

  it("zoom stays within 25%..400%", () => {
    for (let i = 0; i < 50; i++) actions.zoomAt(0, 0, -50);
    expect(store.get().camera.zoom).toBe(MAX_ZOOM);
    for (let i = 0; i < 80; i++) actions.zoomAt(0, 0, 50);
    expect(store.get().camera.zoom).toBe(MIN_ZOOM);
  });

  it("zoom keeps the board point under the pointer fixed", () => {
    store.set({ camera: { x: 100, y: 50, zoom: 1 } });
    const px = 400;
    const py = 300;
    const before = { x: (px - 100) / 1, y: (py - 50) / 1 };
    actions.zoomAt(px, py, -30);
    const c = store.get().camera;
    expect((px - c.x) / c.zoom).toBeCloseTo(before.x);
    expect((py - c.y) / c.zoom).toBeCloseTo(before.y);
  });

  it("pan and zoom clear the hover", () => {
    actions.setHover({ screenId: A.id, id: "n1", path: ["n1"] });
    actions.panBy(10, 10);
    expect(store.get().hover).toBeNull();
    actions.setHover({ screenId: A.id, id: "n1", path: ["n1"] });
    actions.zoomAt(0, 0, 10);
    expect(store.get().hover).toBeNull();
  });
});

describe("layers loading (R4.3)", () => {
  function withRoot() {
    const c = connected(A);
    actions.setActive(A.id);
    actions.loadRoot(A.id, vi.fn());
    c.fromPage({ type: "res", reqId: c.lastRequest("children").reqId, data: [{ id: "n1", name: "main", tag: "main", key: null, hasChildren: true }] });
    return c;
  }
  const kids = [
    { id: "n2", name: "a", tag: "div", key: null, hasChildren: false },
    { id: "n3", name: "b", tag: "div", key: null, hasChildren: false },
  ];

  it("loads children on first expand, showing a loading state", async () => {
    const { fromPage, lastRequest } = withRoot();
    await vi.runAllTimersAsync();
    expect(store.get().trees[A.id].root).toEqual(["n1"]);
    actions.toggleRow(A.id, "n1");
    expect(store.get().trees[A.id].rows.n1.status).toBe("loading");
    fromPage({ type: "res", reqId: lastRequest("children").reqId, data: kids });
    await vi.runAllTimersAsync();
    expect(store.get().trees[A.id].nodes.n1.children).toEqual(["n2", "n3"]);
    expect(store.get().trees[A.id].rows.n1).toBeUndefined();
  });

  it("collapse + re-expand while loading never duplicates, and the cancel isn't reported", async () => {
    const { fromPage, sent } = withRoot();
    await vi.runAllTimersAsync();
    actions.toggleRow(A.id, "n1");
    const first = sent().filter((m) => m.type === "children").at(-1);
    actions.toggleRow(A.id, "n1"); // collapse while loading
    actions.toggleRow(A.id, "n1"); // expand again
    const second = sent().filter((m) => m.type === "children").at(-1);
    expect(second.reqId).not.toBe(first.reqId);
    fromPage({ type: "res", reqId: first.reqId, data: kids }); // stale answer: dropped
    fromPage({ type: "res", reqId: second.reqId, data: kids });
    await vi.runAllTimersAsync();
    expect(store.get().trees[A.id].nodes.n1.children).toEqual(["n2", "n3"]);
    expect(report).not.toHaveBeenCalled();
  });

  it("a row that doesn't load in 3s shows an error on that row and is reported once", async () => {
    withRoot();
    await vi.runAllTimersAsync();
    actions.toggleRow(A.id, "n1");
    await vi.advanceTimersByTimeAsync(ROW_TIMEOUT);
    expect(store.get().trees[A.id].rows.n1.status).toBe("error");
    expect(report).toHaveBeenCalledTimes(1);
    expect(vi.mocked(report).mock.calls[0][1]).toEqual({ region: "layers-row", screenId: A.id });
  });

  it("a retry that fails again is a new report", async () => {
    withRoot();
    await vi.runAllTimersAsync();
    actions.toggleRow(A.id, "n1");
    await vi.advanceTimersByTimeAsync(ROW_TIMEOUT);
    actions.loadChildren(A.id, "n1");
    await vi.advanceTimersByTimeAsync(ROW_TIMEOUT);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("an answer that arrives after the page navigated changes nothing and reports nothing", async () => {
    const { fromPage, lastRequest, conn } = withRoot();
    await vi.runAllTimersAsync();
    actions.toggleRow(A.id, "n1");
    const req = lastRequest("children");
    fromPage({ type: "bye" });
    conn.receive({ figr: 1, type: "ready", docId: "doc-2" });
    conn.receive({ figr: 1, type: "res", docId: "doc-2", reqId: req.reqId, data: kids });
    await vi.advanceTimersByTimeAsync(ROW_TIMEOUT * 2);
    expect(store.get().trees[A.id].nodes.n1).toBeUndefined();
    expect(report).not.toHaveBeenCalled();
  });

  it("selecting a deep element expands every ancestor and loads them", () => {
    const { sent } = withRoot();
    actions.select(A.id, "n9", ["n1", "n5", "n7", "n9"], false);
    const t = store.get().trees[A.id];
    expect(t.expanded).toMatchObject({ n1: true, n5: true, n7: true });
    const loading = sent()
      .filter((m) => m.type === "children")
      .map((m) => m.id);
    expect(loading).toEqual(expect.arrayContaining(["n1", "n5", "n7"]));
  });

  it("page pushes of a parent's children update the tree", async () => {
    const { fromPage, lastRequest } = withRoot();
    await vi.runAllTimersAsync();
    actions.toggleRow(A.id, "n1");
    fromPage({ type: "res", reqId: lastRequest("children").reqId, data: kids });
    await vi.runAllTimersAsync();
    fromPage({ type: "children", id: "n1", children: [kids[1]] });
    expect(store.get().trees[A.id].nodes.n1.children).toEqual(["n3"]);
    expect(store.get().trees[A.id].nodes.n2).toBeUndefined();
  });
});

describe("search (R4.11)", () => {
  it("clearing the search restores the expanded state from before", async () => {
    const c = connected(A);
    actions.loadRoot(A.id, vi.fn());
    c.fromPage({ type: "res", reqId: c.lastRequest("children").reqId, data: [{ id: "n1", name: "main", tag: "main", key: null, hasChildren: true }] });
    await vi.runAllTimersAsync();
    actions.toggleRow(A.id, "n1");
    const before = store.get().trees[A.id].expanded;
    actions.setSearch(A.id, "level");
    await vi.advanceTimersByTimeAsync(200);
    const req = c.lastRequest("search");
    expect(req.query).toBe("level");
    c.fromPage({
      type: "res",
      reqId: req.reqId,
      data: { results: [[{ id: "n1", name: "main", tag: "main", key: null, hasChildren: true }, { id: "n8", name: "Level 9", tag: "div", key: null, hasChildren: false }]], truncated: false },
    });
    await vi.runAllTimersAsync();
    expect(store.get().trees[A.id].search?.root).toEqual(["n1"]);
    // Selecting a result keeps the search open and doesn't touch the normal tree.
    actions.clickRow(A.id, "n8", false);
    expect(store.get().trees[A.id].search?.query).toBe("level");
    actions.setSearch(A.id, "");
    expect(store.get().trees[A.id].search).toBeNull();
    expect(store.get().trees[A.id].expanded).toEqual(before);
  });

  it("a search the page doesn't answer shows an error on the search line, reported once; Retry runs it again", async () => {
    const c = connected(A);
    actions.loadRoot(A.id, vi.fn());
    c.fromPage({ type: "res", reqId: c.lastRequest("children").reqId, data: [] });
    await vi.runAllTimersAsync();
    actions.setSearch(A.id, "x");
    await vi.advanceTimersByTimeAsync(120 + ROW_TIMEOUT);
    expect(store.get().trees[A.id].search?.status).toBe("error");
    expect(report).toHaveBeenCalledTimes(1);
    expect(vi.mocked(report).mock.calls[0][1]).toEqual({ region: "layers", screenId: A.id });
    // Page changes don't re-run a failed search on their own (no report storm).
    c.fromPage({ type: "dirty" });
    await vi.advanceTimersByTimeAsync(300);
    expect(c.sent().filter((m) => m.type === "search")).toHaveLength(1);

    actions.retrySearch(A.id);
    expect(store.get().trees[A.id].search?.status).toBe("loading");
    await vi.advanceTimersByTimeAsync(0);
    const req = c.lastRequest("search");
    c.fromPage({ type: "res", reqId: req.reqId, data: { results: [], truncated: false } });
    await vi.runAllTimersAsync();
    expect(store.get().trees[A.id].search?.status).toBe("ready");
  });

  it("the top level failing goes to the panel's region handler", async () => {
    connected(A);
    const onError = vi.fn();
    actions.loadRoot(A.id, onError);
    await vi.advanceTimersByTimeAsync(ROW_TIMEOUT);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
