import { describe, it, expect } from "vitest";
import {
  parseWorktreeList,
  worktreeLabel,
  worktreeHolding,
  worktreeDirName,
  resolveWorktreePath,
} from "../src/git/worktrees.js";

/** Build porcelain output the way `git worktree list --porcelain` emits it. */
function porcelain(...records: string[][]): string {
  return records.map((lines) => lines.join("\n")).join("\n\n") + "\n";
}

describe("parseWorktreeList", () => {
  it("returns nothing for empty output", () => {
    expect(parseWorktreeList("")).toEqual([]);
    expect(parseWorktreeList("\n\n")).toEqual([]);
  });

  it("parses an attached worktree", () => {
    const out = porcelain(["worktree /repo", "HEAD abc123", "branch refs/heads/main"]);
    const [wt] = parseWorktreeList(out);
    expect(wt.path).toBe("/repo");
    expect(wt.head).toBe("abc123");
    expect(wt.branch).toBe("main");
    expect(wt.detached).toBe(false);
  });

  it("strips refs/heads/ from the branch", () => {
    const out = porcelain(["worktree /w", "HEAD a", "branch refs/heads/feat/nested/name"]);
    expect(parseWorktreeList(out)[0].branch).toBe("feat/nested/name");
  });

  it("parses a detached worktree as having no branch", () => {
    const out = porcelain(["worktree /w", "HEAD abc", "detached"]);
    const [wt] = parseWorktreeList(out);
    expect(wt.detached).toBe(true);
    expect(wt.branch).toBeUndefined();
  });

  it("parses several records", () => {
    const out = porcelain(
      ["worktree /repo", "HEAD a1", "branch refs/heads/main"],
      ["worktree /wt-feature", "HEAD b2", "branch refs/heads/feature"],
      ["worktree /wt-detached", "HEAD c3", "detached"]
    );
    expect(parseWorktreeList(out).map((w) => w.path)).toEqual([
      "/repo",
      "/wt-feature",
      "/wt-detached",
    ]);
  });

  it("names a worktree after its directory", () => {
    const out = porcelain(["worktree /a/b/wt-feature", "HEAD a", "detached"]);
    expect(parseWorktreeList(out)[0].name).toBe("wt-feature");
  });

  it("tolerates a trailing slash on the path", () => {
    const out = porcelain(["worktree /a/b/wt-feature/", "HEAD a", "detached"]);
    expect(parseWorktreeList(out)[0].name).toBe("wt-feature");
  });

  it("flags a bare parent", () => {
    const out = porcelain(["worktree /bare", "bare"]);
    const [wt] = parseWorktreeList(out);
    expect(wt.bare).toBe(true);
    expect(wt.head).toBe("");
  });

  it("flags a locked worktree and keeps its reason", () => {
    const out = porcelain([
      "worktree /w",
      "HEAD a",
      "branch refs/heads/x",
      "locked on a removable drive",
    ]);
    const [wt] = parseWorktreeList(out);
    expect(wt.locked).toBe(true);
    expect(wt.lockReason).toBe("on a removable drive");
  });

  it("flags a locked worktree with no reason given", () => {
    const out = porcelain(["worktree /w", "HEAD a", "branch refs/heads/x", "locked"]);
    const [wt] = parseWorktreeList(out);
    expect(wt.locked).toBe(true);
    expect(wt.lockReason).toBeUndefined();
  });

  it("flags a prunable worktree and keeps its reason", () => {
    const out = porcelain([
      "worktree /gone",
      "HEAD a",
      "branch refs/heads/x",
      "prunable gitdir file points to non-existent location",
    ]);
    const [wt] = parseWorktreeList(out);
    expect(wt.prunable).toBe(true);
    expect(wt.prunableReason).toBe("gitdir file points to non-existent location");
  });

  it("marks the worktree matching cwd as current", () => {
    const out = porcelain(
      ["worktree /repo", "HEAD a", "branch refs/heads/main"],
      ["worktree /wt", "HEAD b", "branch refs/heads/other"]
    );
    const parsed = parseWorktreeList(out, "/repo");
    expect(parsed.map((w) => w.isCurrent)).toEqual([true, false]);
  });

  it("marks nothing current when cwd is not given", () => {
    const out = porcelain(["worktree /repo", "HEAD a", "branch refs/heads/main"]);
    expect(parseWorktreeList(out)[0].isCurrent).toBe(false);
  });

  it("parses real git output verbatim", () => {
    // Captured from git 2.50.1, including a detached, a locked and a prunable
    const real = [
      "worktree /tmp/wt/repo",
      "HEAD 199007b9d4d408b1ea4a7eeaeaca17a64127b202",
      "branch refs/heads/main",
      "",
      "worktree /tmp/wt/wt-detached",
      "HEAD 199007b9d4d408b1ea4a7eeaeaca17a64127b202",
      "detached",
      "",
      "worktree /tmp/wt/wt-feature",
      "HEAD 199007b9d4d408b1ea4a7eeaeaca17a64127b202",
      "branch refs/heads/feature",
      "prunable gitdir file points to non-existent location",
      "",
      "worktree /tmp/wt/wt-other",
      "HEAD 199007b9d4d408b1ea4a7eeaeaca17a64127b202",
      "branch refs/heads/other",
      "locked",
      "",
    ].join("\n");
    const parsed = parseWorktreeList(real, "/tmp/wt/repo");
    expect(parsed).toHaveLength(4);
    expect(parsed[0].isCurrent).toBe(true);
    expect(parsed[1].detached).toBe(true);
    expect(parsed[2].prunable).toBe(true);
    expect(parsed[3].locked).toBe(true);
  });
});

