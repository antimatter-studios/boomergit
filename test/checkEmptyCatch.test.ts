import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "check-empty-catch.mjs");

/**
 * Run the guard against a throwaway tree rather than the repo, so the test
 * proves it rejects what it should instead of only agreeing that today's
 * sources are clean.
 */
function runOn(files: Record<string, string>): { code: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "empty-catch-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const path = join(dir, name);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, content);
    }
    try {
      const output = execFileSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
      return { code: 0, output };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { code: e.status, output: `${e.stdout}${e.stderr}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("check-empty-catch", () => {
  it("rejects a catch block with no statements", () => {
    const { code, output } = runOn({ "src/a.ts": "try { f(); } catch {}\n" });
    expect(code).toBe(1);
    expect(output).toContain("src/a.ts:1");
  });

  it("rejects a catch whose only content is a comment", () => {
    // The shape this guard exists for: it looks handled and discards the error.
    const { code, output } = runOn({
      "src/a.ts": "try { f(); } catch {\n  /* best effort */\n}\n",
    });
    expect(code).toBe(1);
    expect(output).toContain("src/a.ts:1");
  });

  it("rejects a bound error that is then ignored", () => {
    const { code } = runOn({ "src/a.ts": "try { f(); } catch (err) {}\n" });
    expect(code).toBe(1);
  });

  it("accepts a catch that logs", () => {
    const { code } = runOn({ "src/a.ts": "try { f(); } catch (e) { console.error(e); }\n" });
    expect(code).toBe(0);
  });

  it("accepts a catch that returns a value the caller can act on", () => {
    const { code } = runOn({
      "src/a.ts": "export function f(): string {\n  try { return g(); } catch { return ''; }\n}\n",
    });
    expect(code).toBe(0);
  });

  it("checks .mjs build scripts, not only TypeScript", () => {
    const { code, output } = runOn({ "scripts/x.mjs": "try { f(); } catch {}\n" });
    expect(code).toBe(1);
    expect(output).toContain("scripts/x.mjs:1");
  });

  it("finds a catch nested inside another function", () => {
    const { code } = runOn({
      "src/a.ts": "function outer() {\n  function inner() {\n    try { f(); } catch {}\n  }\n}\n",
    });
    expect(code).toBe(1);
  });

  it("reports every offender rather than stopping at the first", () => {
    const { output } = runOn({
      "src/a.ts": "try { f(); } catch {}\n",
      "src/b.ts": "try { g(); } catch {}\n",
    });
    expect(output).toContain("src/a.ts:1");
    expect(output).toContain("src/b.ts:1");
  });

  it("passes a tree with nothing to complain about", () => {
    const { code, output } = runOn({ "src/a.ts": "export const x = 1;\n" });
    expect(code).toBe(0);
    expect(output).toContain("No empty catch blocks");
  });
});
