// Messages between the host (this app) and the bridge script inside each preview
// page (backend/pages/figr-bridge.js). Every message carries `figr: 1`; messages
// from a page also carry its `docId`, which changes on every page load.
//
// Page -> host
//   hello                      bridge loaded; host answers with "init"
//   ready                      handshake done (after "init")
//   bye                        page is unloading (navigation)
//   res { reqId, data, error } answer to a request
//   rects { [id]: Box }        boxes of watched elements, sent when they change
//   live { [id]: LiveProps }   live values of watched elements, sent when they change
//   children { id, children }  an observed parent's child list changed
//   gone { ids }               ids whose element no longer exists
//   dirty                      the DOM changed somewhere (re-run search)
//   pageError { message }      uncaught error / rejection inside the page
//   key { key, shift }         shortcut pressed while the page had focus
//   zoom { x, y, dy }          Ctrl/Cmd + wheel inside the page
//
// Host -> page
//   init { mode }, mode { mode }, watch { rects, live }, wheel { x, y, dx, dy },
//   reveal { id }
//   requests (answered with "res"): hit { x, y }, children { id }, nav { id, dir },
//   search { query }

export type Mode = "select" | "interact";
export type NavDir = "child" | "parent" | "next" | "prev";

export interface NodeInfo {
  id: string;
  name: string;
  tag: string;
  key: string | null;
  hasChildren: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An element's box in the page viewport, plus the part not clipped away. */
export interface Box extends Rect {
  clip: Rect | null;
  name: string;
}

export interface LiveProps {
  name: string;
  tag: string;
  id: string;
  classes: string[];
  key: string | null;
  width: number;
  height: number;
  x: number;
  y: number;
  text: string;
  color: string;
  background: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
}

export interface HitResult {
  id: string;
  name: string;
  path: string[];
  box: Box;
}

export interface SearchResult {
  results: NodeInfo[][];
  truncated: boolean;
}

type Envelope = { figr: 1; docId: string };

export type PageMessage = Envelope &
  (
    | { type: "hello" }
    | { type: "ready" }
    | { type: "bye" }
    | { type: "dirty" }
    | { type: "res"; reqId: number; data: unknown; error?: string }
    | { type: "rects"; rects: Record<string, Box> }
    | { type: "live"; live: Record<string, LiveProps> }
    | { type: "children"; id: string | null; children: NodeInfo[] }
    | { type: "gone"; ids: string[] }
    | { type: "pageError"; message: string }
    | { type: "key"; key: string; shift: boolean }
    | { type: "zoom"; x: number; y: number; dy: number }
  );
