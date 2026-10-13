// Each preview's connection to its page, and what the app does with the
// messages pages send. A page load is identified by its docId: when it changes
// (navigation, reload), everything the app knew about that preview starts over.
import { Connection } from "../connection";
import type { Box, PageMessage } from "../protocol";
import { store, type AppState, type Hover, type Screen } from "../state";
import { applyChildren, dropNodes, emptyTree } from "../tree";
import { zoomFromPage } from "./board";
import { pageChanged, updateTree } from "./layers";
import { handleKey } from "./selection";

/** One connection per preview, by screen id. */
export const connections = new Map<string, Connection>();

// Every page message arrives here; it's handed to the connection of the iframe it came from.
window.addEventListener("message", (e) => {
  for (const conn of connections.values()) {
    if (conn.owns(e)) return conn.receive(e.data);
  }
});

export function connect(screen: Screen, onError: (e: unknown) => void): Connection {
  const conn = new Connection(screen.id, new URL(screen.url).origin, {
    getMode: () => store.get().mode,
    onError,
    onReady: (c) => {
      resetScreen(c.screenId, c.docId);
      syncWatch(c);
    },
    onLeave: (c) => resetScreen(c.screenId, null),
    onMessage: handlePageMessage,
  });
  connections.set(screen.id, conn);
  resetScreen(screen.id, null);
  return conn;
}

export function disconnect(conn: Connection) {
  conn.destroy();
  if (connections.get(conn.screenId) !== conn) return;
  connections.delete(conn.screenId);
  resetScreen(conn.screenId, null);
}

/** A preview starts over: a new page load (docId), or connecting (null). */
function resetScreen(screenId: string, docId: string | null) {
  watchKeys.delete(screenId);
  store.set((s) => {
    const onScreen = s.selection?.screenId === screenId;
    const trees = { ...s.trees };
    if (docId) trees[screenId] = emptyTree(docId);
    else delete trees[screenId];
    const { [screenId]: _rects, ...rects } = s.rects;
    const { [screenId]: _live, ...live } = s.live;
    return {
      selection: onScreen ? null : s.selection,
      goneNotice: onScreen ? false : s.goneNotice,
      hover: s.hover?.screenId === screenId ? null : s.hover,
      reveal: s.reveal?.screenId === screenId ? null : s.reveal,
      trees,
      rects,
      live,
      previews: {
        ...s.previews,
        [screenId]: {
          status: docId ? "ready" : "connecting",
          docId,
          pageErrors: docId ? [] : (s.previews[screenId]?.pageErrors ?? []),
        },
      },
    };
  });
}

function handlePageMessage(conn: Connection, m: PageMessage) {
  const screenId = conn.screenId;
  switch (m.type) {
    case "rects":
      store.set((s) => ({ rects: { ...s.rects, [screenId]: { ...s.rects[screenId], ...m.rects } } }));
      return;
    case "live":
      store.set((s) => ({ live: { ...s.live, [screenId]: { ...s.live[screenId], ...m.live } } }));
      return;
    case "children":
      updateTree(screenId, (t) => applyChildren(t, m.id, m.children));
      return;
    case "gone":
      removeGone(screenId, m.ids);
      return;
    case "dirty":
      pageChanged(screenId);
      return;
    case "pageError":
      store.set((s) => {
        const p = s.previews[screenId];
        return p ? { previews: { ...s.previews, [screenId]: { ...p, pageErrors: [...p.pageErrors, String(m.message)].slice(-5) } } } : {};
      });
      return;
    case "key":
      handleKey(m.key, m.shift);
      return;
    case "zoom":
      zoomFromPage(screenId, m.x, m.y, m.dy);
      return;
  }
}

/** Elements the page re-rendered away: they leave the selection, hover and tree. */
function removeGone(screenId: string, ids: string[]) {
  const gone = new Set(ids);
  store.set((s) => {
    const patch: Partial<AppState> = {};
    const sel = s.selection;
    if (sel?.screenId === screenId) {
      const left = sel.ids.filter((id) => !gone.has(id));
      if (left.length !== sel.ids.length) {
        patch.selection = left.length ? { screenId, ids: left } : null;
        if (!left.length) patch.goneNotice = true;
      }
    }
    if (s.hover?.screenId === screenId && gone.has(s.hover.id)) patch.hover = null;
    const tree = s.trees[screenId];
    if (tree) patch.trees = { ...s.trees, [screenId]: dropNodes(tree, ids) };
    const rects = { ...s.rects[screenId] };
    const live = { ...s.live[screenId] };
    for (const id of ids) {
      delete rects[id];
      delete live[id];
    }
    patch.rects = { ...s.rects, [screenId]: rects };
    patch.live = { ...s.live, [screenId]: live };
    return patch;
  });
}

/** A box the app already has (from a hit test), shown before the page's next push. */
export function primeRect(screenId: string, id: string, box: Box) {
  store.set((s) => ({ rects: { ...s.rects, [screenId]: { ...s.rects[screenId], [id]: box } } }));
}

// ---------- watching ----------
// Each page reports boxes for the hovered element and the selection, and live
// values for the selection. The list is re-sent only when that set changes.

const watchKeys = new Map<string, string>();
let lastHover: Hover | null = null;
let lastSelection: AppState["selection"] = null;

function syncWatch(conn: Connection) {
  const { hover, selection } = store.get();
  const sel = selection?.screenId === conn.screenId ? selection.ids : [];
  const rects = hover?.screenId === conn.screenId && !sel.includes(hover.id) ? [...sel, hover.id] : sel;
  const key = JSON.stringify([rects, sel]);
  if (watchKeys.get(conn.screenId) === key || !conn.docId) return;
  watchKeys.set(conn.screenId, key);
  conn.send({ type: "watch", rects, live: sel });
}

store.subscribe(() => {
  const { hover, selection } = store.get();
  if (hover === lastHover && selection === lastSelection) return;
  lastHover = hover;
  lastSelection = selection;
  connections.forEach(syncWatch);
});
