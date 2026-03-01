import * as vscode from "vscode";
import { execFile } from "node:child_process";

export const FILE_SCHEME = "boomergit-file";

/** Build a URI with JSON-encoded query for resourceLabelFormatters */
export function fileUri(filePath: string, ref: string, cwd: string, label: string): vscode.Uri {
  const query = JSON.stringify({ ref, cwd, label });
  return vscode.Uri.parse(`${FILE_SCHEME}:/${filePath}`).with({ query });
}

export class GitFileContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
    const params = JSON.parse(uri.query) as { ref: string; cwd: string };
    const ref = params.ref ?? "";
    const cwd = params.cwd ?? "";

    // "empty" sentinel → blank content (added files, deleted files, root commits)
    if (ref === "empty") return Promise.resolve("");

    const filePath = uri.path.startsWith("/") ? uri.path.slice(1) : uri.path;

    return new Promise<string>((resolve) => {
      execFile(
        "git", ["show", `${ref}:${filePath}`],
        { cwd, maxBuffer: 10 * 1024 * 1024, encoding: "buffer" },
        (err, stdout) => {
          if (err) return resolve("");
          resolve((stdout as unknown as Buffer).toString("utf8"));
        }
      );
    });
  }
}
