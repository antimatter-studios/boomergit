// Quick verification: does the SVG output match expectations?
const COL_WIDTH = 20;
function colX(col) { return col * COL_WIDTH + COL_WIDTH / 2; }
function segmentPath(x0, y0, x1, y1, cpFactor = 0.5) {
  if (x0 === x1) return `M${x0},${y0} L${x1},${y1}`;
  const cpY = y0 + (y1 - y0) * cpFactor;
  return `M${x0},${y0} C${x0},${cpY} ${x1},${cpY} ${x1},${y1}`;
}

const rowHeight = 21;
const midY = rowHeight / 2 + rowHeight * 0.02;

// Row with merge: commit at lane 0, merge from lane 1 (full height, no half)
const segments = [
  { topCol: 0, botCol: 0, color: "#F5A623" },  // commit lane
  { topCol: 1, botCol: 0, color: "#4FC3F7" },  // merge (full height)
];

console.log("=== SVG Segments for merge row ===\n");
for (const seg of segments) {
  const xTop = colX(seg.topCol);
  const xBot = colX(seg.botCol);
  let y0, y1;
  if (seg.half === "top") { y0 = 0; y1 = midY; }
  else if (seg.half === "bottom") { y0 = midY; y1 = rowHeight; }
  else { y0 = 0; y1 = rowHeight; }

  const isFullHeightCurve = (seg.half === undefined) && (xTop !== xBot);
  const d = segmentPath(xTop, y0, xBot, y1, isFullHeightCurve ? 0.35 : 0.5);

  console.log(`seg [lane ${seg.topCol} -> lane ${seg.botCol}]`);
  console.log(`  half: ${seg.half || "NONE (full height)"}`);
  console.log(`  y: ${y0} -> ${y1} (${y1 === rowHeight ? "FULL" : y1 === midY ? "HALF-top" : "HALF-bot"})`);
  console.log(`  cpFactor: ${isFullHeightCurve ? 0.35 : 0.5}`);
  console.log(`  path: ${d}`);
  console.log();
}

// Compare with old behavior (half:top merge)
console.log("=== OLD behavior (half:top merge) ===\n");
const oldSeg = { topCol: 1, botCol: 0, half: "top" };
const xTop = colX(1), xBot = colX(0);
const oldPath = segmentPath(xTop, 0, xBot, midY, 0.5);
console.log(`  y: 0 -> ${midY.toFixed(1)} (HALF height only)`);
console.log(`  path: ${oldPath}`);
console.log();
console.log("=== KEY DIFFERENCE ===");
console.log(`OLD: merge curve spans 0 -> ${midY.toFixed(1)}px (half row)`);
console.log(`NEW: merge curve spans 0 -> ${rowHeight}px (full row) with cpFactor=0.35`);
