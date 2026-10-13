// R6: a failure shows an error with Retry in its region only, and is reported
// exactly once wherever it was thrown. Cancellations and late errors do nothing.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/report", () => ({ report: vi.fn() }));

import { Region } from "../src/components/Region";
import { useRegion, type RegionApi } from "../src/components/regionApi";
import { Cancelled } from "../src/connection";
import { report } from "../src/report";

afterEach(() => {
  cleanup();
  vi.mocked(report).mockClear();
});

let api: RegionApi;
function Grab() {
  const a = useRegion();
  useLayoutEffect(() => {
    api = a;
  });
  return <p>content</p>;
}

let shouldThrow = true;
function Thrower() {
  if (shouldThrow) throw new Error("render boom");
  return <p>recovered</p>;
}

describe("Region", () => {
  it("a render error shows the region error with Retry, reported once with its context", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    shouldThrow = true;
    render(
      <Region name="inspector" screenId="scr-01">
        <Thrower />
      </Region>,
    );
    expect(screen.getByRole("alert").textContent).toContain("The inspector hit an error");
    expect(report).toHaveBeenCalledTimes(1);
    expect(vi.mocked(report).mock.calls[0][1]).toEqual({ region: "inspector", screenId: "scr-01" });

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("recovered")).toBeTruthy();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("a retry that fails again is a new report", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    shouldThrow = true;
    render(
      <Region name="board" screenId={null}>
        <Thrower />
      </Region>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("only the failing region shows the error; a sibling keeps working", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    shouldThrow = true;
    render(
      <>
        <Region name="inspector" screenId={null}>
          <Thrower />
        </Region>
        <Region name="layers" screenId="scr-01">
          <p>layers ok</p>
        </Region>
      </>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText("layers ok")).toBeTruthy();
  });

  it("raise() and errors in guarded handlers / timers land in the region, reported once", () => {
    render(
      <Region name="details" screenId="scr-01" elementKey="cta-primary">
        <Grab />
      </Region>,
    );
    const handler = api.guard(() => {
      throw new Error("in a handler");
    });
    act(() => {
      handler();
      handler(); // already failed: not reported again
      api.raise(new Error("and again"));
    });
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load details");
    expect(report).toHaveBeenCalledTimes(1);
    expect(vi.mocked(report).mock.calls[0][1]).toEqual({ region: "details", screenId: "scr-01", elementKey: "cta-primary" });
  });

  it("cancellations and aborts are not failures", () => {
    render(
      <Region name="layers" screenId="scr-01">
        <Grab />
      </Region>,
    );
    act(() => {
      api.raise(new Cancelled());
      api.raise(new DOMException("aborted", "AbortError"));
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it("an error that arrives after the region is gone changes nothing and reports nothing", () => {
    const { unmount } = render(
      <Region name="preview" screenId="scr-01">
        <Grab />
      </Region>,
    );
    const stale = api;
    unmount();
    stale.raise(new Error("late"));
    expect(report).not.toHaveBeenCalled();
  });

  it("an error from before a retry is ignored after it", () => {
    render(
      <Region name="preview" screenId="scr-01">
        <Grab />
      </Region>,
    );
    const old = api;
    act(() => old.raise(new Error("first")));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    act(() => old.raise(new Error("late answer from the first attempt")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("works for errors raised from an effect", () => {
    function Effect() {
      const { raise } = useRegion();
      useEffect(() => raise(new Error("effect")), [raise]);
      return null;
    }
    render(
      <Region name="layers" screenId="scr-01">
        <Effect />
      </Region>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(report).toHaveBeenCalledTimes(1);
  });
});
