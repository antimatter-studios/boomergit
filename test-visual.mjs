/**
 * Visual test: runs the REAL layout algorithm against simulated commit histories.
 * Renders at 2x scale for visual clarity in the browser.
 *
 * Usage: node test-visual.mjs
 */
import * as fs from "node:fs";

// ═══════════════════════════════════════════════════════════════
// Layout algorithm (mirrors src/graph/layout.ts)
// ═══════════════════════════════════════════════════════════════

const BRANCH_COLORS = [
  "#F5A623", "#4FC3F7", "#81C784", "#E57373", "#BA68C8",
  "#FFD54F", "#4DD0E1", "#FF8A65", "#A1887F", "#90A4AE",
  "#AED581", "#7986CB",
];

function computeGraphLayout(commits) {
  const lanes = [];
  const rows = [];
  let colorIdx = 0;
  function nextColor() { return BRANCH_COLORS[colorIdx++ % BRANCH_COLORS.length]; }
  function findFree(...excludeIndices) {
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === null && !excludeIndices.includes(i)) return i;
    lanes.push(null); return lanes.length - 1;
  }
  function findLane(hash, exclude = -1) {
    for (let i = 0; i < lanes.length; i++) if (i !== exclude && lanes[i]?.hash === hash) return i;
    return -1;
  }
  function findAllLanes(hash) {
    const result = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i]?.hash === hash) result.push(i);
    return result;
  }

  for (const commit of commits) {
    // Find ALL lanes carrying this commit's hash
    const matchingLanes = findAllLanes(commit.hash);
    let commitLane, convergingLanes;
    const isNewTip = matchingLanes.length === 0;
    if (isNewTip) {
      commitLane = findFree();
      lanes[commitLane] = { hash: commit.hash, color: nextColor() };
      convergingLanes = [];
    } else {
      commitLane = matchingLanes[0];
      convergingLanes = matchingLanes.slice(1);
    }
    const commitColor = lanes[commitLane].color;
    const topLanes = lanes.map(l => l ? { ...l } : null);

    // Free converging lanes
    for (const cl of convergingLanes) lanes[cl] = null;

    const forks = [], merges = [];
    let commitLaneContinues = false;

    if (commit.parents.length === 0) {
      lanes[commitLane] = null;
    } else {
      // First parent always continues in the commit lane
      lanes[commitLane] = { hash: commit.parents[0], color: commitColor };
      commitLaneContinues = true;
      for (let pi = 1; pi < commit.parents.length; pi++) {
        const ph = commit.parents[pi], ex = findLane(ph, commitLane);
        if (ex >= 0) { merges.push({ lane: ex, color: lanes[ex].color }); }
        else { const nl = findFree(commitLane), nc = nextColor(); lanes[nl] = { hash: ph, color: nc }; forks.push({ lane: nl, color: nc }); }
      }
    }

    const botLanes = lanes.map(l => l ? { ...l } : null);
    const segments = [];
    const maxLen = Math.max(topLanes.length, botLanes.length);

    // A) Pass-through lanes
    for (let i = 0; i < maxLen; i++) {
      if (i === commitLane) continue;
      const top = topLanes[i], bot = botLanes[i];
      if (top && bot) segments.push({ topCol: i, botCol: i, color: top.color });
    }

    // B) Convergence curves from other lanes targeting this commit
    for (const cl of convergingLanes) {
      const clColor = topLanes[cl]?.color ?? commitColor;
      segments.push({ topCol: cl, botCol: commitLane, color: clColor });
    }

    // C) Commit lane
    if (commitLaneContinues) {
      segments.push(isNewTip
        ? { topCol: commitLane, botCol: commitLane, color: commitColor, half: "bottom" }
        : { topCol: commitLane, botCol: commitLane, color: commitColor });
    } else if (commit.parents.length === 0) {
      segments.push(isNewTip
        ? { topCol: commitLane, botCol: commitLane, color: commitColor }
        : { topCol: commitLane, botCol: commitLane, color: commitColor, half: "top" });
    }

    // D) Fork curves
    for (const f of forks) segments.push({ topCol: commitLane, botCol: f.lane, color: f.color, half: "bottom" });
    // E) Merge curves
    for (const m of merges) segments.push({ topCol: m.lane, botCol: commitLane, color: m.color });

    let maxCol = commitLane;
    for (const s of segments) { maxCol = Math.max(maxCol, s.topCol, s.botCol); }
    rows.push({ commitHash: commit.hash, commitCol: commitLane, commitColor, segments, numCols: maxCol + 1 });
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════
// SVG renderer (scaled up for visual clarity in test)
// ═══════════════════════════════════════════════════════════════

// Test uses 2.5x scale for visibility
const SCALE = 2.5;
const COL_WIDTH = 20 * SCALE;   // 50px
const ROW_HEIGHT = 24 * SCALE;  // 60px
const DOT_RADIUS = 5 * SCALE;   // 12.5px
const LINE_WIDTH = 2.5 * SCALE; // 6.25px
const SHADOW_WIDTH = 5 * SCALE; // 12.5px
const SHADOW_OPACITY = 0.6;
const BG_COLOR = "#2d2d2d";

function colX(col) { return col * COL_WIDTH + COL_WIDTH / 2; }

function segmentPath(x0, y0, x1, y1, cpFactor = 0.5) {
  if (x0 === x1) return `M${x0},${y0} L${x1},${y1}`;
  const cpY = y0 + (y1 - y0) * cpFactor;
  return `M${x0},${y0} C${x0},${cpY} ${x1},${cpY} ${x1},${y1}`;
}

function renderSvg(row, globalMaxCols) {
  const cols = globalMaxCols ?? Math.max(row.numCols, 2);
  const width = cols * COL_WIDTH + COL_WIDTH;
  const midY = ROW_HEIGHT / 2;
  const shadows = [], lines = [];

  for (const seg of row.segments) {
    const xTop = colX(seg.topCol), xBot = colX(seg.botCol);
    let y0, y1;
    if (seg.half === "top") { y0 = 0; y1 = midY; }
    else if (seg.half === "bottom") { y0 = midY; y1 = ROW_HEIGHT; }
    else { y0 = 0; y1 = ROW_HEIGHT; }

    const isFullHeightCurve = !seg.half && xTop !== xBot;
    const d = segmentPath(xTop, y0, xBot, y1, isFullHeightCurve ? 0.35 : 0.5);
    shadows.push(`<path d="${d}" fill="none" stroke="${BG_COLOR}" stroke-width="${SHADOW_WIDTH}" stroke-opacity="${SHADOW_OPACITY}" stroke-linecap="round"/>`);
    lines.push(`<path d="${d}" fill="none" stroke="${seg.color}" stroke-width="${LINE_WIDTH}" stroke-linecap="round"/>`);
  }

  const cx = colX(row.commitCol);
  const dot = `<circle cx="${cx}" cy="${midY}" r="${DOT_RADIUS}" fill="${row.commitColor}" stroke="${BG_COLOR}" stroke-width="${2 * SCALE}" stroke-opacity="0.8"/>`;

  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${ROW_HEIGHT}" viewBox="0 0 ${width} ${ROW_HEIGHT}">`,
    ...shadows, ...lines, dot, `</svg>`].join("\n");
}

