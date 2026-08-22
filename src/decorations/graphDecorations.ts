import * as vscode from "vscode";
import { refBadgeText, REF_SIGIL_WIDTH, type Commit, type Ref } from "../git/types.js";
import { SHORT_HASH_LEN } from "../git/format.js";
import type { GraphRow } from "../graph/types.js";
import { SvgTileCache, COL_WIDTH } from "../graph/svgTileGen.js";
import { COLOR } from "../ui/theme.js";
import { TIMING } from "../ui/timings.js";

export interface RefHit {
  ref: Ref;
  commitHash: string;
  range: vscode.Range;
}

/**
 * Where ref badges begin in a rendered line: two spaces, the short hash, two
 * more spaces. Searching for badges from here stops a badge-shaped substring
 * in a commit subject from being mistaken for a real badge.
 */
const BADGE_SEARCH_START = 2 + SHORT_HASH_LEN + 2;

/**
 * The longest styled run VS Code renders as a single span.
 *
 * Anything longer is split across several spans, and a decoration's CSS is
 * applied to each one independently — so a name pill carrying rounded corners,
 * padding and a right margin renders those *per fragment*, and one long badge
 * comes out looking like two: `…premature-activatio` followed by a lone `n`.
 */
const VSCODE_LONG_RUN_LIMIT = 50;

/**
 * The pieces a badge's name pill is painted in.
 *
 * A name short enough to render as one span is painted `whole`, exactly as it
 * always was. A longer one is split so that nothing which would repeat sits on
 * the part that can split: the caps carry the padding, the rounded end and the
 * margin, and the body carries only a background — so however many spans the
 * body becomes, they read as one continuous pill.
 */
interface NamePillRanges {
  whole: vscode.DecorationOptions[];
  leftCap: vscode.DecorationOptions[];
  body: vscode.DecorationOptions[];
  tail: vscode.DecorationOptions[];
}

function emptyNamePill(): NamePillRanges {
  return { whole: [], leftCap: [], body: [], tail: [] };
}

/** Ranges to paint, grouped by what they are. */
interface TextRanges {
  hash: vscode.DecorationOptions[];
  author: vscode.DecorationOptions[];
  date: vscode.DecorationOptions[];
  /** The " X " type box at the head of every badge — same style for all. */
  sigil: vscode.DecorationOptions[];
  /** Badge name pills, grouped by the lane colour they take. */
  nameByLaneColor: Map<string, NamePillRanges>;
}

/**
 * Smuggle arbitrary CSS into a decoration through `textDecoration`.
 *
 * VS Code offers no general style hook, but it passes `textDecoration` to the
 * DOM verbatim, so a leading `none;` closes that property and everything after
 * it applies to the decorated span. This is the only way to get a background
 * that respects the inline-block box: the API's own `backgroundColor` always
 * fills the full line height, which makes a badge a stripe rather than a pill.
 */
function injectCss(declarations: Record<string, string>): string {
  const css = Object.entries(declarations)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
  return `none; ${css}`;
}

/** Shared shape of a badge half: a pill segment sized to its own text. */
const BADGE_BOX = {
  display: "inline-block",
  "line-height": "1.3",
};

export class GraphDecorationEngine {
  private svgCache: SvgTileCache;
  private decorationTypes: vscode.TextEditorDecorationType[] = [];
  private refHits: RefHit[] = [];
  private commits: Commit[] = [];
  private activeLine = -1;
  private hoverDeco: vscode.TextEditorDecorationType | undefined;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(storageDir: string) {
    this.svgCache = new SvgTileCache(storageDir);
    // Clear stale tiles on each invocation so code changes take effect
    this.svgCache.clear();
  }

  apply(editor: vscode.TextEditor, rows: GraphRow[], commits: Commit[], currentBranch?: string): void {
    this.clearDecorations();
    this.commits = commits;
    const lineHeight = this.computeLineHeight(editor);

    // Use a consistent column count across all rows so SVG tiles have
    // uniform width — prevents text from shifting left/right per row.
    const globalMaxCols = Math.max(...rows.map((r) => r.numCols), 1);
    const tileWidth = globalMaxCols * COL_WIDTH + COL_WIDTH;

    this.activeLine = findActiveLine(commits, currentBranch);

    for (let i = 0; i < rows.length && i < commits.length; i++) {
      const svgPath = this.svgCache.getTilePath(rows[i], lineHeight, globalMaxCols);
      const isActive = i === this.activeLine;

      const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: isActive ? COLOR.activeRowBackground : undefined,
        color: isActive ? COLOR.activeRowText : undefined,
        fontWeight: isActive ? "bold" : undefined,
        isWholeLine: isActive,
        before: {
          contentIconPath: vscode.Uri.file(svgPath),
          margin: "0 4px 0 0",
          width: `${tileWidth}px`,
          height: `${lineHeight}px`,
          textDecoration: injectCss({ "vertical-align": "top" }),
        },
      });

