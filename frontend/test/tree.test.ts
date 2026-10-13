// R4: the layers tree helpers (pure functions).
import { describe, expect, it } from "vitest";
import type { NodeInfo } from "../src/protocol";
import { applyChildren, buildSearch, dropNodes, emptyTree, nearestVisible, pathTo, visibleRows } from "../src/tree";

const info = (id: string, hasChildren = false): NodeInfo => ({ id, name: id, tag: "div", key: null, hasChildren });

/** body > a > (a1 > a1x), a2 ; b */
function sampleTree() {
  let t = emptyTree("doc");
  t = applyChildren(t, null, [info("a", true), info("b")]);
  t = applyChildren(t, "a", [info("a1", true), info("a2")]);
  t = applyChildren(t, "a1", [info("a1x")]);
  return t;
}

describe("applyChildren", () => {
  it("sets the top level and a parent's children", () => {
    const t = sampleTree();
    expect(t.root).toEqual(["a", "b"]);
    expect(t.nodes.a.children).toEqual(["a1", "a2"]);
    expect(t.nodes.a1.parentId).toBe("a");
  });

  it("replaces children instead of appending, so a repeated answer never duplicates", () => {
    let t = sampleTree();
    t = applyChildren(t, "a", [info("a1", true), info("a2")]);
    t = applyChildren(t, "a", [info("a1", true), info("a2")]);
    expect(t.nodes.a.children).toEqual(["a1", "a2"]);
  });

  it("keeps the loaded children and expanded state of rows that remain", () => {
    let t = { ...sampleTree(), expanded: { a: true as const, a1: true as const } };
    t = applyChildren(t, "a", [info("new"), info("a1", true)]);
    expect(t.nodes.a.children).toEqual(["new", "a1"]);
    expect(t.nodes.a1.children).toEqual(["a1x"]);
    expect(t.expanded.a1).toBe(true);
  });

  it("drops removed rows with their whole subtree and their state", () => {
    let t = { ...sampleTree(), expanded: { a: true as const, a1: true as const } };
    t = applyChildren(t, "a", [info("a2")]);
    expect(t.nodes.a1).toBeUndefined();
    expect(t.nodes.a1x).toBeUndefined();
    expect(t.expanded.a1).toBeUndefined();
  });

  it("keeps a stub parent when a deep level arrives before its parent's level", () => {
    let t = emptyTree("doc");
    t = applyChildren(t, "deep", [info("leaf")]);
    expect(t.nodes.deep.children).toEqual(["leaf"]);
    // The real info arrives later with its own parent's children; children survive.
    t = applyChildren(t, null, [info("deep", true)]);
    expect(t.nodes.deep.children).toEqual(["leaf"]);
    expect(t.nodes.deep.hasChildren).toBe(true);
  });
});

describe("dropNodes", () => {
  it("removes rows from their parent and the top level", () => {
    let t = sampleTree();
    t = dropNodes(t, ["a1", "b"]);
    expect(t.root).toEqual(["a"]);
    expect(t.nodes.a.children).toEqual(["a2"]);
    expect(t.nodes.a1x).toBeUndefined();
  });

  it("ignores unknown ids", () => {
    const t = sampleTree();
    expect(dropNodes(t, ["zzz"]).nodes).toEqual(t.nodes);
  });
});

describe("visibleRows", () => {
  it("lists only rows under expanded parents, with depth", () => {
    const t = sampleTree();
    expect(visibleRows(t.nodes, t.root!, () => false)).toEqual([
      { id: "a", depth: 0 },
      { id: "b", depth: 0 },
    ]);
    const open = new Set(["a", "a1"]);
    expect(visibleRows(t.nodes, t.root!, (id) => open.has(id)).map((r) => `${r.depth}:${r.id}`)).toEqual([
      "0:a",
      "1:a1",
      "2:a1x",
      "1:a2",
      "0:b",
    ]);
  });
});

describe("pathTo / nearestVisible", () => {
  it("walks parent links from the top level down", () => {
    expect(pathTo(sampleTree().nodes, "a1x")).toEqual(["a", "a1", "a1x"]);
  });

  it("highlights the nearest visible ancestor of a row inside a collapsed parent", () => {
    const t = sampleTree();
    const path = ["a", "a1", "a1x"];
    expect(nearestVisible(t.nodes, t.root!, () => false, path)).toBe("a");
    expect(nearestVisible(t.nodes, t.root!, (id) => id === "a", path)).toBe("a1");
    expect(nearestVisible(t.nodes, t.root!, () => true, path)).toBe("a1x");
  });
});

describe("buildSearch", () => {
  it("builds matches plus their ancestors, sharing ancestors once", () => {
    const { nodes, root } = buildSearch([
      [info("a"), info("a1"), info("a1x")],
      [info("a"), info("a2")],
      [info("b")],
    ]);
    expect(root).toEqual(["a", "b"]);
    expect(nodes.a.children).toEqual(["a1", "a2"]);
    expect(nodes.a1x.parentId).toBe("a1");
  });
});
