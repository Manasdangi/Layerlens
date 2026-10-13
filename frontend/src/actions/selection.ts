// Hover, selection and keyboard shortcuts.
import { HIT_TIMEOUT } from "../connection";
import type { HitResult, NavDir } from "../protocol";
import { store, type Hover } from "../state";
import { setMode } from "./board";
import { revealInTree } from "./layers";
import { connections, primeRect } from "./pages";

// ---------- hover ----------

export function setHover(hover: Hover | null) {
  const cur = store.get().hover;
  if (cur === hover || (cur && hover && cur.screenId === hover.screenId && cur.id === hover.id)) return;
  store.set({ hover });
}

/** Clears the hover, optionally only if it's on that preview / element. */
export function clearHover(screenId?: string, id?: string) {
  const cur = store.get().hover;
  if (!cur || (screenId && cur.screenId !== screenId) || (id && cur.id !== id)) return;
  store.set({ hover: null });
}

export function hoverFromHit(screenId: string, hit: HitResult | null) {
  if (store.get().mode !== "select") return;
  if (hit) primeRect(screenId, hit.id, hit.box);
  setHover(hit ? { screenId, id: hit.id, path: hit.path } : null);
}

// ---------- selection ----------

export function setActive(screenId: string) {
  if (store.get().activeId !== screenId) store.set({ activeId: screenId });
}

/**
 * Selects an element (`path` = its ancestor ids, top level first). Additive
 * toggles it within the same preview; in another preview it replaces.
 */
export function select(screenId: string, id: string, path: string[], additive: boolean) {
  const { selection } = store.get();
  let ids: string[];
  if (additive && selection?.screenId === screenId) {
    ids = selection.ids.includes(id) ? selection.ids.filter((x) => x !== id) : [...selection.ids, id];
  } else ids = [id];
  store.set({
    selection: ids.length ? { screenId, ids } : null,
    goneNotice: false,
    activeId: screenId,
    reveal: { screenId, id },
  });
  revealInTree(screenId, path);
}

/** A click in a preview: an element, or page background (null) which clears. */
export function selectFromHit(screenId: string, hit: HitResult | null, additive: boolean) {
  if (!hit) return clearSelection();
  primeRect(screenId, hit.id, hit.box);
  select(screenId, hit.id, hit.path, additive);
}

export function clearSelection() {
  if (store.get().selection) store.set({ selection: null });
}

/** Enter / Tab: the page finds the child, parent or sibling of the most recent selection. */
export function navigate(dir: NavDir) {
  const { selection } = store.get();
  if (!selection) return;
  const { screenId } = selection;
  const conn = connections.get(screenId);
  if (!conn?.docId) return;
  const last = selection.ids[selection.ids.length - 1];
  conn
    .request<HitResult | null>("nav", { id: last, dir }, HIT_TIMEOUT)
    .promise.then((r) => {
      if (r) selectFromHit(screenId, r, false);
    })
    // A page that stops answering is that preview's failure. A replaced page
    // cancels the request, which the region ignores.
    .catch((error) => conn.fail(error));
}

// ---------- keyboard ----------

/** Shortcuts, from the host window or forwarded by a page. Returns true if handled. */
export function handleKey(key: string, shift: boolean): boolean {
  const s = store.get();
  switch (key) {
    case "v":
    case "V":
      setMode("select");
      return true;
    case "i":
    case "I":
      setMode("interact");
      return true;
    case "Escape":
      clearSelection();
      return true;
    case "Enter":
      if (s.mode !== "select" || !s.selection) return false;
      navigate(shift ? "parent" : "child");
      return true;
    case "Tab":
      if (s.mode !== "select" || !s.selection) return false;
      navigate(shift ? "prev" : "next");
      return true;
  }
  return false;
}
