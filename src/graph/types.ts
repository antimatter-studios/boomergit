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
