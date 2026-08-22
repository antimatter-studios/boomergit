import { describe, it, expect, beforeEach, vi } from "vitest";
import { __reset, TreeItem, TreeItemCollapsibleState } from "./mocks/vscode.js";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const { ChangedFilesProvider, parseNameStatus, buildFileTree, flattenSingleChildDirs } =
  await import("../src/providers/changedFilesProvider.js");

type Callback = (err: Error | null, stdout: Buffer, stderr: Buffer) => void;

/** Build a NUL-separated stream the way `diff-tree -z` emits it. */
function zStream(...fields: string[]): string {
  return fields.join("\0") + "\0";
}

function gitReturns(stdout: string): void {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb: Callback) => {
    cb(null, Buffer.from(stdout), Buffer.from(""));
  });
}

function gitFails(): void {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb: Callback) => {
    cb(new Error("boom"), Buffer.from(""), Buffer.from("fatal: bad object"));
  });
}

beforeEach(() => {
  __reset();
  execFileMock.mockReset();
});

describe("parseNameStatus", () => {
  it("returns nothing for empty output", () => {
    expect(parseNameStatus("")).toEqual([]);
    expect(parseNameStatus("\0")).toEqual([]);
  });

  it("parses a single-path status", () => {
    expect(parseNameStatus(zStream("M", "src/a.ts"))).toEqual([
      { status: "M", path: "src/a.ts" },
    ]);
  });

  it("parses every single-path status letter", () => {
    const out = zStream("A", "added.ts", "M", "mod.ts", "D", "gone.ts", "T", "type.ts", "U", "conflict.ts");
    expect(parseNameStatus(out).map((f) => f.status)).toEqual(["A", "M", "D", "T", "U"]);
  });

  it("reads a rename's old and new path", () => {
    expect(parseNameStatus(zStream("R100", "old.ts", "new.ts"))).toEqual([
      { status: "R", path: "new.ts", oldPath: "old.ts" },
    ]);
  });

  it("reads a copy's source and destination", () => {
    expect(parseNameStatus(zStream("C75", "src.ts", "copy.ts"))).toEqual([
      { status: "C", path: "copy.ts", oldPath: "src.ts" },
    ]);
  });

  it("takes only the first character of a scored status", () => {
    expect(parseNameStatus(zStream("R100", "a", "b"))[0].status).toBe("R");
  });

  it("reads a rename following a plain entry", () => {
    const out = zStream("A", "new.ts", "R100", "old.ts", "moved.ts");
    expect(parseNameStatus(out)).toEqual([
      { status: "A", path: "new.ts" },
      { status: "R", path: "moved.ts", oldPath: "old.ts" },
    ]);
  });

  it("keeps paths containing spaces intact", () => {
    expect(parseNameStatus(zStream("M", "src/my file.ts"))[0].path).toBe("src/my file.ts");
  });

  it("keeps non-ASCII paths verbatim, unquoted", () => {
    // The whole reason for -z: without it git emits "caf\303\251.txt"
    expect(parseNameStatus(zStream("A", "café.txt"))[0].path).toBe("café.txt");
  });

  it("keeps a path containing a tab", () => {
    expect(parseNameStatus(zStream("M", "odd\tname.ts"))[0].path).toBe("odd\tname.ts");
  });

  it("skips a truncated record with no path", () => {
    expect(parseNameStatus(zStream("M"))).toEqual([]);
  });

  it("skips a rename missing its destination", () => {
    expect(parseNameStatus(zStream("R100", "old.ts"))).toEqual([]);
  });

  it("keeps the good records around a truncated trailing one", () => {
    expect(parseNameStatus(zStream("M", "a.ts", "M", "b.ts", "M")).map((f) => f.path)).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });
});

describe("buildFileTree", () => {
  it("nests files under their directories", () => {
    const tree = buildFileTree([{ status: "M", path: "src/git/a.ts" }]);
    const src = tree.children.get("src")!;
    expect(src.children.get("git")!.children.get("a.ts")!.file?.path).toBe("src/git/a.ts");
  });

  it("places a root-level file directly under the root", () => {
    const tree = buildFileTree([{ status: "M", path: "README.md" }]);
    expect(tree.children.get("README.md")!.file?.path).toBe("README.md");
  });

  it("shares a directory node between sibling files", () => {
    const tree = buildFileTree([
      { status: "M", path: "src/a.ts" },
      { status: "A", path: "src/b.ts" },
    ]);
    expect(tree.children.size).toBe(1);
    expect(tree.children.get("src")!.children.size).toBe(2);
  });

  it("records the full path on intermediate directories", () => {
    const tree = buildFileTree([{ status: "M", path: "a/b/c.ts" }]);
    expect(tree.children.get("a")!.children.get("b")!.path).toBe("a/b");
  });
});

