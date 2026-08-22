/**
 * What a click on the graph means.
 *
 * The graph is a read-only text document, so every interaction arrives as a
 * selection change and has to be interpreted. Separating that decision from
 * the code that acts on it keeps the four cases legible — and testable, which
 * the event wiring itself is not.
 */
export type ClickIntent =
  /** On a ref badge: show that ref's menu and title the sidebar after it. */
  | "badge-menu"
  /** Cmd-click, or a plain click with nothing selected: pick the row, open its menu. */
  | "select-row"
  /** A plain click while rows are selected: treat it as "get out of my way". */
  | "dismiss";

export interface ClickContext {
  /** Cmd/Ctrl was held — the user is picking rows to compare. */
  isCmdClick: boolean;
  /** The click landed inside a ref badge. */
  onBadge: boolean;
  /** Rows are already selected for compare. */
  hasSelections: boolean;
}

/**
 * A badge click only reads as a badge click without a modifier: Cmd-clicking a
 * badge is still the user building up a compare selection, and the row is what
 * matters there.
 */
export function resolveClickIntent({
  isCmdClick,
  onBadge,
  hasSelections,
}: ClickContext): ClickIntent {
  if (onBadge && !isCmdClick) return "badge-menu";
  if (isCmdClick) return "select-row";
  return hasSelections ? "dismiss" : "select-row";
}
