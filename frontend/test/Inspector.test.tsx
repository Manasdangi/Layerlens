// R5: the inspector's Live and Details sections.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/report", () => ({ report: vi.fn() }));

import { Inspector } from "../src/components/Inspector";
import type { LiveProps } from "../src/protocol";
import { report } from "../src/report";
import { store } from "../src/state";

const initial = store.get();

const live = (over: Partial<LiveProps> = {}): LiveProps => ({
  name: "Get started",
  tag: "button",
  id: "",
  classes: ["primary"],
  key: "cta-primary",
  width: 120,
  height: 44,
  x: 48,
  y: 300,
  text: "Get started",
  color: "rgb(250, 247, 242)",
  background: "rgb(29, 29, 31)",
  fontFamily: "Georgia, serif",
  fontSize: "16px",
  fontWeight: "400",
  ...over,
});

function selectLive(items: Record<string, LiveProps>) {
  act(() => {
    store.set({
      selection: { screenId: "scr-01", ids: Object.keys(items) },
      live: { "scr-01": items },
    });
  });
}

const field = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;

type Pending = { key: string; resolve: (r: Response) => void; signal: AbortSignal };
let pending: Pending[] = [];

beforeEach(() => {
  store.set(initial);
  pending = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const key = decodeURIComponent(new URL(url).pathname.split("/").pop()!);
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          pending.push({ key, resolve, signal: init.signal! });
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(report).mockClear();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const details = { component: "Button", description: "Primary CTA", status: "stable", owner: "Growth" };

describe("Inspector", () => {
  it("prompts when nothing is selected", () => {
    render(<Inspector />);
    expect(screen.getByText("Select an element to inspect it")).toBeTruthy();
  });

  it("says 'This element no longer exists' after the selection disappeared", () => {
    render(<Inspector />);
    act(() => store.set({ goneNotice: true }));
    expect(screen.getByText("This element no longer exists")).toBeTruthy();
  });

  it("shows every Live field for one element, and updates when values change", () => {
    render(<Inspector />);
    selectLive({ n1: live() });
    expect(field("Name")).toBe("Get started");
    expect(field("Tag")).toBe("button");
    expect(field("Classes")).toBe("primary");
    expect(field("Size")).toBe("120 × 44");
    expect(field("Position")).toBe("48, 300");
    expect(field("Text")).toBe("Get started");
    expect(field("Font family")).toBe("Georgia, serif");
    expect(field("Font size")).toBe("16px");
    expect(field("Font weight")).toBe("400");
    selectLive({ n1: live({ width: 200 }) });
    expect(field("Size")).toBe("200 × 44");
  });

  it("loads Details for an element with a data-key", async () => {
    render(<Inspector />);
    selectLive({ n1: live() });
    expect(screen.getByText("Loading details…")).toBeTruthy();
    await act(async () => pending[0].resolve(json(200, details)));
    expect(field("Component")).toBe("Button");
    expect(field("Owner")).toBe("Growth");
  });

  it("'No details' without a data-key, and 'No details for this element' on 404 (not an error)", async () => {
    render(<Inspector />);
    selectLive({ n1: live({ key: null }) });
    expect(screen.getByText("No details")).toBeTruthy();
    selectLive({ n2: live({ key: "cta-crash" }) });
    await act(async () => pending.at(-1)!.resolve(json(404, { error: "Not found" })));
    expect(screen.getByText("No details for this element")).toBeTruthy();
    expect(report).not.toHaveBeenCalled();
  });

  it("a failed Details request shows an error in Details only; Live still shows; reported once", async () => {
    render(<Inspector />);
    selectLive({ n1: live() });
    await act(async () => pending[0].resolve(json(500, {})));
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load details");
    expect(field("Name")).toBe("Get started");
    expect(report).toHaveBeenCalledTimes(1);
    expect(vi.mocked(report).mock.calls[0][1]).toEqual({ region: "details", screenId: "scr-01", elementKey: "cta-primary" });
  });

  it("only the latest selection's details are ever shown; the replaced request isn't a failure", async () => {
    render(<Inspector />);
    selectLive({ n1: live({ key: "cta-primary" }) });
    selectLive({ n2: live({ key: "feature-sync", name: "Feature" }) });
    expect(pending[0].signal.aborted).toBe(true);
    await act(async () => pending[1].resolve(json(200, { ...details, component: "FeatureCard" })));
    expect(field("Component")).toBe("FeatureCard");
    expect(report).not.toHaveBeenCalled();
  });

  it("several elements: 'N elements', shared value or 'Mixed', no Details", () => {
    render(<Inspector />);
    selectLive({ n1: live(), n2: live({ name: "Other", width: 99 }) });
    expect(screen.getByText("2 elements")).toBeTruthy();
    expect(field("Name")).toBe("Mixed");
    expect(field("Size")).toBe("Mixed");
    expect(field("Tag")).toBe("button");
    expect(screen.queryByText("Details")).toBeNull();
  });

  it("a render error shows the inspector error only", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Inspector />);
    act(() => store.set((s) => ({ dev: { ...s.dev, inspectorThrow: true } })));
    expect(screen.getByRole("alert").textContent).toContain("The inspector hit an error");
    expect(report).toHaveBeenCalledTimes(1);
  });
});
