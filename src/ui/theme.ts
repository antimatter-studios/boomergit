import type { RefType } from "../git/types.js";

/**
 * Every colour BoomerGit paints itself with.
 *
 * Named for role, not value, so a reader never has to ask what `#616161` is
 * doing. These are literals rather than VS Code theme tokens because the graph
 * is drawn as SVG tiles plus injected CSS, neither of which can resolve a
 * `--vscode-*` variable.
 */
export const COLOR = {
  /**
   * The editor background the graph is drawn against. SVG tiles paint a halo
   * of this colour behind each line so crossing lanes read as passing over
   * one another rather than merging.
   */
  editorBackground: "#1e1e1e",

  /**
   * Commit hash. Deliberately the same orange as the first branch lane —
   * kept as its own literal so re-ordering BRANCH_COLORS doesn't silently
   * change the hash colour too.
   */
  commitHash: "#F5A623",
  author: "#90A4AE",
  date: "#616161",

  /** The row holding the checked-out branch: inverted to stand out. */
  activeRowBackground: "#ffffff",
  activeRowText: "#1e1e1e",

  /** The type sigil box at the head of every ref badge. */
  sigilBackground: "#ffffff",
  sigilText: "#000000",

  /**
   * Badge name text. Which one applies depends on the lane colour behind it —
   * see `isLight` in the decoration engine.
   */
  badgeTextOnLight: "#1e1e1e",
  badgeTextOnDark: "#ffffff",

  /** Outline drawn around a ref badge while the pointer is over it. */
  badgeHighlight: "#ff3333",

  /**
   * Anything marking "another working tree has this checked out": the ring
   * around the commit dot, its badge, and its tick in the overview ruler. One
   * token so the three cannot drift apart.
   */
  worktreeAccent: "#73c991",

  /**
   * Whole-row tint for the same thing, when `worktrees.rowStyle` asks for it.
   * Dark enough that the normal row colours stay readable on top — a tint, not
   * a highlight.
   */
  worktreeRow: "#1b3a29",

  /** A row picked for compare, and its marker in the overview ruler. */
  selectedRow: "#cc3333",
  selectedRowMarker: "#5a9bf6",

  /** Click-menu entries. Disabled entries are greyed rather than hidden. */
  menuText: "#ffffff",
  menuTextDisabled: "#888888",

  /** Border on the hover widget, so a click menu reads as a panel. */
  hoverWidgetBorder: "#ffffff",
} as const;

/**
 * Badge colour per ref type, for the Commit Info sidebar.
 *
 * The graph colours a badge by its commit's lane instead — there the lane
 * colour is the useful signal, and the sigil letter carries the type.
 */
export const REF_BADGE_COLOR: Record<RefType, string> = {
  branch: "#4ec9b0",
  tag: "#dcdcaa",
  remote: "#9cdcfe",
  head: "#c586c0",
  stash: "#ce9178",
  note: "#b5cea8",
  pr: "#569cd6",
  other: "#888888",
  worktree: COLOR.worktreeAccent,
};