describe("flattenSingleChildDirs", () => {
  it("collapses a chain of single-child directories", () => {
    const tree = flattenSingleChildDirs(buildFileTree([{ status: "M", path: "src/git/a.ts" }]));
    expect([...tree.children.keys()]).toEqual(["src"]);
    expect(tree.children.get("src")!.name).toBe("src/git");
  });

  it("stops collapsing where a directory branches", () => {
    const tree = flattenSingleChildDirs(
      buildFileTree([
        { status: "M", path: "src/git/a.ts" },
        { status: "M", path: "src/graph/b.ts" },
      ])
    );
    const src = tree.children.get("src")!;
    expect(src.name).toBe("src");
    expect(src.children.size).toBe(2);
  });

  it("does not fold a directory into its only file", () => {
    const tree = flattenSingleChildDirs(buildFileTree([{ status: "M", path: "src/a.ts" }]));
    expect(tree.children.get("src")!.name).toBe("src");
  });

  it("leaves a flat list untouched", () => {
    const files = [
      { status: "M" as const, path: "a.ts" },
      { status: "M" as const, path: "b.ts" },
    ];
    const tree = flattenSingleChildDirs(buildFileTree(files));
    expect([...tree.children.keys()].sort()).toEqual(["a.ts", "b.ts"]);
  });
});

