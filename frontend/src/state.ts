// The single app store. Components read it with useStore(selector); only the
// functions in actions.ts write to it (plus connection lifecycle in actions.ts).
import { useSyncExternalStore } from "react";
import type { Box, LiveProps, Mode } from "./protocol";
import type { TreeState } from "./tree";

export interface Screen {
  id: string;
  name: string;
  url: string;
}

export interface PreviewState {
  status: "connecting" | "ready";
  docId: string | null;
  pageErrors: string[];
}

export interface Hover {
  screenId: string;
  id: string;
  /** Ancestor ids, top level first, ending with id. */
  path: string[];
}

export interface Selection {
  screenId: string;
  /** In selection order: the last one is the most recently selected. */
  ids: string[];
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface DevFaults {
  latency: number;
  screensFail: boolean;
  detailsFail: boolean;
  rootHang: boolean;
  rowHang: boolean;
  inspectorThrow: boolean;
  silent: Record<string, boolean>;
  boardNonce: number;
  boardTimerNonce: number;
}

export interface AppState {
  mode: Mode;
  camera: Camera;
  screens: Screen[];
  previews: Record<string, PreviewState>;
  activeId: string | null;
  hover: Hover | null;
  selection: Selection | null;
  /** Set when the whole selection disappeared from the page; cleared by the next selection. */
  goneNotice: boolean;
  /** Per screen, per element id: last box reported by the page. */
  rects: Record<string, Record<string, Box>>;
  live: Record<string, Record<string, LiveProps>>;
  trees: Record<string, TreeState>;
  /** A row the layers panel should scroll into view once it's rendered. */
  reveal: { screenId: string; id: string } | null;
  dev: DevFaults;
}

let state: AppState = {
  mode: "select",
  camera: { x: 48, y: 64, zoom: 0.25 },
  screens: [],
  previews: {},
  activeId: null,
  hover: null,
  selection: null,
  goneNotice: false,
  rects: {},
  live: {},
  trees: {},
  reveal: null,
  dev: {
    latency: 0,
    screensFail: false,
    detailsFail: false,
    rootHang: false,
    rowHang: false,
    inspectorThrow: false,
    silent: {},
    boardNonce: 0,
    boardTimerNonce: 0,
  },
};

const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    const next = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Selectors must return stored references or primitives, not fresh objects. */
export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
