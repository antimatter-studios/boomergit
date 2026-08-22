import { describe, it, expect } from "vitest";
import {
  parseWorktreeList,
  worktreeLabel,
  worktreeHolding,
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
