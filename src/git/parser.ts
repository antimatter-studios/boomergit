import { execFile } from "node:child_process";
import { Commit, parseRefs } from "./types.js";

const GIT_LOG_FORMAT = "%H|%P|%an|%ae|%at|%s|%D";

export function parseGitLog(cwd: string): Promise<Commit[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["log", "--all", `--format=${GIT_LOG_FORMAT}`, "--topo-order"],
      { cwd, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(parseLogOutput(stdout));
      }
    );
  });
}

export function parseLogOutput(output: string): Commit[] {
  const commits: Commit[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    // Split on pipe, but subject may contain pipes — limit to 7 parts
    const parts = line.split("|");
    if (parts.length < 6) continue;

    const hash = parts[0];
    const parentStr = parts[1];
    const author = parts[2];
    const email = parts[3];
    const timestamp = parseInt(parts[4], 10);
    const subject = parts.slice(5, parts.length - 1).join("|");
    const refStr = parts[parts.length - 1];

    // If there are exactly 7 parts, subject is parts[5] and refs is parts[6]
    // If there are more, the subject contained pipes
    // Edge case: if there are exactly 6 parts, there are no refs
    let finalSubject: string;
    let finalRefStr: string;
    if (parts.length === 7) {
      finalSubject = parts[5];
      finalRefStr = parts[6];
    } else if (parts.length === 6) {
      // No ref names field — subject might be empty or the format had no refs
      finalSubject = parts[5];
      finalRefStr = "";
    } else {
      // parts.length > 7 — subject contained pipe chars
      finalSubject = parts.slice(5, parts.length - 1).join("|");
      finalRefStr = parts[parts.length - 1];
    }

    commits.push({
      hash,
      parents: parentStr ? parentStr.split(" ") : [],
      author,
      email,
      timestamp,
      subject: finalSubject,
      refs: parseRefs(finalRefStr),
    });
  }
  return commits;
}
