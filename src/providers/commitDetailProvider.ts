import * as vscode from "vscode";
import { execFile } from "node:child_process";
import type { Commit } from "../git/types.js";

type FileStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U";

export interface ChangedFile {
  status: FileStatus;
  path: string;
  oldPath?: string;
}

// --- Commit Info WebviewView ---

export class CommitInfoProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private commit: Commit | undefined;
  private activeRefName: string | undefined;
  private activeRefType: string | undefined;
  private fullMessage = "";
  private fetchSeq = 0;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    console.log("[boomergit] resolveWebviewView called");
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: false };
    this.render();
  }

  async showCommit(commit: Commit, cwd: string, activeRefName?: string): Promise<void> {
    const seq = ++this.fetchSeq;
    this.commit = commit;
    this.fullMessage = commit.subject;
    // If no explicit ref, pick the first branch (skip HEAD)
    if (activeRefName) {
      const ref = commit.refs.find((r) => r.name === activeRefName);
      this.activeRefName = activeRefName;
      this.activeRefType = ref?.type;
    } else {
      const firstRef = commit.refs.find((r) => r.type === "branch")
        ?? commit.refs.find((r) => r.type === "remote")
        ?? commit.refs.find((r) => r.type === "tag");
      this.activeRefName = firstRef?.name;
      this.activeRefType = firstRef?.type;
    }
    this.render();

    const message = await new Promise<string>((resolve) => {
      execFile("git", ["show", "-s", "--format=%B", commit.hash], { cwd }, (err, stdout) => {
        resolve(err ? "" : stdout.trim());
      });
    });

    if (seq !== this.fetchSeq) return;
    this.fullMessage = message;
    this.render();
  }

  clear(): void {
    this.fetchSeq++;
    this.commit = undefined;
    this.activeRefName = undefined;
    this.activeRefType = undefined;
    this.fullMessage = "";
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    if (!this.commit) {
      this.view.webview.html = `<!DOCTYPE html><html><body style="padding:8px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);font-size:var(--vscode-font-size);">
        <p style="color:var(--vscode-descriptionForeground);">Click a commit to see details</p>
      </body></html>`;
      this.view.title = "Commit Info";
      return;
    }

    const c = this.commit;
    const date = new Date(c.timestamp * 1000).toLocaleString();
    const msgHtml = this.escapeHtml(this.fullMessage || c.subject);

    // Title: "Branch: name" / "Tag: name" etc, or nothing if no refs
    const typeLabels: Record<string, string> = { branch: "Branch", tag: "Tag", remote: "Remote" };
    const titleLabel = this.activeRefType ? typeLabels[this.activeRefType] || "" : "";
    const titleName = this.activeRefName;
    this.view.title = titleName || "Commit Info";

    // Subtitle badges: all other refs (excluding the active one and HEAD)
    const subtitleRefs = c.refs.filter((r) => r.name !== this.activeRefName && r.type !== "head");
    const badgeColors: Record<string, string> = {
      branch: "#4ec9b0", tag: "#dcdcaa", remote: "#9cdcfe", head: "#c586c0",
    };
    const badges = subtitleRefs.map((r) => {
      const bg = badgeColors[r.type] || "#888";
      return `<span style="background:${bg};color:#1e1e1e;padding:1px 6px;border-radius:3px;font-size:0.85em;font-weight:bold;margin-right:4px;">${this.escapeHtml(r.name)}</span>`;
    }).join("");

    this.view.webview.html = `<!DOCTYPE html>
<html>
<head><style>
  body { padding: 8px 12px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); font-size: var(--vscode-font-size); line-height: 1.5; }
  .title { font-size: 1.3em; font-weight: bold; margin-bottom: 2px; }
  .title-label { color: var(--vscode-descriptionForeground); font-weight: normal; font-size: 0.8em; }
  .badges { line-height: 2; margin-bottom: 8px; }
  .row { margin-bottom: 4px; }
  .label { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .value { word-break: break-all; }
  .message { white-space: pre-wrap; word-wrap: break-word; margin-top: 8px; padding: 8px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); border-radius: 2px; }
  hr { border: none; border-top: 1px solid var(--vscode-widget-border); margin: 10px 0; }
</style></head>
<body>
  ${titleName ? `<div class="title"><span class="title-label">${this.escapeHtml(titleLabel)}:</span> ${this.escapeHtml(titleName)}</div>` : ""}
  ${badges ? `<div class="badges">${badges}</div>` : ""}
  <div class="row"><span class="label">Hash </span><span class="value" style="color:#F5A623;font-weight:bold;">${this.escapeHtml(c.hash)}</span></div>
  <div class="row"><span class="label">Author </span><span class="value">${this.escapeHtml(c.author)} &lt;${this.escapeHtml(c.email)}&gt;</span></div>
  <div class="row"><span class="label">Date </span><span class="value">${this.escapeHtml(date)}</span></div>
  <hr>
  <div class="message">${msgHtml}</div>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}

// --- Changed Files TreeView ---

interface FileTreeNode {
  name: string;
  path: string;
  file?: ChangedFile;
  children: Map<string, FileTreeNode>;
}

class DirItem extends vscode.TreeItem {
  constructor(public node: FileTreeNode, public commitHash: string, public parentHash: string, public cwd: string) {
    super(node.name, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon("folder");
    this.contextValue = "changedDir";
  }
}

class FileItem extends vscode.TreeItem {
  constructor(file: ChangedFile, basename: string, commitHash: string, parentHash: string, cwd: string) {
    super(basename, vscode.TreeItemCollapsibleState.None);
    this.iconPath = FileItem.statusIcon(file.status);
    this.contextValue = "changedFile";
    this.tooltip = `${file.status === "R" ? `${file.oldPath} → ` : ""}${file.path}`;
    this.command = {
      command: "boomergit.openFileDiff",
      title: "Show File Diff",
      arguments: [file, commitHash, parentHash, cwd],
    };
  }

  static statusIcon(status: FileStatus): vscode.ThemeIcon {
    switch (status) {
      case "A": return new vscode.ThemeIcon("diff-added", new vscode.ThemeColor("gitDecoration.addedResourceForeground"));
      case "D": return new vscode.ThemeIcon("diff-removed", new vscode.ThemeColor("gitDecoration.deletedResourceForeground"));
      case "R": return new vscode.ThemeIcon("diff-renamed", new vscode.ThemeColor("gitDecoration.renamedResourceForeground"));
      case "C": return new vscode.ThemeIcon("diff-added", new vscode.ThemeColor("gitDecoration.addedResourceForeground"));
      default:  return new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"));
    }
  }
}

function buildFileTree(files: ChangedFile[]): FileTreeNode {
  const root: FileTreeNode = { name: "", path: "", children: new Map() };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      if (!node.children.has(dir)) {
        node.children.set(dir, { name: dir, path: parts.slice(0, i + 1).join("/"), children: new Map() });
      }
      node = node.children.get(dir)!;
    }
    const filename = parts[parts.length - 1];
    node.children.set(filename, { name: filename, path: file.path, file, children: new Map() });
  }
  return root;
}

function flattenSingleChildDirs(node: FileTreeNode): FileTreeNode {
  for (const [key, child] of node.children) {
    const flattened = flattenSingleChildDirs(child);
    node.children.set(key, flattened);
  }
  if (!node.file && node.children.size === 1 && node.name !== "") {
    const only = [...node.children.values()][0];
    if (!only.file) {
      return { name: `${node.name}/${only.name}`, path: only.path, children: only.children };
    }
  }
  return node;
}

function treeNodeToItems(node: FileTreeNode, commitHash: string, parentHash: string, cwd: string): vscode.TreeItem[] {
  const dirs: DirItem[] = [];
  const files: vscode.TreeItem[] = [];
  for (const child of node.children.values()) {
    if (child.file) {
      files.push(new FileItem(child.file, child.name, commitHash, parentHash, cwd));
    } else {
      dirs.push(new DirItem(child, commitHash, parentHash, cwd));
    }
  }
  dirs.sort((a, b) => a.node.name.localeCompare(b.node.name));
  files.sort((a, b) => (a.label as string).localeCompare(b.label as string));
  return [...dirs, ...files];
}

export class ChangedFilesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private files: ChangedFile[] = [];
  private fileTree: FileTreeNode = { name: "", path: "", children: new Map() };
  private fetchSeq = 0;
  private label = "Changed Files";
  private commitHash = "";
  private parentHash = "";
  private cwd = "";

  async showCommit(hash: string, parentHash: string, isRoot: boolean, cwd: string): Promise<void> {
    this.commitHash = hash;
    this.parentHash = parentHash;
    this.cwd = cwd;
    const seq = ++this.fetchSeq;
    this.files = [];
    this.fileTree = { name: "", path: "", children: new Map() };
    this._onDidChangeTreeData.fire();

    const files = await this.fetchChangedFiles(hash, isRoot, cwd);
    if (seq !== this.fetchSeq) return;

    this.files = files;
    this.fileTree = flattenSingleChildDirs(buildFileTree(files));
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.fetchSeq++;
    this.files = [];
    this.fileTree = { name: "", path: "", children: new Map() };
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    try {
      if (!element) {
        return treeNodeToItems(this.fileTree, this.commitHash, this.parentHash, this.cwd);
      }
      if (element instanceof DirItem) {
        return treeNodeToItems(element.node, element.commitHash, element.parentHash, element.cwd);
      }
      return [];
    } catch (err) {
      console.error("[boomergit] getChildren error:", err);
      return [];
    }
  }

  private fetchChangedFiles(hash: string, isRoot: boolean, cwd: string): Promise<ChangedFile[]> {
    const args = ["diff-tree", "--no-commit-id", "-r", "--name-status"];
    if (isRoot) args.push("--root");
    args.push(hash);
    return new Promise((resolve) => {
      execFile("git", args, { cwd }, (err, stdout, stderr) => {
        console.log(`[boomergit] diff-tree: hash=${hash.slice(0, 8)} isRoot=${isRoot} err=${err?.message ?? "none"} stderr=${stderr?.trim()} stdout=${JSON.stringify(stdout?.slice(0, 300))}`);
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
