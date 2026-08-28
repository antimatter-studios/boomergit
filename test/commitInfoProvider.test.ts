import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter, __reset } from "./mocks/vscode.js";
import { COLOR, REF_BADGE_COLOR } from "../src/ui/theme.js";
import type { Commit, Ref } from "../src/git/types.js";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const { CommitInfoProvider, titleRef } = await import("../src/providers/commitInfoProvider.js");

type Callback = (err: Error | null, stdout: Buffer, stderr: Buffer) => void;

function gitReturns(stdout: string): void {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb: Callback) => {
    cb(null, Buffer.from(stdout), Buffer.from(""));
  });
}

function commit(over: Partial<Commit> = {}): Commit {
  return {
    hash: "abcdef1234567890abcdef1234567890abcdef12",
    parents: [],
    author: "Ada Lovelace",
    email: "ada@x.dev",
    timestamp: 1700000000,
    subject: "feat: a thing",
    refs: [],
    ...over,
  };
}

/** The inline styles of a badge's two halves: the sigil box, then the name pill. */
function badgeHalves(html: string): string[] {
  const badges = /<div class="badges">(.*?)<\/div>/s.exec(html)?.[1] ?? "";
  return [...badges.matchAll(/<span style="([^"]*)">[^<]*<\/span>/g)].map((m) => m[1]);
}

/** A stand-in for the WebviewView the extension host would hand us. */
function fakeView() {
  const visibility = new EventEmitter<void>();
  return {
    title: "",
    visible: true,
    webview: { options: {} as Record<string, unknown>, html: "" },
    onDidChangeVisibility: visibility.event,
    __fireVisibility: () => visibility.fire(),
  };
}

beforeEach(() => {
  __reset();
  execFileMock.mockReset();
  gitReturns("");
});

describe("titleRef", () => {
  it("prefers a local branch", () => {
    const refs: Ref[] = [
      { name: "origin/main", type: "remote" },
      { name: "main", type: "branch" },
      { name: "v1", type: "tag" },
    ];
    expect(titleRef(commit({ refs }))).toEqual({ name: "main", type: "branch" });
  });

  it("falls back to a remote when there's no local branch", () => {
    const refs: Ref[] = [{ name: "v1", type: "tag" }, { name: "origin/x", type: "remote" }];
    expect(titleRef(commit({ refs }))).toEqual({ name: "origin/x", type: "remote" });
  });

  it("falls back to a tag last", () => {
    expect(titleRef(commit({ refs: [{ name: "v1", type: "tag" }] }))).toEqual({
      name: "v1",
      type: "tag",
    });
  });

  it("never titles a commit after HEAD", () => {
    expect(titleRef(commit({ refs: [{ name: "HEAD", type: "head" }] }))).toBeUndefined();
  });

  it("returns nothing when the commit carries no titleable ref", () => {
    expect(titleRef(commit({ refs: [{ name: "stash", type: "stash" }] }))).toBeUndefined();
  });
});

