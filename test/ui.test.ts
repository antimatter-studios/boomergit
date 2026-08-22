import { describe, it, expect } from "vitest";
import { buildBadgeMenu, buildRowMenu } from "../src/ui/menus.js";
import { resolveClickIntent } from "../src/ui/clickIntent.js";
import { computeDiffTarget } from "../src/ui/diffTarget.js";
import { EMPTY_REF } from "../src/providers/gitFileContentProvider.js";
import { TIMING } from "../src/ui/timings.js";
import { COLOR, REF_BADGE_COLOR } from "../src/ui/theme.js";
import { REF_SIGIL, REF_LABEL, type Commit, type Ref } from "../src/git/types.js";
import type { ChangedFile } from "../src/providers/changedFilesProvider.js";

function commit(over: Partial<Commit> = {}): Commit {
  return {
    hash: "abcdef1234567890abcdef1234567890abcdef12",
    parents: [],
    author: "Ada",
    email: "ada@x.dev",
    timestamp: 1700000000,
    subject: "feat: a thing",
    refs: [],
    ...over,
  };
}

/** Decode the JSON arguments out of the first `command:` link for `command`. */
function linkArgs(markdown: string, command: string): unknown[] | undefined {
  const match = markdown.match(new RegExp(`command:${command}\\?([^)]*)\\)`));
  return match ? JSON.parse(decodeURIComponent(match[1])) : undefined;
}

