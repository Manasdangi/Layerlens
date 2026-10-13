import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ChangeEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  clearHover,
  clickRow,
  consumeReveal,
  getScrollMemory,
  hoverRow,
  loadChildren,
  loadRoot,
  panelKey,
  retrySearch,
  setScrollMemory,
  setSearch,
  toggleRow,
} from "../actions";
import { useStore } from "../state";
import { nearestVisible, visibleRows, type Row, type RowStatus, type SearchState, type TreeNode, type TreeState } from "../tree";
import { Region } from "./Region";
import { useRegion } from "./regionApi";

const ROW_H = 24;

export function LayersPanel() {
  const activeId = useStore((s) => s.activeId);
  return (
    <aside className="panel layers-panel">
      <div className="panel-header">Layers</div>
      {activeId ? (
        <Region key={activeId} name="layers" screenId={activeId} className="panel-error">
          <Layers screenId={activeId} />
        </Region>
      ) : (
        <p className="empty">Click something in a preview</p>
      )}
    </aside>
  );
}

function Layers({ screenId }: { screenId: string }) {
  const name = useStore((s) => s.screens.find((x) => x.id === screenId)?.name);
  const status = useStore((s) => s.previews[screenId]?.status);
  const tree = useStore((s) => s.trees[screenId]);
  if (status !== "ready" || !tree) return <p className="empty">Connecting to {name ?? "preview"}…</p>;
  // A navigation creates a new tree (new docId): the panel starts fresh.
  return <LayerTree key={tree.docId} screenId={screenId} name={name ?? ""} tree={tree} />;
}

const alwaysOpen = () => true;
const NO_ROWS: string[] = [];

