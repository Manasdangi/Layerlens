import { useEffect } from "react";
import { clearHover } from "./actions";
import { Board } from "./components/Board";
import { Inspector } from "./components/Inspector";
import { LayersPanel } from "./components/LayersPanel";
import { Splitter } from "./components/Splitter";
import { usePanelWidth } from "./components/panelWidth";
import { Toolbar } from "./components/Toolbar";

export default function App() {
  const layers = usePanelWidth(280);
  const inspector = usePanelWidth(300);

  // Hover clears when the pointer leaves the window.
  useEffect(() => {
    const leave = () => clearHover();
    document.documentElement.addEventListener("mouseleave", leave);
    window.addEventListener("blur", leave);
    return () => {
      document.documentElement.removeEventListener("mouseleave", leave);
      window.removeEventListener("blur", leave);
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <LayersPanel width={layers.width} />
        <Splitter panel="left" label="Resize layers panel" {...layers} />
        <Board />
        <Splitter panel="right" label="Resize inspector" {...inspector} />
        <Inspector width={inspector.width} />
      </div>
    </div>
  );
}
