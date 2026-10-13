// Host <-> page protocol: handshake, request timeouts, cancellation, stale page loads.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECT_TIMEOUT, Cancelled, ConnectError, Connection, TimeoutError } from "../src/connection";

const ORIGIN = "http://localhost:4001";

function setup() {
  const postMessage = vi.fn();
  const iframe = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
  const hooks = {
    getMode: vi.fn(() => "select" as const),
    onReady: vi.fn(),
    onLeave: vi.fn(),
    onMessage: vi.fn(),
    onError: vi.fn(),
  };
  const conn = new Connection("scr-01", ORIGIN, hooks);
  conn.attach(iframe);
  const fromPage = (msg: Record<string, unknown>) => conn.receive({ figr: 1, ...msg });
  const sent = () => postMessage.mock.calls.map((c) => c[0]);
  return { conn, hooks, postMessage, fromPage, sent };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("handshake", () => {
  it("answers hello with init (carrying the mode), to the page's origin only", () => {
    const { fromPage, postMessage } = setup();
    fromPage({ type: "hello", docId: "d1" });
    expect(postMessage).toHaveBeenCalledWith({ figr: 1, type: "init", mode: "select" }, ORIGIN);
  });

  it("becomes ready on the first ready, and ignores a repeated one", () => {
    const { conn, fromPage, hooks } = setup();
    fromPage({ type: "ready", docId: "d1" });
    fromPage({ type: "ready", docId: "d1" });
    expect(conn.docId).toBe("d1");
    expect(hooks.onReady).toHaveBeenCalledTimes(1);
  });

  it("fails with ConnectError if the page never says ready within 10s", () => {
    const { hooks } = setup();
    vi.advanceTimersByTime(CONNECT_TIMEOUT);
    expect(hooks.onError).toHaveBeenCalledTimes(1);
    expect(hooks.onError.mock.calls[0][0]).toBeInstanceOf(ConnectError);
  });

  it("does not time out once ready", () => {
    const { fromPage, hooks } = setup();
    fromPage({ type: "ready", docId: "d1" });
    vi.advanceTimersByTime(CONNECT_TIMEOUT * 2);
    expect(hooks.onError).not.toHaveBeenCalled();
  });

  it("only owns messages from its own iframe and origin", () => {
    const { conn } = setup();
    const win = (conn as unknown as { iframe: HTMLIFrameElement }).iframe.contentWindow;
    expect(conn.owns({ source: win, origin: ORIGIN } as MessageEvent)).toBe(true);
    expect(conn.owns({ source: win, origin: "http://evil.test" } as MessageEvent)).toBe(false);
    expect(conn.owns({ source: {}, origin: ORIGIN } as MessageEvent)).toBe(false);
  });
});

describe("requests", () => {
  function ready() {
    const s = setup();
    s.fromPage({ type: "ready", docId: "d1" });
    return s;
  }

  it("resolves with the page's answer", async () => {
    const { conn, fromPage, sent } = ready();
    const req = conn.request<string[]>("children", { id: null }, 3000);
    const { reqId } = sent().at(-1);
    fromPage({ type: "res", docId: "d1", reqId, data: ["n1"] });
    await expect(req.promise).resolves.toEqual(["n1"]);
  });

  it("rejects with TimeoutError when the page doesn't answer in time, and drops a late answer", async () => {
    const { conn, fromPage, sent } = ready();
    const req = conn.request("children", { id: null }, 3000);
    const { reqId } = sent().at(-1);
    vi.advanceTimersByTime(3000);
    await expect(req.promise).rejects.toBeInstanceOf(TimeoutError);
    expect(() => fromPage({ type: "res", docId: "d1", reqId, data: [] })).not.toThrow();
  });

  it("rejects with Cancelled when cancelled (the user moved on)", async () => {
    const { conn } = ready();
    const req = conn.request("children", { id: null }, 3000);
    req.cancel();
    await expect(req.promise).rejects.toBeInstanceOf(Cancelled);
  });

  it("rejects with Cancelled before the page is ready", async () => {
    const { conn } = setup();
    await expect(conn.request("hit", { x: 0, y: 0 }, 1000).promise).rejects.toBeInstanceOf(Cancelled);
  });

  it("treats a page error answer as an error, and 'gone' as a cancellation", async () => {
    const { conn, fromPage, sent } = ready();
    const a = conn.request("children", { id: "n1" }, 3000);
    fromPage({ type: "res", docId: "d1", reqId: sent().at(-1).reqId, error: "boom" });
    await expect(a.promise).rejects.toThrow("boom");
    const b = conn.request("children", { id: "n1" }, 3000);
    fromPage({ type: "res", docId: "d1", reqId: sent().at(-1).reqId, error: "gone" });
    await expect(b.promise).rejects.toBeInstanceOf(Cancelled);
  });
});

describe("navigation and replaced pages", () => {
  it("bye cancels pending requests, leaves, and re-arms the connect timeout", async () => {
    const { conn, fromPage, hooks } = setup();
    fromPage({ type: "ready", docId: "d1" });
    const req = conn.request("children", { id: null }, 3000);
    fromPage({ type: "bye", docId: "d1" });
    await expect(req.promise).rejects.toBeInstanceOf(Cancelled);
    expect(conn.docId).toBeNull();
    expect(hooks.onLeave).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CONNECT_TIMEOUT);
    expect(hooks.onError.mock.calls[0][0]).toBeInstanceOf(ConnectError);
  });

  it("a new page's ready cancels requests to the old one", async () => {
    const { conn, fromPage, hooks } = setup();
    fromPage({ type: "ready", docId: "d1" });
    const req = conn.request("children", { id: null }, 3000);
    fromPage({ type: "ready", docId: "d2" });
    await expect(req.promise).rejects.toBeInstanceOf(Cancelled);
    expect(conn.docId).toBe("d2");
    expect(hooks.onReady).toHaveBeenCalledTimes(2);
  });

  it("ignores messages from an old page load", () => {
    const { fromPage, hooks } = setup();
    fromPage({ type: "ready", docId: "d2" });
    fromPage({ type: "rects", docId: "d1", rects: {} });
    expect(hooks.onMessage).not.toHaveBeenCalled();
    fromPage({ type: "rects", docId: "d2", rects: {} });
    expect(hooks.onMessage).toHaveBeenCalledTimes(1);
  });

  it("ignores junk", () => {
    const { conn, hooks } = setup();
    for (const junk of [null, 42, "x", {}, { figr: 2, type: "ready", docId: "d" }, { figr: 1, type: "ready" }]) conn.receive(junk);
    expect(hooks.onReady).not.toHaveBeenCalled();
    expect(hooks.onError).not.toHaveBeenCalled();
  });
});

describe("errors", () => {
  it("an error thrown while handling a message goes to onError", () => {
    const { conn, fromPage, hooks } = setup();
    fromPage({ type: "ready", docId: "d1" });
    hooks.onMessage.mockImplementation(() => {
      throw new Error("handler blew up");
    });
    fromPage({ type: "rects", docId: "d1", rects: {} });
    expect(hooks.onError).toHaveBeenCalledTimes(1);
    expect(conn.docId).toBe("d1");
  });

  it("fail() raises in the preview's region", () => {
    const { conn, hooks } = setup();
    const err = new Error("x");
    conn.fail(err);
    expect(hooks.onError).toHaveBeenCalledWith(err);
  });

  it("destroy cancels everything and stops the connect timer", async () => {
    const { conn, fromPage, hooks } = setup();
    fromPage({ type: "ready", docId: "d1" });
    const req = conn.request("children", { id: null }, 3000);
    conn.destroy();
    await expect(req.promise).rejects.toBeInstanceOf(Cancelled);
    vi.advanceTimersByTime(CONNECT_TIMEOUT * 2);
    expect(hooks.onError).not.toHaveBeenCalled();
  });
});
