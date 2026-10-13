import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { clearSelection, fitBoard, handleKey, panBy, setScreens, zoomAt } from "../actions";
import { fetchScreens } from "../api";
import { useStore, type Screen } from "../state";
import { Overlay } from "./Overlay";
import { Preview } from "./Preview";
import { Region } from "./Region";
import { useRegion } from "./regionApi";

export function Board() {
  return (
    <main className="board">
      <Region name="board" screenId={null} className="board-error">
        <BoardView />
      </Region>
    </main>
  );
}

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const ownsNavKeys = (t: EventTarget | null) =>
  !(t instanceof HTMLElement) || t === document.body || t.classList.contains("layers-list");

function BoardView() {
  const { raise, guard, run } = useRegion();
  const boardNonce = useStore((s) => s.dev.boardNonce);
  const timerNonce = useStore((s) => s.dev.boardTimerNonce);
  const camera = useStore((s) => s.camera);
  // Screens of the current board load: a "reload board" (new nonce) shows Loading again.
  const [loaded, setLoaded] = useState<{ nonce: number; list: Screen[] } | null>(null);
  const screens = loaded?.nonce === boardNonce ? loaded.list : null;
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // Load screens (again on dev "reload board").
  useEffect(() => {
    const ac = new AbortController();
    fetchScreens(ac.signal)
      .then(
        guard((list: Screen[]) => {
          setScreens(list);
          setLoaded({ nonce: boardNonce, list });
          fitBoard(viewportRef.current?.clientWidth ?? window.innerWidth, list.length);
        }),
      )
      .catch((error) => {
        if (!ac.signal.aborted) raise(error);
      });
    return () => ac.abort();
  }, [boardNonce, guard, raise]);

  // Dev fault: an error thrown in a timer lands in this region like any other.
  // One-shot: a retry remounts this component and must not throw again.
  const seenTimerNonce = useRef(timerNonce);
  useEffect(() => {
    if (timerNonce === seenTimerNonce.current) return;
    seenTimerNonce.current = timerNonce;
    window.setTimeout(
      guard(() => {
        throw new Error("Dev fault: thrown in a board timer");
      }),
      0,
    );
  }, [timerNonce, guard]);

  // Global shortcuts. Pages forward the same keys while they have focus.
  useEffect(() => {
    const onKey = guard((e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
      // Tab and Enter on a focused control (toolbar, panel buttons) keep their
      // usual meaning. They drive the selection only from the board or the layers list.
      if ((e.key === "Tab" || e.key === "Enter") && !ownsNavKeys(e.target)) return;
      if (handleKey(e.key, e.shiftKey)) e.preventDefault();
    });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guard]);

  // Wheel: Ctrl/Cmd zooms around the pointer, otherwise pans. Previews in Select
  // mode stop plain wheel events themselves (they scroll the page instead).
  useEffect(() => {
    const el = viewportRef.current!;
    const onWheel = guard((e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY * k);
      else panBy(e.deltaX * k, e.deltaY * k);
    });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [guard]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) =>
    run(() => {
      // Only empty board space pans: not a live preview, its error panel, or a control.
      if (e.button !== 0 || (e.target as Element).closest(".preview-frame, .region-error, button, input, .page-error")) return;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); // shortcuts go to the board
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, moved: false };
    });

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) =>
    run(() => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      if (!d.moved) setPanning(true);
      d.moved = true;
      d.x = e.clientX;
      d.y = e.clientY;
      panBy(-dx, -dy);
    });

  const onPointerUp = () =>
    run(() => {
      const d = drag.current;
      drag.current = null;
      setPanning(false);
      if (d && !d.moved) clearSelection(); // a click on empty board space
    });

  const worldStyle = {
    transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
    "--zoom": camera.zoom,
  } as CSSProperties;

  return (
    <div
      ref={viewportRef}
      className={`viewport${panning ? " panning" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="world" style={worldStyle}>
        {screens?.map((screen, i) => <Preview key={`${boardNonce}:${screen.id}`} screen={screen} index={i} />)}
      </div>
      <Overlay />
      {!screens && <div className="board-status">Loading screens…</div>}
    </div>
  );
}