      editor.setDecorations(decorationType, [new vscode.Range(i, 0, i, 0)]);
      this.decorationTypes.push(decorationType);
    }

    this.applyTextColors(editor, commits, rows);
  }

  /**
   * Match VS Code's FontInfo line height calculation exactly.
   * VS Code rounds both fontSize and the final lineHeight to integers.
   * See: vs/editor/common/config/fontInfo.ts
   */
  private computeLineHeight(editor: vscode.TextEditor): number {
    const editorLineHeight = (editor.options as unknown as { lineHeight?: number }).lineHeight;
    if (typeof editorLineHeight === "number" && editorLineHeight > 0) {
      return Math.round(editorLineHeight);
    }

    // Scope to document so language-specific overrides (e.g. [boomergit]) are picked up
    const config = vscode.workspace.getConfiguration("editor", editor.document);
    const rawFontSize = config.get<number>("fontSize", 14);
    const rawLineHeight = config.get<number>("lineHeight", 0);

    // VS Code rounds fontSize first
    const fontSize = Math.round(rawFontSize);

    let lineHeight: number;
    if (rawLineHeight === 0) {
      // Auto: VS Code uses platform-specific golden ratio
      // macOS = 1.5, Windows/Linux = 1.35 (from VS Code's fontInfo.ts)
      const ratio = process.platform === "darwin" ? 1.5 : 1.35;
      lineHeight = ratio * fontSize;
    } else if (rawLineHeight >= 8) {
      // Direct pixel value
      lineHeight = rawLineHeight;
    } else {
      // Multiplier
      lineHeight = rawLineHeight * fontSize;
    }

    // VS Code rounds final lineHeight to integer pixels
    return Math.round(lineHeight);
  }

  /** Returns true if hex color is light enough to need dark text */
  private static isLight(hex: string): boolean {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
  }

  private applyTextColors(editor: vscode.TextEditor, commits: Commit[], rows: GraphRow[]): void {
    const ranges = this.collectRanges(editor, commits, rows);
    this.paintRanges(editor, ranges);
  }

  /**
   * Locate every span worth colouring in the rendered document.
   *
   * Also records each badge's full extent in `refHits`, which is what turns a
   * click position back into the ref it landed on.
   */
  private collectRanges(
    editor: vscode.TextEditor,
    commits: Commit[],
    rows: GraphRow[]
  ): TextRanges {
    const ranges: TextRanges = {
      hash: [],
      author: [],
      date: [],
      sigil: [],
      nameByLaneColor: new Map(),
    };

    for (let i = 0; i < commits.length && i < rows.length; i++) {
      const text = editor.document.lineAt(i).text;
      const commit = commits[i];

      const hashMatch = text.match(/^\s*([0-9a-f]{8})/);
      if (hashMatch) {
        const start = text.indexOf(hashMatch[1]);
        ranges.hash.push({ range: new vscode.Range(i, start, i, start + SHORT_HASH_LEN) });
      }

      this.collectBadgeRanges(ranges, text, i, commit, rows[i].commitColor);

      const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})\s*$/);
      if (dateMatch) {
        const start = text.lastIndexOf(dateMatch[1]);
        ranges.date.push({ range: new vscode.Range(i, start, i, start + 10) });
      }

      const authorIdx = text.lastIndexOf(commit.author);
      if (authorIdx >= 0) {
        ranges.author.push({
          range: new vscode.Range(i, authorIdx, i, authorIdx + commit.author.length),
        });
      }
    }

    return ranges;
  }

  /**
   * Split each of a line's badges into its sigil box and its name pill.
   *
   * Badges are found by searching for the exact text the document provider
   * emitted, left to right, so repeated ref names can't collide.
   */
  private collectBadgeRanges(
    ranges: TextRanges,
    text: string,
    line: number,
    commit: Commit,
    laneColor: string
  ): void {
    let searchFrom = BADGE_SEARCH_START;

    for (const ref of commit.refs) {
      const token = refBadgeText(ref);
      const start = text.indexOf(token, searchFrom);
      if (start < 0) continue;
      const end = start + token.length;
      const sigilEnd = start + REF_SIGIL_WIDTH;

      ranges.sigil.push({ range: new vscode.Range(line, start, line, sigilEnd) });

      const pill = ranges.nameByLaneColor.get(laneColor) ?? emptyNamePill();
      // The name run is the name plus the token's trailing space.
      const nameRunLength = end - sigilEnd;
      if (nameRunLength <= VSCODE_LONG_RUN_LIMIT) {
        pill.whole.push({ range: new vscode.Range(line, sigilEnd, line, end) });
      } else {
        // One character at each end, so neither cap can ever be split, and
        // everything that would visibly repeat lives on them.
        pill.leftCap.push({ range: new vscode.Range(line, sigilEnd, line, sigilEnd + 1) });
        pill.body.push({ range: new vscode.Range(line, sigilEnd + 1, line, end - 2) });
        pill.tail.push({ range: new vscode.Range(line, end - 2, line, end) });
      }
      ranges.nameByLaneColor.set(laneColor, pill);

      // Hit range spans the whole badge, so clicking the sigil works too
      this.refHits.push({
        ref,
        commitHash: commit.hash,
        range: new vscode.Range(line, start, line, end),
      });
      searchFrom = end;
    }
  }

  /** Create the decoration types and hand them their ranges. */
  private paintRanges(editor: vscode.TextEditor, ranges: TextRanges): void {
    this.paint(editor, ranges.hash, { color: COLOR.commitHash, fontWeight: "bold" });
    this.paint(editor, ranges.author, { color: COLOR.author });
    this.paint(editor, ranges.date, { color: COLOR.date });

    // The type sigil: white box, bold black letter, rounded on the left only
    // so it reads as one two-tone pill with the name that follows.
    this.paint(editor, ranges.sigil, {
      color: COLOR.sigilText,
      fontWeight: "bold",
      textDecoration: injectCss({
        background: COLOR.sigilBackground,
        "border-radius": "3px 0 0 3px",
        ...BADGE_BOX,
        padding: "0px 1px",
      }),
    });

    // One set of decoration types per lane colour, so each badge matches its
    // own dot. Every piece shares the same box model and zero vertical
    // padding, so the pieces of one pill line up exactly.
    for (const [laneColor, pill] of ranges.nameByLaneColor) {
      const text = {
        color: GraphDecorationEngine.isLight(laneColor)
          ? COLOR.badgeTextOnLight
          : COLOR.badgeTextOnDark,
        fontWeight: "bold" as const,
      };
      const pillBase = { background: laneColor, ...BADGE_BOX };

      // Short name: one span, so one range carries the whole pill. Asymmetric
      // padding because the text already ends with a space of its own.
      this.paint(editor, pill.whole, {
        ...text,
        textDecoration: injectCss({
          ...pillBase,
          "border-radius": "0 3px 3px 0",
          padding: "0px 3px 0px 6px",
          "margin-right": "6px",
        }),
      });

      // Long name, first character: owns the left inset.
      this.paint(editor, pill.leftCap, {
        ...text,
        textDecoration: injectCss({ ...pillBase, padding: "0px 0px 0px 6px" }),
      });

      // Long name, middle: background only. This is the part VS Code may split
      // into several spans, so it must carry nothing that would repeat — no
      // radius, no padding, no margin — leaving the fragments seamless.
      this.paint(editor, pill.body, {
        ...text,
        textDecoration: injectCss({ ...pillBase, padding: "0px" }),
      });

      // Long name, last character plus the trailing space: owns the rounded
      // end and the gap to the next badge.
      this.paint(editor, pill.tail, {
        ...text,
        textDecoration: injectCss({
          ...pillBase,
          "border-radius": "0 3px 3px 0",
          padding: "0px 3px 0px 0px",
          "margin-right": "6px",
        }),
      });
    }
  }

  /** Create one decoration type, apply it, and keep it for disposal. */
  private paint(
    editor: vscode.TextEditor,
    ranges: vscode.DecorationOptions[],
    options: vscode.DecorationRenderOptions
  ): void {
    const deco = vscode.window.createTextEditorDecorationType(options);
    editor.setDecorations(deco, ranges);
    this.decorationTypes.push(deco);
  }

  /** Returns the ref at the given position, or undefined if not on a badge */
  getRefAt(position: vscode.Position): RefHit | undefined {
    return this.refHits.find((h) => h.range.contains(position));
  }

  /** Returns the commit on the given line */
  getCommitAt(line: number): Commit | undefined {
    return this.commits[line];
  }

  /** Highlight a badge on hover, auto-clears after timeout */
  highlightBadge(editor: vscode.TextEditor, position: vscode.Position): void {
    clearTimeout(this.hoverTimer);
    this.hoverDeco?.dispose();
    this.hoverDeco = undefined;

    const hit = this.getRefAt(position);
    if (!hit) return;

    this.hoverDeco = vscode.window.createTextEditorDecorationType({
      textDecoration: injectCss({
        outline: `2px solid ${COLOR.badgeHighlight}`,
        "border-radius": "3px",
        "outline-offset": "0px",
      }),
    });
    editor.setDecorations(this.hoverDeco, [{ range: hit.range }]);

    this.hoverTimer = setTimeout(() => {
      this.hoverDeco?.dispose();
      this.hoverDeco = undefined;
    }, TIMING.badgeHighlightMs);
  }

  /** Clear any active badge highlight */
  clearHighlight(): void {
    clearTimeout(this.hoverTimer);
    this.hoverDeco?.dispose();
    this.hoverDeco = undefined;
  }

  // --- Row selection for compare ---
  private selectedRows: number[] = [];
  private selectionDecos: vscode.TextEditorDecorationType[] = [];

  /** Toggle-select a row for comparison. Returns current selected lines. */
  selectRow(editor: vscode.TextEditor, line: number): number[] {
    const idx = this.selectedRows.indexOf(line);
    if (idx >= 0) {
      // Deselect
      this.selectedRows.splice(idx, 1);
    } else {
      this.selectedRows.push(line);
      // Constrain to max 2
      if (this.selectedRows.length > 2) {
        this.selectedRows.shift();
      }
    }
    this.applySelectionDecos(editor);
    return [...this.selectedRows];
  }

  /** Get currently selected rows */
  getSelectedRows(): number[] {
    return [...this.selectedRows];
  }

  /** Get commits for selected rows */
  getSelectedCommits(): Commit[] {
    return this.selectedRows
      .map((line) => this.commits[line])
      .filter((c): c is Commit => !!c);
  }

  private applySelectionDecos(editor: vscode.TextEditor): void {
    for (const d of this.selectionDecos) d.dispose();
    this.selectionDecos = [];

    for (let i = 0; i < this.selectedRows.length; i++) {
      const line = this.selectedRows[i];
      const deco = vscode.window.createTextEditorDecorationType({
        backgroundColor: COLOR.selectedRow,
        isWholeLine: true,
        overviewRulerColor: COLOR.selectedRowMarker,
        overviewRulerLane: vscode.OverviewRulerLane.Center,
        after: {
          contentText: ` [${i + 1}]`,
          color: COLOR.badgeTextOnDark,
          fontWeight: "bold",
        },
      });
      editor.setDecorations(deco, [new vscode.Range(line, 0, line, 0)]);
      this.selectionDecos.push(deco);
    }
  }

  clearSelections(): void {
    this.selectedRows = [];
    for (const d of this.selectionDecos) d.dispose();
    this.selectionDecos = [];
  }

  /** Returns the total number of rows (commits) in the graph */
  getTotalRows(): number {
    return this.commits.length;
  }

  /** Clear selections, select a single target line, and apply decorations */
  navigateTo(editor: vscode.TextEditor, line: number): void {
    this.selectedRows = [line];
    this.applySelectionDecos(editor);
  }

  clearDecorations(): void {
    for (const dt of this.decorationTypes) {
      dt.dispose();
    }
    this.decorationTypes = [];
    this.refHits = [];
  }

  dispose(): void {
    this.clearDecorations();
    // Selection + hover decorations are separate decoration types and must be
    // disposed too — otherwise, when refreshGraph() replaces this engine, their
    // red row highlights and [n] markers are orphaned (VS Code keeps rendering
    // them, the new engine can't clear them) and pile up across refreshes.
    this.clearHighlight();
    this.clearSelections();
    this.svgCache.clear();
  }
}

/**
 * The row holding the checked-out branch, or -1 if it isn't in the graph.
 *
 * Local branches only: a remote-tracking ref of the same name is a different
 * commit in general, and highlighting it would be a lie.
 */
export function findActiveLine(commits: Commit[], currentBranch?: string): number {
  if (!currentBranch) return -1;
  return commits.findIndex((c) =>
    c.refs.some((r) => r.type === "branch" && r.name === currentBranch)
  );
}
