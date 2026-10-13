// Outlines and labels, drawn in screen space (outside the zoomed board), so
// borders stay 1px / 2px and labels keep their size at every zoom level. Each
// preview gets a frame that clips its outlines to the preview's edges.
import { PREVIEW_H, PREVIEW_W, previewOrigin } from "../layout";
import type { Box } from "../protocol";
import { useStore } from "../state";

const LABEL_H = 18;

type Kind = "hover" | "selected";

export function Overlay() {
  const mode = useStore((s) => s.mode);
  const camera = useStore((s) => s.camera);
  const hover = useStore((s) => s.hover);
  const selection = useStore((s) => s.selection);
  const rects = useStore((s) => s.rects);
  const screens = useStore((s) => s.screens);

  if (mode !== "select") return null; // selection is kept, just hidden

  const groups = new Map<string, { id: string; kind: Kind }[]>();
  const add = (screenId: string, id: string, kind: Kind) => {
    if (!groups.has(screenId)) groups.set(screenId, []);
    groups.get(screenId)!.push({ id, kind });
  };
  selection?.ids.forEach((id) => add(selection.screenId, id, "selected"));
  if (hover && !(selection?.screenId === hover.screenId && selection.ids.includes(hover.id))) add(hover.screenId, hover.id, "hover");

  const z = camera.zoom;
  return (
    <div className="overlay">
      {[...groups].map(([screenId, items]) => {
        const index = screens.findIndex((s) => s.id === screenId);
        if (index < 0) return null;
        const o = previewOrigin(index);
        return (
          <div
            key={screenId}
            className="ov-frame"
            style={{ left: camera.x + o.x * z, top: camera.y + o.y * z, width: PREVIEW_W * z, height: PREVIEW_H * z }}
          >
            {items.map(({ id, kind }) => {
              const box = rects[screenId]?.[id];
              return box ? <Outline key={`${kind}:${id}`} box={box} zoom={z} kind={kind} /> : null;
            })}
          </div>
        );
      })}
    </div>
  );
}

function Outline({ box, zoom, kind }: { box: Box; zoom: number; kind: Kind }) {
  if (!box.clip) return null; // scrolled fully out of view: no outline, still selected
  const c = { x: box.clip.x * zoom, y: box.clip.y * zoom, w: box.clip.w * zoom, h: box.clip.h * zoom };
  const e = { x: box.x * zoom, y: box.y * zoom, w: box.w * zoom, h: box.h * zoom };
  const frameH = PREVIEW_H * zoom;
  // Label above the visible part; below it when there's no room above; inside as a last resort.
  const labelTop = c.y >= LABEL_H ? c.y - LABEL_H : c.y + c.h + LABEL_H <= frameH ? c.y + c.h : c.y;
  return (
    <>
      <div className="ov-clip" style={{ left: c.x, top: c.y, width: c.w, height: c.h }}>
        <div className={`ov-box ${kind}`} style={{ left: e.x - c.x, top: e.y - c.y, width: e.w, height: e.h }} />
      </div>
      <div className={`ov-label ${kind}`} style={{ left: c.x, top: labelTop, height: LABEL_H }}>
        {box.name}
      </div>
    </>
  );
}
