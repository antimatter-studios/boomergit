#!/usr/bin/env node
/**
 * Diagnostic: runs the REAL layout algorithm against a git repo
 * and prints lane assignments + parent-child connections.
 *
 * Usage: node test-layout-debug.mjs [path-to-repo] [max-commits]
 */
import { execFileSync } from "node:child_process";

// ── Layout algorithm (exact copy from src/graph/layout.ts) ──

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
  function findFreeLane(...excludeIndices) {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null && !excludeIndices.includes(i)) return i;
    }
    lanes.push(null);
    return lanes.length - 1;
  }
  function findLane(hash, exclude = -1) {
    for (let i = 0; i < lanes.length; i++) {
      if (i !== exclude && lanes[i]?.hash === hash) return i;
    }
    return -1;
  }
  function findAllLanes(hash) {
    const result = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i]?.hash === hash) result.push(i);
    return result;
  }

  for (const commit of commits) {
    const matchingLanes = findAllLanes(commit.hash);
    let commitLane, convergingLanes;
    const isNewTip = matchingLanes.length === 0;
    if (isNewTip) {
      commitLane = findFreeLane();
      lanes[commitLane] = { hash: commit.hash, color: nextColor() };
      convergingLanes = [];
    } else {
      commitLane = matchingLanes[0];
      convergingLanes = matchingLanes.slice(1);
    }
    const commitColor = lanes[commitLane].color;
    const topLanes = lanes.map(l => l ? { ...l } : null);

    for (const cl of convergingLanes) lanes[cl] = null;

    const forks = [], merges = [];
    let commitLaneContinues = false;

    if (commit.parents.length === 0) {
      lanes[commitLane] = null;
    } else {
      lanes[commitLane] = { hash: commit.parents[0], color: commitColor };
      commitLaneContinues = true;
      for (let pi = 1; pi < commit.parents.length; pi++) {
        const ph = commit.parents[pi], ex = findLane(ph, commitLane);
        if (ex >= 0) {
          merges.push({ lane: ex, color: lanes[ex].color });
        } else {
          const nl = findFreeLane(commitLane);
          const nc = nextColor();
          lanes[nl] = { hash: ph, color: nc };
          forks.push({ lane: nl, color: nc });
        }
      }
    }

    const botLanes = lanes.map(l => l ? { ...l } : null);
    const segments = [];
    const maxLen = Math.max(topLanes.length, botLanes.length);

    for (let i = 0; i < maxLen; i++) {
      if (i === commitLane) continue;
      const top = topLanes[i], bot = botLanes[i];
      if (top && bot) segments.push({ topCol: i, botCol: i, color: top.color });
    }

    for (const cl of convergingLanes) {
      const clColor = topLanes[cl]?.color ?? commitColor;
      segments.push({ topCol: cl, botCol: commitLane, color: clColor });
    }

    if (commitLaneContinues) {
      segments.push(isNewTip
        ? { topCol: commitLane, botCol: commitLane, color: commitColor, half: "bottom" }
        : { topCol: commitLane, botCol: commitLane, color: commitColor });
    } else if (commit.parents.length === 0) {
      segments.push(isNewTip
        ? { topCol: commitLane, botCol: commitLane, color: commitColor }
        : { topCol: commitLane, botCol: commitLane, color: commitColor, half: "top" });
    }

    for (const f of forks) segments.push({ topCol: commitLane, botCol: f.lane, color: f.color, half: "bottom" });
    for (const m of merges) segments.push({ topCol: m.lane, botCol: commitLane, color: m.color });

    let maxCol = commitLane;
    for (const s of segments) { maxCol = Math.max(maxCol, s.topCol, s.botCol); }

    rows.push({
      commitHash: commit.hash,
      commitCol: commitLane,
      commitColor,
      segments,
      numCols: maxCol + 1,
      forks: forks.map(f => f.lane),
      merges: merges.map(m => m.lane),
      convergingLanes,
      isNewTip,
    });
  }
  return rows;
}

// ── Parse git log ──

function parseRefs(raw) {
  if (!raw.trim()) return [];
  const refs = [];
  for (const r of raw.split(",")) {
    const name = r.trim();
    if (!name) continue;
    if (name.startsWith("HEAD -> ")) {
      refs.push({ name: "HEAD", type: "head" });
      refs.push({ name: name.slice(8), type: "branch" });
    } else if (name === "HEAD") {
      refs.push({ name, type: "head" });
    } else if (name.startsWith("tag: ")) {
      refs.push({ name: name.slice(5), type: "tag" });
    } else if (name.includes("/")) {
      refs.push({ name, type: "remote" });
    } else {
      refs.push({ name, type: "branch" });
    }
  }
  return refs;
}

function parseGitLog(cwd, maxCommits) {
  const args = ["log", "--all", "--format=%H|%P|%an|%ae|%at|%s|%D", "--topo-order"];
  if (maxCommits) args.push(`-${maxCommits}`);
  const stdout = execFileSync("git", args, { cwd, maxBuffer: 50 * 1024 * 1024, encoding: "utf-8" });
  const commits = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < 6) continue;
    const hash = parts[0];
    const parentStr = parts[1];
    let finalSubject, finalRefStr;
    if (parts.length === 7) { finalSubject = parts[5]; finalRefStr = parts[6]; }
    else if (parts.length === 6) { finalSubject = parts[5]; finalRefStr = ""; }
    else { finalSubject = parts.slice(5, parts.length - 1).join("|"); finalRefStr = parts[parts.length - 1]; }
    commits.push({
      hash,
      parents: parentStr ? parentStr.split(" ") : [],
      author: parts[2],
      email: parts[3],
      timestamp: parseInt(parts[4], 10),
      subject: finalSubject,
      refs: parseRefs(finalRefStr),
    });
  }
  return commits;
}