describe("CommitInfoProvider", () => {
  it("shows a placeholder before any commit is selected", () => {
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain("Click a commit to see details");
    expect(view.title).toBe("Commit Info");
  });

  it("disables scripts in the webview", () => {
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    expect(view.webview.options.enableScripts).toBe(false);
  });

  it("notifies when the view becomes visible", () => {
    const onVisible = vi.fn();
    const provider = new CommitInfoProvider(onVisible);
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    view.__fireVisibility();
    expect(onVisible).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the view becomes hidden", () => {
    const onVisible = vi.fn();
    const provider = new CommitInfoProvider(onVisible);
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    view.visible = false;
    view.__fireVisibility();
    expect(onVisible).not.toHaveBeenCalled();
  });

  it("renders hash, author, email and full message", async () => {
    gitReturns("feat: a thing\n\nThe long explanation.\n");
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(commit(), "/repo");

    expect(view.webview.html).toContain("abcdef1234567890abcdef1234567890abcdef12");
    expect(view.webview.html).toContain("Ada Lovelace");
    expect(view.webview.html).toContain("&lt;ada@x.dev&gt;");
    expect(view.webview.html).toContain("The long explanation.");
  });

  it("titles the panel after the named ref", async () => {
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(commit({ refs: [{ name: "main", type: "branch" }] }), "/repo", "main");
    expect(view.title).toBe("main");
    expect(view.webview.html).toContain("Branch:");
  });

  it("labels each ref type in the title", async () => {
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(commit({ refs: [{ name: "#42", type: "pr" }] }), "/repo", "#42");
    expect(view.webview.html).toContain("Pull Request:");
  });

  it("falls back to a generic title with no refs", async () => {
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(commit(), "/repo");
    expect(view.title).toBe("Commit Info");
  });

  it("renders a two-tone badge for every ref but the title's", async () => {
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(
      commit({
        refs: [
          { name: "main", type: "branch" },
          { name: "v1.0", type: "tag" },
        ],
      }),
      "/repo",
      "main"
    );
    // The title ref isn't repeated as a badge; the tag is
    expect(view.webview.html).toContain(REF_BADGE_COLOR.tag);
    expect(view.webview.html).toContain(">T<");
    expect(view.webview.html).toContain("v1.0");
  });

  it("gives both halves of a badge the same box, so neither is taller", async () => {
    // The sigil had a min-width and so had to be inline-block, while the name
    // stayed plain inline — which takes the font's content area rather than the
    // whole line box, leaving the white sigil visibly taller than the pill.
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(
      commit({
        refs: [
          { name: "main", type: "branch" },
          { name: "v1.0", type: "tag" },
        ],
      }),
      "/repo",
      "main"
    );

    const halves = badgeHalves(view.webview.html);
    expect(halves).toHaveLength(2);
    for (const decl of ["display:inline-block", "vertical-align:middle", "padding:1px 6px"]) {
      expect(halves[0]).toContain(decl);
      expect(halves[1]).toContain(decl);
    }
    const lineHeight = (style: string) => /line-height:([^;]+)/.exec(style)?.[1];
    expect(lineHeight(halves[0])).toBeDefined();
    expect(lineHeight(halves[0])).toBe(lineHeight(halves[1]));
  });

  it("keeps both halves at one font size, set once on the wrapper", async () => {
    // Sizing either half on its own is what makes them disagree; the wrapper
    // owns the size so the two can only ever match.
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(
      commit({
        refs: [
          { name: "main", type: "branch" },
          { name: "v1.0", type: "tag" },
        ],
      }),
      "/repo",
      "main"
    );

    const halves = badgeHalves(view.webview.html);
    expect(halves).toHaveLength(2);
    expect(halves[0]).not.toContain("font-size");
    expect(halves[1]).not.toContain("font-size");
  });

  it("never renders HEAD as a badge", async () => {
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(
      commit({
        refs: [
          { name: "main", type: "branch" },
          { name: "HEAD", type: "head" },
        ],
      }),
      "/repo",
      "main"
    );
    expect(view.webview.html).not.toContain(REF_BADGE_COLOR.head);
  });

  it("colours the hash with the shared token", async () => {
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(commit(), "/repo");
    expect(view.webview.html).toContain(COLOR.commitHash);
  });

  it("escapes HTML in the commit message", async () => {
    gitReturns('fix: <script>alert("x")</script> & more');
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(commit(), "/repo");
    expect(view.webview.html).not.toContain("<script>");
    expect(view.webview.html).toContain("&lt;script&gt;");
    expect(view.webview.html).toContain("&amp; more");
  });

  it("escapes HTML in a ref name", async () => {
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(
      commit({ refs: [{ name: '<img src=x>', type: "tag" }] }),
      "/repo"
    );
    expect(view.webview.html).not.toContain("<img src=x>");
  });

  it("falls back to the subject when git gives no message body", async () => {
    gitReturns("");
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(commit({ subject: "only a subject" }), "/repo");
    expect(view.webview.html).toContain("only a subject");
  });

  it("returns to the placeholder on clear", async () => {
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);
    await provider.showCommit(commit(), "/repo");
    provider.clear();
    expect(view.webview.html).toContain("Click a commit to see details");
    expect(view.title).toBe("Commit Info");
  });

  it("discards a slow message fetch superseded by a newer selection", async () => {
    const pending: Callback[] = [];
    execFileMock.mockImplementation((_c, _a, _o, cb: Callback) => {
      pending.push(cb);
    });
    const provider = new CommitInfoProvider();
    const view = fakeView();
    provider.resolveWebviewView(view as never);

    const first = provider.showCommit(commit({ hash: "1".repeat(40) }), "/repo");
    const second = provider.showCommit(commit({ hash: "2".repeat(40), subject: "newer" }), "/repo");
    pending[1](null, Buffer.from("newer body"), Buffer.from(""));
    pending[0](null, Buffer.from("stale body"), Buffer.from(""));
    await Promise.all([first, second]);

    expect(view.webview.html).toContain("newer body");
    expect(view.webview.html).not.toContain("stale body");
  });

  it("does nothing when no view has been resolved yet", async () => {
    const provider = new CommitInfoProvider();
    await expect(provider.showCommit(commit(), "/repo")).resolves.toBeUndefined();
  });
});
