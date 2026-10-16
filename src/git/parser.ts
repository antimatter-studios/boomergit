import { Commit, parseRefs } from "./types.js";
import { gitRun } from "./exec.js";

const GIT_LOG_FORMAT = "%H|%P|%an|%ae|%at|%s|%D";

/** Fields in GIT_LOG_FORMAT: hash, parents, author, email, time, subject, refs. */
const FIELD_COUNT = 7;

/** Index of the subject — the only field whose content can contain the separator. */
const SUBJECT_INDEX = 5;

export async function parseGitLog(cwd: string): Promise<Commit[]> {
  const stdout = await gitRun(
    [
      "log",
      "--all",
      // Full ref paths so refs/heads/foo/bar isn't mistaken for a remote,
      // and decorate every namespace (git only decorates heads/remotes/
      // tags/stash/HEAD by default, hiding notes and PR refs entirely).
      "--decorate=full",
      "--decorate-refs=refs/*",
      "--decorate-refs=HEAD",
      `--format=${GIT_LOG_FORMAT}`,
      "--topo-order",
    ],
    cwd
  );
  return parseLogOutput(stdout);
}

/** Remove commits carrying at least one ref matched by an ignore expression. */
export function filterIgnoredRefCommits(commits: Commit[], patterns: string[]): Commit[] {
  const expressions = patterns.flatMap((pattern) => {
    try {
      return [new RegExp(pattern)];
    } catch {
      return [];
    }
  });
  if (expressions.length === 0) return commits;
  const visible = commits.filter((commit) =>
    !commit.refs.some((ref) => {
      const candidates = [ref.full, ref.name, ref.type].filter((value): value is string => !!value);
      return expressions.some((expression) => candidates.some((value) => {
        expression.lastIndex = 0;
        return expression.test(value);
      }));
    })
  );
  const visibleHashes = new Set(visible.map((commit) => commit.hash));
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));

  // Replace paths through hidden commits with their nearest visible ancestors.
  // The graph layout can then draw uninterrupted lanes across omitted rows.
  function visibleParents(hash: string, seen = new Set<string>()): string[] {
    if (visibleHashes.has(hash)) return [hash];
    if (seen.has(hash)) return [];
    seen.add(hash);
    const hidden = byHash.get(hash);
    if (!hidden) return [];
    const result: string[] = [];
    for (const parent of hidden.parents) {
      for (const ancestor of visibleParents(parent, new Set(seen))) {
        if (!result.includes(ancestor)) result.push(ancestor);
      }
    }
    return result;
  }
  return visible.map((commit) => ({
    ...commit,
    parents: commit.parents.flatMap((parent) => visibleParents(parent)),
  }));
}

export function parseLogOutput(output: string): Commit[] {
  const commits: Commit[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < FIELD_COUNT - 1) continue;

    // A commit subject may contain the separator, so it absorbs any extra
    // parts; the refs field is always last. `%D` emits that field even when a
    // commit carries no refs, so a short line means malformed input.
    const hasRefField = parts.length >= FIELD_COUNT;
    const subject = hasRefField
      ? parts.slice(SUBJECT_INDEX, -1).join("|")
      : parts[SUBJECT_INDEX];
    const refStr = hasRefField ? parts[parts.length - 1] : "";

    const parentStr = parts[1];

    commits.push({
      hash: parts[0],
      parents: parentStr ? parentStr.split(" ") : [],
      author: parts[2],
      email: parts[3],
      timestamp: parseInt(parts[4], 10),
      subject,
      refs: parseRefs(refStr),
    });
  }
  return commits;
}
