#!/usr/bin/env node
/**
 * Eyeball the graph renderer.
 *
 * Writes build/visual-check.html with each scenario's rows drawn by the SVG
 * generator, magnified, so lane routing and curve/dot alignment can be checked
 * by looking rather than by assertion.
 *
 * Unlike the scratch harnesses this replaces, it imports the real modules —
 * those held pasted copies of the layout algorithm that had drifted out of
 * step with src/, so what they drew was not what the extension drew.
 *
 * Usage:
 *   node scripts/dev/visual-check.mjs              # synthetic scenarios
 *   node scripts/dev/visual-check.mjs <repo> [max] # a real repository
 */
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT_HTML = path.join(ROOT, "build", "visual-check.html");
const SCALE = 2.5;

/**
 * Bundle the TypeScript sources so this plain-JS script can call them. Keeps
 * the harness honest: it renders with the same code the extension ships.
 */
async function loadGraphModules() {
  const stem = path.join(os.tmpdir(), `boomergit-visual-${process.pid}`);
  const entry = `${stem}.ts`;
  const bundle = `${stem}.mjs`;
  fs.writeFileSync(
    entry,
    [
      `export { computeGraphLayout } from "${ROOT}/src/graph/layout.js";`,
      `export { renderSvg, ROW_HEIGHT } from "${ROOT}/src/graph/svgTileGen.js";`,
      `export { parseGitLog } from "${ROOT}/src/git/parser.js";`,
      `export { refBadgeText } from "${ROOT}/src/git/types.js";`,
    ].join("\n")
  );
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundle,
    logLevel: "error",
  });
  const mod = await import(pathToFileURL(bundle).href);
  fs.rmSync(entry, { force: true });
  fs.rmSync(bundle, { force: true });
  return mod;
}

/** Shorthand: "hash parent1 parent2" lines into commit objects. */
function graph(subject, spec) {
  return {
    name: subject,
    commits: spec.map(([hash, ...parents]) => ({
      hash: String(hash).repeat(8).slice(0, 40),
      parents: parents.map((p) => String(p).repeat(8).slice(0, 40)),
      author: "Ada",
      email: "ada@x.dev",
      timestamp: 1700000000,
      subject: `commit ${hash}`,
      refs: [],
    })),
  };
}

const SCENARIOS = [
  graph("linear history", [["a", "b"], ["b", "c"], ["c"]]),
  graph("one branch merged back", [
    ["a", "b", "d"],
    ["b", "c"],
    ["d", "c"],
    ["c"],
  ]),
  graph("two independent tips", [["a", "c"], ["b", "c"], ["c"]]),
  graph("octopus merge", [["a", "b", "c", "d"], ["b", "e"], ["c", "e"], ["d", "e"], ["e"]]),
  graph("branch that never merges", [["a", "b"], ["b", "d"], ["c", "d"], ["d"]]),
  graph("criss-cross merges", [
    ["a", "b", "c"],
    ["b", "d", "e"],
    ["c", "d", "e"],
    ["d", "f"],
    ["e", "f"],
    ["f"],
  ]),
  graph("root commit only", [["a"]]),
];

function renderScenario({ name, commits }, mod) {
  const rows = mod.computeGraphLayout(commits);
  const maxCols = Math.max(...rows.map((r) => r.numCols), 1);
  const height = mod.ROW_HEIGHT;

  const lines = rows
    .map((row, i) => {
      const svg = mod.renderSvg(row, height, maxCols);
      const encoded = Buffer.from(svg, "utf8").toString("base64");
      const commit = commits[i];
      return `      <div class="row">
        <img src="data:image/svg+xml;base64,${encoded}" alt="">
        <span class="hash">${commit.hash.slice(0, 8)}</span>
        <span class="lane">lane ${row.commitCol}</span>
        <span class="subject">${commit.subject}</span>
      </div>`;
    })
    .join("\n");

  return `    <section>
      <h2>${name}</h2>
${lines}
    </section>`;
}

function html(sections) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>BoomerGit visual check</title>
<style>
  body { background: #1e1e1e; color: #ddd; font-family: ui-monospace, Menlo, monospace; padding: 24px; }
  h1 { font-size: 18px; font-weight: 600; }
  h2 { font-size: 13px; color: #9cdcfe; margin: 28px 0 8px; font-weight: 600; }
  .row { display: flex; align-items: stretch; gap: 10px; height: ${Math.round(21 * SCALE)}px; }
  .row img { height: 100%; image-rendering: auto; }
  .hash { color: #F5A623; align-self: center; }
  .lane { color: #616161; align-self: center; width: 60px; }
  .subject { color: #ccc; align-self: center; }
  p.note { color: #888; font-size: 12px; max-width: 60ch; }
</style></head>
<body>
  <h1>BoomerGit visual check</h1>
  <p class="note">Rendered by the real <code>computeGraphLayout</code> and
  <code>renderSvg</code>, magnified ${SCALE}&times;. Check that curves land on
  their dots, lanes don't collide, and nothing is clipped at a row boundary.</p>
${sections.join("\n")}
</body></html>`;
}

/** Print lane assignments for a real repository — the old debug harness's job. */
function printLaneTable(commits, rows) {
  console.log(`\n${"hash".padEnd(10)}${"lane".padEnd(6)}${"cols".padEnd(6)}subject`);
  console.log("-".repeat(72));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    console.log(
      commits[i].hash.slice(0, 8).padEnd(10) +
        String(row.commitCol).padEnd(6) +
        String(row.numCols).padEnd(6) +
        commits[i].subject.slice(0, 48)
    );
  }
}

const mod = await loadGraphModules();
const repoPath = process.argv[2];
let sections;

if (repoPath) {
  const max = Number(process.argv[3] ?? 40);
  const commits = (await mod.parseGitLog(path.resolve(repoPath))).slice(0, max);
  if (commits.length === 0) {
    console.error(`No commits found in ${repoPath}`);
    process.exit(1);
  }
  const rows = mod.computeGraphLayout(commits);
  printLaneTable(commits, rows);
  sections = [renderScenario({ name: `${repoPath} (${commits.length} commits)`, commits }, mod)];
} else {
  sections = SCENARIOS.map((s) => renderScenario(s, mod));
}

fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
fs.writeFileSync(OUT_HTML, html(sections));
console.log(`\nWrote ${path.relative(ROOT, OUT_HTML)} — open it to inspect.`);
