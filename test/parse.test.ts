import { describe, it, expect } from "vitest";
import { parseRefs, refBadgeText, refSigil, REF_SIGIL, REF_SIGIL_WIDTH, SIGIL_CHARS } from "../src/git/types.js";
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
    expect(parseRefs("refs/heads/main")).toEqual([
      { name: "main", type: "branch", full: "refs/heads/main" },
    ]);
    expect(parseRefs("refs/remotes/origin/main")).toEqual([
      { name: "origin/main", type: "remote", full: "refs/remotes/origin/main" },
    ]);
    expect(parseRefs("tag: refs/tags/v1.0")).toEqual([
      { name: "v1.0", type: "tag", full: "refs/tags/v1.0" },
    ]);
    expect(parseRefs("refs/stash")).toEqual([
      { name: "stash", type: "stash", full: "refs/stash" },
    ]);
    expect(parseRefs("refs/notes/commits")).toEqual([
      { name: "commits", type: "note", full: "refs/notes/commits" },
    ]);
  });

  it("keeps the path git reported, so the badge's stripped name stays unambiguous", () => {
    // `fc/pr613` on a badge could be a branch of that name or refs/fc/pr613;
    // the tooltip tells them apart, and only the full path can.
    expect(parseRefs("refs/fc/pr613")[0].full).toBe("refs/fc/pr613");
    expect(parseRefs("refs/heads/fc/pr613")[0].full).toBe("refs/heads/fc/pr613");
  });

  it("leaves the path off pseudo-refs that have none", () => {
    // HEAD and 'replaced' are decorations, not paths under refs/.
    expect(parseRefs("HEAD")[0].full).toBeUndefined();
    expect(parseRefs("replaced")[0].full).toBeUndefined();
    // Short-form decoration carries no namespace to record.
    expect(parseRefs("tag: v1.0")[0].full).toBeUndefined();
    expect(parseRefs("main")[0].full).toBeUndefined();
  });

  it("keeps slashed local branches as branches, not remotes", () => {
    expect(parseRefs("refs/heads/chore/guard")).toEqual([
      { name: "chore/guard", type: "branch", full: "refs/heads/chore/guard" },
    ]);
  });

  it("names PR refs after their number across forges", () => {
    expect(parseRefs("refs/pull/42/head")).toEqual([
      { name: "#42", type: "pr", full: "refs/pull/42/head" },
    ]);
    expect(parseRefs("refs/merge-requests/7/head")).toEqual([
      { name: "#7", type: "pr", full: "refs/merge-requests/7/head" },
    ]);
    expect(parseRefs("refs/pull-requests/9/from")).toEqual([
      { name: "#9", type: "pr", full: "refs/pull-requests/9/from" },
    ]);
    expect(parseRefs("refs/changes/34/1234/2")).toEqual([
      { name: "#1234", type: "pr", full: "refs/changes/34/1234/2" },
    ]);
  });

  it("reads git's 'replaced' decoration as a ref, not a branch", () => {
    // git emits the bare word for a commit with a refs/replace/* ref; there is
    // no branch of that name to check out or delete.
    expect(parseRefs("replaced")).toEqual([{ name: "replaced", type: "other" }]);
  });

  it("still treats a real branch named 'replaced-thing' as a branch", () => {
    expect(parseRefs("refs/heads/replaced-thing")).toEqual([
      { name: "replaced-thing", type: "branch", full: "refs/heads/replaced-thing" },
    ]);
  });

  it("classifies bisect refs, which arrive as full paths", () => {
    expect(parseRefs("refs/bisect/bad")).toEqual([
      { name: "bisect/bad", type: "other", full: "refs/bisect/bad" },
    ]);
    expect(parseRefs("refs/bisect/good-abc123")).toEqual([
      { name: "bisect/good-abc123", type: "other", full: "refs/bisect/good-abc123" },
    ]);
  });

  it("falls back to 'other' for unknown namespaces", () => {
    expect(parseRefs("refs/bisect/bad")).toEqual([
      { name: "bisect/bad", type: "other", full: "refs/bisect/bad" },
    ]);
    expect(parseRefs("refs/replace/abc123")).toEqual([
      { name: "replace/abc123", type: "other", full: "refs/replace/abc123" },
    ]);
  });

  it("splits 'HEAD -> refs/heads/main'", () => {
    expect(parseRefs("HEAD -> refs/heads/main")).toEqual([
      { name: "HEAD", type: "head" },
      { name: "main", type: "branch", full: "refs/heads/main" },
    ]);
  });

  it("keeps only the left side of a non-HEAD symref", () => {
    expect(parseRefs("origin/HEAD -> origin/main")).toEqual([
      { name: "origin/HEAD", type: "remote" },
    ]);
  });
});

describe("refBadgeText keeps the full ref name", () => {
  it("does not shorten even a long name", () => {
    const name = "origin/dependabot/github_actions/github-actions-bc056f11d8";
    expect(refBadgeText({ name, type: "remote" })).toBe(` RB ${name} `);
  });

  it("keeps a pathologically long name intact", () => {
    const name = "origin/" + "long-".repeat(40) + "end";
    expect(refBadgeText({ name, type: "remote" })).toContain(name);
  });
});

describe("refBadgeText", () => {
  it("prefixes the type sigil in its own box", () => {
    expect(refBadgeText({ name: "main", type: "branch" })).toBe(" LB main ");
    expect(refBadgeText({ name: "v1.0", type: "tag" })).toBe(" T  v1.0 ");
    expect(refBadgeText({ name: "origin/main", type: "remote" })).toBe(" RB origin/main ");
    expect(refBadgeText({ name: "HEAD", type: "head" })).toBe(" H  HEAD ");
  });

  it("puts the name immediately after the sigil box", () => {
    const text = refBadgeText({ name: "main", type: "branch" });
    expect(text.slice(0, REF_SIGIL_WIDTH)).toBe(" LB ");
    expect(text.slice(REF_SIGIL_WIDTH)).toBe("main ");
  });

  it("measures the box against the sigil that is actually in it", () => {
    // The decoration engine slices at this offset to colour the white box; a
    // width that disagreed with the text would tint part of the name instead.
    for (const type of Object.keys(REF_SIGIL) as (keyof typeof REF_SIGIL)[]) {
      const text = refBadgeText({ name: "x", type });
      expect(text.slice(0, REF_SIGIL_WIDTH)).toBe(` ${refSigil(type)} `);
    }
  });

  it("gives every badge the same sigil box, one letter or two", () => {
    // A one-letter T beside a two-letter RB would otherwise step the names in
    // and out by a character down the column.
    const types = Object.keys(REF_SIGIL) as (keyof typeof REF_SIGIL)[];
    const boxes = types.map((type) => refBadgeText({ name: "x", type }).indexOf("x"));
    expect(new Set(boxes).size).toBe(1);
    expect(boxes[0]).toBe(REF_SIGIL_WIDTH);
  });

  it("pads a one-letter sigil rather than widening the two-letter one", () => {
    expect(refSigil("tag")).toBe("T ");
    expect(refSigil("remote")).toBe("RB");
  });

  it("keeps no sigil longer than the box that holds it", () => {
    // A three-letter sigil would silently overflow the white box, since
    // padEnd only pads and never truncates.
    for (const sigil of Object.values(REF_SIGIL)) {
      expect(sigil.length).toBeLessThanOrEqual(SIGIL_CHARS);
    }
  });
});
