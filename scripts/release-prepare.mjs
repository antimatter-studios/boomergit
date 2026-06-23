#!/usr/bin/env node
// Open a release PR. `main` is protected (PR-only), so version bumps can't be
// pushed directly — they go through a PR. Merging that PR lands the bump on
// main, where the pipeline's release-on-merge job publishes and creates the
// GitHub Release + tag.
//
// All mutations happen on the release branch, so a mid-script failure never
// leaves `main` with a half-applied bump.
//
// Usage: node scripts/release-prepare.mjs <patch|minor|major>
import { execSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
  console.error("usage: release-prepare.mjs <patch|minor|major>");
  process.exit(1);
}

const sh = (cmd) => execSync(cmd, { stdio: "inherit" });
const cap = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

// Preconditions: clean tree on an up-to-date main.
const branch = cap("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
  console.error(`release: run from main (currently on ${branch}).`);
  process.exit(1);
}
if (cap("git status --porcelain")) {
  console.error("release: working tree is not clean.");
  process.exit(1);
}
sh("git pull --ff-only");

// Compute the next version up front so the branch name is known before any file
// is mutated, and bail early if that release branch already exists (nothing
// touched yet).
const current = JSON.parse(readFileSync("package.json", "utf8")).version;
const m = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!m) {
  console.error(`release: unexpected version "${current}" (expected X.Y.Z).`);
  process.exit(1);
}
const [maj, min, pat] = m.slice(1).map(Number);
const version =
  bump === "major" ? `${maj + 1}.0.0` : bump === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
const tag = `v${version}`;
const relBranch = `release/${tag}`;

if (cap(`git branch --list ${relBranch}`) || cap(`git ls-remote --heads origin ${relBranch}`)) {
  console.error(`release: branch ${relBranch} already exists — delete it or finish that release first.`);
  process.exit(1);
}

// Everything below runs on the release branch; revert to a clean main on failure.
sh(`git checkout -b ${relBranch}`);
try {
  sh(`npm version ${version} --no-git-tag-version`);
  sh("node scripts/bump-changelog.mjs");
  sh("git add -A");
  execFileSync("git", ["commit", "-m", `release: ${tag}`], { stdio: "inherit" });
  sh(`git push -u origin ${relBranch}`);
  execFileSync(
    "gh",
    ["pr", "create", "--base", "main", "--title", `release: ${tag}`, "--body",
      `Release ${tag}.\n\nMerging this lands the version bump on \`main\`; the pipeline's release-on-merge job then publishes to the VS Code Marketplace + Open VSX and creates the GitHub Release ${tag} with the VSIX attached.`],
    { stdio: "inherit" }
  );
} catch (err) {
  console.error("\nrelease: failed — reverting to a clean main (no changes left behind).");
  try {
    sh("git checkout -f main");
    sh(`git branch -D ${relBranch}`);
  } catch {
    /* best effort */
  }
  throw err;
}

console.log(`\n✓ Release PR opened for ${tag}. Merge it (squash) — CI publishes + tags automatically.`);
