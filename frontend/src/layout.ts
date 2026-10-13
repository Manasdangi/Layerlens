// Board geometry, in board ("world") pixels.
export const PREVIEW_W = 1280;
export const PREVIEW_H = 800;
export const COLUMNS = 4;
export const GAP_X = 160;
export const GAP_Y = 200;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export function previewOrigin(index: number) {
  return {
    x: (index % COLUMNS) * (PREVIEW_W + GAP_X),
    y: Math.floor(index / COLUMNS) * (PREVIEW_H + GAP_Y),
  };
}

export function boardSize(count: number) {
  const cols = Math.min(COLUMNS, count);
  const rows = Math.ceil(count / COLUMNS);
  return {
    w: cols * PREVIEW_W + (cols - 1) * GAP_X,
    h: rows * PREVIEW_H + (rows - 1) * GAP_Y,
  };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
