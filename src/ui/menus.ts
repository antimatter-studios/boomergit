import { shortHash } from "../git/format.js";
import type { Commit, Ref } from "../git/types.js";
import { COLOR } from "./theme.js";

/**
 * The click menus, built as markdown.
 *
 * They're rendered through VS Code's hover widget — the only native surface
 * that takes arbitrary markup and command links. Entries are `command:` links
 * with URI-encoded JSON arguments, which is the documented way to invoke a
 * command from trusted markdown.
 */

/** Menu text has to be coloured explicitly; the hover widget's default is dim. */
function enabled(text: string): string {
  return `<span style="color:${COLOR.menuText};">${text}</span>`;
}

/** An entry that can't be actioned is greyed rather than hidden, so the menu doesn't jump. */
function disabled(text: string): string {
  return `<span style="color:${COLOR.menuTextDisabled};">${text}</span>`;
}

function commandLink(label: string, command: string, args: unknown[]): string {
  const encoded = encodeURIComponent(JSON.stringify(args));
  return `[${enabled(label)}](command:${command}?${encoded})`;
}

/** Blank line between entries — the hover renders each as its own paragraph. */
const SEPARATOR = "\n\n";

function copyEntry(label: string, text: string, confirmation: string): string {
  return commandLink(label, "boomergit.copyText", [text, confirmation]);
}

function copyHashEntry(commit: Commit): string {
  return copyEntry(
    "$(git-commit)&ensp;Copy Commit Hash",
    commit.hash,
    `Copied: ${shortHash(commit.hash)}`
  );
}

/**
 * The menu for clicking a ref badge.
 *
 * Which entries appear depends on what the ref actually supports: only
 * branches and remote-tracking refs can be checked out, and only a local
 * branch can be deleted — and never the one currently checked out.
 */
export function buildBadgeMenu(ref: Ref, commit: Commit, currentBranch?: string): string {
  const entries: string[] = [];

  if (ref.type === "branch" || ref.type === "remote") {
    entries.push(
      commandLink("$(git-branch)&ensp;Checkout Branch", "boomergit.checkoutRef", [
        ref.name,
        ref.type,
      ])
    );
  }

  if (ref.type === "branch") {
    entries.push(
      ref.name === currentBranch
        ? disabled("$(trash)&ensp;Cannot delete current branch")
        : commandLink("$(trash)&ensp;Delete Branch", "boomergit.deleteBranch", [ref.name])
    );
  }

  entries.push(
    copyEntry("$(clippy)&ensp;Copy Ref Name", ref.name, `Copied: ${ref.name}`),
    copyHashEntry(commit)
  );

  return entries.join(SEPARATOR);
}

/** The menu for clicking a commit row rather than one of its badges. */
export function buildRowMenu(commit: Commit): string {
  return [
    commandLink("$(git-branch)&ensp;Create Branch Here", "boomergit.createBranch", [commit.hash]),
    copyHashEntry(commit),
    copyEntry("$(note)&ensp;Copy Commit Message", commit.subject, "Copied commit message"),
  ].join(SEPARATOR);
}
