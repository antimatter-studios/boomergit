/**
 * A line segment passing through a single row tile.
 *
 * `half` controls which portion of the tile the segment occupies:
 * - undefined: full height (0 → ROW_HEIGHT) — pass-throughs, continuing commit lanes, merge curves
 * - "top": top half (0 → midY) — commit lane arriving at the dot from above
 * - "bottom": bottom half (midY → ROW_HEIGHT) — forks departing from the commit dot
 */
export interface Segment {
  topCol: number;
  botCol: number;
  color: string;
  half?: "top" | "bottom";
}

/**
 * Marks drawn on a tile that aren't part of the graph's structure.
 *
 * Separate from GraphRow because the layout doesn't know about them: they come
 * from data joined onto the graph afterwards, so the renderer takes them as its
 * own input rather than the lane algorithm inventing fields it never sets.
 */
export interface TileMarks {
  /** Ring the commit dot: another working tree has this commit checked out. */
  worktree?: boolean;
}

export interface GraphRow {
  commitHash: string;
  commitCol: number;
  commitColor: string;
  segments: Segment[];
  numCols: number;
}

export const BRANCH_COLORS = [
  "#F5A623", // orange
  "#4FC3F7", // light blue
  "#81C784", // green
  "#E57373", // red
  "#BA68C8", // purple
  "#FFD54F", // yellow
  "#4DD0E1", // cyan
  "#FF8A65", // deep orange
  "#A1887F", // brown
  "#90A4AE", // blue grey
  "#AED581", // light green
  "#7986CB", // indigo
];
