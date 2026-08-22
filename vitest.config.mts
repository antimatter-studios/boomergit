import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // The real `vscode` module only exists inside the extension host, so
      // every module importing it is untestable without this redirect.
      vscode: path.resolve(__dirname, "test/mocks/vscode.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Report on every source file, not just the ones a test happens to
      // import — an untested module must show as 0%, not vanish from the table.
      all: true,
      include: ["src/**/*.ts"],
      thresholds: {
        // perFile so a well-covered module can't carry a neglected one:
        // every source file has to clear the bar on its own.
        perFile: true,
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 70,
      },
    },
  },
});
