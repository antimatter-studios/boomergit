import { describe, it, expect, beforeEach } from "vitest";
import { Uri, __reset } from "./mocks/vscode.js";
import { GitGraphProvider } from "../src/providers/gitGraphProvider.js";
import type { Commit } from "../src/git/types.js";

const uri = Uri.parse("boomergit:BoomerGit - Git Graph");

function commit(over: Partial<Commit> = {}): Commit {
  return {
    hash: "a".repeat(40),
    parents: [],
    author: "Ada",
    email: "ada@x.dev",
    timestamp: 1700000000, // 2023-11-14
    subject: "Initial commit",
    refs: [],
    ...over,
  };
}

describe("GitGraphProvider", () => {
  beforeEach(() => __reset());

  it("renders nothing when there are no commits", () => {
    const provider = new GitGraphProvider();
    expect(provider.provideTextDocumentContent(uri)).toBe("");
  });

  it("renders one line per commit", () => {
    const provider = new GitGraphProvider();
    provider.setCommits([
      commit({ hash: "1".repeat(40), subject: "one" }),
      commit({ hash: "2".repeat(40), subject: "two" }),
    ]);
    expect(provider.provideTextDocumentContent(uri).split("\n")).toHaveLength(2);
  });

  it("lays out hash, subject, author and ISO date", () => {
    const provider = new GitGraphProvider();
    provider.setCommits([commit({ hash: "abcdef1234567890", subject: "feat: thing" })]);
    const line = provider.provideTextDocumentContent(uri);
    expect(line).toBe("  abcdef12  feat: thing  Ada  2023-11-14");
  });

  it("shortens the hash to 8 characters", () => {
    const provider = new GitGraphProvider();
    provider.setCommits([commit({ hash: "0123456789abcdef0123456789abcdef01234567" })]);
    expect(provider.provideTextDocumentContent(uri)).toContain("01234567");
    expect(provider.provideTextDocumentContent(uri)).not.toContain("012345678");
  });

  it("inserts a sigil badge per ref, before the subject", () => {
    const provider = new GitGraphProvider();
    provider.setCommits([
      commit({
        subject: "tip",
        refs: [
          { name: "HEAD", type: "head" },
          { name: "main", type: "branch" },
          { name: "v1.0", type: "tag" },
        ],
      }),
    ]);
    const line = provider.provideTextDocumentContent(uri);
    expect(line).toContain(" H HEAD  B main  T v1.0 tip");
    // Badges precede the subject
    expect(line.indexOf(" B main ")).toBeLessThan(line.indexOf("tip"));
  });

  it("emits no badge section for a commit with no refs", () => {
    const provider = new GitGraphProvider();
    provider.setCommits([commit({ subject: "plain" })]);
    expect(provider.provideTextDocumentContent(uri)).toBe(
      "  aaaaaaaa  plain  Ada  2023-11-14"
    );
  });

  it("replaces the commit set on each setCommits call", () => {
    const provider = new GitGraphProvider();
    provider.setCommits([commit({ subject: "first" })]);
    provider.setCommits([commit({ subject: "second" })]);
    const out = provider.provideTextDocumentContent(uri);
    expect(out).toContain("second");
    expect(out).not.toContain("first");
  });

  it("fires onDidChange for the refreshed uri", () => {
    const provider = new GitGraphProvider();
    const seen: string[] = [];
    provider.onDidChange((u: Uri) => seen.push(u.toString()));
    provider.refresh(uri);
    expect(seen).toEqual([uri.toString()]);
  });

  it("stops notifying once disposed", () => {
    const provider = new GitGraphProvider();
    let calls = 0;
    provider.onDidChange(() => calls++);
    provider.dispose();
    provider.refresh(uri);
    expect(calls).toBe(0);
  });
});