describe("ChangedFilesProvider", () => {
  it("starts empty", () => {
    const provider = new ChangedFilesProvider();
    expect(provider.getChildren()).toEqual([]);
  });

  it("asks git for the commit's name-status diff", async () => {
    gitReturns(zStream("M", "a.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "parent", false, "/repo");
    expect(execFileMock.mock.calls[0][1]).toEqual([
      "diff-tree",
      "--no-commit-id",
      "-r",
      "--name-status",
      "-z",
      "abc",
    ]);
  });

  it("passes --root for a root commit, which has no parent to diff", async () => {
    gitReturns(zStream("A", "a.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "", true, "/repo");
    expect(execFileMock.mock.calls[0][1]).toContain("--root");
  });

  it("lists directories before files", async () => {
    gitReturns(zStream("M", "z.ts", "M", "src/a.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "p", false, "/repo");
    const labels = provider.getChildren().map((i) => i.label);
    expect(labels).toEqual(["src", "z.ts"]);
  });

  it("sorts files alphabetically", async () => {
    gitReturns(zStream("M", "c.ts", "M", "a.ts", "M", "b.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "p", false, "/repo");
    expect(provider.getChildren().map((i) => i.label)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("gives a file item a diff command carrying its commit", async () => {
    gitReturns(zStream("M", "a.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "parent", false, "/repo");
    const item = provider.getChildren()[0];
    expect(item.command?.command).toBe("boomergit.openFileDiff");
    expect(item.command?.arguments?.slice(1)).toEqual(["abc", "parent", "/repo"]);
  });

  it("expands directory items so changes are visible without clicking", async () => {
    gitReturns(zStream("M", "src/a.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "p", false, "/repo");
    expect(provider.getChildren()[0].collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
  });

  it("returns a directory's children when expanded", async () => {
    gitReturns(zStream("M", "src/a.ts", "M", "src/b.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "p", false, "/repo");
    const dir = provider.getChildren()[0];
    expect(provider.getChildren(dir).map((i) => i.label)).toEqual(["a.ts", "b.ts"]);
  });

  it("returns nothing for the children of a file", async () => {
    gitReturns(zStream("M", "a.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "p", false, "/repo");
    expect(provider.getChildren(provider.getChildren()[0])).toEqual([]);
  });

  it("shows a rename's old path in the tooltip", async () => {
    gitReturns(zStream("R100", "old.ts", "new.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "p", false, "/repo");
    expect(provider.getChildren()[0].tooltip).toBe("old.ts → new.ts");
  });

  it("shows just the path for a non-rename", async () => {
    gitReturns(zStream("M", "a.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "p", false, "/repo");
    expect(provider.getChildren()[0].tooltip).toBe("a.ts");
  });

  it("surfaces a git failure instead of an empty tree", async () => {
    gitFails();
    const provider = new ChangedFilesProvider();
    await provider.showCommit("bad", "p", false, "/repo");
    const children = provider.getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].label).toBe("Failed to list changed files");
    expect(children[0].tooltip).toContain("fatal: bad object");
  });

  it("asks git for NUL-separated output so paths arrive unquoted", async () => {
    gitReturns(zStream("M", "a.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "p", false, "/repo");
    expect(execFileMock.mock.calls[0][1]).toContain("-z");
  });

  it("clears a previous failure when a later commit succeeds", async () => {
    gitFails();
    const provider = new ChangedFilesProvider();
    await provider.showCommit("bad", "p", false, "/repo");
    gitReturns(zStream("M", "a.ts"));
    await provider.showCommit("good", "p", false, "/repo");
    expect(provider.getChildren().map((i) => i.label)).toEqual(["a.ts"]);
  });

  it("clears a failure on clear()", async () => {
    gitFails();
    const provider = new ChangedFilesProvider();
    await provider.showCommit("bad", "p", false, "/repo");
    provider.clear();
    expect(provider.getChildren()).toEqual([]);
  });

  it("empties the tree on clear", async () => {
    gitReturns(zStream("M", "a.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "p", false, "/repo");
    provider.clear();
    expect(provider.getChildren()).toEqual([]);
  });

  it("notifies listeners when the tree changes", async () => {
    gitReturns(zStream("M", "a.ts"));
    const provider = new ChangedFilesProvider();
    let fires = 0;
    provider.onDidChangeTreeData(() => fires++);
    await provider.showCommit("abc", "p", false, "/repo");
    // Once to blank the old commit, once with the new files
    expect(fires).toBe(2);
  });

  it("discards a slow fetch superseded by a newer selection", async () => {
    // First call resolves late with 'old.ts'; second resolves with 'new.ts'.
    const pending: Callback[] = [];
    execFileMock.mockImplementation((_c, _a, _o, cb: Callback) => {
      pending.push(cb);
    });
    const provider = new ChangedFilesProvider();
    const first = provider.showCommit("older", "p", false, "/repo");
    const second = provider.showCommit("newer", "p", false, "/repo");

    pending[1](null, Buffer.from(zStream("M", "new.ts")), Buffer.from(""));
    pending[0](null, Buffer.from(zStream("M", "old.ts")), Buffer.from(""));
    await Promise.all([first, second]);

    expect(provider.getChildren().map((i) => i.label)).toEqual(["new.ts"]);
  });

  it("survives git returning a truncated record", async () => {
    gitReturns(zStream("M", "good.ts"));
    const provider = new ChangedFilesProvider();
    await expect(provider.showCommit("abc", "p", false, "/repo")).resolves.toBeUndefined();
    expect(provider.getChildren().map((i) => i.label)).toEqual(["good.ts"]);
  });

  it("surfaces a tree-building failure instead of showing an empty list", async () => {
    gitReturns(zStream("M", "src/a.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "p", false, "/repo");

    // Corrupt a directory node so listing its children throws
    const dir = provider.getChildren()[0] as unknown as { node: unknown };
    dir.node = { name: "src", path: "src", children: null };

    const children = provider.getChildren(dir as never);
    expect(children).toHaveLength(1);
    expect(children[0].label).toBe("Failed to list changed files");
    expect(children[0].contextValue).toBe("changedFilesError");
  });

  it("returns nothing for an element that is neither file nor directory", async () => {
    gitReturns(zStream("M", "a.ts"));
    const provider = new ChangedFilesProvider();
    await provider.showCommit("abc", "p", false, "/repo");
    expect(provider.getChildren(new TreeItem("stray") as never)).toEqual([]);
  });

  it("returns the element unchanged from getTreeItem", () => {
    const provider = new ChangedFilesProvider();
    const item = new TreeItem("x");
    expect(provider.getTreeItem(item as never)).toBe(item);
  });
});
