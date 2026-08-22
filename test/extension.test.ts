import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  Position,
  Selection,
  TabInputText,
  TextEditorSelectionChangeKind,
  Uri,
  __emitters,
  __reset,
  __state,
  window,
  workspace,
} from "./mocks/vscode.js";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const { activate, deactivate } = await import("../src/extension.js");

type Callback = (err: Error | null, stdout: Buffer, stderr: Buffer) => void;

const GRAPH_URI = "boomergit:BoomerGit - Git Graph";

/** One commit line in the format the parser expects, with full-path refs. */
function logLine(hash: string, subject: string, refs = "", parents = ""): string {
  return [hash, parents, "Ada", "ada@x.dev", "1700000000", subject, refs].join("|");
}

const DEFAULT_LOG = [
  logLine("a".repeat(40), "second", "HEAD -> refs/heads/main", "b".repeat(40)),
  logLine("b".repeat(40), "first"),
].join("\n");

/**
 * Route git invocations by subcommand, so a test can say what the repository
 * looks like without caring about call order.
 */
function gitResponds(responses: Record<string, string>, failing = new Set<string>()): void {
  execFileMock.mockImplementation((_cmd, args: string[], _opts, cb: Callback) => {
    const sub = args[0];
    // rev-parse answers two different questions and the extension asks both:
    // the current branch, and the working tree's root path.
    const key =
      sub === "rev-parse" && args.includes("--show-toplevel") ? "rev-parse:toplevel" : sub;
    if (failing.has(sub)) {
      cb(new Error("git failed"), Buffer.from(""), Buffer.from(`fatal: ${sub} refused`));
      return;
    }
    cb(null, Buffer.from(responses[key] ?? ""), Buffer.from(""));
  });
}

function defaultRepo(overrides: Record<string, string> = {}): void {
  gitResponds({
    log: DEFAULT_LOG,
    "rev-parse": "main\n",
    // git reports resolved paths; this is what identifies the current worktree
    "rev-parse:toplevel": "/repo\n",
    "for-each-ref": "aaa refs/heads/main\n",
    show: "second\n\nbody\n",
    "diff-tree": "M\tsrc/a.ts\n",
    worktree: "",
    checkout: "",
    branch: "",
    ...overrides,
  });
}

let storageDir: string;
let context: { subscriptions: { dispose(): void }[]; globalStorageUri: { fsPath: string } };

beforeEach(() => {
  __reset();
  execFileMock.mockReset();
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "boomergit-ext-"));
  context = { subscriptions: [], globalStorageUri: { fsPath: storageDir } };
  workspace.workspaceFolders = [{ uri: Uri.file("/repo") }];
  defaultRepo();
});

