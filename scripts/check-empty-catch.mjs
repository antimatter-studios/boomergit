#!/usr/bin/env node
/**
 * Fail the build on a catch block that does nothing.
 *
 * A silent catch turns a crash into a button that appears to do nothing: the
 * user clicks, the handler swallows the error, and there is no message, no log
 * and no clue where to start looking. That happened here — the graph's whole
 * open path sat inside `catch { /* silently fail on refresh *\/ }`.
 *
 * A comment is not a handler. `catch { /* best effort *\/ }` still discards the
 * error, so a block whose only content is a comment counts as empty. The
 * minimum acceptable handler is one statement: log it, rethrow it, or return a
 * value that the caller can actually distinguish from success.
 *
 * tsc has no rule for this and the project carries no ESLint, so this walks the
 * AST with the TypeScript API that esbuild's typecheck already depends on.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// An explicit root lets the tests run the guard against a throwaway tree, so
// they can prove it rejects a bad catch rather than only that today's sources
// happen to be clean.
const ROOT = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("..", import.meta.url));
const DIRS = ["src", "test", "scripts"];
const SKIP = new Set(["node_modules", "out", "build", ".git"]);
const EXTENSIONS = new Set([".ts", ".mts", ".mjs", ".js", ".cjs"]);

/** Every source file under `dir`, recursively, that we typecheck or ship. */
function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (EXTENSIONS.has(extname(entry))) found.push(path);
  }
  return found;
}

/**
 * A catch block counts as empty when it holds no statements. TypeScript parks
 * comments in the node's trivia rather than the statement list, so a block
 * containing only a comment lands here too — which is the point.
 */
function emptyCatches(file) {
  const text = readFileSync(file, "utf8");
  const kind = /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const hits = [];

  const visit = (node) => {
    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      hits.push(line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

const failures = [];
for (const dir of DIRS) {
  const path = join(ROOT, dir);
  if (!existsSync(path)) continue;
  for (const file of walk(path)) {
    for (const line of emptyCatches(file)) {
      failures.push(`${relative(ROOT, file)}:${line}`);
    }
  }
}

if (failures.length) {
  console.error(
    `Empty catch block${failures.length > 1 ? "s" : ""} — a discarded error is a bug report nobody gets:`
  );
  for (const at of failures) console.error(`  ${at}`);
  console.error("\nHandle it: log it, rethrow it, or return something the caller can act on.");
  process.exit(1);
}

console.log(`No empty catch blocks (${DIRS.join(", ")}).`);
