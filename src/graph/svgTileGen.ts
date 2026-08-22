import * as fs from "node:fs";
import * as path from "node:path";
import type { GraphRow, TileMarks } from "./types.js";
import { COLOR } from "../ui/theme.js";

// Grid dimensions
export const COL_WIDTH = 20;
export const ROW_HEIGHT = 24;
export const DOT_RADIUS = 5;
export const LINE_WIDTH = 2.5;
const SHADOW_WIDTH = 5;
const SHADOW_OPACITY = 0.75;
/** Gap between the commit dot and the worktree ring around it. */
const RING_GAP = 2.5;
const RING_WIDTH = 1.5;
/** Lines are haloed in the editor background so crossings read as overlaps. */
const BG_COLOR = COLOR.editorBackground;

export class SvgTileCache {
  private cacheDir: string;
  private cache = new Map<string, string>();

  constructor(storageDir: string) {
    this.cacheDir = path.join(storageDir, "svg-tiles");
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  getTilePath(
    row: GraphRow,
    rowHeight: number = ROW_HEIGHT,
    maxCols?: number,
    marks: TileMarks = {}
  ): string {
    const cols = maxCols ?? row.numCols;
    const key = this.buildKey(row, rowHeight, cols, marks);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const svg = renderSvg(row, rowHeight, cols, marks);
    const filePath = path.join(this.cacheDir, `${key}.svg`);
    fs.writeFileSync(filePath, svg, "utf-8");
    this.cache.set(key, filePath);
    return filePath;
  }

  clear(): void {
    this.cache.clear();
    if (fs.existsSync(this.cacheDir)) {
      for (const file of fs.readdirSync(this.cacheDir)) {
        fs.unlinkSync(path.join(this.cacheDir, file));
      }
    }
  }

  private buildKey(
    row: GraphRow,
    rowHeight: number,
    maxCols: number,
    marks: TileMarks
  ): string {
    // Marks belong in the key: two rows identical in structure but differing in
    // whether they're checked out elsewhere must not share a cached tile.
    const parts: string[] = [
      `c${row.commitCol}:${row.commitColor.replace("#", "")}:h${rowHeight}:w${maxCols}`,
      marks.worktree ? "wt" : "-",
    ];
    for (const seg of row.segments) {
      const h = seg.half === "top" ? "T" : seg.half === "bottom" ? "B" : "F";
      parts.push(`${h}${seg.topCol}-${seg.botCol}:${seg.color.replace("#", "")}`);
    }
    return `tile_${fileNameDigest(parts.join("_"))}`;
  }
}

/**
 * A short, filename-safe digest of a tile's shape.
 *
 * Java's String.hashCode (`h = h * 31 + c`, truncated to 32 bits), picked for
 * being four lines rather than for collision resistance. A collision would
 * render the wrong tile, so the 32-bit space matters — but a single graph holds
 * only as many distinct shapes as it has rows, far below where that bites.
 */
function fileNameDigest(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    // (hash << 5) - hash is hash * 31; `| 0` keeps it a signed 32-bit int
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function colX(col: number): number {
  return col * COL_WIDTH + COL_WIDTH / 2;
}

/**
 * Draw a bezier curve or straight line between two points.
 *
 * cpFactor controls where the control points sit along the vertical span:
 * - 0.5 (default): midpoint — standard S-curve, good for half-height segments
 * - 0.35: curve bends earlier — for full-height merge curves, so the curve
 *   passes closer to the commit dot at midY (within ~6px for adjacent lanes)
 */
function segmentPath(x0: number, y0: number, x1: number, y1: number, cpFactor: number = 0.5): string {
  if (x0 === x1) {
    return `M${x0},${y0} L${x1},${y1}`;
  }
  const cpY = y0 + (y1 - y0) * cpFactor;
  return `M${x0},${y0} C${x0},${cpY} ${x1},${cpY} ${x1},${y1}`;
}

/**
 * Render a single row tile SVG.
 *
 * Segments are drawn according to their `half` property, which is what makes
 * curves terminate on the commit dot rather than passing behind it:
 * - undefined: full height (0 → ROW_HEIGHT) — pass-through lanes, continuing
 *   commit lanes, and both convergence and merge curves
 * - "top": top half (0 → midY) — a lane arriving at the dot and ending there,
 *   i.e. a root commit
 * - "bottom": bottom half (midY → ROW_HEIGHT) — a lane starting at the dot: a
 *   new branch tip, and forks departing towards a second parent
 */
export function renderSvg(
  row: GraphRow,
  rowHeight: number = ROW_HEIGHT,
  maxCols?: number,
  marks: TileMarks = {}
): string {
  const cols = maxCols ?? row.numCols;
  const width = cols * COL_WIDTH + COL_WIDTH;
  const midY = rowHeight / 2;
  const shadows: string[] = [];
  const lines: string[] = [];

  for (const seg of row.segments) {
    const xTop = colX(seg.topCol);
    const xBot = colX(seg.botCol);

    let y0: number, y1: number;
    if (seg.half === "top") {
      y0 = 0;
      y1 = midY;
    } else if (seg.half === "bottom") {
      y0 = midY;
      y1 = rowHeight;
    } else {
      y0 = 0;
      y1 = rowHeight;
    }

    // Full-height cross-column segments (merges) use a lower cpFactor
    // so the curve bends earlier and passes closer to the commit dot at midY
    const isFullHeightCurve = !seg.half && xTop !== xBot;
    const d = segmentPath(xTop, y0, xBot, y1, isFullHeightCurve ? 0.35 : 0.5);

    shadows.push(
      `<path d="${d}" fill="none" stroke="${BG_COLOR}" stroke-width="${SHADOW_WIDTH}" stroke-opacity="${SHADOW_OPACITY}" stroke-linecap="round"/>`
    );
    lines.push(
      `<path d="${d}" fill="none" stroke="${seg.color}" stroke-width="${LINE_WIDTH}" stroke-linecap="round"/>`
    );
  }

  // Commit dot (on top of everything)
  const cx = colX(row.commitCol);
  const dot = `<circle cx="${cx}" cy="${midY}" r="${DOT_RADIUS}" fill="${row.commitColor}" stroke="${BG_COLOR}" stroke-width="1.5" stroke-opacity="${SHADOW_OPACITY}"/>`;

  // A ring outside the dot says another working tree has this commit checked
  // out. Drawn here rather than as a row decoration so it composes with the
  // inverted active row and the compare selection, which both fill the row.
  // Haloed like the lines are, so it stays legible where a lane passes behind.
  const ring: string[] = [];
  if (marks.worktree) {
    // Clamp to the row: line height follows the user's font size, and a ring
    // sized for a comfortable row would be clipped by a tight one. If it can't
    // clear the dot it is dropped rather than drawn as a smudge around it.
    const largestThatFits = midY - RING_WIDTH / 2 - 0.5;
    const r = Math.min(DOT_RADIUS + RING_GAP, largestThatFits);
    if (r < DOT_RADIUS + 1) return svgDocument(width, rowHeight, [...shadows, ...lines, dot]);
    ring.push(
      `<circle cx="${cx}" cy="${midY}" r="${r}" fill="none" stroke="${BG_COLOR}" stroke-width="${RING_WIDTH + 2}" stroke-opacity="${SHADOW_OPACITY}"/>`,
      `<circle cx="${cx}" cy="${midY}" r="${r}" fill="none" stroke="${COLOR.worktreeAccent}" stroke-width="${RING_WIDTH}"/>`
    );
  }

  return svgDocument(width, rowHeight, [...shadows, ...lines, dot, ...ring]);
}

/** Wrap drawn elements in the tile's SVG root. */
function svgDocument(width: number, height: number, elements: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...elements,
    `</svg>`,
  ].join("\n");
}
