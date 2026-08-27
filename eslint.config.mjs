import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Lint rules, on top of `tsc`.
 *
 * What this config exists for: a discarded error turns a crash into a button
 * that appears to do nothing. The graph's whole open path once sat inside
 * `catch { /* silently fail on refresh *\/ }`, so a failure and a no-op were
 * indistinguishable from the outside — no message, no log, nowhere to start.
 *
 * `no-empty` alone does not cover it. ESLint counts a comment as content, so
 * `catch { /* best effort *\/ }` passes it — and that is the exact shape this
 * repository had. `local/no-silent-catch` below closes that gap: a comment is
 * not a handler, and the minimum is one statement that logs, rethrows, or
 * returns something the caller can tell apart from success.
 *
 * The rest is typescript-eslint's recommended set, which is type-unaware and
 * therefore fast; `tsc --noEmit` already covers what types can catch.
 */

/**
 * A catch block that discards the error is reported wherever it appears.
 *
 * Exported so the rule can be tested directly — a guard nothing checks is a
 * guard you find out about when it has already stopped working.
 */
export const localPlugin = {
  rules: {
    "no-silent-catch": {
      meta: {
        type: "problem",
        docs: { description: "Require a catch block to do something with the error" },
        schema: [],
        messages: {
          silent:
            "Catch block discards the error. Log it, rethrow it, or return something the caller can act on — a comment is not a handler.",
        },
      },
      create(context) {
        return {
          CatchClause(node) {
            if (node.body.body.length === 0) {
              context.report({ node: node.body, messageId: "silent" });
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: ["out/**", "build/**", "node_modules/**", "*.vsix"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { local: localPlugin },
    rules: {
      // The point of the whole file. no-empty covers the bare `catch {}` and
      // every other empty block; no-silent-catch covers the comment-only catch
      // that no-empty lets through.
      "no-empty": ["error", { allowEmptyCatch: false }],
      "local/no-silent-catch": "error",

      // A caught error that is never read is the same silence wearing a
      // binding, so it is an error rather than a warning like the rest.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Dev harnesses and build scripts are plain Node ESM, not the extension.
    files: ["scripts/**/*.mjs", "esbuild.mjs", "eslint.config.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    // The vscode test double stands in for an API whose real shape only exists
    // inside the extension host, so `any` is what it is standing in for.
    // Everything this config is actually guarding still applies here.
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  }
);