// ═══════════════════════════════════════════════════════════════
// Simulated commit histories
// ═══════════════════════════════════════════════════════════════

function C(hash, parents, subject = "") {
  return { hash, parents, author: "dev", email: "", timestamp: 0, subject: subject || hash, refs: [] };
}

const scenario1 = [
  C("a1", ["a2"], "latest on main"),
  C("a2", ["a5", "a3"], "Merge feat into main"),
  C("a3", ["a4"], "feat: second commit"),
  C("a4", ["a5"], "feat: first commit"),
  C("a5", ["a6"], "main before branch"),
  C("a6", [], "initial commit"),
];

const scenario2 = [
  C("b01", ["b02"], "main: latest"),
  C("b02", ["b05", "b03"], "Merge feat-b"),
  C("b03", ["b04"], "feat-b: work"),
  C("b04", ["b07"], "feat-b: start"),
  C("b05", ["b07", "b06"], "Merge feat-a"),
  C("b06", ["b07"], "feat-a: work"),
  C("b07", ["b08"], "main: before branches"),
  C("b08", [], "initial"),
];

const scenario3 = [
  C("c01", ["c02"], "main: tip"),
  C("c02", ["c03", "c10"], "Merge release"),
  C("c03", ["c04", "c09"], "Merge hotfix"),
  C("c04", ["c05", "c08"], "Merge feat-api"),
  C("c05", ["c06", "c07"], "Merge feat-ui"),
  C("c06", ["c13", "c12"], "Merge feat-auth"),
  C("c07", ["c11"], "feat-ui: commit 2"),
  C("c08", ["c11"], "feat-api: commit 2"),
  C("c09", ["c13"], "hotfix: urgent fix"),
  C("c10", ["c14"], "release: prep"),
  C("c11", ["c13"], "shared parent commit"),
  C("c12", ["c13"], "feat-auth: commit 1"),
  C("c13", ["c14"], "main: old commit"),
  C("c14", [], "initial"),
];

