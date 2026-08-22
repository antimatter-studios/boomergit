import { describe, it, expect } from "vitest";
import {
  parseRefs,
  refBadgeText,
  badgeName,
  REF_SIGIL_WIDTH,
  MAX_BADGE_NAME_LEN,
} from "../src/git/types.js";
import { parseLogOutput } from "../src/git/parser.js";

describe("parseRefs", () => {
  it("returns [] for empty or whitespace input", () => {
    expect(parseRefs("")).toEqual([]);
    expect(parseRefs("   ")).toEqual([]);
  });

  it("splits 'HEAD -> branch' into a head ref and a branch ref", () => {
    expect(parseRefs("HEAD -> main")).toEqual([
      { name: "HEAD", type: "head" },
      { name: "main", type: "branch" },
    ]);
  });

  it("classifies a bare HEAD", () => {
    expect(parseRefs("HEAD")).toEqual([{ name: "HEAD", type: "head" }]);
  });

  it("classifies tags via the 'tag: ' prefix", () => {
    expect(parseRefs("tag: v1.2.0")).toEqual([{ name: "v1.2.0", type: "tag" }]);
  });

  it("treats names containing a slash as remotes", () => {
    expect(parseRefs("origin/main")).toEqual([{ name: "origin/main", type: "remote" }]);
  });

  it("treats a plain name as a local branch", () => {
    expect(parseRefs("feature")).toEqual([{ name: "feature", type: "branch" }]);
  });

  it("parses a comma-separated mix and trims whitespace", () => {
    expect(parseRefs("HEAD -> main, origin/main, tag: v1.0")).toEqual([
      { name: "HEAD", type: "head" },
      { name: "main", type: "branch" },
      { name: "origin/main", type: "remote" },
      { name: "v1.0", type: "tag" },
    ]);
  });

  it("skips empty entries between commas", () => {
    expect(parseRefs("main, , origin/main")).toEqual([
      { name: "main", type: "branch" },
      { name: "origin/main", type: "remote" },
    ]);
  });
});

describe("parseLogOutput", () => {
  const line = (parts: string[]) => parts.join("|");

  it("returns [] for empty output", () => {
    expect(parseLogOutput("")).toEqual([]);
    expect(parseLogOutput("\n  \n")).toEqual([]);
  });

  it("parses a single commit with an empty refs field", () => {
    const out = line(["abc123", "def456", "Ada", "ada@x.dev", "1700000000", "Initial commit", ""]);
    const commits = parseLogOutput(out);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({
      hash: "abc123",
      parents: ["def456"],
      author: "Ada",
      email: "ada@x.dev",
      timestamp: 1700000000,
      subject: "Initial commit",
      refs: [],
    });
  });

  it("parses refs from the trailing field", () => {
    const out = line(["h", "p", "A", "a@x", "100", "Subject", "HEAD -> main, tag: v1.0"]);
    expect(parseLogOutput(out)[0].refs).toEqual([
      { name: "HEAD", type: "head" },
      { name: "main", type: "branch" },
      { name: "v1.0", type: "tag" },
    ]);
  });

  it("splits multiple parents on space", () => {
    const out = line(["m", "p1 p2 p3", "A", "a@x", "100", "Merge", ""]);
    expect(parseLogOutput(out)[0].parents).toEqual(["p1", "p2", "p3"]);
  });

  it("treats a root commit (no parents) as an empty parents array", () => {
    const out = line(["root", "", "A", "a@x", "100", "Root", ""]);
    expect(parseLogOutput(out)[0].parents).toEqual([]);
  });

  it("preserves pipe characters inside the subject when refs follow", () => {
    const out = line(["h", "p", "A", "a@x", "100", "feat: a | b | c", "HEAD -> main"]);
    const c = parseLogOutput(out)[0];
    expect(c.subject).toBe("feat: a | b | c");
    expect(c.refs).toEqual([
      { name: "HEAD", type: "head" },
      { name: "main", type: "branch" },
    ]);
  });

  it("parses multiple lines and skips blank ones", () => {
    const out = [
      line(["h1", "h2", "A", "a@x", "100", "one", ""]),
      "",
      line(["h2", "", "B", "b@x", "200", "two", ""]),
    ].join("\n");
    const commits = parseLogOutput(out);
    expect(commits.map((c) => c.hash)).toEqual(["h1", "h2"]);
  });

  it("skips lines with fewer than 6 fields", () => {
    expect(parseLogOutput("too|few|fields")).toEqual([]);
  });
});

