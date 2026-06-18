#!/usr/bin/env node
// Print the CHANGELOG.md section body for a given version (without its heading).
// Used by the release pipeline to feed GitHub Release notes. Exits non-zero if
// the version has no section or the section is empty, so CI can fall back to
// auto-generated notes.
import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: extract-changelog.mjs <version>");
  process.exit(1);
}

let md;
try {
  md = readFileSync("CHANGELOG.md", "utf8");
} catch {
  process.exit(1);
}

const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^##\\s+\\[?v?${esc}\\]?(\\s|$)`);

const lines = md.split("\n");
const start = lines.findIndex((l) => heading.test(l));
if (start === -1) process.exit(1);

const body = [];
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s+/.test(lines[i])) break;
  body.push(lines[i]);
}

const text = body.join("\n").trim();
if (!text) process.exit(1);
process.stdout.write(text + "\n");
