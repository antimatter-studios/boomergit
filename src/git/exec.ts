import { execFile } from "node:child_process";

/**
 * Ceiling on a single git invocation's output. `git log --all` on a large repo
 * is the worst case; every other command is far smaller. One value for all of
 * them so no call site silently truncates at a lower limit than its neighbours.
 */
export const GIT_MAX_BUFFER = 50 * 1024 * 1024;

/**
 * Run git and resolve its stdout as a Buffer.
 *
 * Buffer rather than a decoded string because file content out of `git show`
 * isn't necessarily UTF-8 text — the caller decides how to interpret it.
 */
function run(args: string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: GIT_MAX_BUFFER, encoding: "buffer" },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr?.toString("utf8").trim();
          return reject(new Error(detail || err.message));
        }
        resolve(stdout as unknown as Buffer);
      }
    );
  });
}

/**
 * Run git, rejecting with git's own stderr if it fails.
 *
 * For commands that change the repository — the user asked for a checkout or a
 * branch delete, so a failure is something they need to be told about.
 */
export async function gitRun(args: string[], cwd: string): Promise<string> {
  const stdout = await run(args, cwd);
  return stdout.toString("utf8");
}

/**
 * Run git, resolving "" if it fails.
 *
 * For read-only queries where failure is an ordinary outcome rather than an
 * error worth surfacing: a repo with no commits yet has no HEAD to rev-parse,
 * and a file that doesn't exist in a given commit has no content to show.
 */
export async function gitQuery(args: string[], cwd: string): Promise<string> {
  try {
    return (await run(args, cwd)).toString("utf8");
  } catch {
    return "";
  }
}

/** As `gitQuery`, but resolving the trimmed output. */
export async function gitQueryTrimmed(args: string[], cwd: string): Promise<string> {
  return (await gitQuery(args, cwd)).trim();
}
