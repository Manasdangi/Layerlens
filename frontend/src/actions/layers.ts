// The layers tree of each preview: lazy loading, expand / collapse, revealing a
// selection, panel keyboard, and search. A tree belongs to one page load (its
// docId), so answers for an older page load are dropped.
//
// Failures: the top level fails the whole layers panel (its region). A row's
// children and the search are smaller regions inside it: their error is kept in
// the tree state, shown in place with a Retry, and reported here.
import { Cancelled, ROW_TIMEOUT, type Request } from "../connection";
import type { NodeInfo, SearchResult } from "../protocol";
import { report } from "../report";
import { store } from "../state";
import { applyChildren, buildSearch, pathTo, type Row, type TreeState } from "../tree";
import { connections } from "./pages";
import { select, setActive, setHover } from "./selection";

export function updateTree(screenId: string, fn: (t: TreeState) => TreeState) {
  store.set((s) => {
    const t = s.trees[screenId];
    return t ? { trees: { ...s.trees, [screenId]: fn(t) } } : {};
  });
}

/** The preview's tree, if it still belongs to that page load. */
function currentTree(screenId: string, docId: string) {
  const t = store.get().trees[screenId];
  return t && t.docId === docId ? t : null;
}

/** The nodes the panel is showing: the search results while searching. */
function shownNodes(screenId: string) {
  const t = store.get().trees[screenId];
  return t ? (t.search ? t.search.nodes : t.nodes) : {};
}

// ---------- scroll position, remembered per page load ----------

const scrollMemory = new Map<string, number>();
export const getScrollMemory = (docId: string) => scrollMemory.get(docId) ?? 0;
export const setScrollMemory = (docId: string, top: number) => scrollMemory.set(docId, top);

// ---------- loading ----------

/** Loads the top level. A failure goes to `onError` (the panel's region). Returns a cancel. */
export function loadRoot(screenId: string, onError: (e: unknown) => void): () => void {
  const conn = connections.get(screenId);
  const tree = store.get().trees[screenId];
  if (!conn?.docId || !tree) return () => {};
  const { docId } = tree;
  const req = conn.request<NodeInfo[]>("children", { id: null, hang: store.get().dev.rootHang }, ROW_TIMEOUT);
  req.promise
    .then((list) => {
      if (currentTree(screenId, docId)) updateTree(screenId, (t) => applyChildren(t, null, list));
    })
    .catch((error) => {
      if (currentTree(screenId, docId)) onError(error); // the region ignores cancellations
    });
  return req.cancel;
}

let rowToken = 0;
const rowRequests = new Map<string, Request<NodeInfo[]>>();
const rowKey = (screenId: string, id: string) => `${screenId}\n${id}`;

/** Loads a row's children, showing "loading" then the children or an error on that row. */
export function loadChildren(screenId: string, id: string) {
  const conn = connections.get(screenId);
  const tree = store.get().trees[screenId];
  if (!conn?.docId || !tree) return;
  const { docId } = tree;
  const key = rowKey(screenId, id);
  const token = ++rowToken;
  rowRequests.get(key)?.cancel();
  updateTree(screenId, (t) => ({ ...t, rows: { ...t.rows, [id]: { status: "loading", token } } }));
  const req = conn.request<NodeInfo[]>("children", { id, hang: store.get().dev.rowHang }, ROW_TIMEOUT);
  rowRequests.set(key, req);

  // Only this token's answer may land: collapse / re-expand starts a new token,
  // and children are replaced, never appended, so nothing duplicates.
  const isCurrent = () => currentTree(screenId, docId)?.rows[id]?.token === token;
  req.promise
    .then((list) => {
      if (!isCurrent()) return;
      updateTree(screenId, (t) => {
        const { [id]: _done, ...rows } = t.rows;
        return { ...applyChildren(t, id, list), rows };
      });
    })
    .catch((error) => {
      if (error instanceof Cancelled || !isCurrent()) return;
      const elementKey = currentTree(screenId, docId)?.nodes[id]?.key;
      updateTree(screenId, (t) => ({ ...t, rows: { ...t.rows, [id]: { status: "error", token } } }));
      report(error, { region: "layers-row", screenId, ...(elementKey ? { elementKey } : {}) });
    })
    .finally(() => {
      if (rowRequests.get(key) === req) rowRequests.delete(key);
    });
}

export function toggleRow(screenId: string, id: string) {
  const t = store.get().trees[screenId];
  if (!t || t.search) return;
  if (t.expanded[id]) {
    // Collapsing while loading cancels: that's the user moving on, not a failure.
    const loading = t.rows[id]?.status === "loading";
    if (loading) rowRequests.get(rowKey(screenId, id))?.cancel();
    updateTree(screenId, (t) => {
      const { [id]: _open, ...expanded } = t.expanded;
      const { [id]: _row, ...rows } = t.rows;
      return { ...t, expanded, rows: loading ? rows : t.rows };
    });
    return;
  }
  updateTree(screenId, (t) => ({ ...t, expanded: { ...t.expanded, [id]: true } }));
  if (!t.nodes[id]?.children && !t.rows[id]) loadChildren(screenId, id);
}

