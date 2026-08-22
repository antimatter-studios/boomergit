import * as vscode from "vscode";
import { gitQuery } from "../git/exec.js";

/** git's name-status letters: added, modified, deleted, renamed, copied, type-changed, unmerged. */
export type FileStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U";

export interface ChangedFile {
  status: FileStatus;
  path: string;
  oldPath?: string;
}

/**
 * Parse `git diff-tree --name-status` output.
 *
 * Each line is a status letter followed by tab-separated paths. Renames and
 * copies carry two paths — old then new — and everything else carries one.
 */
export function parseNameStatus(stdout: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    const status = parts[0].charAt(0) as FileStatus;
    // A rename or copy carries two paths, old then new; everything else one.
    // Skip a line missing the path it needs rather than building a file entry
    // with an undefined path, which would throw when the tree is assembled.
    const isMove = status === "R" || status === "C";
    const filePath = isMove ? parts[2] : parts[1];
    if (!filePath) continue;
    files.push(isMove ? { status, path: filePath, oldPath: parts[1] } : { status, path: filePath });
  }
  return files;
}

interface FileTreeNode {
  name: string;
  path: string;
  file?: ChangedFile;
  children: Map<string, FileTreeNode>;
}

/** An empty tree root, used both initially and on clear. */
function emptyTree(): FileTreeNode {
  return { name: "", path: "", children: new Map() };
}

/**
 * Shown in place of the tree when building it throws.
 *
 * Returning an empty list here would be indistinguishable from a commit that
 * genuinely changed nothing, which is the one reading a user must not be given
 * when something has actually gone wrong.
 */
class TreeErrorItem extends vscode.TreeItem {
  constructor(detail: string) {
    super("Failed to list changed files", vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
    this.tooltip = detail;
    this.contextValue = "changedFilesError";
  }
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

/** Group a flat file list into a directory tree. */
export function buildFileTree(files: ChangedFile[]): FileTreeNode {
  const root = emptyTree();
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

/**
 * Collapse chains of single-child directories into one node, so a deep path
 * with nothing to branch at reads as `src/providers/` rather than three
 * nested rows the user has to expand one at a time.
 */
export function flattenSingleChildDirs(node: FileTreeNode): FileTreeNode {
  for (const [key, child] of node.children) {
    node.children.set(key, flattenSingleChildDirs(child));
  }
  if (!node.file && node.children.size === 1 && node.name !== "") {
    const only = [...node.children.values()][0];
    if (!only.file) {
      return { name: `${node.name}/${only.name}`, path: only.path, children: only.children };
    }
  }
  return node;
}

/** Directories first, then files, each alphabetically. */
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

  private fileTree: FileTreeNode = emptyTree();
  private fetchSeq = 0;
  private commitHash = "";
  private parentHash = "";
  private cwd = "";

  async showCommit(hash: string, parentHash: string, isRoot: boolean, cwd: string): Promise<void> {
    this.commitHash = hash;
    this.parentHash = parentHash;
    this.cwd = cwd;
    // Sequence number so a slow fetch can't overwrite a newer selection.
    const seq = ++this.fetchSeq;
    this.fileTree = emptyTree();
    this._onDidChangeTreeData.fire();

    const files = await this.fetchChangedFiles(hash, isRoot, cwd);
    if (seq !== this.fetchSeq) return;

    this.fileTree = flattenSingleChildDirs(buildFileTree(files));
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.fetchSeq++;
    this.fileTree = emptyTree();
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
      // Surfaced in the tree as well as logged: the log isn't somewhere a user
      // would think to look when the view says a commit changed nothing.
      console.error("[boomergit] getChildren error:", err);
      return [new TreeErrorItem(err instanceof Error ? err.message : String(err))];
    }
  }

  private async fetchChangedFiles(hash: string, isRoot: boolean, cwd: string): Promise<ChangedFile[]> {
    const args = ["diff-tree", "--no-commit-id", "-r", "--name-status"];
    // A root commit has no parent to diff against, so git needs telling.
    if (isRoot) args.push("--root");
    args.push(hash);
    return parseNameStatus(await gitQuery(args, cwd));
  }
}
