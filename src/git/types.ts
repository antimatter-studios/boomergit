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
  | "other"; // refs/bisect/*, refs/replace/*, refs/original/*, refs/worktree/*, …

export interface Ref {
  name: string;
  type: RefType;
}

/** Capital letter shown in the white box at the head of each badge. */
export const REF_SIGIL: Record<RefType, string> = {
  branch: "B",
  remote: "R",
  tag: "T",
  head: "H",
  stash: "S",
  note: "N",
  pr: "P",
  other: "?",
};

/** Human-readable type name, for the sidebar. */
export const REF_LABEL: Record<RefType, string> = {
  branch: "Branch",
  remote: "Remote",
  tag: "Tag",
  head: "HEAD",
  stash: "Stash",
  note: "Note",
  pr: "Pull Request",
  other: "Ref",
};

/** Characters the sigil box occupies at the start of a badge: " X ". */
export const REF_SIGIL_WIDTH = 3;

/**
 * Longest ref name a badge will show.
 *
 * VS Code's line renderer splits any styled run longer than 50 characters into
 * separate spans, and a decoration's CSS is applied to each span
 * independently — so a badge whose name run exceeds that renders as *two*
 * pills, the second holding the overflow: `…premature-activatio` followed by a
 * lone `n`, or a pill containing nothing but the trailing space.
 *
 * The name run is the name plus one trailing space, so the cap has to leave
 * room for it. 48 keeps a margin under the limit.
 */
export const MAX_BADGE_NAME_LEN = 48;

/**
 * A ref name shortened to fit a badge, with the middle elided.
 *
 * Both ends are kept because both identify a branch: the remote and namespace
 * prefix at the front, and the distinctive tail — a ticket number, a hash
 * suffix — at the back. `Ref.name` itself stays full, so checkout, delete and
 * copy still act on the real name.
 */
export function badgeName(name: string): string {
  if (name.length <= MAX_BADGE_NAME_LEN) return name;
  const kept = MAX_BADGE_NAME_LEN - 1; // one column for the ellipsis
  const head = Math.ceil(kept / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (kept - head))}`;
}

/**
 * Badge text as it appears in the graph document: " X name ".
 * The first REF_SIGIL_WIDTH chars are decorated as the white sigil box, the
 * rest as the commit-coloured name pill — so this is the single source of
 * truth for both the document provider and the decoration engine.
 */
export function refBadgeText(ref: Ref): string {
  return ` ${REF_SIGIL[ref.type]} ${badgeName(ref.name)} `;
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
  if (full.startsWith("refs/heads/")) return { name: full.slice(11), type: "branch" };
  if (full.startsWith("refs/remotes/")) return { name: full.slice(13), type: "remote" };
  if (full.startsWith("refs/tags/")) return { name: full.slice(10), type: "tag" };
  if (full === "refs/stash") return { name: "stash", type: "stash" };
  if (full.startsWith("refs/notes/")) return { name: full.slice(11), type: "note" };
  for (const prefix of PR_PREFIXES) {
    if (!full.startsWith(prefix)) continue;
    const rest = full.slice(prefix.length);
    // refs/pull/42/head -> #42 ; anything odd keeps its path
    const id = rest.split("/")[0];
    return { name: /^\d+$/.test(id) ? `#${id}` : rest, type: "pr" };
  }
  // Gerrit: refs/changes/34/1234/2 — the change number is the middle segment
  if (full.startsWith("refs/changes/")) {
    const parts = full.slice(13).split("/");
    return { name: parts.length >= 2 ? `#${parts[1]}` : parts.join("/"), type: "pr" };
  }
  if (full.startsWith("refs/")) return { name: full.slice(5), type: "other" };
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
      refs.push({ name: name.slice(5).replace(/^refs\/tags\//, ""), type: "tag" });
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
