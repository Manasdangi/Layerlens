// Dev-only fault triggers for the Dev faults menu (R6.7).
import { HIT_TIMEOUT } from "../connection";
import { store, type DevFaults } from "../state";
import { emptyTree } from "../tree";
import { updateTree } from "./layers";
import { connections } from "./pages";

export function setDev(patch: Partial<DevFaults>) {
  store.set((s) => ({ dev: { ...s.dev, ...patch } }));
}

/** Refetches GET /screens (and rebuilds every preview). */
export function reloadBoard() {
  setDev({ boardNonce: store.get().dev.boardNonce + 1 });
}

export function throwInBoardTimer() {
  setDev({ boardTimerNonce: store.get().dev.boardTimerNonce + 1 });
}

/** Reloads a preview with a bridge that never answers, so its connect timeout fires. */
export function toggleSilent(screenId: string) {
  const { [screenId]: wasSilent, ...silent } = store.get().dev.silent;
  setDev({ silent: wasSilent ? silent : { ...silent, [screenId]: true } });
}

/** The next message from that page throws in its handler. */
export function throwInMessage(screenId: string) {
  const conn = connections.get(screenId);
  if (!conn?.docId) return;
  conn.throwNext = true;
  conn.request("hit", { x: 1, y: 1 }, HIT_TIMEOUT).promise.catch(() => {}); // provokes a message
}

/** Forgets the layers tree, so the panel loads the top level again. */
export function reloadLayers(screenId: string) {
  updateTree(screenId, (t) => emptyTree(t.docId));
}
