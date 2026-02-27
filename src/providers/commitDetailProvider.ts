import * as vscode from "vscode";
import { execFile } from "node:child_process";
import type { Commit } from "../git/types.js";

type FileStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U";

interface ChangedFile {
  status: FileStatus;
  path: string;
  oldPath?: string; // for renames
}

class InfoItem extends vscode.TreeItem {
  constructor(label: string, description: string, icon: vscode.ThemeIcon) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    this.contextValue = "commitInfo";
  }
}

class MessageLine extends vscode.TreeItem {
  constructor(text: string) {
    super(text || " ", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "messageLine";
  }
}

class SectionHeader extends vscode.TreeItem {
  constructor(label: string, public sectionId: string) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "sectionHeader";
  }
}

class FileItem extends vscode.TreeItem {
  constructor(file: ChangedFile) {
    const parts = file.path.split("/");
    const basename = parts.pop()!;
    const dirname = parts.join("/");
    super(basename, vscode.TreeItemCollapsibleState.None);
    this.description = dirname || undefined;
    this.iconPath = FileItem.statusIcon(file.status);
    this.contextValue = "changedFile";
    this.tooltip = `${file.status === "R" ? `${file.oldPath} → ` : ""}${file.path}`;
  }

  private static statusIcon(status: FileStatus): vscode.ThemeIcon {
    switch (status) {
      case "A": return new vscode.ThemeIcon("diff-added", new vscode.ThemeColor("gitDecoration.addedResourceForeground"));
      case "D": return new vscode.ThemeIcon("diff-removed", new vscode.ThemeColor("gitDecoration.deletedResourceForeground"));
      case "R": return new vscode.ThemeIcon("diff-renamed", new vscode.ThemeColor("gitDecoration.renamedResourceForeground"));
      case "C": return new vscode.ThemeIcon("diff-added", new vscode.ThemeColor("gitDecoration.addedResourceForeground"));
      default:  return new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"));
    }
  }
}

export class CommitDetailProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private commit: Commit | undefined;
  private fullMessage = "";
  private files: ChangedFile[] = [];
  private fetchSeq = 0;

  // Stable section header references so TreeView can track identity across refreshes
  private infoSection = new SectionHeader("Commit Info", "info");
  private msgSection = new SectionHeader("Message", "message");
  private filesSection = new SectionHeader("Changed Files (0)", "files");

  async showCommit(commit: Commit, cwd: string): Promise<void> {
    const seq = ++this.fetchSeq;
    this.commit = commit;
    this.fullMessage = commit.subject;
    this.files = [];
    this.filesSection.label = "Changed Files (…)";
    this._onDidChangeTreeData.fire();

    const [message, files] = await Promise.all([
      this.fetchFullMessage(commit.hash, cwd),
      this.fetchChangedFiles(commit.hash, commit.parents.length === 0, cwd),
    ]);

    // Discard if a newer showCommit was called while we were fetching
    if (seq !== this.fetchSeq) return;

    this.fullMessage = message;
    this.files = files;
    this.filesSection.label = `Changed Files (${files.length})`;
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.fetchSeq++;
    this.commit = undefined;
    this.fullMessage = "";
    this.files = [];
    this.filesSection.label = "Changed Files (0)";
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!this.commit) return [];

    if (!element) {
      return [this.infoSection, this.msgSection, this.filesSection];
    }

    if (element === this.infoSection) {
      return this.buildInfoItems();
    }
    if (element === this.msgSection) {
      return this.buildMessageItems();
    }
    if (element === this.filesSection) {
      return this.files.map((f) => new FileItem(f));
    }

    return [];
  }

  private buildInfoItems(): vscode.TreeItem[] {
    const c = this.commit!;
    const items: vscode.TreeItem[] = [];

    items.push(new InfoItem("Hash", c.hash, new vscode.ThemeIcon("git-commit")));
    items.push(new InfoItem("Author", `${c.author} <${c.email}>`, new vscode.ThemeIcon("person")));

    const date = new Date(c.timestamp * 1000);
    items.push(new InfoItem("Date", date.toLocaleString(), new vscode.ThemeIcon("calendar")));

    for (const ref of c.refs) {
      let icon: vscode.ThemeIcon;
      switch (ref.type) {
        case "branch": icon = new vscode.ThemeIcon("git-branch"); break;
        case "tag":    icon = new vscode.ThemeIcon("tag"); break;
        case "remote": icon = new vscode.ThemeIcon("cloud"); break;
        case "head":   icon = new vscode.ThemeIcon("git-branch"); break;
        default:       icon = new vscode.ThemeIcon("git-branch"); break;
      }
      items.push(new InfoItem(ref.type, ref.name, icon));
    }

    return items;
  }

  private buildMessageItems(): vscode.TreeItem[] {
    const msg = this.fullMessage || this.commit?.subject || "";
    const lines = msg.split("\n");
    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    if (lines.length === 0) return [new MessageLine("(no message)")];
    return lines.map((line) => new MessageLine(line));
  }

  private fetchFullMessage(hash: string, cwd: string): Promise<string> {
    return new Promise((resolve) => {
      execFile("git", ["show", "-s", "--format=%B", hash], { cwd }, (err, stdout) => {
        resolve(err ? "" : stdout.trim());
      });
    });
  }

  private fetchChangedFiles(hash: string, isRoot: boolean, cwd: string): Promise<ChangedFile[]> {
    const args = ["diff-tree", "--no-commit-id", "-r", "--name-status"];
    if (isRoot) args.push("--root");
    args.push(hash);
    return new Promise((resolve) => {
      execFile("git", args, { cwd }, (err, stdout) => {
        if (err) return resolve([]);
        const files: ChangedFile[] = [];
        for (const line of stdout.trim().split("\n")) {
          if (!line) continue;
          const parts = line.split("\t");
          const statusRaw = parts[0].charAt(0) as FileStatus;
          if (statusRaw === "R" || statusRaw === "C") {
            files.push({ status: statusRaw, path: parts[2], oldPath: parts[1] });
          } else {
            files.push({ status: statusRaw, path: parts[1] });
          }
        }
        resolve(files);
      });
    });
  }
}
