import * as vscode from "vscode";
import { gitQuery } from "../git/exec.js";

export const FILE_SCHEME = "boomergit-file";

/**
 * Ref meaning "nothing on this side" — a file that didn't exist yet, one that
 * has been deleted, or the parent side of a root commit. Defined here because
 * this is the module that resolves it; anything constructing a diff should
 * import it rather than repeat the literal.
 */
export const EMPTY_REF = "empty";

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

    if (ref === EMPTY_REF) return Promise.resolve("");

    const filePath = uri.path.startsWith("/") ? uri.path.slice(1) : uri.path;

    return gitQuery(["show", `${ref}:${filePath}`], cwd);
  }
}
