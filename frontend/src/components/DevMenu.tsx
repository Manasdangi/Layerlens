// Dev-only: trigger each failure on demand (R6.7).
import { useState } from "react";
import { reloadBoard, reloadLayers, setDev, throwInBoardTimer, throwInMessage, toggleSilent } from "../actions";
import { useStore } from "../state";

export function DevMenu() {
  const [open, setOpen] = useState(false);
  const dev = useStore((s) => s.dev);
  const activeId = useStore((s) => s.activeId);
  const activeName = useStore((s) => s.screens.find((x) => x.id === s.activeId)?.name);
  const screens = useStore((s) => s.screens);
  // A silenced preview fails and can't be clicked to become active again, so
  // every silenced preview stays listed here until it's switched back.
  const silenced = screens.filter((x) => dev.silent[x.id] && x.id !== activeId);

  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <label className="dev-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );

  return (
    <div className="dev">
      <button type="button" className="dev-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        Dev faults
      </button>
      {open && (
        <div className="dev-menu">
          <h4>API</h4>
          <label className="dev-row">
            <span>Latency (ms)</span>
            <input
              type="number"
              min={0}
              step={250}
              value={dev.latency}
              onChange={(e) => setDev({ latency: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>

          <h4>Board</h4>
          {toggle("GET /screens fails", dev.screensFail, (v) => setDev({ screensFail: v }), "then Reload board")}
          <button type="button" onClick={reloadBoard}>
            Reload board
          </button>
          <button type="button" onClick={throwInBoardTimer}>
            Throw in a board timer
          </button>

          <h4>Active preview {activeName ? `(${activeName})` : ""}</h4>
          {!activeId && <p className="dev-note">Click a preview first.</p>}
          {activeId && (
            <>
              {toggle("Bridge stays silent", !!dev.silent[activeId], () => toggleSilent(activeId), "reloads it; 10s timeout")}
              <button type="button" onClick={() => throwInMessage(activeId)}>
                Throw while handling its next message
              </button>
            </>
          )}
          {silenced.map((x) => (
            <div key={x.id}>{toggle(`${x.name}: bridge silent`, true, () => toggleSilent(x.id), "untick, then Retry")}</div>
          ))}

          <h4>Layers</h4>
          {toggle("Top-level load hangs", dev.rootHang, (v) => setDev({ rootHang: v }), "then Reload layers")}
          {activeId && (
            <button type="button" onClick={() => reloadLayers(activeId)}>
              Reload layers
            </button>
          )}
          {toggle("Row child loads hang", dev.rowHang, (v) => setDev({ rowHang: v }), "3s timeout per row")}

          <h4>Inspector</h4>
          {toggle("GET /elements fails", dev.detailsFail, (v) => setDev({ detailsFail: v }))}
          {toggle("Inspector throws on render", dev.inspectorThrow, (v) => setDev({ inspectorThrow: v }))}
        </div>
      )}
    </div>
  );
}
