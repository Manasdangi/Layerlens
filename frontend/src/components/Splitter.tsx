// Resizable side panels: a thin handle between a panel and the board. Drag it,
// or focus it and use ← / →; double-click or Enter resets the width.
import type { KeyboardEvent, PointerEvent } from "react";
import { PANEL_MAX, PANEL_MIN } from "./panelWidth";

const KEY_STEP = 16;

interface Props {
  /** Which panel it resizes: the one on its left (Layers) or on its right (Inspector). */
  panel: "left" | "right";
  label: string;
  width: number;
  initial: number;
  setWidth(width: number): void;
}

export function Splitter({ panel, label, width, initial, setWidth }: Props) {
  // Dragging right widens a left panel and narrows a right one.
  const sign = panel === "left" ? 1 : -1;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Pointer capture keeps the drag going while the pointer crosses a preview iframe.
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = width;
    const el = e.currentTarget;
    document.body.classList.add("resizing");
    const move = (ev: globalThis.PointerEvent) => setWidth(startWidth + sign * (ev.clientX - startX));
    const end = () => {
      document.body.classList.remove("resizing");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setWidth(width + sign * (e.key === "ArrowRight" ? KEY_STEP : -KEY_STEP));
    } else if (e.key === "Enter") {
      e.preventDefault();
      setWidth(initial);
    }
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setWidth(initial)}
      onKeyDown={onKeyDown}
    />
  );
}
