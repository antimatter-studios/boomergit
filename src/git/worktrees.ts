import { gitQuery, gitQueryTrimmed } from "./exec.js";

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
  /**
   * True for the repository's own checkout — git's "main worktree", as opposed
   * to the "linked worktrees" that `git worktree add` creates.
   *
   * It isn't a worktree in the sense that matters to the graph: it's the
   * repository, already described by its HEAD and branch badges. Only linked
   * worktrees are worth marking as checked out elsewhere.
   */
  isMain: boolean;
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
export function parseWorktreeList(
  stdout: string,
  /** Path git itself reports for the current working tree, not the one the
   * editor was opened with — see listWorktrees. */
  currentWorktreePath?: string
): Worktree[] {
  const currentPath =
    currentWorktreePath === undefined ? undefined : normalisePath(currentWorktreePath);
  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> & { path?: string } = {};

  const flush = () => {
    if (!current.path) return;
    const path = current.path;
    // git lists the main worktree first, from whichever worktree you ask —
    // verified against 2.50.1 from the main tree and from two linked ones.
    const isMain = worktrees.length === 0;
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
      isCurrent: currentPath !== undefined && normalisePath(path) === currentPath,
      isMain,
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

/**
 * Every working tree of the repository at `cwd`, including `cwd` itself.
 *
 * Which one is current is decided by asking git, not by comparing the path the
 * editor gave us: git reports resolved paths, so a repository opened at
 * `/tmp/x` appears as `/private/tmp/x` on macOS and a string compare fails —
 * leaving the working tree you are in looking like somebody else's, badged W
 * and tinted. Any symlinked path does this, not only /tmp.
 */
export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  const [porcelain, topLevel] = await Promise.all([
    gitQuery(["worktree", "list", "--porcelain"], cwd),
    gitQueryTrimmed(["rev-parse", "--show-toplevel"], cwd),
  ]);
  // A bare repository has no top level; fall back rather than mark nothing.
  return parseWorktreeList(porcelain, topLevel || cwd);
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

/** Where new worktrees are placed, from `boomergit.worktrees.location`. */
export type WorktreeLocation = "sibling" | "custom";

export interface WorktreePlacement {
  location: WorktreeLocation;
  /** Parent directory when location is "custom". `${workspaceFolder}` expands. */
  customPath: string;
  /** Absolute path of the repository the graph is showing. */
  repoPath: string;
}

/**
 * Characters that can't go in a path component, plus the slash a branch name
 * so often contains — `feat/thing` has to become one directory, not two.
 */
const UNSAFE_IN_DIR_NAME = /[/\\:*?"<>|\s]+/g;

/**
 * A branch name as a single directory component.
 *
 * Deliberately not a strict ASCII slug: a branch named `café-fix` should keep
 * its name, since the filesystem has no problem with it. Only characters that
 * genuinely can't appear in one path component are replaced.
 */
export function worktreeDirName(branch: string): string {
  return branch
    .replace(UNSAFE_IN_DIR_NAME, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** One spelling of a path, so two of them compare equal. */
function normalisePath(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Join two path fragments without needing node:path in this module. */
function join(base: string, child: string): string {
  return `${base.replace(/\/+$/, "")}/${child}`;
}

function parentOf(absolutePath: string): string {
  const trimmed = absolutePath.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut <= 0 ? "/" : trimmed.slice(0, cut);
}

function nameOf(absolutePath: string): string {
  return absolutePath.replace(/\/+$/, "").split("/").pop() ?? absolutePath;
}

/**
 * Where a new worktree for `branch` should be created.
 *
 * "sibling" puts it next to the repository as `<repo>-<branch>`, which keeps
 * worktrees out of the repository itself — nothing to gitignore, and the editor
 * never shows them as stray folders.
 *
 * "custom" takes a parent directory, so `${workspaceFolder}/.worktrees` gives
 * the inside-the-repo layout (worth gitignoring). A relative path is resolved
 * against the repository, and an empty one falls back to sibling rather than
 * creating a worktree somewhere surprising.
 */
export function resolveWorktreePath(branch: string, placement: WorktreePlacement): string {
  const dirName = worktreeDirName(branch);
  const { location, customPath, repoPath } = placement;

  if (location === "custom" && customPath.trim()) {
    const expanded = customPath.trim().replace(/\$\{workspaceFolder\}/g, repoPath);
    const parent = expanded.startsWith("/") ? expanded : join(repoPath, expanded);
    return join(parent, dirName);
  }

  return join(parentOf(repoPath), `${nameOf(repoPath)}-${dirName}`);
}
