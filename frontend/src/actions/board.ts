// The board: screens, mode, and the camera (pan and zoom).
import { MAX_ZOOM, MIN_ZOOM, boardSize, clamp, previewOrigin } from "../layout";
import type { Mode } from "../protocol";
import { store, type Screen } from "../state";
import { connections } from "./pages";

export function setScreens(screens: Screen[]) {
  store.set({ screens });
}

export function setMode(mode: Mode) {
  if (store.get().mode === mode) return;
  store.set({ mode, hover: null });
  connections.forEach((c) => c.send({ type: "mode", mode }));
}

export function panBy(dx: number, dy: number) {
  store.set((s) => ({ camera: { ...s.camera, x: s.camera.x - dx, y: s.camera.y - dy }, hover: null }));
}

/** Zooms keeping the board point under (px, py) fixed; coordinates relative to the board viewport. */
export function zoomAt(px: number, py: number, deltaY: number) {
  store.set((s) => {
    const c = s.camera;
    const zoom = clamp(c.zoom * Math.exp(-clamp(deltaY, -50, 50) * 0.01), MIN_ZOOM, MAX_ZOOM);
    const k = zoom / c.zoom;
    return { camera: { zoom, x: px - (px - c.x) * k, y: py - (py - c.y) * k }, hover: null };
  });
}

/** Ctrl/Cmd + wheel inside a page (Interact mode): (x, y) is in that page's pixels. */
export function zoomFromPage(screenId: string, x: number, y: number, dy: number) {
  const { screens, camera } = store.get();
  const index = screens.findIndex((s) => s.id === screenId);
  if (index < 0) return;
  const o = previewOrigin(index);
  zoomAt(camera.x + (o.x + x) * camera.zoom, camera.y + (o.y + y) * camera.zoom, dy);
}

export function fitBoard(viewW: number, count: number) {
  const size = boardSize(count);
  const zoom = clamp(Math.min((viewW - 96) / size.w, 1), MIN_ZOOM, MAX_ZOOM);
  store.set({ camera: { zoom, x: Math.max(48, (viewW - size.w * zoom) / 2), y: 64 } });
}