/** Expands every ancestor in `path` (loading levels in parallel) so the element's row shows. */
export function revealInTree(screenId: string, path: string[]) {
  const t = store.get().trees[screenId];
  if (!t || t.search) return; // while searching, the pre-search expansion is preserved
  const ancestors = path.slice(0, -1);
  if (!ancestors.length) return;
  updateTree(screenId, (t) => ({ ...t, expanded: { ...t.expanded, ...Object.fromEntries(ancestors.map((a) => [a, true as const])) } }));
  for (const a of ancestors) if (!t.nodes[a]?.children && !t.rows[a]) loadChildren(screenId, a);
}

/** The panel scrolled the selected row into view. */
export function consumeReveal() {
  if (store.get().reveal) store.set({ reveal: null });
}

// ---------- rows: hover, click, keyboard ----------

export function hoverRow(screenId: string, id: string) {
  setHover({ screenId, id, path: pathTo(shownNodes(screenId), id) });
}

/** Selects the row's element and scrolls only that page to show it. */
export function clickRow(screenId: string, id: string, additive: boolean) {
  setActive(screenId);
  select(screenId, id, pathTo(shownNodes(screenId), id), additive);
  connections.get(screenId)?.send({ type: "reveal", id });
}

/** Arrow keys while the panel has focus. `rows` = the visible rows, in order. */
export function panelKey(screenId: string, key: string, rows: Row[]) {
  const s = store.get();
  const t = s.trees[screenId];
  if (!t) return;
  const nodes = shownNodes(screenId);
  const go = (id: string | null | undefined) => {
    if (id && nodes[id]) clickRow(screenId, id, false);
  };
  const cur = s.selection?.screenId === screenId ? s.selection.ids[s.selection.ids.length - 1] : undefined;
  const idx = cur ? rows.findIndex((r) => r.id === cur) : -1;
  if (!cur || idx < 0) return go(rows[0]?.id);
  const node = nodes[cur];
  const canToggle = !t.search && node?.hasChildren;
  switch (key) {
    case "ArrowUp":
      return go(rows[idx - 1]?.id);
    case "ArrowDown":
      return go(rows[idx + 1]?.id);
    case "ArrowRight":
      if (canToggle && !t.expanded[cur]) return toggleRow(screenId, cur);
      return go(node?.children?.[0]);
    case "ArrowLeft":
      if (canToggle && t.expanded[cur]) return toggleRow(screenId, cur);
      return go(node?.parentId);
  }
}

// ---------- search ----------
// The page searches its whole DOM (rows never loaded included) and answers with
// each match plus its ancestors. Typing waits briefly before asking; a newer
// query replaces (cancels) an older one.

const searchTimers = new Map<string, number>();
const searchRequests = new Map<string, Request<SearchResult>>();

export function setSearch(screenId: string, query: string) {
  clearTimeout(searchTimers.get(screenId));
  if (!query) {
    searchRequests.get(screenId)?.cancel();
    updateTree(screenId, (t) => ({ ...t, search: null }));
    return;
  }
  updateTree(screenId, (t) => ({
    ...t,
    search: { nodes: {}, root: [], truncated: false, ...t.search, query, status: "loading" },
  }));
  scheduleSearch(screenId, 120);
}

export function retrySearch(screenId: string) {
  updateTree(screenId, (t) => (t.search ? { ...t, search: { ...t.search, status: "loading" } } : t));
  scheduleSearch(screenId, 0);
}

/** The page's DOM changed: an open search re-runs (not one that's showing an error). */
export function pageChanged(screenId: string) {
  const search = store.get().trees[screenId]?.search;
  if (search && search.status !== "error") scheduleSearch(screenId, 250);
}

function scheduleSearch(screenId: string, delay: number) {
  clearTimeout(searchTimers.get(screenId));
  searchTimers.set(screenId, window.setTimeout(() => runSearch(screenId), delay));
}

function runSearch(screenId: string) {
  const conn = connections.get(screenId);
  const t = store.get().trees[screenId];
  if (!conn?.docId || !t?.search) return;
  const { docId } = t;
  const { query } = t.search;
  searchRequests.get(screenId)?.cancel(); // replaced: not a failure
  const req = conn.request<SearchResult>("search", { query }, ROW_TIMEOUT);
  searchRequests.set(screenId, req);
  const isCurrent = () => currentTree(screenId, docId)?.search?.query === query;
  const setStatus = (patch: Partial<NonNullable<TreeState["search"]>>) =>
    updateTree(screenId, (t) => (t.search ? { ...t, search: { ...t.search, ...patch } } : t));
  req.promise
    .then((res) => {
      if (isCurrent()) setStatus({ status: "ready", truncated: res.truncated, ...buildSearch(res.results) });
    })
    .catch((error) => {
      if (error instanceof Cancelled || !isCurrent()) return;
      setStatus({ status: "error" });
      report(error, { region: "layers", screenId });
    });
}
