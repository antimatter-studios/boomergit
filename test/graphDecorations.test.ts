import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Position, Range, __reset, __state, makeFakeDocument, makeFakeEditor } from "./mocks/vscode.js";
import { GraphDecorationEngine } from "../src/decorations/graphDecorations.js";
import { GitGraphProvider } from "../src/providers/gitGraphProvider.js";
import { computeGraphLayout } from "../src/graph/layout.js";
import { COLOR, REF_BADGE_COLOR } from "../src/ui/theme.js";
import type { Commit, Ref } from "../src/git/types.js";

let storageDir: string;

beforeEach(() => {
  __reset();
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "boomergit-deco-"));
});

afterEach(() => {
  fs.rmSync(storageDir, { recursive: true, force: true });
});

function commit(hash: string, over: Partial<Commit> = {}): Commit {
  return {
    hash,
    parents: [],
    author: "Ada",
    email: "ada@x.dev",
    timestamp: 1700000000,
    subject: `subject ${hash}`,
    refs: [],
    ...over,
  };
}

/**
 * Build the editor exactly as the extension does: render the document through
 * the real provider, so badge offsets in the text are the real ones.
 */
function setup(commits: Commit[]) {
  const provider = new GitGraphProvider();
  provider.setCommits(commits);
  const text = provider.provideTextDocumentContent(undefined as never);
  const editor = makeFakeEditor(makeFakeDocument(text));
  const rows = computeGraphLayout(commits);
  const engine = new GraphDecorationEngine(storageDir);
  return { engine, editor, rows, text };
}

/** All decoration option objects whose injected CSS mentions `fragment`. */
function decorationsWithCss(fragment: string) {
  return __state.decorationTypes.filter((d) =>
    String(d.options.textDecoration ?? "").includes(fragment)
  );
}

describe("GraphDecorationEngine.apply", () => {
  it("creates one SVG tile decoration per row", () => {
    const commits = [commit("a".repeat(40)), commit("b".repeat(40))];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const tiles = __state.decorationTypes.filter((d) => "before" in d.options);
    expect(tiles).toHaveLength(2);
  });

  it("writes an SVG tile file for each row", () => {
    const commits = [commit("a".repeat(40))];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const tiles = fs.readdirSync(path.join(storageDir, "svg-tiles"));
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((f) => f.endsWith(".svg"))).toBe(true);
  });

  it("gives every tile the same width so text can't shift between rows", () => {
    // A merge widens the graph; narrow rows must still pad to the same width.
    const commits = [
      commit("m".repeat(40), { parents: ["a".repeat(40), "b".repeat(40)] }),
      commit("a".repeat(40)),
      commit("b".repeat(40)),
    ];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const widths = __state.decorationTypes
      .filter((d) => "before" in d.options)
      .map((d) => (d.options.before as Record<string, unknown>).width);
    expect(new Set(widths).size).toBe(1);
  });

  it("inverts the row holding the checked-out branch", () => {
    const commits = [
      commit("a".repeat(40), { refs: [{ name: "main", type: "branch" }] }),
      commit("b".repeat(40)),
    ];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits, "main");
    const inverted = __state.decorationTypes.filter(
      (d) => d.options.backgroundColor === COLOR.activeRowBackground
    );
    expect(inverted).toHaveLength(1);
    expect(inverted[0].options.color).toBe(COLOR.activeRowText);
    expect(inverted[0].options.isWholeLine).toBe(true);
  });

  it("inverts nothing when the current branch isn't in the graph", () => {
    const commits = [commit("a".repeat(40), { refs: [{ name: "main", type: "branch" }] })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits, "some-other-branch");
    expect(
      __state.decorationTypes.filter((d) => d.options.backgroundColor === COLOR.activeRowBackground)
    ).toHaveLength(0);
  });

  it("matches the current branch by name only against local branches", () => {
    // A remote-tracking ref of the same name must not claim the active row.
    const commits = [commit("a".repeat(40), { refs: [{ name: "main", type: "remote" }] })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits, "main");
    expect(
      __state.decorationTypes.filter((d) => d.options.backgroundColor === COLOR.activeRowBackground)
    ).toHaveLength(0);
  });

  it("colours hash, author and date", () => {
    const commits = [commit("abcdef1234567890")];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const colours = __state.decorationTypes.map((d) => d.options.color);
    expect(colours).toContain(COLOR.commitHash);
    expect(colours).toContain(COLOR.author);
    expect(colours).toContain(COLOR.date);
  });

  it("discards the previous pass's decorations when re-applied", () => {
    const commits = [commit("a".repeat(40))];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const firstPass = [...__state.decorationTypes];
    engine.apply(editor as never, rows, commits);
    expect(firstPass.every((d) => d.disposed)).toBe(true);
  });

  it("tolerates more rows than commits", () => {
    const commits = [commit("a".repeat(40))];
    const { engine, editor, rows } = setup(commits);
    expect(() => engine.apply(editor as never, [...rows, ...rows], commits)).not.toThrow();
  });
});

