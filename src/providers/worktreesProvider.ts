import * as vscode from "vscode";
import { shortHash } from "../git/format.js";
import { worktreeLabel, type Worktree } from "../git/worktrees.js";

/**
 * One working tree in the sidebar list.
 *
 * The label is the branch, or the directory name when detached — the same
 * choice the graph badge makes, so the two read as the same thing.
 */
class WorktreeItem extends vscode.TreeItem {
  constructor(readonly worktree: Worktree) {
    super(worktreeLabel(worktree), vscode.TreeItemCollapsibleState.None);

    this.description = describe(worktree);
    this.tooltip = tooltip(worktree);
    this.iconPath = icon(worktree);
    this.contextValue = worktree.isCurrent ? "worktreeCurrent" : "worktree";
    this.resourceUri = vscode.Uri.file(worktree.path);

    // Clicking a worktree jumps the graph to the commit it sits on, which is
    // the question the list is usually being consulted to answer.
    this.command = {
      command: "boomergit.revealWorktree",
      title: "Reveal Worktree Commit",
      arguments: [worktree.head],
    };
  }
}

/** The trailing grey text: what state this worktree is in. */
function describe(worktree: Worktree): string {
  const parts: string[] = [];
  if (worktree.isCurrent) parts.push("current");
  if (worktree.bare) parts.push("bare");
  if (worktree.detached) parts.push("detached");
  if (worktree.locked) parts.push("locked");
  if (worktree.prunable) parts.push("prunable");
  if (worktree.head) parts.push(shortHash(worktree.head));
  return parts.join(" · ");
}

function tooltip(worktree: Worktree): string {
  const lines = [worktree.path];
  if (worktree.branch) lines.push(`Branch: ${worktree.branch}`);
  else if (worktree.detached) lines.push("Detached HEAD");
  if (worktree.head) lines.push(`HEAD: ${worktree.head}`);
  if (worktree.locked) lines.push(`Locked${worktree.lockReason ? `: ${worktree.lockReason}` : ""}`);
  if (worktree.prunable) {
    lines.push(`Prunable${worktree.prunableReason ? `: ${worktree.prunableReason}` : ""}`);
  }
  return lines.join("\n");
}

function icon(worktree: Worktree): vscode.ThemeIcon {
  if (worktree.prunable) {
    return new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
  }
  if (worktree.isCurrent) {
    return new vscode.ThemeIcon("check", new vscode.ThemeColor("gitDecoration.addedResourceForeground"));
  }
  if (worktree.locked) return new vscode.ThemeIcon("lock");
  if (worktree.detached) return new vscode.ThemeIcon("git-commit");
  return new vscode.ThemeIcon("git-branch");
}

/** Sidebar list of every working tree of the repository. */
export class WorktreesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private worktrees: Worktree[] = [];

  setWorktrees(worktrees: Worktree[]): void {
    this.worktrees = worktrees;
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.worktrees = [];
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) return [];
    // Current first — it's the frame of reference for everything else — then
    // by label so the list doesn't reorder as HEADs move.
    return [...this.worktrees]
      .sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
        return worktreeLabel(a).localeCompare(worktreeLabel(b));
      })
      .map((w) => new WorktreeItem(w));
  }
}
