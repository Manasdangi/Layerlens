// Width of a resizable side panel (see Splitter.tsx), kept between the limits.
import { useState } from "react";

export const PANEL_MIN = 200;
export const PANEL_MAX = 480;

const clampWidth = (w: number) => Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, w)));

export function usePanelWidth(initial: number) {
  const [width, setWidth] = useState(initial);
  return { width, initial, setWidth: (w: number) => setWidth(clampWidth(w)) };
}