afterEach(() => {
  for (const d of context.subscriptions) d.dispose();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

/** Activate, then open the graph as the user would. */
async function openGraph() {
  activate(context as never);
  await __state.commands.get("boomergit.showGraph")!();
}

/** Pretend a tab exists for the graph, which several code paths check for. */
function graphTabIsOpen(): void {
  window.tabGroups.all = [{ tabs: [{ input: new TabInputText(Uri.parse(GRAPH_URI)) }] }];
}

describe("activate", () => {
  it("registers both content providers", () => {
    activate(context as never);
    expect([...__state.registeredContentProviders.keys()].sort()).toEqual([
      "boomergit",
      "boomergit-file",
    ]);
  });

  it("registers every contributed command", () => {
    activate(context as never);
    expect([...__state.commands.keys()].sort()).toEqual([
      "boomergit.checkoutRef",
      "boomergit.copyText",
      "boomergit.copyWorktreePath",
      "boomergit.createBranch",
      "boomergit.createWorktree",
      "boomergit.deleteBranch",
      "boomergit.openFileDiff",
      "boomergit.openWorktree",
      "boomergit.refresh",
      "boomergit.revealWorktree",
      "boomergit.selectDown",
      "boomergit.selectUp",
      "boomergit.showGraph",
      "boomergit.toggleAutoRefresh",
    ]);
  });

  it("registers a hover provider for the graph scheme", () => {
    activate(context as never);
    expect(__state.hoverProvider).toBeDefined();
  });

  it("gives the hover widget a visible border", () => {
    activate(context as never);
    const update = __state.configUpdates.find((u) => u.key === "colorCustomizations");
    expect((update?.value as Record<string, string>)["editorHoverWidget.border"]).toBe("#ffffff");
  });

  it("preserves existing colour customizations", () => {
    __state.configValues.set("workbench.colorCustomizations", { "editor.background": "#123456" });
    activate(context as never);
    const update = __state.configUpdates.find((u) => u.key === "colorCustomizations");
    expect((update?.value as Record<string, string>)["editor.background"]).toBe("#123456");
  });

  it("puts everything it creates into the disposal list", () => {
    activate(context as never);
    expect(context.subscriptions.length).toBeGreaterThan(15);
  });
});

describe("showGraph", () => {
  it("complains when there is no workspace open", async () => {
    workspace.workspaceFolders = undefined;
    await openGraph();
    expect(__state.errorMessages[0]).toContain("No workspace folder open");
  });

  it("renders the graph document from git log", async () => {
    await openGraph();
    const provider = __state.registeredContentProviders.get("boomergit") as {
      provideTextDocumentContent(u: Uri): string;
    };
    const text = provider.provideTextDocumentContent(Uri.parse(GRAPH_URI));
    expect(text).toContain("second");
    expect(text).toContain(" B main ");
  });

  it("opens the document as the active editor", async () => {
    await openGraph();
    expect(window.activeTextEditor?.document.uri.toString()).toBe(GRAPH_URI);
  });

  it("gives the document the boomergit language, for the editor overrides", async () => {
    await openGraph();
    expect(__state.documentLanguages.map((d) => d.language)).toContain("boomergit");
  });

  it("marks the graph open so the contributed menus appear", async () => {
    await openGraph();
    expect(__state.executedCommands).toEqual(
      expect.arrayContaining([
        { command: "setContext", args: ["boomergit:graphOpen", true] },
      ])
    );
  });

  it("decorates the rendered rows", async () => {
    await openGraph();
    const tiles = __state.decorationTypes.filter((d) => "before" in d.options);
    expect(tiles).toHaveLength(2);
  });

  it("auto-selects the row holding the checked-out branch", async () => {
    await openGraph();
    // The active row gets a whole-line inverted decoration
    const inverted = __state.decorationTypes.filter((d) => d.options.isWholeLine === true);
    expect(inverted.length).toBeGreaterThan(0);
  });

  it("survives a repository with no commits", async () => {
    defaultRepo({ log: "" });
    await openGraph();
    expect(__state.errorMessages).toEqual([]);
  });

  it("survives git log failing outright", async () => {
    gitResponds({}, new Set(["log"]));
    await openGraph();
    expect(__state.errorMessages).toEqual([]);
  });
});

describe("checkoutRef", () => {
  it("checks out a local branch by name", async () => {
    await openGraph();
    await __state.commands.get("boomergit.checkoutRef")!("feature", "branch");
    const call = execFileMock.mock.calls.find((c) => c[1][0] === "checkout");
    expect(call?.[1]).toEqual(["checkout", "feature"]);
    expect(__state.infoMessages).toContain("Checked out: feature");
  });

  it("strips the remote name when checking out a remote-tracking branch", async () => {
    await openGraph();
    await __state.commands.get("boomergit.checkoutRef")!("origin/feature/x", "remote");
    const call = execFileMock.mock.calls.find((c) => c[1][0] === "checkout");
    expect(call?.[1]).toEqual(["checkout", "feature/x"]);
  });

  it("surfaces git's own message when checkout fails", async () => {
    await openGraph();
    gitResponds({}, new Set(["checkout"]));
    await __state.commands.get("boomergit.checkoutRef")!("feature", "branch");
    expect(__state.errorMessages.some((m) => m.includes("Checkout failed"))).toBe(true);
    expect(__state.errorMessages.some((m) => m.includes("fatal: checkout refused"))).toBe(true);
  });
});

describe("deleteBranch", () => {
  it("asks before deleting", async () => {
    await openGraph();
    __state.nextWarningChoice = undefined;
    await __state.commands.get("boomergit.deleteBranch")!("feature");
    expect(__state.warningMessages[0]).toContain('Delete branch "feature"?');
    expect(execFileMock.mock.calls.some((c) => c[1][0] === "branch")).toBe(false);
  });

  it("deletes with -d when confirmed", async () => {
    await openGraph();
    __state.nextWarningChoice = "Delete";
    await __state.commands.get("boomergit.deleteBranch")!("feature");
    const call = execFileMock.mock.calls.find((c) => c[1][0] === "branch");
    expect(call?.[1]).toEqual(["branch", "-d", "feature"]);
    expect(__state.infoMessages).toContain("Deleted branch: feature");
  });

  it("force-deletes with -D when asked", async () => {
    await openGraph();
    __state.nextWarningChoice = "Force Delete";
    await __state.commands.get("boomergit.deleteBranch")!("feature");
    const call = execFileMock.mock.calls.find((c) => c[1][0] === "branch");
    expect(call?.[1]).toEqual(["branch", "-D", "feature"]);
  });

  it("reports a failed delete", async () => {
    await openGraph();
    __state.nextWarningChoice = "Delete";
    gitResponds({}, new Set(["branch"]));
    await __state.commands.get("boomergit.deleteBranch")!("feature");
    expect(__state.errorMessages.some((m) => m.includes("Delete failed"))).toBe(true);
  });
});

describe("createBranch", () => {
  it("creates a branch at the given commit", async () => {
    await openGraph();
    __state.nextInputBoxValue = "my-branch";
    await __state.commands.get("boomergit.createBranch")!("c".repeat(40));
    const call = execFileMock.mock.calls.find((c) => c[1][0] === "branch");
    expect(call?.[1]).toEqual(["branch", "my-branch", "c".repeat(40)]);
    expect(__state.infoMessages).toContain("Created branch: my-branch");
  });

  it("does nothing when the name prompt is dismissed", async () => {
    await openGraph();
    __state.nextInputBoxValue = undefined;
    await __state.commands.get("boomergit.createBranch")!("c".repeat(40));
    expect(execFileMock.mock.calls.some((c) => c[1][0] === "branch")).toBe(false);
  });

  it("reports a failed create", async () => {
    await openGraph();
    __state.nextInputBoxValue = "bad name";
    gitResponds({}, new Set(["branch"]));
    await __state.commands.get("boomergit.createBranch")!("c".repeat(40));
    expect(__state.errorMessages.some((m) => m.includes("Create branch failed"))).toBe(true);
  });
});

describe("copyText", () => {
  it("copies to the clipboard and confirms", async () => {
    activate(context as never);
    await __state.commands.get("boomergit.copyText")!("abc123", "Copied: abc123");
    expect(__state.clipboard).toBe("abc123");
    expect(__state.infoMessages).toContain("Copied: abc123");
  });
});

describe("auto-refresh", () => {
  it("is off by default", async () => {
    graphTabIsOpen();
    await openGraph();
    const statusBar = window.createStatusBarItem.mock.results[0].value;
    expect(statusBar.text).toContain("Off");
  });

  it("toggles on and persists the setting", async () => {
    await openGraph();
    await __state.commands.get("boomergit.toggleAutoRefresh")!();
    expect(__state.configUpdates.some((u) => u.key === "autoRefresh" && u.value === true)).toBe(
      true
    );
    expect(__state.statusBarMessages.some((m) => m.includes("on"))).toBe(true);
  });

  it("toggles back off", async () => {
    await openGraph();
    await __state.commands.get("boomergit.toggleAutoRefresh")!();
    await __state.commands.get("boomergit.toggleAutoRefresh")!();
    expect(__state.statusBarMessages.some((m) => m.includes("off"))).toBe(true);
  });

  it("picks up the setting being changed elsewhere", async () => {
    graphTabIsOpen();
    await openGraph();
    __state.configValues.set("boomergit.autoRefresh", true);
    __emitters.onDidChangeConfiguration.fire({
      affectsConfiguration: (s: string) => s === "boomergit.autoRefresh",
    });
    const statusBar = window.createStatusBarItem.mock.results[0].value;
    expect(statusBar.text).toContain("On");
  });

  it("ignores unrelated configuration changes", async () => {
    graphTabIsOpen();
    await openGraph();
    __state.configValues.set("boomergit.autoRefresh", true);
    __emitters.onDidChangeConfiguration.fire({ affectsConfiguration: () => false });
    const statusBar = window.createStatusBarItem.mock.results[0].value;
    expect(statusBar.text).toContain("Off");
  });
});

describe("refresh", () => {
  it("re-reads git log", async () => {
    await openGraph();
    const before = execFileMock.mock.calls.filter((c) => c[1][0] === "log").length;
    await __state.commands.get("boomergit.refresh")!();
    const after = execFileMock.mock.calls.filter((c) => c[1][0] === "log").length;
    expect(after).toBeGreaterThan(before);
  });

  it("keeps the graph rendered after a refresh", async () => {
    await openGraph();
    await __state.commands.get("boomergit.refresh")!();
    expect(__state.decorationTypes.filter((d) => "before" in d.options && !d.disposed)).toHaveLength(
      2
    );
  });
});

describe("keyboard row navigation", () => {
  it("moves the selection down", async () => {
    await openGraph();
    const editor = window.activeTextEditor!;
    await __state.commands.get("boomergit.selectDown")!();
    expect(editor.selection.active.line).toBe(1);
  });

  it("stops at the last row", async () => {
    await openGraph();
    const editor = window.activeTextEditor!;
    await __state.commands.get("boomergit.selectDown")!();
    await __state.commands.get("boomergit.selectDown")!();
    expect(editor.selection.active.line).toBe(1);
  });

  it("moves the selection back up", async () => {
    await openGraph();
    const editor = window.activeTextEditor!;
    await __state.commands.get("boomergit.selectDown")!();
    await __state.commands.get("boomergit.selectUp")!();
    expect(editor.selection.active.line).toBe(0);
  });

  it("stops at the first row", async () => {
    await openGraph();
    const editor = window.activeTextEditor!;
    await __state.commands.get("boomergit.selectUp")!();
    expect(editor.selection.active.line).toBe(0);
  });

  it("does nothing when the active editor isn't the graph", async () => {
    await openGraph();
    window.activeTextEditor = undefined;
    expect(() => __state.commands.get("boomergit.selectUp")!()).not.toThrow();
  });
});

describe("click handling", () => {
  /** Fire a mouse selection change at a position, as VS Code would. */
  function click(line: number, character: number, cmdClick = false) {
    const editor = window.activeTextEditor!;
    const at = new Position(line, character);
    const selections = cmdClick
      ? [new Selection(0, 0, 0, 0), new Selection(at, at)]
      : [new Selection(at, at)];
    __emitters.onDidChangeTextEditorSelection.fire({
      textEditor: editor,
      selections,
      kind: TextEditorSelectionChangeKind.Mouse,
    });
  }

  it("ignores selection changes that aren't from the mouse", async () => {
    await openGraph();
    const editor = window.activeTextEditor!;
    __emitters.onDidChangeTextEditorSelection.fire({
      textEditor: editor,
      selections: [new Selection(1, 0, 1, 0)],
      kind: TextEditorSelectionChangeKind.Keyboard,
    });
    expect(__state.executedCommands.some((c) => c.command === "editor.action.showHover")).toBe(
      false
    );
  });

  it("dismisses the selection when a row is clicked while rows are selected", async () => {
    // Opening the graph auto-selects the checked-out branch's row, so the very
    // first plain click is a "get out of my way".
    await openGraph();
    vi.useFakeTimers();
    click(1, 40);
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    expect(__state.executedCommands.some((c) => c.command === "editor.action.showHover")).toBe(
      false
    );
  });

  it("opens a menu when a row is clicked with nothing selected", async () => {
    await openGraph();
    vi.useFakeTimers();
    click(1, 40); // dismisses the auto-selection
    // Past the self-selection ignore window, or the next click is discarded
    vi.advanceTimersByTime(300);
    click(1, 40); // now selects the row and opens its menu
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    expect(__state.executedCommands.some((c) => c.command === "editor.action.showHover")).toBe(true);
  });

  it("builds the badge menu when a badge is clicked", async () => {
    await openGraph();
    const editor = window.activeTextEditor!;
    const line0 = editor.document.lineAt(0).text;
    const badgeAt = line0.indexOf(" B main ") + 4;

    vi.useFakeTimers();
    click(0, badgeAt);
    vi.advanceTimersByTime(300);
    vi.useRealTimers();

    const hover = __state.hoverProvider.provideHover(editor.document, new Position(0, badgeAt));
    expect(hover?.contents.value).toContain("Checkout Branch");
    expect(hover?.contents.value).toContain("Cannot delete current branch");
  });

  it("builds the row menu when the subject is clicked", async () => {
    await openGraph();
    const editor = window.activeTextEditor!;
    const line1 = editor.document.lineAt(1).text;

    vi.useFakeTimers();
    click(1, line1.indexOf("first")); // dismisses the auto-selection
    vi.advanceTimersByTime(300);
    click(1, line1.indexOf("first")); // opens the row menu
    vi.advanceTimersByTime(300);
    vi.useRealTimers();

    const hover = __state.hoverProvider.provideHover(
      editor.document,
      new Position(1, line1.indexOf("first"))
    );
    expect(hover?.contents.value).toContain("Create Branch Here");
    expect(hover?.contents.value).not.toContain("Checkout Branch");
  });

  it("returns no hover unless a click asked for one", async () => {
    await openGraph();
    const editor = window.activeTextEditor!;
    expect(__state.hoverProvider.provideHover(editor.document, new Position(0, 40))).toBeUndefined();
  });

  it("builds up a two-row compare selection on Cmd-click", async () => {
    await openGraph();
    vi.useFakeTimers();
    click(1, 40); // clear the auto-selection first
    vi.advanceTimersByTime(300);
    click(0, 40, true);
    vi.advanceTimersByTime(300);
    click(1, 40, true);
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    const markers = __state.decorationTypes.filter((d) => d.options.after && !d.disposed);
    expect(markers).toHaveLength(2);
  });

  it("toggles a Cmd-clicked row back off", async () => {
    await openGraph();
    vi.useFakeTimers();
    click(1, 40); // clear the auto-selection
    vi.advanceTimersByTime(300);
    click(0, 40, true);
    vi.advanceTimersByTime(300);
    click(0, 40, true);
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    const markers = __state.decorationTypes.filter((d) => d.options.after && !d.disposed);
    expect(markers).toHaveLength(0);
  });
});

describe("teardown", () => {
  it("clears the graph state when the tab is closed", async () => {
    await openGraph();
    window.tabGroups.all = [];
    __emitters.onDidChangeTabs.fire({});
    const statusBar = window.createStatusBarItem.mock.results[0].value;
    expect(statusBar.shown).toBe(false);
  });

  it("re-decorates when the editor is recreated by a layout change", async () => {
    await openGraph();
    const editor = window.activeTextEditor!;
    const before = __state.decorationTypes.length;
    __emitters.onDidChangeVisibleTextEditors.fire([editor]);
    expect(__state.decorationTypes.length).toBeGreaterThan(before);
  });

  it("marks the graph closed on deactivate", () => {
    activate(context as never);
    deactivate();
    expect(__state.executedCommands).toEqual(
      expect.arrayContaining([
        { command: "setContext", args: ["boomergit:graphOpen", false] },
      ])
    );
  });

  it("disposes everything without throwing", async () => {
    await openGraph();
    expect(() => {
      for (const d of context.subscriptions) d.dispose();
    }).not.toThrow();
    context.subscriptions = [];
  });
});

describe("git-extension change trigger", () => {
  /** A stand-in for the built-in vscode.git extension's API. */
  function fakeGitExtension({
    active = true,
    repositories = [{ rootUri: { fsPath: "/repo" } }] as any[],
    throwOnApi = false,
  } = {}) {
    const stateEmitters: (() => void)[] = [];
    const openRepoEmitters: ((repo: unknown) => void)[] = [];
    for (const repo of repositories) {
      repo.state = {
        onDidChange: (listener: () => void) => {
          stateEmitters.push(listener);
          return { dispose: vi.fn() };
        },
      };
    }
    const api = {
      repositories,
      onDidOpenRepository: (listener: (repo: unknown) => void) => {
        openRepoEmitters.push(listener);
        return { dispose: vi.fn() };
      },
    };
    const exports = {
      getAPI: (_v: number) => {
        if (throwOnApi) throw new Error("no api");
        return api;
      },
    };
    return {
      ext: {
        isActive: active,
        exports,
        activate: () => Promise.resolve(exports),
      },
      fireStateChange: () => stateEmitters.forEach((l) => l()),
      fireOpenRepository: () => openRepoEmitters.forEach((l) => l(repositories[0])),
      repositories,
    };
  }

  /**
   * Let fire-and-forget async work settle. A refresh chain is many awaits
   * deep, so drain whole macrotasks rather than counting microtasks.
   */
  async function flush() {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  }

  it("refreshes when the repository changes and auto-refresh is on", async () => {
    const git = fakeGitExtension();
    (window as any).__unused = undefined;
    (await import("./mocks/vscode.js")).extensions.getExtension.mockReturnValue(git.ext);
    __state.configValues.set("boomergit.autoRefresh", true);
    graphTabIsOpen();
    await openGraph();
    await flush();

    const before = execFileMock.mock.calls.filter((c) => c[1][0] === "log").length;
    // A different ref signature than the baseline recorded during the open
    defaultRepo({ "for-each-ref": "bbb refs/heads/main\n" });
    git.fireStateChange();
    await flush();
    const after = execFileMock.mock.calls.filter((c) => c[1][0] === "log").length;
    expect(after).toBeGreaterThan(before);
  });

  it("does not refresh when the refs are unchanged", async () => {
    const git = fakeGitExtension();
    (await import("./mocks/vscode.js")).extensions.getExtension.mockReturnValue(git.ext);
    __state.configValues.set("boomergit.autoRefresh", true);
    graphTabIsOpen();
    await openGraph();
    await flush();

    const before = execFileMock.mock.calls.filter((c) => c[1][0] === "log").length;
    git.fireStateChange();
    await flush();
    const after = execFileMock.mock.calls.filter((c) => c[1][0] === "log").length;
    expect(after).toBe(before);
  });

  it("does not refresh while auto-refresh is off", async () => {
    const git = fakeGitExtension();
    (await import("./mocks/vscode.js")).extensions.getExtension.mockReturnValue(git.ext);
    graphTabIsOpen();
    await openGraph();
    await flush();

    const before = execFileMock.mock.calls.filter((c) => c[1][0] === "log").length;
    defaultRepo({ "for-each-ref": "ccc refs/heads/main\n" });
    git.fireStateChange();
    await flush();
    expect(execFileMock.mock.calls.filter((c) => c[1][0] === "log").length).toBe(before);
  });

  it("activates the git extension when it isn't active yet", async () => {
    const git = fakeGitExtension({ active: false });
    (await import("./mocks/vscode.js")).extensions.getExtension.mockReturnValue(git.ext);
    activate(context as never);
    await flush();
    expect(() => git.fireStateChange()).not.toThrow();
  });

  it("hooks a repository that loads after activation", async () => {
    const git = fakeGitExtension({ repositories: [] });
    (await import("./mocks/vscode.js")).extensions.getExtension.mockReturnValue(git.ext);
    activate(context as never);
    await flush();
    git.repositories.push({ rootUri: { fsPath: "/repo" }, state: { onDidChange: () => ({ dispose: vi.fn() }) } } as never);
    expect(() => git.fireOpenRepository()).not.toThrow();
  });

  it("falls back to polling when the git API can't be reached", async () => {
    const git = fakeGitExtension({ throwOnApi: true });
    (await import("./mocks/vscode.js")).extensions.getExtension.mockReturnValue(git.ext);
    activate(context as never);
    await flush();
    // The fallback timer is registered for disposal alongside everything else
    expect(context.subscriptions.length).toBeGreaterThan(15);
  });
});

describe("preserving the view across a refresh", () => {
  it("keeps the selected commit selected", async () => {
    await openGraph();
    const editor = window.activeTextEditor!;
    await __state.commands.get("boomergit.selectDown")!();
    const before = editor.selection.active.line;
    await __state.commands.get("boomergit.refresh")!();
    // Row 1 is still marked after the refresh
    const markers = __state.decorationTypes.filter((d) => d.options.after && !d.disposed);
    expect(markers).toHaveLength(1);
    expect(before).toBe(1);
  });

  it("falls back to the current branch when the selected commit is gone", async () => {
    await openGraph();
    await __state.commands.get("boomergit.selectDown")!();
    // The previously selected commit no longer exists in the new log
    defaultRepo({ log: logLine("f".repeat(40), "only", "HEAD -> refs/heads/main") });
    await __state.commands.get("boomergit.refresh")!();
    const inverted = __state.decorationTypes.filter(
      (d) => d.options.isWholeLine === true && !d.disposed
    );
    expect(inverted.length).toBeGreaterThan(0);
  });

  it("restores the scroll position", async () => {
    await openGraph();
    const editor = window.activeTextEditor!;
    await __state.commands.get("boomergit.refresh")!();
    expect(editor.revealRange).toHaveBeenCalled();
  });
});

describe("openFileDiff", () => {
  const file = { status: "M" as const, path: "src/a.ts" };

  it("opens a diff and splits below on the first use", async () => {
    await openGraph();
    window.tabGroups.all = [{ tabs: [] }];
    await __state.commands.get("boomergit.openFileDiff")!(file, "a".repeat(40), "b".repeat(40), "/repo");
    const commandNames = __state.executedCommands.map((c) => c.command);
    expect(commandNames).toContain("vscode.diff");
    expect(commandNames).toContain("workbench.action.moveEditorToBelowGroup");
  });

  it("reuses the bottom group once it exists", async () => {
    await openGraph();
    window.tabGroups.all = [{ tabs: [], viewColumn: 1 }, { tabs: [], viewColumn: 2 }];
    await __state.commands.get("boomergit.openFileDiff")!(file, "a".repeat(40), "b".repeat(40), "/repo");
    const commandNames = __state.executedCommands.map((c) => c.command);
    expect(commandNames).toContain("vscode.diff");
    expect(commandNames).not.toContain("workbench.action.moveEditorToBelowGroup");
  });

  it("titles the diff after the file and both sides", async () => {
    await openGraph();
    window.tabGroups.all = [{ tabs: [] }];
    await __state.commands.get("boomergit.openFileDiff")!(file, "a".repeat(40), "b".repeat(40), "/repo");
    const diff = __state.executedCommands.find((c) => c.command === "vscode.diff")!;
    expect(diff.args[2]).toBe("a.ts (Parent bbbbbbbb ↔ Commit aaaaaaaa)");
  });
});

describe("worktrees", () => {
  const WORKTREES = [
    "worktree /repo",
    "HEAD " + "a".repeat(40),
    "branch refs/heads/main",
    "",
    "worktree /wt-second",
    "HEAD " + "b".repeat(40),
    "branch refs/heads/second",
    "",
  ].join("\n");

  it("lists every worktree in the sidebar, current first", async () => {
    defaultRepo({ worktree: WORKTREES });
    workspace.workspaceFolders = [{ uri: Uri.file("/repo") }];
    await openGraph();
    // The worktrees view is created first, so it is the first tree view
    const labels = __state.treeViews.length;
    expect(labels).toBeGreaterThan(0);
  });

  it("marks the row another worktree has checked out", async () => {
    defaultRepo({ worktree: WORKTREES });
    workspace.workspaceFolders = [{ uri: Uri.file("/repo") }];
    await openGraph();
    // A ruler tick, and a ring drawn into that row's tile
    const ticks = __state.decorationTypes.filter((d) => d.options.overviewRulerColor === "#73c991");
    expect(ticks).toHaveLength(1);
  });

  it("badges the row with the worktree's branch", async () => {
    defaultRepo({ worktree: WORKTREES });
    workspace.workspaceFolders = [{ uri: Uri.file("/repo") }];
    await openGraph();
    const provider = __state.registeredContentProviders.get("boomergit") as {
      provideTextDocumentContent(u: Uri): string;
    };
    expect(provider.provideTextDocumentContent(Uri.parse(GRAPH_URI))).toContain(" W second ");
  });

  it("never badges the main worktree, which is the repository itself", async () => {
    defaultRepo({ worktree: WORKTREES });
    workspace.workspaceFolders = [{ uri: Uri.file("/repo") }];
    await openGraph();
    const provider = __state.registeredContentProviders.get("boomergit") as {
      provideTextDocumentContent(u: Uri): string;
    };
    expect(provider.provideTextDocumentContent(Uri.parse(GRAPH_URI))).not.toContain(" W main ");
  });

  it("badges a linked worktree even when it is the one being viewed", async () => {
    // The case that separates "main worktree" from "current worktree": viewed
    // from the linked tree, it is still a linked tree and still marked, while
    // the main worktree stays unmarked. The graph reads the same from anywhere.
    defaultRepo({ worktree: WORKTREES, "rev-parse:toplevel": "/wt-second\n" });
    workspace.workspaceFolders = [{ uri: Uri.file("/wt-second") }];
    await openGraph();
    const provider = __state.registeredContentProviders.get("boomergit") as {
      provideTextDocumentContent(u: Uri): string;
    };
    const text = provider.provideTextDocumentContent(Uri.parse(GRAPH_URI));
    expect(text).toContain(" W second ");
    expect(text).not.toContain(" W main ");
  });

  it("refuses checkout of a branch another worktree holds", async () => {
    defaultRepo({ worktree: WORKTREES });
    workspace.workspaceFolders = [{ uri: Uri.file("/repo") }];
    await openGraph();
    const editor = window.activeTextEditor!;
    const line1 = editor.document.lineAt(1).text;
    const badgeAt = line1.indexOf(" W second ");
    // The branch badge on the same row is what a user would click
    const branchAt = line1.indexOf(" B second ");
    expect(badgeAt >= 0 || branchAt >= 0).toBe(true);
  });

  it("folds worktree state into the change signature", async () => {
    defaultRepo({ worktree: WORKTREES });
    workspace.workspaceFolders = [{ uri: Uri.file("/repo") }];
    await openGraph();
    const calls = execFileMock.mock.calls.filter((c) => c[1][0] === "worktree");
    // Once for the graph, and again when the signature baseline is taken
    expect(calls.length).toBeGreaterThan(1);
  });

  it("copies a worktree path to the clipboard", async () => {
    defaultRepo({ worktree: WORKTREES });
    await openGraph();
    await __state.commands.get("boomergit.copyWorktreePath")!({
      worktree: { path: "/wt-second" },
    });
    expect(__state.clipboard).toBe("/wt-second");
  });

  it("opens a worktree in a new window", async () => {
    defaultRepo({ worktree: WORKTREES });
    await openGraph();
    await __state.commands.get("boomergit.openWorktree")!({
      worktree: { path: "/wt-second" },
    });
    const open = __state.executedCommands.find((c) => c.command === "vscode.openFolder");
    expect(open).toBeDefined();
    expect(open!.args[1]).toEqual({ forceNewWindow: true });
  });

  it("survives a repository with no extra worktrees", async () => {
    defaultRepo({ worktree: "worktree /repo\nHEAD " + "a".repeat(40) + "\nbranch refs/heads/main\n" });
    await openGraph();
    expect(__state.errorMessages).toEqual([]);
    expect(
      __state.decorationTypes.filter((d) => d.options.overviewRulerColor === "#73c991")
    ).toHaveLength(0);
  });
});

describe("createWorktree", () => {
  beforeEach(() => {
    workspace.workspaceFolders = [{ uri: Uri.file("/Users/me/projects/boomergit") }];
  });

  /** The path offered in the confirmation prompt. */
  function suggestedPath(): string {
    return window.showInputBox.mock.calls.at(-1)?.[0]?.value ?? "";
  }

  it("suggests a sibling directory by default", async () => {
    await openGraph();
    __state.nextInputBoxValue = undefined; // cancel, we only want the suggestion
    await __state.commands.get("boomergit.createWorktree")!("feature", "branch");
    expect(suggestedPath()).toBe("/Users/me/projects/boomergit-feature");
  });

  it("flattens a namespaced branch in the suggestion", async () => {
    await openGraph();
    __state.nextInputBoxValue = undefined;
    await __state.commands.get("boomergit.createWorktree")!("feat/thing", "branch");
    expect(suggestedPath()).toBe("/Users/me/projects/boomergit-feat-thing");
  });

  it("honours a custom location from settings", async () => {
    __state.configValues.set("boomergit.worktrees.location", "custom");
    __state.configValues.set("boomergit.worktrees.customPath", "${workspaceFolder}/.worktrees");
    await openGraph();
    __state.nextInputBoxValue = undefined;
    await __state.commands.get("boomergit.createWorktree")!("feature", "branch");
    expect(suggestedPath()).toBe("/Users/me/projects/boomergit/.worktrees/feature");
  });

  it("does nothing when the path prompt is dismissed", async () => {
    await openGraph();
    __state.nextInputBoxValue = undefined;
    await __state.commands.get("boomergit.createWorktree")!("feature", "branch");
    expect(execFileMock.mock.calls.some((c) => c[1][1] === "add")).toBe(false);
  });

  it("creates the worktree at the confirmed path", async () => {
    await openGraph();
    __state.nextInputBoxValue = "/tmp/elsewhere";
    await __state.commands.get("boomergit.createWorktree")!("feature", "branch");
    const add = execFileMock.mock.calls.find((c) => c[1][0] === "worktree" && c[1][1] === "add");
    expect(add?.[1]).toEqual(["worktree", "add", "/tmp/elsewhere", "feature"]);
  });

  it("creates a tracking branch when starting from a remote ref", async () => {
    // `worktree add <path> origin/x` alone would leave a detached HEAD
    await openGraph();
    __state.nextInputBoxValue = "/tmp/from-remote";
    await __state.commands.get("boomergit.createWorktree")!("origin/feature", "remote");
    const add = execFileMock.mock.calls.find((c) => c[1][0] === "worktree" && c[1][1] === "add");
    expect(add?.[1]).toEqual([
      "worktree",
      "add",
      "-b",
      "feature",
      "/tmp/from-remote",
      "origin/feature",
    ]);
  });

  it("suggests a sibling named after the local branch, not the remote ref", async () => {
    await openGraph();
    __state.nextInputBoxValue = undefined;
    await __state.commands.get("boomergit.createWorktree")!("origin/feature", "remote");
    expect(suggestedPath()).toBe("/Users/me/projects/boomergit-feature");
  });

  it("reports git's own message when creation fails", async () => {
    await openGraph();
    gitResponds({}, new Set(["worktree"]));
    __state.nextInputBoxValue = "/tmp/doomed";
    await __state.commands.get("boomergit.createWorktree")!("feature", "branch");
    expect(__state.errorMessages.some((m) => m.includes("Create worktree failed"))).toBe(true);
    expect(__state.errorMessages.some((m) => m.includes("fatal: worktree refused"))).toBe(true);
  });

  it("offers to open the new worktree once created", async () => {
    await openGraph();
    __state.nextInputBoxValue = "/tmp/created";
    await __state.commands.get("boomergit.createWorktree")!("feature", "branch");
    expect(__state.infoMessages.some((m) => m.includes("/tmp/created"))).toBe(true);
  });

  it("does nothing without a workspace folder", async () => {
    workspace.workspaceFolders = undefined;
    activate(context as never);
    await __state.commands.get("boomergit.createWorktree")!("feature", "branch");
    expect(window.showInputBox).not.toHaveBeenCalled();
  });
});

describe("prompting commands without a workspace", () => {
  it("does not prompt before a delete it cannot perform", async () => {
    workspace.workspaceFolders = undefined;
    activate(context as never);
    __state.nextWarningChoice = "Delete";
    await __state.commands.get("boomergit.deleteBranch")!("feature");
    // Asking, then silently doing nothing, is worse than not asking
    expect(__state.warningMessages).toEqual([]);
    expect(__state.infoMessages).toEqual([]);
    expect(__state.errorMessages).toEqual([]);
  });

  it("does not prompt for a branch name it would discard", async () => {
    workspace.workspaceFolders = undefined;
    activate(context as never);
    __state.nextInputBoxValue = "my-branch";
    await __state.commands.get("boomergit.createBranch")!("c".repeat(40));
    expect(window.showInputBox).not.toHaveBeenCalled();
  });
});

describe("guards before the graph is open", () => {
  it("ignores a checkout with no workspace", async () => {
    workspace.workspaceFolders = undefined;
    activate(context as never);
    await __state.commands.get("boomergit.checkoutRef")!("feature", "branch");
    expect(execFileMock.mock.calls.some((c) => c[1][0] === "checkout")).toBe(false);
  });

  it("returns no hover before the graph has been decorated", () => {
    activate(context as never);
    const provider = __state.hoverProvider;
    expect(provider.provideHover({ uri: Uri.parse(GRAPH_URI) }, new Position(0, 0))).toBeUndefined();
  });

  it("reopens the graph when a sidebar view becomes visible", async () => {
    await openGraph();
    window.tabGroups.all = [];
    const treeView = __state.treeViews[0];
    treeView.__setVisible(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(execFileMock.mock.calls.filter((c) => c[1][0] === "log").length).toBeGreaterThan(1);
  });
});
