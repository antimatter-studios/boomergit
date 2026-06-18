import { describe, it, expect } from "vitest";
import { parseRefs } from "../src/git/types.js";
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
