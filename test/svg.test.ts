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