describe("worktreeLabel", () => {
  it("uses the branch when attached", () => {
    const [wt] = parseWorktreeList(
      "worktree /a/wt-dir\nHEAD a\nbranch refs/heads/my-branch\n"
    );
    expect(worktreeLabel(wt)).toBe("my-branch");
  });

  it("falls back to the directory name when detached", () => {
    const [wt] = parseWorktreeList("worktree /a/wt-dir\nHEAD a\ndetached\n");
    expect(worktreeLabel(wt)).toBe("wt-dir");
  });
});

describe("worktreeHolding", () => {
  const list = parseWorktreeList(
    [
      "worktree /repo",
      "HEAD a",
      "branch refs/heads/main",
      "",
      "worktree /wt-feature",
      "HEAD b",
      "branch refs/heads/feature",
      "",
      "worktree /bare",
      "bare",
      "",
    ].join("\n"),
    "/repo"
  );

  it("finds the worktree holding a branch", () => {
    expect(worktreeHolding(list, "feature")?.path).toBe("/wt-feature");
  });

  it("ignores the current worktree — its branch is checkoutable as normal", () => {
    expect(worktreeHolding(list, "main")).toBeUndefined();
  });

  it("returns nothing for a branch no worktree holds", () => {
    expect(worktreeHolding(list, "unheld")).toBeUndefined();
  });

  it("never returns the bare parent", () => {
    expect(worktreeHolding(list, "")).toBeUndefined();
  });
});

describe("worktreeDirName", () => {
  it("leaves a simple name alone", () => {
    expect(worktreeDirName("feature")).toBe("feature");
  });

  it("flattens the slashes in a namespaced branch", () => {
    expect(worktreeDirName("feat/nested/thing")).toBe("feat-nested-thing");
  });

  it("keeps non-ASCII characters, which the filesystem handles fine", () => {
    expect(worktreeDirName("café-fix")).toBe("café-fix");
  });

  it("replaces characters a path component cannot hold", () => {
    expect(worktreeDirName("odd:name*with?chars")).toBe("odd-name-with-chars");
  });

  it("collapses runs of replacements into one dash", () => {
    expect(worktreeDirName("a//b")).toBe("a-b");
    expect(worktreeDirName("a   b")).toBe("a-b");
  });

  it("trims leading and trailing dashes", () => {
    expect(worktreeDirName("/leading/")).toBe("leading");
  });
});

describe("resolveWorktreePath", () => {
  const repoPath = "/Users/me/projects/boomergit";

  it("defaults to a sibling named <repo>-<branch>", () => {
    expect(
      resolveWorktreePath("feature", { location: "sibling", customPath: "", repoPath })
    ).toBe("/Users/me/projects/boomergit-feature");
  });

  it("flattens a namespaced branch into the sibling's name", () => {
    expect(
      resolveWorktreePath("feat/thing", { location: "sibling", customPath: "", repoPath })
    ).toBe("/Users/me/projects/boomergit-feat-thing");
  });

  it("puts a worktree under an absolute custom directory", () => {
    expect(
      resolveWorktreePath("feature", {
        location: "custom",
        customPath: "/tmp/trees",
        repoPath,
      })
    ).toBe("/tmp/trees/feature");
  });

  it("expands ${workspaceFolder}, giving the inside-the-repo layout", () => {
    expect(
      resolveWorktreePath("feature", {
        location: "custom",
        customPath: "${workspaceFolder}/.worktrees",
        repoPath,
      })
    ).toBe("/Users/me/projects/boomergit/.worktrees/feature");
  });

  it("resolves a relative custom path against the repository", () => {
    expect(
      resolveWorktreePath("feature", {
        location: "custom",
        customPath: ".worktrees",
        repoPath,
      })
    ).toBe("/Users/me/projects/boomergit/.worktrees/feature");
  });

  it("falls back to sibling when custom is selected but left empty", () => {
    // Better than creating a worktree at an unexpected place
    expect(
      resolveWorktreePath("feature", { location: "custom", customPath: "", repoPath })
    ).toBe("/Users/me/projects/boomergit-feature");
  });

  it("falls back to sibling when custom is only whitespace", () => {
    expect(
      resolveWorktreePath("feature", { location: "custom", customPath: "   ", repoPath })
    ).toBe("/Users/me/projects/boomergit-feature");
  });

  it("tolerates a trailing slash on the repository path", () => {
    expect(
      resolveWorktreePath("feature", {
        location: "sibling",
        customPath: "",
        repoPath: "/Users/me/projects/boomergit/",
      })
    ).toBe("/Users/me/projects/boomergit-feature");
  });

  it("tolerates a trailing slash on the custom directory", () => {
    expect(
      resolveWorktreePath("feature", {
        location: "custom",
        customPath: "/tmp/trees/",
        repoPath,
      })
    ).toBe("/tmp/trees/feature");
  });

  it("handles a repository at the filesystem root", () => {
    expect(
      resolveWorktreePath("feature", { location: "sibling", customPath: "", repoPath: "/repo" })
    ).toBe("/repo-feature");
  });
});
