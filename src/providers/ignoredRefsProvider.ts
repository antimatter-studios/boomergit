import * as vscode from "vscode";

class IgnoredRefItem extends vscode.TreeItem {
  constructor(readonly pattern: string) {
    super(pattern, vscode.TreeItemCollapsibleState.None);
    this.tooltip = `Commits with refs matching /${pattern}/ are hidden`;
    this.description = "regex";
    this.contextValue = "ignoredRef";
    this.iconPath = new vscode.ThemeIcon("regex");
    this.command = { command: "boomergit.removeIgnoredRef", title: "Remove Ignore Pattern", arguments: [pattern] };
  }
}

export class IgnoredRefsProvider implements vscode.TreeDataProvider<IgnoredRefItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly readPatterns: () => string[]) {}

  refresh(): void { this.changed.fire(); }
  getTreeItem(item: IgnoredRefItem): vscode.TreeItem { return item; }
  getChildren(): IgnoredRefItem[] { return this.readPatterns().map((pattern) => new IgnoredRefItem(pattern)); }
}