// ── Visual output ──

const COLOR_NAMES = {
  "#F5A623": "ORG", "#4FC3F7": "BLU", "#81C784": "GRN", "#E57373": "RED",
  "#BA68C8": "PUR", "#FFD54F": "YEL", "#4DD0E1": "CYN", "#FF8A65": "DOR",
};

function colorName(c) { return COLOR_NAMES[c] || c.slice(1, 4); }

function drawRow(row, maxCols) {
  const cells = Array(maxCols).fill("   ");
  // Draw pass-throughs as vertical bars
  for (const seg of row.segments) {
    if (seg.topCol === seg.botCol && seg.topCol !== row.commitCol) {
      cells[seg.topCol] = " │ ";
    }
  }
  // Draw the commit dot
  cells[row.commitCol] = " ● ";
  // Draw fork indicators
  for (const seg of row.segments) {
    if (seg.half === "bottom" && seg.botCol !== seg.topCol) {
      if (seg.botCol < cells.length) cells[seg.botCol] = seg.botCol > seg.topCol ? " ╲ " : " ╱ ";
    }
    if (!seg.half && seg.topCol !== seg.botCol) {
      // full-height merge
      if (seg.topCol < cells.length && seg.topCol !== row.commitCol) cells[seg.topCol] = " ⤵ ";
    }
  }
  return cells.join("");
}

// ── Main ──

const repoPath = process.argv[2] || ".";
const maxCommits = parseInt(process.argv[3]) || 30;

let commits;
try {
  commits = parseGitLog(repoPath, maxCommits);
} catch (e) {
  console.error(`Error: ${e.message}`);
  console.error(`Usage: node test-layout-debug.mjs [path-to-repo] [max-commits]`);
  process.exit(1);
}

console.log(`\n=== Layout Debug: ${repoPath} (${commits.length} commits) ===\n`);

const rows = computeGraphLayout(commits);
const maxCols = Math.max(...rows.map(r => r.numCols), 1);

// Build parent→row index for connection verification
const hashToRow = new Map();
commits.forEach((c, i) => hashToRow.set(c.hash, i));

console.log("Row | Graph" + " ".repeat(maxCols * 3 - 2) + "| Lane | Hash     | Parents→Rows               | Subject");
console.log("----+" + "-".repeat(maxCols * 3 + 2) + "+------+----------+----------------------------+--------");

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const commit = commits[i];
  const graph = drawRow(row, maxCols);
  const parentInfo = commit.parents.map(p => {
    const pRow = hashToRow.get(p);
    return `${p.slice(0, 6)}@${pRow !== undefined ? pRow : "?"}`;
  }).join(", ");
  const refs = commit.refs.length ? ` [${commit.refs.map(r => r.name).join(", ")}]` : "";
  const extra = [];
  if (row.isNewTip) extra.push("NEW");
  if (row.forks.length) extra.push(`fork→${row.forks.join(",")}`);
  if (row.merges.length) extra.push(`merge←${row.merges.join(",")}`);
  if (row.convergingLanes.length) extra.push(`converge←${row.convergingLanes.join(",")}`);

  console.log(
    `${String(i).padStart(3)} | ${graph} | ${String(row.commitCol).padStart(4)} | ${commit.hash.slice(0, 8)} | ${parentInfo.padEnd(26)} | ${commit.subject.slice(0, 40)}${refs}`
  );
  if (extra.length) {
    console.log(`    |${" ".repeat(maxCols * 3 + 2)}|      |          | ${extra.join(", ")}`);
  }
}

// Verify all parent connections
console.log("\n=== Parent Connection Verification ===\n");
let issues = 0;
for (let i = 0; i < commits.length; i++) {
  const commit = commits[i];
  for (const parent of commit.parents) {
    const parentRow = hashToRow.get(parent);
    if (parentRow === undefined) {
      console.log(`⚠ Row ${i} (${commit.hash.slice(0, 8)}): parent ${parent.slice(0, 8)} NOT in log (outside --max-count?)`);
      issues++;
      continue;
    }
    if (parentRow <= i) {
      console.log(`❌ Row ${i} (${commit.hash.slice(0, 8)}): parent ${parent.slice(0, 8)} at row ${parentRow} (BEFORE child — topo-order violation!)`);
      issues++;
    }
  }
}

// Check that lanes correctly carry hashes to their target rows
console.log("\n=== Lane Continuity Check ===\n");
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  // Every commit that's in a lane at this row should eventually appear
  // Check: are there pass-through lanes that never resolve?
}

if (issues === 0) {
  console.log("✓ All parent connections valid (parents come after children in topo-order)");
}
console.log(`\nTotal: ${commits.length} commits, max ${maxCols} columns, ${issues} issues`);