const scenario4 = [
  C("d1", ["d2"], "main: after octopus"),
  C("d2", ["d6", "d3", "d4", "d5"], "Octopus merge"),
  C("d3", ["d6"], "feat-a: work"),
  C("d4", ["d6"], "feat-b: work"),
  C("d5", ["d6"], "feat-c: work"),
  C("d6", ["d7"], "main: before octopus"),
  C("d7", [], "initial"),
];

const scenario5 = [
  C("e01", ["e02"], "main: tip"),
  C("e02", ["e03", "e04"], "Merge feat-b into main"),
  C("e04", ["e05", "e06"], "feat-b: merge feat-a"),
  C("e05", ["e08"], "feat-b: own work"),
  C("e06", ["e07"], "feat-a: latest"),
  C("e03", ["e08"], "main: work"),
  C("e07", ["e08"], "feat-a: initial"),
  C("e08", [], "initial"),
];

const scenario6 = [
  C("f01", ["f02"], "main: tip"),
  C("f02", ["f03", "f16"], "Merge infra"),
  C("f03", ["f04", "f15"], "Merge docs"),
  C("f04", ["f05", "f14"], "Merge perf"),
  C("f05", ["f06", "f13"], "Merge api"),
  C("f06", ["f07", "f12"], "Merge ui"),
  C("f07", ["f08", "f11"], "Merge auth"),
  C("f08", ["f09"], "main: work 2"),
  C("f09", ["f10"], "main: work 1"),
  C("f10", ["f17"], "main: old"),
  C("f11", ["f17"], "auth: work"),
  C("f12", ["f17"], "ui: work"),
  C("f13", ["f17"], "api: work"),
  C("f14", ["f17"], "perf: work"),
  C("f15", ["f17"], "docs: work"),
  C("f16", ["f17"], "infra: work"),
  C("f17", [], "initial"),
];

const scenario7 = [
  C("g01", ["g02"], "main: latest"),
  C("g02", ["g03", "g04"], "Merge develop"),
  C("g04", ["g05", "g06"], "develop: merge main"),
  C("g06", ["g07"], "main: hotfix"),
  C("g05", ["g08"], "develop: feature 3"),
  C("g03", ["g07"], "main: after first merge"),
  C("g07", ["g08", "g09"], "Merge develop (first)"),
  C("g09", ["g10"], "develop: feature 2"),
  C("g08", ["g10"], "main: early work"),
  C("g10", ["g11"], "develop: feature 1"),
  C("g11", [], "initial"),
];