describe("buildBadgeMenu", () => {
  const branch: Ref = { name: "feature", type: "branch" };

  it("offers checkout for a local branch", () => {
    const md = buildBadgeMenu(branch, commit());
    expect(md).toContain("Checkout Branch");
    expect(linkArgs(md, "boomergit.checkoutRef")).toEqual(["feature", "branch"]);
  });

  it("offers checkout for a remote-tracking branch", () => {
    const md = buildBadgeMenu({ name: "origin/feature", type: "remote" }, commit());
    expect(linkArgs(md, "boomergit.checkoutRef")).toEqual(["origin/feature", "remote"]);
  });

  it("offers no checkout for a tag", () => {
    expect(buildBadgeMenu({ name: "v1.0", type: "tag" }, commit())).not.toContain("Checkout");
  });

  it("offers no checkout for a remote's symbolic HEAD", () => {
    // git checkout HEAD exits 0 without changing branches, so offering it
    // would report a checkout that never happened. Every clone has this ref.
    const md = buildBadgeMenu({ name: "origin/HEAD", type: "remote" }, commit());
    expect(md).not.toContain("Checkout");
  });

  it("still offers checkout for a branch legitimately named ...HEADless", () => {
    const md = buildBadgeMenu({ name: "origin/HEADless", type: "remote" }, commit());
    expect(md).toContain("Checkout Branch");
  });

  it.each(["stash", "note", "pr", "other", "head"] as const)(
    "offers no checkout for a %s ref",
    (type) => {
      expect(buildBadgeMenu({ name: "x", type }, commit())).not.toContain("Checkout");
    }
  );

  it("offers delete for a branch that isn't checked out", () => {
    const md = buildBadgeMenu(branch, commit(), "main");
    expect(md).toContain("Delete Branch");
    expect(linkArgs(md, "boomergit.deleteBranch")).toEqual(["feature"]);
  });

  it("refuses to delete the checked-out branch, and says why", () => {
    const md = buildBadgeMenu(branch, commit(), "feature");
    expect(md).toContain("Cannot delete current branch");
    expect(md).not.toContain("command:boomergit.deleteBranch");
  });

  it("greys the refusal rather than hiding it", () => {
    expect(buildBadgeMenu(branch, commit(), "feature")).toContain(COLOR.menuTextDisabled);
  });

  it("offers no delete for a remote-tracking branch", () => {
    const md = buildBadgeMenu({ name: "origin/feature", type: "remote" }, commit());
    expect(md).not.toContain("Delete Branch");
  });

  it("refuses checkout when another worktree holds the branch", () => {
    // git checkout fails outright here, so the menu must not offer it
    const md = buildBadgeMenu(branch, commit(), "main", "wt-feature");
    expect(md).toContain("Checked out in worktree wt-feature");
    expect(md).not.toContain("command:boomergit.checkoutRef");
  });

  it("refuses delete when another worktree holds the branch", () => {
    const md = buildBadgeMenu(branch, commit(), "main", "wt-feature");
    expect(md).toContain("In use by worktree wt-feature");
    expect(md).not.toContain("command:boomergit.deleteBranch");
  });

  it("greys both refusals rather than hiding them", () => {
    const md = buildBadgeMenu(branch, commit(), "main", "wt-feature");
    expect(md.split(COLOR.menuTextDisabled).length - 1).toBe(2);
  });

  it("offers both actions when no worktree holds the branch", () => {
    const md = buildBadgeMenu(branch, commit(), "main");
    expect(md).toContain("command:boomergit.checkoutRef");
    expect(md).toContain("command:boomergit.deleteBranch");
  });

  it("prefers the current-branch refusal over the worktree one", () => {
    // Can't happen in practice, but the message must be the accurate one
    const md = buildBadgeMenu(branch, commit(), "feature", "wt-feature");
    expect(md).toContain("Cannot delete current branch");
  });

  it("offers no worktree actions on a worktree badge itself", () => {
    const md = buildBadgeMenu({ name: "wt-feature", type: "worktree" }, commit());
    expect(md).not.toContain("Checkout");
    expect(md).not.toContain("Delete Branch");
    expect(md).toContain("Copy Ref Name");
  });

  it("always offers to copy the ref name and the commit hash", () => {
    const md = buildBadgeMenu({ name: "v1.0", type: "tag" }, commit());
    expect(md).toContain("Copy Ref Name");
    expect(md).toContain("Copy Commit Hash");
  });

  it("copies the full hash but confirms with the short one", () => {
    const md = buildBadgeMenu(branch, commit());
    const args = md
      .split("\n\n")
      .map((entry) => linkArgs(entry, "boomergit.copyText"))
      .filter(Boolean)
      .find((a) => (a as string[])[0].length === 40) as string[];
    expect(args[0]).toBe("abcdef1234567890abcdef1234567890abcdef12");
    expect(args[1]).toBe("Copied: abcdef12");
  });

  it("separates entries with a blank line", () => {
    expect(buildBadgeMenu(branch, commit(), "main").split("\n\n")).toHaveLength(4);
  });

  it("acts on the full ref name even when the badge shows a shortened one", () => {
    // The badge elides the middle; checkout must still get the real name
    const longName = "origin/dependabot/github_actions/github-actions-bc056f11d8";
    const md = buildBadgeMenu({ name: longName, type: "remote" }, commit());
    expect(linkArgs(md, "boomergit.checkoutRef")).toEqual([longName, "remote"]);
  });

  it("copies the full ref name, not the shortened one", () => {
    const longName = "origin/fix/cost-allocation-tag-premature-activation";
    const md = buildBadgeMenu({ name: longName, type: "branch" }, commit());
    const copyArgs = md
      .split("\n\n")
      .map((entry) => linkArgs(entry, "boomergit.copyText"))
      .filter(Boolean)
      .find((a) => (a as string[])[0] === longName);
    expect(copyArgs).toBeDefined();
  });

  it("escapes a ref name safely into the command arguments", () => {
    const md = buildBadgeMenu({ name: "feat/a b&c", type: "branch" }, commit());
    expect(linkArgs(md, "boomergit.checkoutRef")).toEqual(["feat/a b&c", "branch"]);
  });
});

describe("buildRowMenu", () => {
  it("offers branch creation at that commit", () => {
    const md = buildRowMenu(commit());
    expect(linkArgs(md, "boomergit.createBranch")).toEqual([
      "abcdef1234567890abcdef1234567890abcdef12",
    ]);
  });

  it("offers to copy the hash and the message", () => {
    const md = buildRowMenu(commit());
    expect(md).toContain("Copy Commit Hash");
    expect(md).toContain("Copy Commit Message");
  });

  it("has exactly three entries", () => {
    expect(buildRowMenu(commit()).split("\n\n")).toHaveLength(3);
  });

  it("offers no ref actions", () => {
    const md = buildRowMenu(commit());
    expect(md).not.toContain("Checkout");
    expect(md).not.toContain("Delete Branch");
  });
});