describe("ref badge decorations", () => {
  const refs: Ref[] = [
    { name: "HEAD", type: "head" },
    { name: "main", type: "branch" },
    { name: "v1.0", type: "tag" },
  ];

  it("splits each badge into a white sigil box and a coloured name pill", () => {
    const commits = [commit("a".repeat(40), { refs })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);

    const sigil = __state.decorationTypes.find(
      (d) => d.options.color === COLOR.sigilText && String(d.options.textDecoration ?? "").includes(COLOR.sigilBackground)
    );
    expect(sigil).toBeDefined();
    // One sigil decoration type covering all three badges
    expect(editor.__decorations.get(sigil!)).toHaveLength(3);
  });

  it("rounds the sigil box on the left and the name pill on the right", () => {
    const commits = [commit("a".repeat(40), { refs })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    expect(decorationsWithCss("border-radius: 3px 0 0 3px").length).toBeGreaterThan(0);
    expect(decorationsWithCss("border-radius: 0 3px 3px 0").length).toBeGreaterThan(0);
  });

  it("hit-tests a click inside a badge back to its ref", () => {
    const commits = [commit("a".repeat(40), { refs })];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);

    const idx = text.indexOf(" B main ");
    // Inside the name, past the sigil box
    const hit = engine.getRefAt(new Position(0, idx + 4) as never);
    expect(hit?.ref.name).toBe("main");
    expect(hit?.ref.type).toBe("branch");
    expect(hit?.commitHash).toBe("a".repeat(40));
  });

  it("hit-tests a click on the sigil letter itself", () => {
    const commits = [commit("a".repeat(40), { refs })];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const idx = text.indexOf(" T v1.0 ");
    const hit = engine.getRefAt(new Position(0, idx + 1) as never);
    expect(hit?.ref.name).toBe("v1.0");
  });

  it("returns nothing for a click on the subject text", () => {
    const commits = [commit("a".repeat(40), { refs, subject: "the subject" })];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const hit = engine.getRefAt(new Position(0, text.indexOf("the subject") + 2) as never);
    expect(hit).toBeUndefined();
  });

  it("distinguishes adjacent badges", () => {
    const commits = [commit("a".repeat(40), { refs })];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const headHit = engine.getRefAt(new Position(0, text.indexOf(" H HEAD ") + 4) as never);
    const mainHit = engine.getRefAt(new Position(0, text.indexOf(" B main ") + 4) as never);
    expect(headHit?.ref.type).toBe("head");
    expect(mainHit?.ref.type).toBe("branch");
  });

  it("hit-tests badges on the correct row when several rows carry refs", () => {
    const commits = [
      commit("a".repeat(40), { refs: [{ name: "first", type: "branch" }] }),
      commit("b".repeat(40), { refs: [{ name: "second", type: "branch" }] }),
    ];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const secondLine = text.split("\n")[1];
    const hit = engine.getRefAt(
      new Position(1, secondLine.indexOf(" B second ") + 4) as never
    );
    expect(hit?.ref.name).toBe("second");
    expect(hit?.commitHash).toBe("b".repeat(40));
  });

  it("hit-tests a badge whose name was shortened to fit", () => {
    // A name over the length cap is elided in the document; the click must
    // still resolve to the ref, whose own name stays full.
    const longName = "origin/dependabot/github_actions/github-actions-bc056f11d8";
    const commits = [commit("a".repeat(40), { refs: [{ name: longName, type: "remote" }] })];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);

    const badgeStart = text.indexOf(" R ");
    const hit = engine.getRefAt(new Position(0, badgeStart + 6) as never);
    expect(hit?.ref.name).toBe(longName);
  });

  it("paints a short name as one whole pill", () => {
    const commits = [commit("a".repeat(40), { refs: [{ name: "main", type: "branch" }] })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);

    // Exactly one piece carries ranges: the whole-pill styling, unchanged
    const laneColour = rows[0].commitColor;
    const withRanges = decorationsWithCss(`background: ${laneColour}`).filter(
      (d) => (editor.__decorations.get(d) ?? []).length > 0
    );
    expect(withRanges).toHaveLength(1);
    const css = String(withRanges[0].options.textDecoration);
    expect(css).toContain("border-radius: 0 3px 3px 0");
    expect(css).toContain("padding: 0px 3px 0px 6px");
  });

  it("splits a long name's pill so a rendered split can't show", () => {
    // Over VS Code's 50-character run limit, so its middle may be split into
    // several spans. Nothing that would repeat may sit on that middle.
    const longName = "origin/dependabot/github_actions/github-actions-bc056f11d8";
    const commits = [commit("a".repeat(40), { refs: [{ name: longName, type: "remote" }] })];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);

    const laneColour = rows[0].commitColor;
    const pieces = decorationsWithCss(`background: ${laneColour}`).filter(
      (d) => (editor.__decorations.get(d) ?? []).length > 0
    );
    // Three pieces: left cap, body, tail
    expect(pieces).toHaveLength(3);

    // The body is the piece carrying nothing that could repeat
    const seamless = pieces.filter((d) => {
      const css = String(d.options.textDecoration);
      return !css.includes("border-radius") && !css.includes("margin-right");
    });
    expect(seamless.length).toBeGreaterThan(0);
    for (const piece of seamless) {
      expect(String(piece.options.textDecoration)).toContain(`background: ${laneColour}`);
    }

    // Exactly one piece owns the rounded end and the gap to the next badge
    const rounded = pieces.filter((d) =>
      String(d.options.textDecoration).includes("border-radius")
    );
    expect(rounded).toHaveLength(1);
    expect(String(rounded[0].options.textDecoration)).toContain("margin-right: 6px");
  });

  it("tiles a long name's pieces over the name with no gap or overlap", () => {
    const longName = "origin/dependabot/github_actions/github-actions-bc056f11d8";
    const commits = [commit("a".repeat(40), { refs: [{ name: longName, type: "remote" }] })];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);

    const laneColour = rows[0].commitColor;
    const spans = decorationsWithCss(`background: ${laneColour}`)
      .flatMap((d) => editor.__decorations.get(d) ?? [])
      .map((o: { range: Range }) => o.range)
      .sort((a, b) => a.start.character - b.start.character);

    // Contiguous: each piece starts where the previous ended
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start.character).toBe(spans[i - 1].end.character);
    }
    // Together they cover the name plus its trailing space, exactly
    const badgeStart = text.indexOf(" R ");
    expect(spans[0].start.character).toBe(badgeStart + 3);
    expect(spans[spans.length - 1].end.character).toBe(
      badgeStart + 3 + longName.length + 1
    );
  });

  it("gives every piece of one pill the same box, so they line up", () => {
    const longName = "origin/dependabot/github_actions/github-actions-bc056f11d8";
    const commits = [commit("a".repeat(40), { refs: [{ name: longName, type: "remote" }] })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);

    const laneColour = rows[0].commitColor;
    const pieces = decorationsWithCss(`background: ${laneColour}`).filter(
      (d) => (editor.__decorations.get(d) ?? []).length > 0
    );
    for (const piece of pieces) {
      const css = String(piece.options.textDecoration);
      expect(css).toContain("display: inline-block");
      expect(css).toContain("line-height: 1.3");
      // Zero vertical padding everywhere, or the pieces would step
      expect(css).toMatch(/padding: 0px/);
    }
  });

  it("forgets hit ranges once decorations are cleared", () => {
    const commits = [commit("a".repeat(40), { refs })];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);
    engine.clearDecorations();
    expect(engine.getRefAt(new Position(0, text.indexOf(" B main ") + 4) as never)).toBeUndefined();
  });

  it("colours the name pill with the commit's lane colour", () => {
    const commits = [commit("a".repeat(40), { refs })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const laneColour = rows[0].commitColor;
    expect(decorationsWithCss(`background: ${laneColour}`).length).toBeGreaterThan(0);
  });
});

