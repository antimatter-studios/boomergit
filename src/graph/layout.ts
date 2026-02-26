import type { Commit } from "../git/types.js";
import { BRANCH_COLORS, type GraphRow, type Segment } from "./types.js";

interface LaneEntry {
  hash: string;
  color: string;
}

export function computeGraphLayout(commits: Commit[]): GraphRow[] {
  const lanes: (LaneEntry | null)[] = [];
  const rows: GraphRow[] = [];
  let colorIdx = 0;

  function nextColor(): string {
    const c = BRANCH_COLORS[colorIdx % BRANCH_COLORS.length];
    colorIdx++;
    return c;
  }

  function findFreeLane(...excludeIndices: number[]): number {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null && !excludeIndices.includes(i)) return i;
    }
    lanes.push(null);
    return lanes.length - 1;
  }

  function findLane(hash: string, exclude = -1): number {
    for (let i = 0; i < lanes.length; i++) {
      if (i !== exclude && lanes[i]?.hash === hash) return i;
    }
    return -1;
  }

  /** Find ALL lanes carrying the given hash */
  function findAllLanes(hash: string): number[] {
    const result: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i]?.hash === hash) result.push(i);
    }
    return result;
  }

  for (const commit of commits) {
    // ─── Find ALL lanes carrying this commit's hash ───
    // Multiple lanes can point to the same commit when several branch tips
    // share the same parent — each gets its own lane running down to it.
    const matchingLanes = findAllLanes(commit.hash);
    let commitLane: number;
    let convergingLanes: number[];
    const isNewTip = matchingLanes.length === 0;

    if (isNewTip) {
      commitLane = findFreeLane();
      lanes[commitLane] = { hash: commit.hash, color: nextColor() };
      convergingLanes = [];
    } else {
      commitLane = matchingLanes[0];
      convergingLanes = matchingLanes.slice(1);
    }

    const commitColor = lanes[commitLane]!.color;
    const topLanes = lanes.map((l) => (l ? { ...l } : null));

    // Free converging lanes — they've reached their target commit
    for (const cl of convergingLanes) {
      lanes[cl] = null;
    }

    // ─── Process parents ───
    const forks: { lane: number; color: string }[] = [];
    const merges: { lane: number; color: string }[] = [];
    let commitLaneContinues = false;

    if (commit.parents.length === 0) {
      lanes[commitLane] = null;
    } else {
      // First parent always continues in the commit lane.
      // Never transition to another lane — that causes branches to collapse
      // into each other instead of running independently down to their parent.
      lanes[commitLane] = { hash: commit.parents[0], color: commitColor };
      commitLaneContinues = true;

      for (let pi = 1; pi < commit.parents.length; pi++) {
        const parentHash = commit.parents[pi];
        const existing = findLane(parentHash, commitLane);

        if (existing >= 0) {
          merges.push({ lane: existing, color: lanes[existing]!.color });
        } else {
          const nl = findFreeLane(commitLane);
          const nc = nextColor();
          lanes[nl] = { hash: parentHash, color: nc };
          forks.push({ lane: nl, color: nc });
        }
      }
    }

    const botLanes = lanes.map((l) => (l ? { ...l } : null));

    // ─── Build segments ───
    const segments: Segment[] = [];
    const maxLen = Math.max(topLanes.length, botLanes.length);

    // A) Pass-through lanes (non-commit lanes that continue)
    for (let i = 0; i < maxLen; i++) {
      if (i === commitLane) continue;
      const top = topLanes[i];
      const bot = botLanes[i];
      if (top && bot) {
        segments.push({ topCol: i, botCol: i, color: top.color });
      }
    }

    // B) Convergence: other lanes that were also targeting this commit.
    //    These draw curves from their column to the commit column.
    for (const cl of convergingLanes) {
      const clColor = topLanes[cl]?.color ?? commitColor;
      segments.push({ topCol: cl, botCol: commitLane, color: clColor });
    }

    // C) Commit lane
    if (commitLaneContinues) {
      if (isNewTip) {
        segments.push({ topCol: commitLane, botCol: commitLane, color: commitColor, half: "bottom" });
      } else {
        segments.push({ topCol: commitLane, botCol: commitLane, color: commitColor });
      }
    } else if (commit.parents.length === 0) {
      if (isNewTip) {
        segments.push({ topCol: commitLane, botCol: commitLane, color: commitColor });
      } else {
        segments.push({ topCol: commitLane, botCol: commitLane, color: commitColor, half: "top" });
      }
    }

    // D) Fork curves: from the commit dot down to new lanes (bottom half)
    for (const fork of forks) {
      segments.push({ topCol: commitLane, botCol: fork.lane, color: fork.color, half: "bottom" });
    }

    // E) Merge curves: from existing lanes toward the commit lane (full height)
    for (const merge of merges) {
      segments.push({ topCol: merge.lane, botCol: commitLane, color: merge.color });
    }

    // Compute column count
    let maxCol = commitLane;
    for (const seg of segments) {
      if (seg.topCol > maxCol) maxCol = seg.topCol;
      if (seg.botCol > maxCol) maxCol = seg.botCol;
    }

    rows.push({
      commitHash: commit.hash,
      commitCol: commitLane,
      commitColor,
      segments,
      numCols: maxCol + 1,
    });
  }

  return rows;
}