describe("resolveClickIntent", () => {
  it("shows the badge menu for a plain click on a badge", () => {
    expect(
      resolveClickIntent({ isCmdClick: false, onBadge: true, hasSelections: false })
    ).toBe("badge-menu");
  });

  it("still shows the badge menu when rows are selected", () => {
    expect(resolveClickIntent({ isCmdClick: false, onBadge: true, hasSelections: true })).toBe(
      "badge-menu"
    );
  });

  it("treats a Cmd-click on a badge as building a compare selection", () => {
    expect(resolveClickIntent({ isCmdClick: true, onBadge: true, hasSelections: false })).toBe(
      "select-row"
    );
  });

  it("selects the row on a plain click with nothing selected", () => {
    expect(resolveClickIntent({ isCmdClick: false, onBadge: false, hasSelections: false })).toBe(
      "select-row"
    );
  });

  it("dismisses on a plain click while rows are selected", () => {
    expect(resolveClickIntent({ isCmdClick: false, onBadge: false, hasSelections: true })).toBe(
      "dismiss"
    );
  });

  it("never dismisses on a Cmd-click", () => {
    expect(resolveClickIntent({ isCmdClick: true, onBadge: false, hasSelections: true })).toBe(
      "select-row"
    );
  });
});

describe("computeDiffTarget", () => {
  const commitHash = "1111111111111111111111111111111111111111";
  const parentHash = "2222222222222222222222222222222222222222";

  it("diffs a modified file between parent and commit", () => {
    const target = computeDiffTarget({ status: "M", path: "src/a.ts" }, commitHash, parentHash);
    expect(target.leftRef).toBe(parentHash);
    expect(target.rightRef).toBe(commitHash);
    expect(target.leftPath).toBe("src/a.ts");
    expect(target.rightPath).toBe("src/a.ts");
  });

  it("shows nothing on the left for an added file", () => {
    const target = computeDiffTarget({ status: "A", path: "new.ts" }, commitHash, parentHash);
    expect(target.leftRef).toBe(EMPTY_REF);
    expect(target.leftLabel).toBe("New File");
  });

  it("shows nothing on the right for a deleted file", () => {
    const target = computeDiffTarget({ status: "D", path: "gone.ts" }, commitHash, parentHash);
    expect(target.rightRef).toBe(EMPTY_REF);
    expect(target.rightLabel).toBe("Deleted");
  });

  it("shows nothing on the left for a root commit, which has no parent", () => {
    const target = computeDiffTarget({ status: "M", path: "a.ts" }, commitHash, "");
    expect(target.leftRef).toBe(EMPTY_REF);
    expect(target.leftLabel).toBe("New File");
  });

  it("uses the old path on the left of a rename", () => {
    const file: ChangedFile = { status: "R", path: "new.ts", oldPath: "old.ts" };
    const target = computeDiffTarget(file, commitHash, parentHash);
    expect(target.leftPath).toBe("old.ts");
    expect(target.rightPath).toBe("new.ts");
  });

  it("abbreviates both hashes in the labels", () => {
    const target = computeDiffTarget({ status: "M", path: "a.ts" }, commitHash, parentHash);
    expect(target.leftLabel).toBe("Parent 22222222");
    expect(target.rightLabel).toBe("Commit 11111111");
  });

  it("titles the diff after the file's basename", () => {
    const target = computeDiffTarget(
      { status: "M", path: "src/deep/file.ts" },
      commitHash,
      parentHash
    );
    expect(target.title).toBe("file.ts (Parent 22222222 ↔ Commit 11111111)");
  });

  it("handles a root-level path with no directory", () => {
    const target = computeDiffTarget({ status: "M", path: "README.md" }, commitHash, parentHash);
    expect(target.title).toBe("README.md (Parent 22222222 ↔ Commit 11111111)");
  });
});

describe("shared constants", () => {
  it("keeps the menu-open delay shorter than the cursor reset that follows it", () => {
    // Otherwise the cursor moves before the hover has positioned itself.
    expect(TIMING.openMenuMs).toBeLessThan(TIMING.cursorResetWithMenuMs);
  });

  it("gives every ref type a sigil, a label and a badge colour", () => {
    const types = Object.keys(REF_SIGIL) as (keyof typeof REF_SIGIL)[];
    for (const type of types) {
      expect(REF_SIGIL[type]).toHaveLength(1);
      expect(REF_LABEL[type]).toBeTruthy();
      expect(REF_BADGE_COLOR[type]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("gives each ref type a distinct sigil", () => {
    const sigils = Object.values(REF_SIGIL);
    expect(new Set(sigils).size).toBe(sigils.length);
  });

  it("uses well-formed hex for every colour", () => {
    for (const value of Object.values(COLOR)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