describe("worktree marks", () => {
  const worktreeRef = { name: "feature", type: "worktree" as const };

  /** The SVG written for a given row, read back off disk. */
  function tileFor(line: number, editor: { __decorations: Map<unknown, unknown> }) {
    const tiles = __state.decorationTypes.filter((d) => "before" in d.options);
    const before = tiles[line].options.before as { contentIconPath: { fsPath: string } };
    return fs.readFileSync(before.contentIconPath.fsPath, "utf8");
  }

  it("rings the commit dot of a row checked out in another worktree", () => {
    const commits = [
      commit("a".repeat(40), { refs: [worktreeRef] }),
      commit("b".repeat(40)),
    ];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);

    expect(tileFor(0, editor)).toContain(COLOR.worktreeAccent);
    // The neighbouring row gets no ring
    expect(tileFor(1, editor)).not.toContain(COLOR.worktreeAccent);
  });

  it("draws the ring outside the dot, not over it", () => {
    const commits = [commit("a".repeat(40), { refs: [worktreeRef] })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);

    const svg = tileFor(0, editor);
    const radii = [...svg.matchAll(/r="([\d.]+)"/g)].map((m) => Number(m[1]));
    // The ring's radius exceeds the dot's, so the dot stays visible inside it
    expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii));
  });

  it("gives the ring no fill, so the lane colour still reads through", () => {
    const commits = [commit("a".repeat(40), { refs: [worktreeRef] })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    expect(tileFor(0, editor)).toMatch(
      new RegExp(`fill="none"[^>]*stroke="${COLOR.worktreeAccent}"`)
    );
  });

  it("does not tint the row, so the active row and selection still show", () => {
    const commits = [commit("a".repeat(40), { refs: [worktreeRef] })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);

    // Nothing added a whole-line background beyond the active-row treatment
    const fills = __state.decorationTypes.filter(
      (d) => d.options.isWholeLine === true && d.options.backgroundColor
    );
    expect(fills).toHaveLength(0);
  });

  it("ticks the overview ruler so off-screen worktrees are findable", () => {
    const commits = [commit("a".repeat(40), { refs: [worktreeRef] })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const ticks = __state.decorationTypes.filter(
      (d) => d.options.overviewRulerColor === REF_BADGE_COLOR.worktree
    );
    expect(ticks).toHaveLength(1);
    expect(editor.__decorations.get(ticks[0])).toHaveLength(1);
  });

  it("adds no ruler tick when nothing is checked out elsewhere", () => {
    const commits = [commit("a".repeat(40), { refs: [{ name: "main", type: "branch" }] })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    expect(
      __state.decorationTypes.filter(
        (d) => d.options.overviewRulerColor === REF_BADGE_COLOR.worktree
      )
    ).toHaveLength(0);
  });

  it("does not share a cached tile between ringed and plain rows", () => {
    // Structurally identical rows differing only in the mark
    const commits = [
      commit("a".repeat(40), { refs: [worktreeRef] }),
      commit("b".repeat(40)),
    ];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const tiles = __state.decorationTypes.filter((d) => "before" in d.options);
    const paths = tiles.map(
      (d) => (d.options.before as { contentIconPath: { fsPath: string } }).contentIconPath.fsPath
    );
    expect(paths[0]).not.toBe(paths[1]);
  });

  it("marks every worktree row, not just the first", () => {
    const commits = [
      commit("a".repeat(40), { refs: [worktreeRef] }),
      commit("b".repeat(40)),
      commit("c".repeat(40), { refs: [{ name: "other", type: "worktree" }] }),
    ];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const ticks = __state.decorationTypes.find(
      (d) => d.options.overviewRulerColor === REF_BADGE_COLOR.worktree
    )!;
    expect(editor.__decorations.get(ticks)).toHaveLength(2);
  });

  it("gives a worktree its W badge alongside the branch badge", () => {
    const commits = [
      commit("a".repeat(40), {
        refs: [
          { name: "feature", type: "branch" },
          { name: "feature", type: "worktree" },
        ],
      }),
    ];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);
    expect(text).toContain(" B feature ");
    expect(text).toContain(" W feature ");
    // The W badge hit-tests back to the worktree ref, not the branch
    const hit = engine.getRefAt(new Position(0, text.indexOf(" W feature ") + 4) as never);
    expect(hit?.ref.type).toBe("worktree");
  });
});

