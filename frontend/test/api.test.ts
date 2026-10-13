// R5 / R6: the API client validates responses; a 404 is "no details", not an error.
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, fetchDetails, fetchScreens } from "../src/api";
import { store } from "../src/state";

function mockFetch(status: number, body: string) {
  const fn = vi.fn(async (_url: string) => new Response(body, { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const signal = () => new AbortController().signal;

afterEach(() => {
  vi.unstubAllGlobals();
  store.set((s) => ({ dev: { ...s.dev, latency: 0, screensFail: false, detailsFail: false } }));
});

describe("fetchScreens", () => {
  it("returns the validated list", async () => {
    mockFetch(200, JSON.stringify([{ id: "s1", name: "One", url: "http://localhost:4001/page-1.html" }]));
    await expect(fetchScreens(signal())).resolves.toEqual([{ id: "s1", name: "One", url: "http://localhost:4001/page-1.html" }]);
  });

  it("throws on a 5xx", async () => {
    mockFetch(503, "{}");
    await expect(fetchScreens(signal())).rejects.toBeInstanceOf(HttpError);
  });

  it("throws on a malformed body (truncated JSON)", async () => {
    mockFetch(200, '{"component": "Butt');
    await expect(fetchScreens(signal())).rejects.toThrow();
  });

  it("throws on the wrong shape", async () => {
    mockFetch(200, JSON.stringify([{ id: 1 }]));
    await expect(fetchScreens(signal())).rejects.toThrow(/malformed/);
  });

  it("passes the dev latency and fail params", async () => {
    const fn = mockFetch(200, "[]");
    store.set((s) => ({ dev: { ...s.dev, latency: 500, screensFail: true } }));
    await fetchScreens(signal());
    const url = new URL(fn.mock.calls[0][0]);
    expect(url.searchParams.get("latency")).toBe("500");
    expect(url.searchParams.get("fail")).toBe("1");
  });
});

describe("fetchDetails", () => {
  const details = { component: "Button", description: "d", status: "stable", owner: "Growth" };

  it("returns details", async () => {
    mockFetch(200, JSON.stringify(details));
    await expect(fetchDetails("cta-primary", signal())).resolves.toEqual(details);
  });

  it("returns null on 404 (not an error)", async () => {
    mockFetch(404, JSON.stringify({ error: "Not found" }));
    await expect(fetchDetails("nope", signal())).resolves.toBeNull();
  });

  it("throws on a 500", async () => {
    mockFetch(500, "{}");
    await expect(fetchDetails("k", signal())).rejects.toBeInstanceOf(HttpError);
  });

  it("throws on bad data", async () => {
    mockFetch(200, JSON.stringify({ component: "Button" }));
    await expect(fetchDetails("k", signal())).rejects.toThrow(/malformed/);
  });

  it("encodes the key", async () => {
    const fn = mockFetch(200, JSON.stringify(details));
    await fetchDetails("a/b c", signal());
    expect(fn.mock.calls[0][0]).toContain("/elements/a%2Fb%20c");
  });
});
