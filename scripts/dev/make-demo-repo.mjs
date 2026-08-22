#!/usr/bin/env node
/**
 * Build a repository that exercises every BoomerGit feature, for opening in the
 * Extension Development Host.
 *
 * VS Code will not open the same folder in two windows, so boomergit itself
 * can't be the test subject while you have it open — hence a purpose-built one.
 * It defaults to the path .vscode/launch.json already opens, so F5 just works.
 *
 * Creates, alongside the repo: a bare "origin" to give real remote-tracking
 * refs, and two worktrees as siblings (matching the default `sibling`
 * placement).
 *
 * Usage:
 *   node scripts/dev/make-demo-repo.mjs [path]     # default /tmp/boomergit-test
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const target = path.resolve(process.argv[2] ?? "/tmp/boomergit-test");
const origin = `${target}-origin`;
const worktreeFeature = `${target}-feature`;
const worktreeLoose = `${target}-detached`;

/** Run git in `cwd`, returning trimmed stdout. */
function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/** Commit everything in the working tree with a fixed identity and date. */
let tick = 0;
function commit(repo, message) {
  // Fixed, increasing dates so the graph's ordering is stable between runs
  const when = `2026-01-${String(1 + (tick % 28)).padStart(2, "0")}T12:00:00`;
  tick++;
  git(repo, "add", "-A");
  execFileSync("git", ["commit", "-q", "-m", message], {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_DATE: when,
    },
  });
  return git(repo, "rev-parse", "HEAD");
}

for (const dir of [target, origin, worktreeFeature, worktreeLoose]) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── A bare origin, so remote-tracking refs are real rather than faked ──
fs.mkdirSync(origin, { recursive: true });
git(origin, "init", "-q", "--bare", "-b", "main");

// ── The repository itself ──
fs.mkdirSync(target, { recursive: true });
git(target, "init", "-q", "-b", "main");
git(target, "config", "user.name", "Demo Author");
git(target, "config", "user.email", "demo@example.com");
git(target, "remote", "add", "origin", origin);

write(path.join(target, "README.md"), "# Demo repository\n\nBuilt by make-demo-repo.mjs.\n");
commit(target, "chore: initial commit");

write(path.join(target, "src/app.js"), "export const app = () => 'v1';\n");
const tagged = commit(target, "feat: add the app entry point");

// A lightweight tag and an annotated one — both show as T
git(target, "tag", "v0.1.0", tagged);
git(target, "tag", "-a", "v0.2.0", "-m", "Release 0.2.0", tagged);

// ── A branch that forks and merges back, so lanes actually branch ──
git(target, "checkout", "-q", "-b", "feature/side-quest");
write(path.join(target, "src/side.js"), "export const side = () => 'side';\n");
commit(target, "feat: begin the side quest");
write(path.join(target, "src/side.js"), "export const side = () => 'side, improved';\n");
commit(target, "feat: finish the side quest");

git(target, "checkout", "-q", "main");
write(path.join(target, "src/app.js"), "export const app = () => 'v2';\n");
commit(target, "feat: move the app on while the side quest ran");
// --no-ff so the merge is visible as a merge, not fast-forwarded away
execFileSync("git", ["merge", "-q", "--no-ff", "feature/side-quest", "-m", "merge: land the side quest"], {
  cwd: target,
  env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-09T12:00:00", GIT_COMMITTER_DATE: "2026-01-09T12:00:00" },
});

// ── A branch with a name long enough to have split the badge before 0.4.1 ──
git(target, "branch", "chore/a-deliberately-long-branch-name-to-check-badge-rendering");

// ── An unmerged branch, so there's a lane that never rejoins ──
git(target, "checkout", "-q", "-b", "fix/never-merged", "HEAD~2");
write(path.join(target, "src/fix.js"), "export const fix = () => true;\n");
commit(target, "fix: something on a branch that never lands");
git(target, "checkout", "-q", "main");

// ── Push, so remote-tracking refs (R) and origin/HEAD exist ──
git(target, "push", "-q", "--all", "origin");
git(target, "push", "-q", "--tags", "origin");
git(target, "remote", "set-head", "origin", "main");
git(target, "fetch", "-q", "origin");

// ── A note (N badge) ──
git(target, "notes", "add", "-m", "Reviewed by the release manager.", "HEAD");

// ── A pull-request ref, as a fetched forge ref would look (P badge) ──
git(target, "update-ref", "refs/pull/42/head", git(target, "rev-parse", "fix/never-merged"));

// ── A replace ref, which lands in the catch-all (? badge) ──
git(target, "replace", "--graft", git(target, "rev-parse", "HEAD~1"), git(target, "rev-parse", "HEAD~3"));

// ── A stash, including an untracked file (S badge) ──
write(path.join(target, "src/app.js"), "export const app = () => 'uncommitted work';\n");
write(path.join(target, "scratch.txt"), "untracked\n");
git(target, "stash", "push", "-q", "--include-untracked", "-m", "work in progress");

// ── Two worktrees, so the W badge and the row marker have something to mark ──
git(target, "worktree", "add", "-q", worktreeFeature, "feature/side-quest");
git(target, "worktree", "add", "-q", "--detach", worktreeLoose, "HEAD~1");

const summary = [
  ["repository", target],
  ["origin (bare)", origin],
  ["worktree, attached", `${worktreeFeature}  [feature/side-quest]`],
  ["worktree, detached", worktreeLoose],
];

console.log("Demo repository built.\n");
for (const [label, value] of summary) {
  console.log(`  ${label.padEnd(20)} ${value}`);
}

console.log("\nWhat it exercises:");
console.log(`
  B  local branches, including one with a >50 character name
  R  remote-tracking branches, plus origin/HEAD (offers no checkout)
  T  tags, both lightweight (v0.1.0) and annotated (v0.2.0)
  H  HEAD on main
  S  a stash, which renders as two rows: the stash and its untracked-files commit
  N  a note on the tip commit
  P  a pull-request ref at refs/pull/42/head
  ?  a replace ref, in the catch-all
  W  two worktrees — one attached, one detached

  Graph shapes: a fork that merges back with --no-ff, and a branch that never
  lands, so lanes both rejoin and run off the bottom.

  Worktree row marker: set boomergit.worktrees.rowStyle to background, ring,
  both or none to compare them.
`);
console.log(`Open it with F5 — .vscode/launch.json already points at ${target}\n`);
