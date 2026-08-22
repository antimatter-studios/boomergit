import { describe, it, expect } from "vitest";
import { renderSvg, COL_WIDTH, DOT_RADIUS } from "../src/graph/svgTileGen.js";
import type { GraphRow } from "../src/graph/types.js";

function row(overrides: Partial<GraphRow> = {}): GraphRow {
  return {
    commitHash: "a",
    commitCol: 0,
    commitColor: "#F5A623",
    segments: [{ topCol: 0, botCol: 0, color: "#F5A623" }],
    numCols: 1,
    ...overrides,
  };
}

describe("renderSvg", () => {
  it("emits a well-formed <svg> element sized to the grid", () => {
    const svg = renderSvg(row(), 24);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    // width = (cols * COL_WIDTH) + COL_WIDTH
    expect(svg).toContain(`width="${1 * COL_WIDTH + COL_WIDTH}"`);
    expect(svg).toContain('height="24"');
  });

  it("draws exactly one commit dot with the commit colour and radius", () => {
    const svg = renderSvg(row({ commitColor: "#4FC3F7" }), 24);
    expect((svg.match(/<circle/g) ?? [])).toHaveLength(1);
    expect(svg).toContain(`r="${DOT_RADIUS}"`);
    expect(svg).toContain('fill="#4FC3F7"');
  });

  it("draws a shadow + line path per segment", () => {
    const svg = renderSvg(
      row({ segments: [{ topCol: 0, botCol: 0, color: "#fff" }, { topCol: 1, botCol: 1, color: "#000" }], numCols: 2 }),
      24,
    );
    expect((svg.match(/<path/g) ?? [])).toHaveLength(2 * 2);
  });

  it("uses a straight line for same-column segments", () => {
    const svg = renderSvg(row({ segments: [{ topCol: 0, botCol: 0, color: "#fff" }] }), 24);
    expect(svg).toContain(" L"); // M..L, no bezier
    expect(svg).not.toContain(" C");
  });

  it("uses a bezier curve for cross-column segments", () => {
    const svg = renderSvg(
      row({ segments: [{ topCol: 0, botCol: 1, color: "#fff" }], numCols: 2 }),
      24,
    );
    expect(svg).toContain(" C");
  });

  it("honours the maxCols override for width", () => {
    const svg = renderSvg(row(), 24, 5);
    expect(svg).toContain(`width="${5 * COL_WIDTH + COL_WIDTH}"`);
  });
});

describe("renderSvg worktree ring", () => {
  const plain = {
    commitHash: "a",
    commitCol: 0,
    commitColor: "#F5A623",
    segments: [{ topCol: 0, botCol: 0, color: "#F5A623" }],
    numCols: 1,
  };

  it("draws no ring unless asked", () => {
    expect(renderSvg(plain, 21, 1)).not.toContain("#73c991");
  });

  it("draws a ring around the dot when asked", () => {
    const svg = renderSvg(plain, 21, 1, { worktree: true });
    expect(svg).toContain("#73c991");
    expect(svg).toMatch(/fill="none"[^>]*stroke="#73c991"/);
  });

  it("puts the ring outside the dot", () => {
    const svg = renderSvg(plain, 21, 1, { worktree: true });
    const ring = svg.match(/r="([\d.]+)"[^>]*stroke="#73c991"/);
    expect(Number(ring![1])).toBeGreaterThan(5);
  });

  it("keeps the ring inside the row at a comfortable line height", () => {
    const svg = renderSvg(plain, 21, 1, { worktree: true });
    const radii = [...svg.matchAll(/cy="([\d.]+)"[^>]*r="([\d.]+)"/g)];
    for (const [, cy, r] of radii) {
      expect(Number(cy) - Number(r)).toBeGreaterThanOrEqual(0);
    }
  });

  it("shrinks the ring rather than clipping it on a tight row", () => {
    const svg = renderSvg(plain, 14, 1, { worktree: true });
    const ring = svg.match(/r="([\d.]+)"[^>]*stroke="#73c991"/);
    if (ring) {
      // Fits within half the row height, so nothing is cut off
      expect(Number(ring[1])).toBeLessThanOrEqual(7);
    }
  });

  it("drops the ring entirely when the row is too short to clear the dot", () => {
    // 11px row: midY 5.5, so no ring can sit outside a radius-5 dot
    expect(renderSvg(plain, 11, 1, { worktree: true })).not.toContain("#73c991");
  });

  it("still draws the dot and lines when the ring is dropped", () => {
    const svg = renderSvg(plain, 11, 1, { worktree: true });
    expect(svg).toContain('fill="#F5A623"');
    expect(svg).toContain("<path");
    expect(svg).toContain("</svg>");
  });
});