const scenario8 = [
  C("h01", ["h02"], "main: tip"),
  C("h02", ["h06", "h03"], "Merge feat-a"),
  C("h03", ["h04", "h05"], "feat-a: merge sub-feat"),
  C("h05", ["h07"], "sub-feat: merge sub-sub"),
  C("h04", ["h06"], "feat-a: own work"),
  C("h07", ["h08", "h09"], "sub-feat: work (merge)"),
  C("h09", ["h10"], "sub-sub-feat: work"),
  C("h08", ["h10"], "sub-feat: base"),
  C("h06", ["h10"], "main: before branch"),
  C("h10", [], "initial"),
];

// ═══════════════════════════════════════════════════════════════
// Build HTML
// ═══════════════════════════════════════════════════════════════

function renderScenario(title, description, commits) {
  const rows = computeGraphLayout(commits);
  const globalMaxCols = Math.max(...rows.map(r => r.numCols), 2);

  const svgs = rows.map((row, i) => {
    const svg = renderSvg(row, globalMaxCols);
    const label = commits[i].subject;
    const segs = row.segments.map(s => {
      const h = s.half === "top" ? "↑" : s.half === "bottom" ? "↓" : "│";
      return s.topCol === s.botCol ? `${h}${s.topCol}` : `${s.topCol}${h === "↑" ? "⤴" : h === "↓" ? "⤵" : "→"}${s.botCol}`;
    }).join(" ");
    return `<div style="display:flex;align-items:center;height:${ROW_HEIGHT}px;margin:0;padding:0;">
    ${svg}
    <span style="color:#bbb;font-size:13px;margin-left:16px;white-space:nowrap"><b style="color:${row.commitColor}">${commits[i].hash.slice(0,4)}</b> ${label}</span>
    <span style="color:#555;font-size:10px;margin-left:16px;white-space:nowrap">${segs}</span>
  </div>`;
  }).join("\n");

  return `
  <div style="margin-bottom:60px;">
    <h3 style="color:#eee;margin-bottom:4px;font-size:16px;">${title}</h3>
    <p style="color:#888;margin-top:0;font-size:13px;">${description}</p>
    <div style="display:flex;flex-direction:column;gap:0;border:1px solid #444;border-radius:8px;padding:12px 16px;width:fit-content;background:#2d2d2d;">
    ${svgs}
    </div>
  </div>`;
}

const html = `<!DOCTYPE html>
<html>
<head>
  <title>BoomerGit SVG Tile Test</title>
  <style>
    body { background:#1a1a1a; color:white; font-family:'SF Mono','Fira Code','Cascadia Code',monospace; padding:40px; max-width:1400px; }
    h2 { color:#F5A623; border-bottom:2px solid #444; padding-bottom:12px; font-size:22px; }
  </style>
</head>
<body>
<h2>BoomerGit — Graph Layout Visual Test</h2>
<p style="color:#888;font-size:13px;">Real layout algorithm output at 2.5x scale. Fork/merge curves connect directly to commit dots.</p>

${renderScenario("1. Simple Feature Branch", "Branch off main → 2 commits → merge back. Curves should connect directly to the orange merge dots.", scenario1)}
${renderScenario("2. Two Feature Branches", "feat-a and feat-b fork from different points, merge back sequentially.", scenario2)}
${renderScenario("3. Six Branches — Staggered", "auth, ui, api, hotfix, release. Tests column reuse and wide merges.", scenario3)}
${renderScenario("4. Octopus Merge (4 Parents)", "Three branches merged in one commit. Three fork curves from one dot.", scenario4)}
${renderScenario("5. Cross-Merge", "feat-b merges feat-a into itself, then merges into main.", scenario5)}
${renderScenario("6. Dense Monorepo — 6 Sequential Forks", "Six branches all fork from main, merge back one by one. Peak 7 columns.", scenario6)}
${renderScenario("7. Bidirectional Merges", "main and develop merge into each other repeatedly.", scenario7)}
${renderScenario("8. Nested Branches (3 Deep)", "Branch off a branch off a branch.", scenario8)}

</body>
</html>`;

fs.writeFileSync("test-output.html", html);
console.log("Written test-output.html — 8 scenarios at 2.5x scale with half-height curves");