describe("commit lookup", () => {
  it("maps a line to its commit", () => {
    const commits = [commit("a".repeat(40)), commit("b".repeat(40))];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    expect(engine.getCommitAt(1)?.hash).toBe("b".repeat(40));
  });

  it("returns nothing past the end", () => {
    const commits = [commit("a".repeat(40))];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    expect(engine.getCommitAt(99)).toBeUndefined();
  });

  it("reports the total row count", () => {
    const commits = [commit("a".repeat(40)), commit("b".repeat(40)), commit("c".repeat(40))];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    expect(engine.getTotalRows()).toBe(3);
  });
});

describe("row selection", () => {
  function threeRows() {
    const commits = [commit("a".repeat(40)), commit("b".repeat(40)), commit("c".repeat(40))];
    const built = setup(commits);
    built.engine.apply(built.editor as never, built.rows, commits);
    return { ...built, commits };
  }

  it("selects a row", () => {
    const { engine, editor } = threeRows();
    expect(engine.selectRow(editor as never, 1)).toEqual([1]);
  });

  it("toggles a selected row back off", () => {
    const { engine, editor } = threeRows();
    engine.selectRow(editor as never, 1);
    expect(engine.selectRow(editor as never, 1)).toEqual([]);
  });

  it("holds two rows for compare", () => {
    const { engine, editor } = threeRows();
    engine.selectRow(editor as never, 0);
    expect(engine.selectRow(editor as never, 2)).toEqual([0, 2]);
  });

  it("drops the oldest selection past two rows", () => {
    const { engine, editor } = threeRows();
    engine.selectRow(editor as never, 0);
    engine.selectRow(editor as never, 1);
    expect(engine.selectRow(editor as never, 2)).toEqual([1, 2]);
  });

  it("resolves selections to commits", () => {
    const { engine, editor } = threeRows();
    engine.selectRow(editor as never, 0);
    engine.selectRow(editor as never, 2);
    expect(engine.getSelectedCommits().map((c) => c.hash)).toEqual([
      "a".repeat(40),
      "c".repeat(40),
    ]);
  });

  it("marks selections in order", () => {
    const { engine, editor } = threeRows();
    engine.selectRow(editor as never, 0);
    engine.selectRow(editor as never, 1);
    const markers = __state.decorationTypes
      .filter((d) => d.options.after)
      .map((d) => (d.options.after as Record<string, unknown>).contentText);
    expect(markers).toContain(" [1]");
    expect(markers).toContain(" [2]");
  });

  it("clears every selection", () => {
    const { engine, editor } = threeRows();
    engine.selectRow(editor as never, 0);
    engine.selectRow(editor as never, 1);
    engine.clearSelections();
    expect(engine.getSelectedRows()).toEqual([]);
  });

  it("replaces the selection when navigating", () => {
    const { engine, editor } = threeRows();
    engine.selectRow(editor as never, 0);
    engine.selectRow(editor as never, 1);
    engine.navigateTo(editor as never, 2);
    expect(engine.getSelectedRows()).toEqual([2]);
  });

  it("skips commits that no longer exist", () => {
    const { engine, editor } = threeRows();
    engine.selectRow(editor as never, 99);
    expect(engine.getSelectedCommits()).toEqual([]);
  });
});

