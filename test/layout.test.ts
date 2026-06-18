import { describe, it, expect } from "vitest";
import { computeGraphLayout } from "../src/graph/layout.js";
import { BRANCH_COLORS } from "../src/graph/types.js";
import type { Commit } from "../src/git/types.js";

function commit(hash: string, parents: string[] = []): Commit {
  return { hash, parents, author: "A", email: "a@x", timestamp: 0, subject: hash, refs: [] };
}

describe("computeGraphLayout", () => {
  it("returns [] for no commits", () => {
    expect(computeGraphLayout([])).toEqual([]);
  });

  it("produces one row per commit, preserving order", () => {
    const rows = computeGraphLayout([commit("a", ["b"]), commit("b", ["c"]), commit("c")]);
    expect(rows.map((r) => r.commitHash)).toEqual(["a", "b", "c"]);
  });

  it("keeps a linear history in a single lane (column 0)", () => {
    const rows = computeGraphLayout([commit("a", ["b"]), commit("b", ["c"]), commit("c")]);
    expect(rows.every((r) => r.commitCol === 0)).toBe(true);
    expect(rows.every((r) => r.numCols === 1)).toBe(true);
  });

  it("assigns the first branch colour to the first tip", () => {
    const rows = computeGraphLayout([commit("a")]);
    expect(rows[0].commitColor).toBe(BRANCH_COLORS[0]);
  });

  it("opens a second lane for a merge commit's extra parent", () => {
    // m has two parents; p1 and p2 converge on g.
    const rows = computeGraphLayout([
      commit("m", ["p1", "p2"]),
      commit("p1", ["g"]),
      commit("p2", ["g"]),
      commit("g"),
    ]);
    const mRow = rows.find((r) => r.commitHash === "m")!;
    expect(mRow.commitCol).toBe(0);
    expect(mRow.numCols).toBe(2);
    // a fork curve crosses columns (topCol !== botCol)
    expect(mRow.segments.some((s) => s.topCol !== s.botCol)).toBe(true);
  });

  it("maintains structural invariants for every row", () => {
    const rows = computeGraphLayout([
      commit("m", ["p1", "p2"]),
      commit("p1", ["g"]),
      commit("p2", ["g"]),
      commit("g"),
    ]);
    for (const r of rows) {
      expect(r.commitCol).toBeGreaterThanOrEqual(0);
      expect(r.numCols).toBeGreaterThanOrEqual(1);
      expect(r.commitCol).toBeLessThan(r.numCols);
      expect(BRANCH_COLORS).toContain(r.commitColor);
    }
  });
});
