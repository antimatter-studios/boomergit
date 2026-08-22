/**
 * Interaction timings, in milliseconds.
 *
 * These are all workarounds for the same underlying problem: the graph is a
 * read-only text document pretending to be an interactive widget, so clicks,
 * cursor moves and hovers have to be sequenced around VS Code's own handling
 * of them. The values are empirical — each comment says what breaks if it's
 * wrong, because the numbers are meaningless without that.
 */
export const TIMING = {
  /**
   * How long to ignore selection events after moving the cursor ourselves.
   * Without it, a programmatic cursor reset is indistinguishable from a real
   * click and the menu immediately reopens.
   */
  ignoreSelfSelectionMs: 200,

  /**
   * Delay before asking for the hover after a click. The hover renders at the
   * cursor's position, so it has to be requested after VS Code has finished
   * moving the cursor or the menu appears at the previous row.
   */
  openMenuMs: 50,

  /**
   * Delay before resetting the cursor when a menu is opening. Longer than
   * `openMenuMs` so the hover has already positioned itself; resetting sooner
   * moves the menu.
   */
  cursorResetWithMenuMs: 250,

  /**
   * How long to wait for VS Code to pick up regenerated document content
   * before decorating it. A fallback only — the change event normally fires
   * first, and this covers the case where the content didn't actually change.
   */
  documentUpdateMs: 200,

  /**
   * Poll interval for the auto-refresh fallback, used only when the built-in
   * Git extension isn't available to tell us the repository changed.
   */
  refreshPollMs: 3000,

  /** How long the auto-refresh confirmation stays in the status bar. */
  toastMs: 2000,

  /** How long a ref badge stays outlined after the pointer leaves it. */
  badgeHighlightMs: 800,
} as const;
