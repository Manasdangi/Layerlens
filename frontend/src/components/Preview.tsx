import { memo, useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import { clearHover, connect, connections, disconnect, hoverFromHit, selectFromHit, setActive } from "../actions";
import { ConnectError, HIT_TIMEOUT, type Connection } from "../connection";
import { PREVIEW_H, PREVIEW_W, previewOrigin } from "../layout";
import type { HitResult } from "../protocol";
import { store, useStore, type Screen } from "../state";
import { Region } from "./Region";
import { useRegion } from "./regionApi";

export const Preview = memo(function Preview({ screen, index }: { screen: Screen; index: number }) {
  const o = previewOrigin(index);
  return (
    <div className="preview" style={{ left: o.x, top: o.y, width: PREVIEW_W, height: PREVIEW_H }}>
      <PreviewTitle screen={screen} />
      <Region
        name="preview"
        screenId={screen.id}
        className="preview-error"
        message={(e) => (e instanceof ConnectError ? "Couldn't connect to this preview" : "This preview hit an error")}
      >
        <PreviewFrame screen={screen} />
      </Region>
    </div>
  );
});

function PreviewTitle({ screen }: { screen: Screen }) {
  const errors = useStore((s) => s.previews[screen.id]?.pageErrors);
  const active = useStore((s) => s.activeId === screen.id);
  return (
    <div className={`preview-title${active ? " active" : ""}`}>
      <span>{screen.name}</span>
      {errors && errors.length > 0 && (
        <span className="page-error" tabIndex={0}>
          Page error{errors.length > 1 ? ` (${errors.length})` : ""}
          <span className="page-error-tip">{errors.join("\n")}</span>
        </span>
      )}
    </div>
  );
}

function withParam(url: string, key: string, value: string) {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

/** Pointer position in page pixels. */
function toPage(frame: HTMLElement, e: { clientX: number; clientY: number }) {
  const r = frame.getBoundingClientRect();
  const zoom = store.get().camera.zoom;
  return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
}

function PreviewFrame({ screen }: { screen: Screen }) {
  const { raise, guard, run } = useRegion();
  const mode = useStore((s) => s.mode);
  const status = useStore((s) => s.previews[screen.id]?.status);
  const silent = useStore((s) => !!s.dev.silent[screen.id]);
  const frameRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<Connection | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hoverSeq = useRef(0);
  const src = silent ? withParam(screen.url, "figr_silent", "1") : screen.url;

  useEffect(() => {
    const conn = connect(screen, raise);
    conn.attach(iframeRef.current!);
    connRef.current = conn;
    return () => {
      disconnect(conn);
      connRef.current = null;
    };
  }, [screen, src, raise]);

  // A newer hover makes an older answer stale: it's dropped. But a page that
  // doesn't answer at all is this preview's failure (cancellations are ignored).
  const hoverAt = useCallback(
    (p: { x: number; y: number }) => {
      const conn = connRef.current;
      if (!conn?.docId) return;
      const seq = ++hoverSeq.current;
      conn
        .request<HitResult | null>("hit", p, HIT_TIMEOUT)
        .promise.then(
          guard((hit: HitResult | null) => {
            if (seq === hoverSeq.current && pointer.current) hoverFromHit(screen.id, hit);
          }),
        )
        .catch(raise);
    },
    [guard, raise, screen.id],
  );

  // Select mode: plain wheel scrolls the page under the pointer; Ctrl/Cmd + wheel
  // is left to bubble up so the board zooms.
  useEffect(() => {
    const el = captureRef.current;
    if (!el) return;
    let rehover = 0;
    const onWheel = guard((e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const conn = connRef.current;
      if (!conn?.docId) return;
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? PREVIEW_H : 1;
      conn.send({ type: "wheel", ...toPage(frameRef.current!, e), dx: e.deltaX * k, dy: e.deltaY * k });
      clearTimeout(rehover);
      rehover = window.setTimeout(() => pointer.current && hoverAt(pointer.current), 50);
    });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      clearTimeout(rehover);
      el.removeEventListener("wheel", onWheel);
    };
  }, [mode, guard, hoverAt]);

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) =>
    run(() => {
      pointer.current = toPage(frameRef.current!, e);
      hoverAt(pointer.current);
    });

  const onPointerLeave = () => {
    pointer.current = null;
    hoverSeq.current++;
    clearHover(screen.id);
  };

  // No text selection in the host, and nothing in the host or a page keeps
  // focus, so shortcuts (Tab included) go to the board right after a click.
  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) =>
    run(() => {
      const p = toPage(frameRef.current!, e);
      const additive = e.shiftKey;
      setActive(screen.id);
      const conn = connRef.current;
      if (!conn?.docId) return;
      conn
        .request<HitResult | null>("hit", p, HIT_TIMEOUT)
        .promise.then(guard((hit: HitResult | null) => selectFromHit(screen.id, hit, additive)))
        .catch(raise);
    });

  return (
    <div className="preview-frame" ref={frameRef}>
      <iframe
        key={src}
        ref={iframeRef}
        src={src}
        title={screen.name}
        width={PREVIEW_W}
        height={PREVIEW_H}
        onLoad={() => connections.get(screen.id)?.greet()}
      />
      {mode === "select" && (
        <div
          ref={captureRef}
          className="capture"
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onMouseDown={onMouseDown}
          onClick={onClick}
        />
      )}
      {status !== "ready" && <div className="preview-status">Connecting…</div>}
    </div>
  );
}
