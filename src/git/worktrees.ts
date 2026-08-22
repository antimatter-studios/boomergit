import { gitQuery } from "./exec.js";

/**
 * A checked-out working tree of this repository.
 *
 * `git log` cannot tell you these exist: it decorates the branches, but nothing
 * in its output says a branch is checked out somewhere else. `git worktree
 * list` is the only source, which makes worktrees a second data source joined
 * onto the graph by commit hash.
 */
export interface Worktree {
  /** Absolute path of the working tree's directory. */
  path: string;
  /** Its directory name — what to call it when there's no branch. */
  name: string;
  /** Commit its HEAD points at. Joins to a graph row. */
  head: string;
  /** Branch it has checked out, or undefined when detached. */
  branch?: string;
  detached: boolean;
  /** The bare parent of a set of worktrees, not a working tree itself. */
  bare: boolean;
  /** `git worktree remove` refuses while locked. */
  locked: boolean;
  /** Reason given when it was locked, if any. */
  lockReason?: string;
  /** Its directory is gone; needs `git worktree prune`. */
  prunable: boolean;
  prunableReason?: string;
  /** True for the worktree the editor currently has open. */
  isCurrent: boolean;
}

/** What to show for a worktree: its branch, or its directory when detached. */
export function worktreeLabel(worktree: Worktree): string {
  return worktree.branch ?? worktree.name;
}

/**
 * Parse `git worktree list --porcelain`.
 *
 * Records are separated by blank lines. Each opens with `worktree <path>` and
 * carries `HEAD <sha>` plus either `branch <ref>` or `detached`; `bare`,
 * `locked` and `prunable` are optional flags, the latter two able to carry a
 * reason on the same line.
 */
export function parseWorktreeList(stdout: string, cwd?: string): Worktree[] {
  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> & { path?: string } = {};

  const flush = () => {
    if (!current.path) return;
    const path = current.path;
    worktrees.push({
      path,
      name: path.split("/").filter(Boolean).pop() ?? path,
      head: current.head ?? "",
      branch: current.branch,
      detached: current.detached ?? false,
      bare: current.bare ?? false,
      locked: current.locked ?? false,
      lockReason: current.lockReason,
      prunable: current.prunable ?? false,
      prunableReason: current.prunableReason,
      isCurrent: cwd !== undefined && path === cwd,
    });
    current = {};
  };

  for (const line of stdout.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) {
      flush();
      continue;
    }
    const spaceAt = trimmed.indexOf(" ");
    const key = spaceAt < 0 ? trimmed : trimmed.slice(0, spaceAt);
    const value = spaceAt < 0 ? "" : trimmed.slice(spaceAt + 1);

    switch (key) {
      case "worktree":
        flush();
        current.path = value;
        break;
      case "HEAD":
        current.head = value;
        break;
      case "branch":
        current.branch = value.replace(/^refs\/heads\//, "");
        break;
      case "detached":
        current.detached = true;
        break;
      case "bare":
        current.bare = true;
        break;
      case "locked":
        current.locked = true;
        if (value) current.lockReason = value;
        break;
      case "prunable":
        current.prunable = true;
        if (value) current.prunableReason = value;
        break;
    }
  }
  flush();
  return worktrees;
}

/** Every working tree of the repository at `cwd`, including `cwd` itself. */
export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  return parseWorktreeList(await gitQuery(["worktree", "list", "--porcelain"], cwd), cwd);
}

/**
 * The worktree holding `branch`, if any — what makes checking out or deleting
 * that branch impossible, since git refuses while another tree has it.
 */
export function worktreeHolding(
  worktrees: Worktree[],
  branch: string
): Worktree | undefined {
  return worktrees.find((w) => !w.isCurrent && !w.bare && w.branch === branch);
}
