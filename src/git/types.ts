export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  refs: Ref[];
}

/**
 * Every ref namespace git will decorate a commit with. `git log --all` only
 * decorates heads/remotes/tags/stash/HEAD by default; the parser asks for
 * `--decorate-refs=refs/*` so notes, PR refs and the rest show up too.
 */
export type RefType =
  | "branch" // refs/heads/*
  | "remote" // refs/remotes/<remote>/*
  | "tag" // refs/tags/* (annotated and lightweight alike)
  | "head" // HEAD — detached, or the marker on the checked-out branch
  | "stash" // refs/stash
  | "note" // refs/notes/*
  | "pr" // refs/pull/*, refs/merge-requests/*, refs/pull-requests/*, refs/changes/*
  | "other" // refs/bisect/*, refs/replace/*, refs/original/*, refs/worktree/*, …
  /**
   * Another working tree has this commit checked out. Not a ref git reports —
   * `git log` has no idea worktrees exist — but it behaves like one everywhere
   * the UI is concerned, so it rides the same badge machinery.
   */
  | "worktree";

export interface Ref {
  name: string;
  type: RefType;
  /**
   * The ref path git reported, before the namespace prefix was stripped for
   * display: `refs/remotes/origin/main` behind the name `origin/main`. Absent
   * for the pseudo-refs that have no path — HEAD, worktrees, `replaced`, and
   * anything arriving in short (`--decorate=short`) form.
   */
  full?: string;
}

/**
 * Capitals shown in the white box at the head of each badge.
 *
 * `LB`/`RB` rather than `B`/`R`: the pair that actually needs telling apart is
 * local branch from remote-tracking branch, and a lone `R` reads as "remote",
 * which is `origin` — a different thing from the branch this ref names. Two
 * letters are the shortest form that says branch *and* which kind. Everything
 * else has no counterpart to be confused with, so it keeps one letter.
 */
export const REF_SIGIL: Record<RefType, string> = {
  branch: "LB",
  remote: "RB",
  tag: "T",
  head: "H",
  stash: "S",
  note: "N",
  pr: "P",
  other: "?",
  worktree: "W",
};

/**
 * Human-readable type name, for the sidebar.
 *
 * "Remote branch", not "Remote": the remote is `origin`, and this ref is a
 * branch that tracks one of its branches. Naming it after the remote made the
 * `R` describe the wrong noun.
 */
export const REF_LABEL: Record<RefType, string> = {
  branch: "Branch",
  remote: "Remote branch",
  tag: "Tag",
  head: "HEAD",
  stash: "Stash",
  note: "Note",
  pr: "Pull Request",
  other: "Custom ref",
  worktree: "Worktree",
};

/**
 * One sentence saying what the badge means, shown on mouse-over.
 *
 * The sigil alone can't carry this: `?` in particular is honest but mute, and
 * a ref in a namespace nobody standardised is exactly the case where the user
 * has no way to guess. Every type gets one so the tip is never a special case.
 */
export const REF_HINT: Record<RefType, string> = {
  branch: "A local branch. Moves forward as you commit on it.",
  remote:
    "A remote-tracking branch — where that branch stood on the remote as of your last fetch. Local edits never move it.",
  tag: "A tag. Pinned to this one commit, unlike a branch.",
  head: "Where your working tree is right now.",
  stash: "The most recent `git stash` entry.",
  note: "A note — text attached to a commit without rewriting it.",
  pr: "A code-review ref published by the host (GitHub, GitLab, Gerrit). Read-only; fetched, never pushed to.",
  other:
    "A ref in a namespace git does not define, so nothing standard says what it is for — usually a tool or script put it here. That is what the `?` means.",
  worktree: "Another working tree has this commit checked out. Not a ref git stores.",
};

/**
 * Sigil field width, in characters. Every sigil is padded to it, so a one-
 * letter `T` and a two-letter `RB` produce the same size white box — badges
 * sitting side by side line up rather than stepping in and out by a character.
 */
export const SIGIL_CHARS = 2;

/** The sigil as it appears in the box: right-padded to a common width. */
export function refSigil(type: RefType): string {
  return REF_SIGIL[type].padEnd(SIGIL_CHARS);
}

