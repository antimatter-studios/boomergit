#!/usr/bin/env node
// Run by the `version` npm lifecycle hook (during `npm version`, after the
// version bump but before the commit/tag). Promotes the `## [Unreleased]`
// section to a dated, versioned section and leaves a fresh empty Unreleased
// above it, so the changelog update lands in the version commit.
import { readFileSync, writeFileSync } from "node:fs";

const path = "CHANGELOG.md";
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const date = new Date().toISOString().slice(0, 10);

let md;
try {
  md = readFileSync(path, "utf8");
} catch {
  console.error(`bump-changelog: ${path} not found; skipping.`);
  process.exit(0);
}

const unreleased = /^##\s+\[Unreleased\][^\n]*$/im;
if (!unreleased.test(md)) {
  console.error("bump-changelog: no '## [Unreleased]' section found; skipping.");
  process.exit(0);
}

md = md.replace(unreleased, `## [Unreleased]\n\n## [${version}] - ${date}`);
writeFileSync(path, md);
console.log(`bump-changelog: promoted Unreleased -> ${version} (${date}).`);
