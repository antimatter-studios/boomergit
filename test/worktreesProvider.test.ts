import { describe, it, expect, beforeEach } from "vitest";
import { __reset, TreeItem, TreeItemCollapsibleState } from "./mocks/vscode.js";
import { WorktreesProvider } from "../src/providers/worktreesProvider.js";
import { parseWorktreeList } from "../src/git/worktrees.js";

/** Build porcelain output the way `git worktree list --porcelain` emits it. */
function porcelain(...records: string[][]): string {
  return records.map((lines) => lines.join("\n")).join("\n\n") + "\n";
}

const REPO = ["worktree /repo", "HEAD " + "a".repeat(40), "branch refs/heads/main"];
const FEATURE = ["worktree /wt-feature", "HEAD " + "b".repeat(40), "branch refs/heads/feature"];
const DETACHED = ["worktree /wt-loose", "HEAD " + "c".repeat(40), "detached"];

function provider(out: string, cwd = "/repo") {
  const p = new WorktreesProvider();
  p.setWorktrees(parseWorktreeList(out, cwd));
  return p;
}

beforeEach(() => {
  __reset();
});

describe("WorktreesProvider", () => {
  it("starts empty", () => {
    expect(new WorktreesProvider().getChildren()).toEqual([]);
  });

  it("lists one item per worktree", () => {
    expect(provider(porcelain(REPO, FEATURE, DETACHED)).getChildren()).toHaveLength(3);
  });

  it("labels an attached worktree with its branch", () => {
    const items = provider(porcelain(REPO, FEATURE)).getChildren();
    expect(items.map((i) => i.label)).toContain("feature");
  });

  it("labels a detached worktree with its directory", () => {
    const items = provider(porcelain(REPO, DETACHED)).getChildren();
    expect(items.map((i) => i.label)).toContain("wt-loose");
  });

  it("puts the current worktree first", () => {
    // Alphabetically 'feature' precedes 'main', so ordering must be deliberate
    const items = provider(porcelain(FEATURE, REPO)).getChildren();
    expect(items[0].label).toBe("main");
  });

  it("sorts the rest by label, so the list is stable as HEADs move", () => {
    const zed = ["worktree /wt-zed", "HEAD " + "d".repeat(40), "branch refs/heads/zed"];
    const items = provider(porcelain(REPO, zed, FEATURE)).getChildren();
    expect(items.map((i) => i.label)).toEqual(["main", "feature", "zed"]);
  });

  it("marks the current worktree in its description", () => {
    const items = provider(porcelain(REPO, FEATURE)).getChildren();
    const current = items.find((i) => i.label === "main")!;
    expect(String((current as { description?: string }).description)).toContain("current");
  });

  it("shows the short hash of each worktree's HEAD", () => {
    const items = provider(porcelain(REPO, FEATURE)).getChildren();
    const feature = items.find((i) => i.label === "feature")!;
    expect(String((feature as { description?: string }).description)).toContain("bbbbbbbb");
  });

  it("describes detached, locked and prunable states", () => {
    const odd = [
      "worktree /wt-odd",
      "HEAD " + "e".repeat(40),
      "detached",
      "locked because reasons",
      "prunable gitdir file points to non-existent location",
    ];
    const items = provider(porcelain(REPO, odd)).getChildren();
    const description = String(
      (items.find((i) => i.label === "wt-odd") as { description?: string }).description
    );
    expect(description).toContain("detached");
    expect(description).toContain("locked");
    expect(description).toContain("prunable");
  });

  it("puts the path and branch in the tooltip", () => {
    const items = provider(porcelain(REPO, FEATURE)).getChildren();
    const tooltip = String(items.find((i) => i.label === "feature")!.tooltip);
    expect(tooltip).toContain("/wt-feature");
    expect(tooltip).toContain("Branch: feature");
  });

  it("says 'Detached HEAD' in a detached worktree's tooltip", () => {
    const items = provider(porcelain(REPO, DETACHED)).getChildren();
    const tooltip = String(items.find((i) => i.label === "wt-loose")!.tooltip);
    expect(tooltip).toContain("Detached HEAD");
  });

  it("explains a lock reason in the tooltip", () => {
    const locked = [
      "worktree /wt-lk",
      "HEAD " + "f".repeat(40),
      "branch refs/heads/lk",
      "locked on a removable drive",
    ];
    const items = provider(porcelain(REPO, locked)).getChildren();
    const tooltip = String(items.find((i) => i.label === "lk")!.tooltip);
    expect(tooltip).toContain("Locked: on a removable drive");
  });

  it("warns on a prunable worktree", () => {
    const gone = [
      "worktree /wt-gone",
      "HEAD " + "0".repeat(40),
      "branch refs/heads/gone",
      "prunable gitdir file points to non-existent location",
    ];
    const items = provider(porcelain(REPO, gone)).getChildren();
    const item = items.find((i) => i.label === "gone")!;
    expect((item.iconPath as { id: string }).id).toBe("warning");
  });

  it("checks off the current worktree, and branch-icons the others", () => {
    const items = provider(porcelain(REPO, FEATURE)).getChildren();
    expect((items.find((i) => i.label === "main")!.iconPath as { id: string }).id).toBe("check");
    expect((items.find((i) => i.label === "feature")!.iconPath as { id: string }).id).toBe(
      "git-branch"
    );
  });

  it("uses a commit icon for a detached worktree", () => {
    const items = provider(porcelain(REPO, DETACHED)).getChildren();
    expect((items.find((i) => i.label === "wt-loose")!.iconPath as { id: string }).id).toBe(
      "git-commit"
    );
  });

  it("clicking an item reveals the commit it sits on", () => {
    const items = provider(porcelain(REPO, FEATURE)).getChildren();
    const feature = items.find((i) => i.label === "feature")!;
    expect(feature.command?.command).toBe("boomergit.revealWorktree");
    expect(feature.command?.arguments).toEqual(["b".repeat(40)]);
  });

  it("distinguishes the current worktree by contextValue, so menus can differ", () => {
    const items = provider(porcelain(REPO, FEATURE)).getChildren();
    expect(items.find((i) => i.label === "main")!.contextValue).toBe("worktreeCurrent");
    expect(items.find((i) => i.label === "feature")!.contextValue).toBe("worktree");
  });

  it("has no children below a worktree", () => {
    const p = provider(porcelain(REPO, FEATURE));
    expect(p.getChildren(p.getChildren()[0])).toEqual([]);
  });

  it("empties on clear", () => {
    const p = provider(porcelain(REPO, FEATURE));
    p.clear();
    expect(p.getChildren()).toEqual([]);
  });

  it("notifies listeners when the list changes", () => {
    const p = new WorktreesProvider();
    let fires = 0;
    p.onDidChangeTreeData(() => fires++);
    p.setWorktrees(parseWorktreeList(porcelain(REPO), "/repo"));
    p.clear();
    expect(fires).toBe(2);
  });

  it("returns the element unchanged from getTreeItem", () => {
    const p = new WorktreesProvider();
    const item = new TreeItem("x");
    expect(p.getTreeItem(item as never)).toBe(item);
  });

  it("renders worktrees as leaf items", () => {
    const items = provider(porcelain(REPO, FEATURE)).getChildren();
    expect(items.every((i) => i.collapsibleState === TreeItemCollapsibleState.None)).toBe(true);
  });
});
