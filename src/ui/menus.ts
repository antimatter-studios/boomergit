import { shortHash } from "../git/format.js";
import { REF_HINT, REF_LABEL, type Commit, type Ref } from "../git/types.js";
import { COLOR } from "./theme.js";

/**
 * The click menus, built as markdown.
 *
 * They're rendered through VS Code's hover widget — the only native surface
 * that takes arbitrary markup and command links. Entries are `command:` links
 * with URI-encoded JSON arguments, which is the documented way to invoke a
 * command from trusted markdown.
 */

/**
 * Whether a ref names something `git checkout` can actually put you on.
 *
 * `origin/HEAD` is a symbolic ref naming the remote's default branch, and
 * stripping the remote leaves `HEAD` — `git checkout HEAD` exits 0 without
 * changing branches, so offering it would report a checkout that never
 * happened. Every clone has that ref, so this is not a corner case.
 */
function isCheckoutable(ref: Ref): boolean {
  if (ref.type === "branch") return true;
  return ref.type === "remote" && !ref.name.endsWith("/HEAD");
}

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
 * The tooltip shown when the mouse rests on a badge, as opposed to the menu a
 * click opens: what this kind of ref is, and the path git filed it under.
 *
 * The full path is the half the badge cannot show — every namespace prefix is
 * stripped for display, so `fc/pr613` and a branch literally named `fc/pr613`
 * read identically until you see `refs/fc/pr613`.
 */
export function buildRefTip(ref: Ref): string {
  const heading = `${enabled(`**${REF_LABEL[ref.type]}**`)}`;
  const path = ref.full ? `${SEPARATOR}\`${ref.full}\`` : "";
  return `${heading}${path}${SEPARATOR}${REF_HINT[ref.type]}`;
}

/**
 * Horizontal rule between the menu's explanation and its actions. The hover
 * widget renders markdown, so `---` needs the blank lines around it or it is
 * read as a setext underline for the line above.
 */
const RULE = `${SEPARATOR}---${SEPARATOR}`;

/** What the caller knows about a ref that changes which actions are possible. */
export interface BadgeMenuContext {
  /** The branch checked out in the working tree the editor has open. */
  currentBranch?: string;
  /** Another working tree holding this ref's branch, if one does. */
  heldByWorktree?: string;
  /**
   * Why a worktree cannot be created for this ref, if it cannot — git refuses
   * a branch already checked out anywhere, including here.
   */
  worktreeBlockedBy?: string;
}

/**
 * The menu for clicking a ref badge.
 *
 * Which entries appear depends on what the ref actually supports: see
 * isCheckoutable for what can be checked out, and only a local branch can be
 * deleted — never the one currently checked out, and never one another working
 * tree is holding, since git refuses both outright.
 */
export function buildBadgeMenu(
  ref: Ref,
  commit: Commit,
  context: BadgeMenuContext = {}
): string {
  const { currentBranch, heldByWorktree, worktreeBlockedBy } = context;
  const entries: string[] = [];

  if (isCheckoutable(ref)) {
    // `git checkout` fails outright while another working tree holds the
    // branch, so say so rather than offering an action that cannot work.
    entries.push(
      heldByWorktree
        ? disabled(`$(git-branch)&ensp;Checked out in worktree ${heldByWorktree}`)
        : commandLink("$(git-branch)&ensp;Checkout Branch", "boomergit.checkoutRef", [
            ref.name,
            ref.type,
          ])
    );

    // A worktree checks the branch out alongside, instead of moving this one.
    // git refuses a branch already checked out anywhere — including the tree
    // you are in — so both cases are named rather than offered and failed.
    entries.push(
      worktreeBlockedBy
        ? disabled(`$(list-tree)&ensp;Already checked out in ${worktreeBlockedBy}`)
        : commandLink("$(list-tree)&ensp;Create Worktree&hellip;", "boomergit.createWorktree", [
            ref.name,
            ref.type,
          ])
    );
  }

  if (ref.type === "branch") {
    if (ref.name === currentBranch) {
      entries.push(disabled("$(trash)&ensp;Cannot delete current branch"));
    } else if (heldByWorktree) {
      // Same refusal from git: a branch in use by a worktree cannot be deleted.
      entries.push(disabled(`$(trash)&ensp;In use by worktree ${heldByWorktree}`));
    } else {
      entries.push(
        commandLink("$(trash)&ensp;Delete Branch", "boomergit.deleteBranch", [ref.name])
      );
    }
  }

  entries.push(
    copyEntry("$(clippy)&ensp;Copy Ref Name", ref.name, `Copied: ${ref.name}`),
    copyHashEntry(commit)
  );

  // The same explanation the tooltip gives, above the actions: a click
  // dismisses the tooltip, and that is exactly when the user is deciding
  // whether the ref is the one they meant.
  return `${buildRefTip(ref)}${RULE}${entries.join(SEPARATOR)}`;
}

/** The menu for clicking a commit row rather than one of its badges. */
export function buildRowMenu(commit: Commit): string {
  return [
    commandLink("$(git-branch)&ensp;Create Branch Here", "boomergit.createBranch", [commit.hash]),
    copyHashEntry(commit),
    copyEntry("$(note)&ensp;Copy Commit Message", commit.subject, "Copied commit message"),
  ].join(SEPARATOR);
}