describe("parseRefs (--decorate=full)", () => {
  it("classifies each namespace from its full path", () => {
    expect(parseRefs("refs/heads/main")).toEqual([{ name: "main", type: "branch" }]);
    expect(parseRefs("refs/remotes/origin/main")).toEqual([{ name: "origin/main", type: "remote" }]);
    expect(parseRefs("tag: refs/tags/v1.0")).toEqual([{ name: "v1.0", type: "tag" }]);
    expect(parseRefs("refs/stash")).toEqual([{ name: "stash", type: "stash" }]);
    expect(parseRefs("refs/notes/commits")).toEqual([{ name: "commits", type: "note" }]);
  });

  it("keeps slashed local branches as branches, not remotes", () => {
    expect(parseRefs("refs/heads/chore/guard")).toEqual([{ name: "chore/guard", type: "branch" }]);
  });

  it("names PR refs after their number across forges", () => {
    expect(parseRefs("refs/pull/42/head")).toEqual([{ name: "#42", type: "pr" }]);
    expect(parseRefs("refs/merge-requests/7/head")).toEqual([{ name: "#7", type: "pr" }]);
    expect(parseRefs("refs/pull-requests/9/from")).toEqual([{ name: "#9", type: "pr" }]);
    expect(parseRefs("refs/changes/34/1234/2")).toEqual([{ name: "#1234", type: "pr" }]);
  });

  it("falls back to 'other' for unknown namespaces", () => {
    expect(parseRefs("refs/bisect/bad")).toEqual([{ name: "bisect/bad", type: "other" }]);
    expect(parseRefs("refs/replace/abc123")).toEqual([{ name: "replace/abc123", type: "other" }]);
  });

  it("splits 'HEAD -> refs/heads/main'", () => {
    expect(parseRefs("HEAD -> refs/heads/main")).toEqual([
      { name: "HEAD", type: "head" },
      { name: "main", type: "branch" },
    ]);
  });

  it("keeps only the left side of a non-HEAD symref", () => {
    expect(parseRefs("origin/HEAD -> origin/main")).toEqual([
      { name: "origin/HEAD", type: "remote" },
    ]);
  });
});

describe("badgeName", () => {
  it("leaves a name that already fits untouched", () => {
    expect(badgeName("origin/claude/fork-pages-actions-source")).toBe(
      "origin/claude/fork-pages-actions-source"
    );
  });

  it("leaves a name exactly at the limit untouched", () => {
    const exact = "x".repeat(MAX_BADGE_NAME_LEN);
    expect(badgeName(exact)).toBe(exact);
  });

  it("elides the middle of a longer name", () => {
    const name = "origin/dependabot/github_actions/github-actions-bc056f11d8";
    const shortened = badgeName(name);
    expect(shortened).toHaveLength(MAX_BADGE_NAME_LEN);
    expect(shortened).toContain("…");
    expect(shortened.startsWith("origin/dependabot/")).toBe(true);
    expect(shortened.endsWith("056f11d8")).toBe(true);
  });

  it("keeps the distinctive tail, which is what tells two branches apart", () => {
    const a = badgeName("origin/claude/a-very-long-generated-branch-name-aaaaaa-1nr4n");
    const b = badgeName("origin/claude/a-very-long-generated-branch-name-aaaaaa-j5kvg");
    expect(a).not.toBe(b);
  });

  it("never exceeds the limit however long the input", () => {
    for (const len of [49, 50, 51, 80, 300]) {
      expect(badgeName("y".repeat(len)).length).toBeLessThanOrEqual(MAX_BADGE_NAME_LEN);
    }
  });
});

describe("badge run length (VS Code splits styled runs over 50 chars)", () => {
  /**
   * The name pill is decorated as one run: the name plus its trailing space.
   * A run longer than 50 characters is split into separate spans by VS Code's
   * line renderer, and each span gets the pill CSS — which is what produced a
   * second badge holding the overflow.
   */
  const VSCODE_LONG_RUN_LIMIT = 50;

  it("keeps the name run within the limit for a pathological name", () => {
    const ref = { name: "origin/" + "long-".repeat(40) + "end", type: "remote" } as const;
    const token = refBadgeText(ref);
    const nameRun = token.slice(REF_SIGIL_WIDTH);
    expect(nameRun.length).toBeLessThanOrEqual(VSCODE_LONG_RUN_LIMIT);
  });

  it("keeps the name run within the limit for every real-world case that split", () => {
    // The four badges observed rendering as two pills, all 50 chars at the seam
    const observed = [
      "origin/fix/cost-allocation-tag-premature-activation",
      "origin/claude/domains-microstack-boilerplate-1nr4nr",
      "origin/dependabot/github_actions/github-actions-bc056f11d8",
      "origin/claude/henry-graeser-elevated-access-ghs6cf1",
    ];
    for (const name of observed) {
      const nameRun = refBadgeText({ name, type: "remote" }).slice(REF_SIGIL_WIDTH);
      expect(nameRun.length).toBeLessThanOrEqual(VSCODE_LONG_RUN_LIMIT);
    }
  });

  it("leaves the sigil run far below the limit", () => {
    expect(REF_SIGIL_WIDTH).toBeLessThan(VSCODE_LONG_RUN_LIMIT);
  });
});

describe("refBadgeText", () => {
  it("prefixes the type sigil in a fixed-width box", () => {
    expect(refBadgeText({ name: "main", type: "branch" })).toBe(" B main ");
    expect(refBadgeText({ name: "v1.0", type: "tag" })).toBe(" T v1.0 ");
    expect(refBadgeText({ name: "origin/main", type: "remote" })).toBe(" R origin/main ");
    expect(refBadgeText({ name: "HEAD", type: "head" })).toBe(" H HEAD ");
  });

  it("puts the name immediately after the sigil box", () => {
    const text = refBadgeText({ name: "main", type: "branch" });
    expect(text.slice(0, REF_SIGIL_WIDTH)).toBe(" B ");
    expect(text.slice(REF_SIGIL_WIDTH)).toBe("main ");
  });
});