function LayerTree({ screenId, name, tree }: { screenId: string; name: string; tree: TreeState }) {
  const { raise, guard, run } = useRegion();
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const hasRoot = tree.root !== undefined;
  const search = tree.search;

  // The top level loads when the tree is new (or reloaded). Its failure fails this panel.
  useEffect(() => {
    if (!hasRoot) return loadRoot(screenId, raise);
  }, [screenId, hasRoot, raise]);

  // While searching, the panel shows the search results, all expanded.
  const view = search ?? { nodes: tree.nodes, root: tree.root ?? NO_ROWS };
  const isOpen = useMemo(() => (search ? alwaysOpen : (id: string) => !!tree.expanded[id]), [search, tree.expanded]);
  const rows = useMemo(() => visibleRows(view.nodes, view.root, isOpen), [view.nodes, view.root, isOpen]);

  const selected = useMemo(() => new Set(selection?.screenId === screenId ? selection.ids : []), [selection, screenId]);
  const hovered = hover?.screenId === screenId ? nearestVisible(view.nodes, view.root, isOpen, hover.path) : null;

  const { listRef, onScroll } = useListScroll(screenId, tree.docId, rows);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) =>
    run(() => {
      if (!e.key.startsWith("Arrow")) return;
      e.preventDefault();
      panelKey(screenId, e.key, rows);
    });

  return (
    <div className="layers">
      <div className="layers-meta">{name}</div>
      <input
        className="search"
        type="search"
        placeholder="Search layers"
        value={search?.query ?? ""}
        onChange={guard((e: ChangeEvent<HTMLInputElement>) => setSearch(screenId, e.target.value))}
      />
      {search && <SearchStatus screenId={screenId} search={search} empty={rows.length === 0} />}
      <div className="layers-list" ref={listRef} tabIndex={0} onScroll={onScroll} onKeyDown={onKeyDown}>
        {!hasRoot && !search && <p className="empty">Loading layers…</p>}
        {rows.map((r) => (
          <LayerRow
            key={r.id}
            screenId={screenId}
            node={view.nodes[r.id]}
            depth={r.depth}
            open={isOpen(r.id)}
            searching={!!search}
            status={search ? undefined : tree.rows[r.id]}
            selected={selected.has(r.id)}
            hovered={hovered === r.id}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The list's scroll position:
 *  - restored from memory when the panel opens on this page load (R4.9);
 *  - anchored to the first visible row, so rows inserted or removed above it
 *    don't move what the user is looking at (R4.10);
 *  - scrolled to show a newly selected row once it exists (R4.5).
 * Rows are a fixed height, so a row's position is its index × ROW_H.
 */
function useListScroll(screenId: string, docId: string, rows: Row[]) {
  const reveal = useStore((s) => s.reveal);
  const listRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<Row[]>([]);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const restored = useRef(false);

  // Called on every scroll and after every layout: notes the anchor row and the position.
  const remember = useCallback(() => {
    const el = listRef.current!;
    const idx = Math.floor(el.scrollTop / ROW_H);
    const row = rowsRef.current[idx];
    anchor.current = row ? { id: row.id, offset: idx * ROW_H - el.scrollTop } : null;
    setScrollMemory(docId, el.scrollTop);
  }, [docId]);

  useLayoutEffect(() => {
    const el = listRef.current!;
    rowsRef.current = rows;
    if (!restored.current) {
      restored.current = true;
      el.scrollTop = getScrollMemory(docId);
    } else if (anchor.current) {
      const idx = rows.findIndex((r) => r.id === anchor.current!.id);
      if (idx >= 0) el.scrollTop = idx * ROW_H - anchor.current.offset;
    }
    if (reveal?.screenId === screenId) {
      const idx = rows.findIndex((r) => r.id === reveal.id);
      if (idx >= 0) {
        const top = idx * ROW_H;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
        consumeReveal();
      }
    }
    remember();
  }, [rows, reveal, screenId, docId, remember]);

  return { listRef, onScroll: remember };
}

function SearchStatus({ screenId, search, empty }: { screenId: string; search: SearchState; empty: boolean }) {
  const { run } = useRegion();
  let text: ReactNode = null;
  if (search.status === "loading") text = "Searching…";
  else if (search.status === "error")
    text = (
      <span className="row-status error">
        Couldn't search
        <button type="button" onClick={() => run(() => retrySearch(screenId))}>
          Retry
        </button>
      </span>
    );
  else if (empty) text = "No matches";
  else if (search.truncated) text = "Showing the first 500 matches";
  return <div className="search-status">{text}</div>;
}

interface RowProps {
  screenId: string;
  node: TreeNode;
  depth: number;
  open: boolean;
  searching: boolean;
  status?: RowStatus;
  selected: boolean;
  hovered: boolean;
}

const LayerRow = memo(function LayerRow({ screenId, node, depth, open, searching, status, selected, hovered }: RowProps) {
  const { guard } = useRegion();
  const showChevron = node.hasChildren && !searching;
  return (
    <div
      className={`row${selected ? " selected" : ""}${hovered ? " hovered" : ""}`}
      style={{ height: ROW_H, paddingLeft: 6 + depth * 14 }}
      onMouseEnter={guard(() => hoverRow(screenId, node.id))}
      onMouseLeave={() => clearHover(screenId, node.id)}
      onClick={guard((e: MouseEvent) => clickRow(screenId, node.id, e.shiftKey))}
    >
      <span
        className="chevron"
        onClick={guard((e: MouseEvent) => {
          if (!showChevron) return;
          e.stopPropagation();
          toggleRow(screenId, node.id);
        })}
      >
        {showChevron ? (open ? "▾" : "▸") : ""}
      </span>
      <span className="row-name">{node.name}</span>
      {status?.status === "loading" && <span className="row-status">Loading…</span>}
      {status?.status === "error" && (
        <span className="row-status error">
          Couldn't load
          <button
            type="button"
            onClick={guard((e: MouseEvent) => {
              e.stopPropagation();
              loadChildren(screenId, node.id);
            })}
          >
            Retry
          </button>
        </span>
      )}
    </div>
  );
});
