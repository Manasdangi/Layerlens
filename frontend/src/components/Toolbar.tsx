import { setMode } from "../actions";
import { useStore } from "../state";
import { DevMenu } from "./DevMenu";

export function Toolbar() {
  const mode = useStore((s) => s.mode);
  const zoom = useStore((s) => Math.round(s.camera.zoom * 100));
  return (
    <header className="toolbar">
      <div className="brand">Layerlens</div>
      <div className="mode-toggle" role="group" aria-label="Mode">
        <button type="button" aria-pressed={mode === "select"} onClick={() => setMode("select")}>
          Select <kbd>V</kbd>
        </button>
        <button type="button" aria-pressed={mode === "interact"} onClick={() => setMode("interact")}>
          Interact <kbd>I</kbd>
        </button>
      </div>
      <div className="toolbar-hint">Drag or scroll to pan · Ctrl/⌘ + scroll to zoom</div>
      <div className="zoom">{zoom}%</div>
      {import.meta.env.DEV && <DevMenu />}
    </header>
  );
}
