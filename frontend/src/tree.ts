// Pure helpers for the layers tree of one preview. No React, no messaging.
import type { NodeInfo } from "./protocol";

export interface TreeNode extends NodeInfo {
  parentId: string | null;
  /** undefined = children never loaded */
  children?: string[];
}

export interface RowStatus {
  status: "loading" | "error";
  token: number;
}

export interface SearchState {
  query: string;
  status: "loading" | "ready" | "error";
  nodes: Record<string, TreeNode>;
  root: string[];
  truncated: boolean;
}

export interface TreeState {
  /** The page load this tree belongs to. A navigation creates a new tree. */
  docId: string;
  nodes: Record<string, TreeNode>;
  /** Children of <body>; undefined until loaded. */
  root?: string[];
  expanded: Record<string, true>;
  rows: Record<string, RowStatus>;
  search: SearchState | null;
}

export interface Row {
  id: string;
  depth: number;
}

export const emptyTree = (docId: string): TreeState => ({ docId, nodes: {}, expanded: {}, rows: {}, search: null });

function dropSubtree(nodes: Record<string, TreeNode>, t: { expanded: Record<string, true>; rows: Record<string, RowStatus> }, id: string) {
  const node = nodes[id];
  if (!node) return;
  delete nodes[id];
  delete t.expanded[id];
  delete t.rows[id];
  for (const child of node.children ?? []) if (nodes[child]?.parentId === id) dropSubtree(nodes, t, child);
}

/** Replaces a parent's children (null = top level). Rows that remain keep their state. */
export function applyChildren(tree: TreeState, parentId: string | null, infos: NodeInfo[]): TreeState {
  const nodes = { ...tree.nodes };
  const side = { expanded: { ...tree.expanded }, rows: { ...tree.rows } };
  const oldIds = parentId === null ? (tree.root ?? []) : (nodes[parentId]?.children ?? []);
  const keep = new Set(infos.map((i) => i.id));
  for (const id of oldIds) if (!keep.has(id) && nodes[id]?.parentId === parentId) dropSubtree(nodes, side, id);
  for (const info of infos) nodes[info.id] = { ...info, parentId, children: nodes[info.id]?.children };
  const ids = infos.map((i) => i.id);
  if (parentId === null) return { ...tree, nodes, ...side, root: ids };
  // The parent may not be in the tree yet when a deep reveal loads levels in
  // parallel: keep a stub, its real info arrives with its own parent's children.
  const parent = nodes[parentId] ?? { id: parentId, name: "", tag: "", key: null, hasChildren: true, parentId: null };
  nodes[parentId] = { ...parent, children: ids };
  return { ...tree, nodes, ...side };
}

export function dropNodes(tree: TreeState, ids: string[]): TreeState {
  const nodes = { ...tree.nodes };
  const side = { expanded: { ...tree.expanded }, rows: { ...tree.rows } };
  let root = tree.root;
  for (const id of ids) {
    const node = nodes[id];
    if (!node) continue;
    if (node.parentId === null) root = root?.filter((x) => x !== id);
    else {
      const parent = nodes[node.parentId];
      if (parent?.children) nodes[node.parentId] = { ...parent, children: parent.children.filter((x) => x !== id) };
    }
    dropSubtree(nodes, side, id);
  }
  return { ...tree, nodes, ...side, root };
}

export function visibleRows(nodes: Record<string, TreeNode>, root: string[], isOpen: (id: string) => boolean): Row[] {
  const out: Row[] = [];
  const walk = (ids: string[], depth: number) => {
    for (const id of ids) {
      const node = nodes[id];
      if (!node) continue;
      out.push({ id, depth });
      if (node.children && isOpen(id)) walk(node.children, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** Ids from the top level down to `id`, following parent links. */
export function pathTo(nodes: Record<string, TreeNode>, id: string): string[] {
  const path: string[] = [];
  for (let node: TreeNode | undefined = nodes[id]; node && path.length < 1000; node = node.parentId ? nodes[node.parentId] : undefined) {
    path.unshift(node.id);
    if (!node.parentId) break;
  }
  return path;
}

/** The deepest row of `path` that is currently visible (no expansion). */
export function nearestVisible(nodes: Record<string, TreeNode>, root: string[], isOpen: (id: string) => boolean, path: string[]): string | null {
  let best: string | null = null;
  let siblings = root;
  for (const id of path) {
    if (!siblings.includes(id)) break;
    best = id;
    if (!isOpen(id)) break;
    siblings = nodes[id]?.children ?? [];
  }
  return best;
}

/** Builds the filtered tree shown while searching: matches plus their ancestors. */
export function buildSearch(results: NodeInfo[][]): { nodes: Record<string, TreeNode>; root: string[] } {
  const nodes: Record<string, TreeNode> = {};
  const root: string[] = [];
  for (const chain of results) {
    let parentId: string | null = null;
    for (const info of chain) {
      if (!nodes[info.id]) {
        nodes[info.id] = { ...info, parentId, children: [] };
        if (parentId === null) root.push(info.id);
        else nodes[parentId].children!.push(info.id);
      }
      parentId = info.id;
    }
  }
  return { nodes, root };
}
