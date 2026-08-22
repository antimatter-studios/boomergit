import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Position, Range, __reset, __state, makeFakeDocument, makeFakeEditor } from "./mocks/vscode.js";
import { GraphDecorationEngine } from "../src/decorations/graphDecorations.js";
import { GitGraphProvider } from "../src/providers/gitGraphProvider.js";
import { computeGraphLayout } from "../src/graph/layout.js";
import { COLOR } from "../src/ui/theme.js";
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