describe("badge hover highlight", () => {
  const refs: Ref[] = [{ name: "main", type: "branch" }];

  it("outlines the badge under the pointer", () => {
    const commits = [commit("a".repeat(40), { refs })];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);
    engine.highlightBadge(editor as never, new Position(0, text.indexOf(" B main ") + 4) as never);
    expect(decorationsWithCss(`outline: 2px solid ${COLOR.badgeHighlight}`)).toHaveLength(1);
  });

  it("adds no outline away from a badge", () => {
    const commits = [commit("a".repeat(40), { refs })];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    engine.highlightBadge(editor as never, new Position(0, 0) as never);
    expect(decorationsWithCss(`outline: 2px solid ${COLOR.badgeHighlight}`)).toHaveLength(0);
  });

  it("replaces the previous outline rather than stacking", () => {
    const commits = [commit("a".repeat(40), { refs })];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);
    const at = text.indexOf(" B main ") + 4;
    engine.highlightBadge(editor as never, new Position(0, at) as never);
    engine.highlightBadge(editor as never, new Position(0, at) as never);
    const outlines = decorationsWithCss(`outline: 2px solid ${COLOR.badgeHighlight}`);
    expect(outlines.filter((d) => !d.disposed)).toHaveLength(1);
  });

  it("clears the outline on demand", () => {
    const commits = [commit("a".repeat(40), { refs })];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);
    engine.highlightBadge(editor as never, new Position(0, text.indexOf(" B main ") + 4) as never);
    engine.clearHighlight();
    const outlines = decorationsWithCss(`outline: 2px solid ${COLOR.badgeHighlight}`);
    expect(outlines.every((d) => d.disposed)).toBe(true);
  });
});