/** Characters the sigil box occupies at the start of a badge: " XX ". */
export const REF_SIGIL_WIDTH = SIGIL_CHARS + 2;

/**
 * Badge text as it appears in the graph document: " XX name ".
 * The first REF_SIGIL_WIDTH chars are decorated as the white sigil box, the
 * rest as the commit-coloured name pill — so this is the single source of
 * truth for both the document provider and the decoration engine.
 */
export function refBadgeText(ref: Ref): string {
  return ` ${refSigil(ref.type)} ${ref.name} `;
}

/**
 * The local branch a remote-tracking ref corresponds to: `origin/feature/x`
 * becomes `feature/x`. Only the first segment — the remote name — is dropped,
 * so a branch whose own name contains slashes survives intact.
 */
export function localBranchName(remoteRefName: string): string {
  const firstSlash = remoteRefName.indexOf("/");
  return firstSlash >= 0 ? remoteRefName.slice(firstSlash + 1) : remoteRefName;
}

/** Namespaces that hold code-review refs, and the segment count before the id. */
const PR_PREFIXES = ["refs/pull/", "refs/merge-requests/", "refs/pull-requests/"];

function classify(full: string): Ref {
  if (full === "HEAD") return { name: "HEAD", type: "head" };
  // A commit carrying a refs/replace/* ref is decorated as the bare word
  // "replaced" — not a ref path, even under --decorate=full. Read as a branch
  // it would offer to check out and delete a branch that does not exist.
  // (Bisect refs are not special-cased like this; they arrive as refs/bisect/*.)
  if (full === "replaced") return { name: "replaced", type: "other" };
  if (full.startsWith("refs/heads/")) return { name: full.slice(11), type: "branch", full };
  if (full.startsWith("refs/remotes/")) return { name: full.slice(13), type: "remote", full };
  if (full.startsWith("refs/tags/")) return { name: full.slice(10), type: "tag", full };
  if (full === "refs/stash") return { name: "stash", type: "stash", full };
  if (full.startsWith("refs/notes/")) return { name: full.slice(11), type: "note", full };
  for (const prefix of PR_PREFIXES) {
    if (!full.startsWith(prefix)) continue;
    const rest = full.slice(prefix.length);
    // refs/pull/42/head -> #42 ; anything odd keeps its path
    const id = rest.split("/")[0];
    return { name: /^\d+$/.test(id) ? `#${id}` : rest, type: "pr", full };
  }
  // Gerrit: refs/changes/34/1234/2 — the change number is the middle segment
  if (full.startsWith("refs/changes/")) {
    const parts = full.slice(13).split("/");
    return { name: parts.length >= 2 ? `#${parts[1]}` : parts.join("/"), type: "pr", full };
  }
  if (full.startsWith("refs/")) return { name: full.slice(5), type: "other", full };
  // Short (`--decorate=short`) form: nothing to key off but the slash.
  return { name: full, type: full.includes("/") ? "remote" : "branch" };
}

export function parseRefs(raw: string): Ref[] {
  if (!raw.trim()) return [];
  const refs: Ref[] = [];
  for (const r of raw.split(",")) {
    let name = r.trim();
    if (!name) continue;
    // "tag: v1.0" (short) or "tag: refs/tags/v1.0" (full)
    if (name.startsWith("tag: ")) {
      const tag = name.slice(5);
      const short = tag.replace(/^refs\/tags\//, "");
      refs.push(tag === short ? { name: short, type: "tag" } : { name: short, type: "tag", full: tag });
      continue;
    }
    // "HEAD -> refs/heads/main" — record HEAD and the branch it points at
    if (name.startsWith("HEAD -> ")) {
      refs.push({ name: "HEAD", type: "head" });
      refs.push(classify(name.slice(8)));
      continue;
    }
    // Any other symref ("origin/HEAD -> origin/main"): keep the left side only
    const arrow = name.indexOf(" -> ");
    if (arrow >= 0) name = name.slice(0, arrow);
    refs.push(classify(name));
  }
  return refs;
}
