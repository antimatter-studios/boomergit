import { describe, it, expect } from "vitest";
import { Linter } from "eslint";
// @ts-expect-error - the flat config is plain ESM with no type declarations.
import { localPlugin } from "../eslint.config.mjs";

/**
 * The `no-silent-catch` rule, exercised directly.
 *
 * It exists because a discarded error turns a crash into a button that appears
 * to do nothing — the shape that hid the graph's open-path failure. ESLint's
 * own `no-empty` does not cover it: ESLint counts a comment as content, so
 * `catch { /* best effort *\/ }` passes it, and that is what this repository
 * actually had. So the gap-closing half is ours, and it needs its own test.
 */
const linter = new Linter();

function lint(code: string): string[] {
  const messages = linter.verify(code, [
    {
      plugins: { local: localPlugin },
      rules: { "local/no-silent-catch": "error" },
    },
  ]);
  return messages.map((m) => m.ruleId ?? m.message);
}

describe("local/no-silent-catch", () => {
  it("reports a catch block with no statements", () => {
    expect(lint("try { f(); } catch {}")).toEqual(["local/no-silent-catch"]);
  });

  it("reports a catch whose only content is a comment", () => {
    // The case no-empty lets through, and the reason this rule exists.
    expect(lint("try { f(); } catch { /* best effort */ }")).toEqual([
      "local/no-silent-catch",
    ]);
  });

  it("reports a bound error that is then ignored", () => {
    expect(lint("try { f(); } catch (err) {}")).toEqual(["local/no-silent-catch"]);
  });

  it("accepts a catch that logs", () => {
    expect(lint("try { f(); } catch (e) { console.error(e); }")).toEqual([]);
  });

  it("accepts a catch that rethrows", () => {
    expect(lint("try { f(); } catch (e) { throw e; }")).toEqual([]);
  });

  it("accepts a catch that returns something the caller can act on", () => {
    expect(lint("function g() { try { return f(); } catch { return ''; } }")).toEqual([]);
  });

  it("finds a catch nested inside another function", () => {
    expect(lint("function a() { function b() { try { f(); } catch {} } }")).toEqual([
      "local/no-silent-catch",
    ]);
  });

  it("reports every offender rather than stopping at the first", () => {
    expect(lint("try { f(); } catch {}\ntry { g(); } catch {}")).toHaveLength(2);
  });

  it("says what to do instead, not just that it is wrong", () => {
    const messages = linter.verify("try { f(); } catch {}", [
      { plugins: { local: localPlugin }, rules: { "local/no-silent-catch": "error" } },
    ]);
    expect(messages[0].message).toContain("Log it, rethrow it");
  });
});
