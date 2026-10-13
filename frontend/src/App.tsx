import { useEffect } from "react";
import { clearHover } from "./actions";
import { Board } from "./components/Board";
import { Inspector } from "./components/Inspector";
import { LayersPanel } from "./components/LayersPanel";
import { Toolbar } from "./components/Toolbar";

export default function App() {
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
        <LayersPanel />
        <Board />
        <Inspector />
      </div>
    </div>
  );
}