describe("dispose", () => {
  it("disposes row, selection and highlight decorations together", () => {
    const commits = [commit("a".repeat(40), { refs: [{ name: "main", type: "branch" }] })];
    const { engine, editor, rows, text } = setup(commits);
    engine.apply(editor as never, rows, commits);
    engine.selectRow(editor as never, 0);
    engine.highlightBadge(editor as never, new Position(0, text.indexOf(" B main ") + 4) as never);

    engine.dispose();

    expect(__state.decorationTypes.every((d) => d.disposed)).toBe(true);
    expect(engine.getSelectedRows()).toEqual([]);
  });

  it("empties the SVG tile cache", () => {
    const commits = [commit("a".repeat(40))];
    const { engine, editor, rows } = setup(commits);
    engine.apply(editor as never, rows, commits);
    engine.dispose();
    expect(fs.readdirSync(path.join(storageDir, "svg-tiles"))).toHaveLength(0);
  });
});

describe("line height", () => {
  it("uses the editor's explicit line height when set", () => {
    const commits = [commit("a".repeat(40))];
    const { engine, editor, rows } = setup(commits);
    editor.options.lineHeight = 30;
    engine.apply(editor as never, rows, commits);
    const tile = __state.decorationTypes.find((d) => "before" in d.options)!;
    expect((tile.options.before as Record<string, unknown>).height).toBe("30px");
  });

  it("derives a line height from the configured font size", () => {
    const commits = [commit("a".repeat(40))];
    const { engine, editor, rows } = setup(commits);
    __state.configValues.set("editor.fontSize", 16);
    __state.configValues.set("editor.lineHeight", 0);
    engine.apply(editor as never, rows, commits);
    const tile = __state.decorationTypes.find((d) => "before" in d.options)!;
    const ratio = process.platform === "darwin" ? 1.5 : 1.35;
    expect((tile.options.before as Record<string, unknown>).height).toBe(
      `${Math.round(16 * ratio)}px`
    );
  });

  it("treats a configured line height of 8 or more as pixels", () => {
    const commits = [commit("a".repeat(40))];
    const { engine, editor, rows } = setup(commits);
    __state.configValues.set("editor.lineHeight", 26);
    engine.apply(editor as never, rows, commits);
    const tile = __state.decorationTypes.find((d) => "before" in d.options)!;
    expect((tile.options.before as Record<string, unknown>).height).toBe("26px");
  });

  it("treats a configured line height below 8 as a multiplier", () => {
    const commits = [commit("a".repeat(40))];
    const { engine, editor, rows } = setup(commits);
    __state.configValues.set("editor.fontSize", 14);
    __state.configValues.set("editor.lineHeight", 2);
    engine.apply(editor as never, rows, commits);
    const tile = __state.decorationTypes.find((d) => "before" in d.options)!;
    expect((tile.options.before as Record<string, unknown>).height).toBe("28px");
  });
});
