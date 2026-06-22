#!/usr/bin/env node
// Open a release PR. `main` is protected (PR-only), so version bumps can't be
// pushed directly — they go through a PR. Merging that PR lands the bump on
// main, where the pipeline's release-on-merge job publishes and creates the
// GitHub Release + tag.
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

// Bump version in package.json + lock (no commit, no tag), then promote the
// CHANGELOG Unreleased section to the new version.
sh(`npm version ${bump} --no-git-tag-version`);
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = `v${version}`;
sh("node scripts/bump-changelog.mjs");

// Commit on a release branch and open the PR.
const relBranch = `release/${tag}`;
sh(`git checkout -b ${relBranch}`);
sh("git add -A");
execFileSync("git", ["commit", "-m", `release: ${tag}`], { stdio: "inherit" });
sh(`git push -u origin ${relBranch}`);
execFileSync(
  "gh",
  ["pr", "create", "--base", "main", "--title", `release: ${tag}`, "--body",
    `Release ${tag}.\n\nMerging this lands the version bump on \`main\`; the pipeline's release-on-merge job then publishes to the VS Code Marketplace + Open VSX and creates the GitHub Release ${tag} with the VSIX attached.`],
  { stdio: "inherit" }
);

console.log(`\n✓ Release PR opened for ${tag}. Merge it (squash) — CI publishes + tags automatically.`);
