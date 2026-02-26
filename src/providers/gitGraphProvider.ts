import * as vscode from "vscode";
import type { Commit } from "../git/types.js";

export class GitGraphProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private commits: Commit[] = [];

  setCommits(commits: Commit[]): void {
    this.commits = commits;
  }

  refresh(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  provideTextDocumentContent(_uri: vscode.Uri): string {
    const lines: string[] = [];
    for (const commit of this.commits) {
      const shortHash = commit.hash.slice(0, 8);
      const date = new Date(commit.timestamp * 1000);
      const dateStr = date.toISOString().slice(0, 10);
      const refTokens = commit.refs.map((r) => ` ${r.name} `).join("");
      const refSection = refTokens || "";

      // Format: {pad}{hash}{pad}{refs}{gap}{subject}{pad}{author}{pad}{date}
      lines.push(`  ${shortHash}  ${refSection}${commit.subject}  ${commit.author}  ${dateStr}`);
    }
    return lines.join("\n");
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
