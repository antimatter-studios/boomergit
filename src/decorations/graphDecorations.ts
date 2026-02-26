import * as vscode from "vscode";
import type { Commit, Ref } from "../git/types.js";
import type { GraphRow } from "../graph/types.js";
import { SvgTileCache, COL_WIDTH } from "../graph/svgTileGen.js";

export interface RefHit {
  ref: Ref;
  commitHash: string;
  range: vscode.Range;
}

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

    // Find the line with the active branch
    this.activeLine = -1;
    if (currentBranch) {
      for (let i = 0; i < commits.length; i++) {
        if (commits[i].refs.some((r) => r.type === "branch" && r.name === currentBranch)) {
          this.activeLine = i;
          break;
        }
      }
    }
    const activeLine = this.activeLine;

    for (let i = 0; i < rows.length && i < commits.length; i++) {
      const row = rows[i];
      const svgPath = this.svgCache.getTilePath(row, lineHeight, globalMaxCols);

      const isActive = i === activeLine;
      const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: isActive ? "#ffffff" : undefined,
        color: isActive ? "#1e1e1e" : undefined,
        fontWeight: isActive ? "bold" : undefined,
        isWholeLine: isActive,
        before: {
          contentIconPath: vscode.Uri.file(svgPath),
          margin: "0 4px 0 0",
          width: `${tileWidth}px`,
          height: `${lineHeight}px`,
          textDecoration: "none; vertical-align: top",
        },
      });

      const range = new vscode.Range(i, 0, i, 0);
      editor.setDecorations(decorationType, [range]);
      this.decorationTypes.push(decorationType);
    }

    this.applyTextColors(editor, commits, rows, activeLine);
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

  private applyTextColors(editor: vscode.TextEditor, commits: Commit[], rows: GraphRow[], activeLine: number = -1): void {
    const hashRanges: vscode.DecorationOptions[] = [];
    const authorRanges: vscode.DecorationOptions[] = [];
    const dateRanges: vscode.DecorationOptions[] = [];
    // Group ref badge ranges by commit color so each gets matching dot color
    const refByColor = new Map<string, vscode.DecorationOptions[]>();

    for (let i = 0; i < commits.length && i < rows.length; i++) {
      const line = editor.document.lineAt(i);
      const text = line.text;
      const commit = commits[i];
      const commitColor = rows[i].commitColor;

      const hashMatch = text.match(/^\s*([0-9a-f]{8})/);
      if (hashMatch) {
        const start = text.indexOf(hashMatch[1]);
        hashRanges.push({
          range: new vscode.Range(i, start, i, start + 8),
        });
      }

      // Find each ref token: " name " appearing after the hash
      let searchFrom = 10; // past "  {hash}  "
      for (const ref of commit.refs) {
        const token = ` ${ref.name} `;
        const idx = text.indexOf(token, searchFrom);
        if (idx >= 0) {
          const range = new vscode.Range(i, idx, i, idx + token.length);
          if (!refByColor.has(commitColor)) {
            refByColor.set(commitColor, []);
          }
          refByColor.get(commitColor)!.push({ range });
          this.refHits.push({ ref, commitHash: commit.hash, range });
          searchFrom = idx + token.length;
        }
      }

      const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})\s*$/);
      if (dateMatch) {
        const start = text.lastIndexOf(dateMatch[1]);
        dateRanges.push({
          range: new vscode.Range(i, start, i, start + 10),
        });
      }

      const authorIdx = text.lastIndexOf(commit.author);
      if (authorIdx >= 0) {
        authorRanges.push({
          range: new vscode.Range(i, authorIdx, i, authorIdx + commit.author.length),
        });
      }
    }

    const hashDeco = vscode.window.createTextEditorDecorationType({
      color: "#F5A623",
      fontWeight: "bold",
    });
    const authorDeco = vscode.window.createTextEditorDecorationType({
      color: "#90A4AE",
    });
    const dateDeco = vscode.window.createTextEditorDecorationType({
      color: "#616161",
    });

    editor.setDecorations(hashDeco, hashRanges);
    editor.setDecorations(authorDeco, authorRanges);
    editor.setDecorations(dateDeco, dateRanges);
    this.decorationTypes.push(hashDeco, authorDeco, dateDeco);

    // Create one decoration type per unique commit color.
    // Use CSS injection to shrink the badge height (padding) and add
    // a visible gap between badge and adjacent rows (margin).
    for (const [bgColor, ranges] of refByColor) {
      const textColor = GraphDecorationEngine.isLight(bgColor) ? "#1e1e1e" : "#ffffff";
      // Inject background via CSS instead of VS Code's backgroundColor
      // (which always fills the full line height). CSS background respects
      // the element's inline-block dimensions, giving us control over height.
      const deco = vscode.window.createTextEditorDecorationType({
        color: textColor,
        fontWeight: "bold",
        textDecoration: `none; background: ${bgColor}; border-radius: 3px; display: inline-block; line-height: 1.3; padding: 0px 2px; margin-right: 6px`,
      });
      editor.setDecorations(deco, ranges);
      this.decorationTypes.push(deco);
    }
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
      textDecoration: `none; outline: 2px solid #ff3333; border-radius: 3px; outline-offset: 0px`,
    });
    editor.setDecorations(this.hoverDeco, [{ range: hit.range }]);

    this.hoverTimer = setTimeout(() => {
      this.hoverDeco?.dispose();
      this.hoverDeco = undefined;
    }, 800);
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
      const isOnActiveLine = line === this.activeLine;
      const deco = vscode.window.createTextEditorDecorationType({
        backgroundColor: isOnActiveLine ? "#cc3333" : "#cc3333",
        isWholeLine: true,
        overviewRulerColor: "#5a9bf6",
        overviewRulerLane: vscode.OverviewRulerLane.Center,
        after: {
          contentText: ` [${i + 1}]`,
          color: "#ffffff",
          fontWeight: "bold",
        },
      });
      editor.setDecorations(deco, [new vscode.Range(line, 0, line, 0)]);
      this.selectionDecos.push(deco);
    }
  }

  clearSelections(editor: vscode.TextEditor): void {
    this.selectedRows = [];
    for (const d of this.selectionDecos) d.dispose();
    this.selectionDecos = [];
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
    this.svgCache.clear();
  }
}
