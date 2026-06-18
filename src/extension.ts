import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { parseGitLog } from "./git/parser.js";
import { computeGraphLayout } from "./graph/layout.js";
import { GitGraphProvider } from "./providers/gitGraphProvider.js";
import type { Commit } from "./git/types.js";
import { GraphDecorationEngine } from "./decorations/graphDecorations.js";
import { CommitInfoProvider, ChangedFilesProvider } from "./providers/commitDetailProvider.js";
import type { ChangedFile } from "./providers/commitDetailProvider.js";
import { GitFileContentProvider, FILE_SCHEME, fileUri } from "./providers/gitFileContentProvider.js";

const SCHEME = "boomergit";
const DISPLAY_NAME = "BoomerGit";
const TITLE = `${DISPLAY_NAME} - Git Graph`;

export function activate(context: vscode.ExtensionContext) {
  const graphProvider = new GitGraphProvider();
  const storageDir = context.globalStorageUri.fsPath;

  // Set hover widget border for our menus
  const wbConfig = vscode.workspace.getConfiguration("workbench");
  const colors = wbConfig.get<Record<string, string>>("colorCustomizations") ?? {};
  const hoverColors: Record<string, string> = {
    "editorHoverWidget.border": "#ffffff",
  };
  const merged = { ...colors, ...hoverColors };
  wbConfig.update("colorCustomizations", merged, vscode.ConfigurationTarget.Global);

  // True when a graph editor tab exists anywhere (visible or background).
  function isGraphEditorOpen(): boolean {
    return vscode.window.tabGroups.all.some((g) =>
      g.tabs.some((t) =>
        t.input instanceof vscode.TabInputText && t.input.uri.scheme === SCHEME)
    );
  }

  // Reopen the graph when a BoomerGit sidebar view becomes visible but the
  // graph editor was closed. Guarded against concurrent re-entry because all
  // three views can fire visibility at once when the sidebar is revealed.
  let reopening = false;
  async function maybeReopenGraph(visible: boolean): Promise<void> {
    if (!visible || reopening || isGraphEditorOpen()) return;
    reopening = true;
    try {
      await vscode.commands.executeCommand("boomergit.showGraph");
    } finally {
      reopening = false;
    }
  }

  const commitInfoProvider = new CommitInfoProvider(() => maybeReopenGraph(true));
  const commitInfoReg = vscode.window.registerWebviewViewProvider("boomergit.commitInfo", commitInfoProvider);

  const changedFilesProvider = new ChangedFilesProvider();
  const changedFilesView = vscode.window.createTreeView("boomergit.changedFiles", {
    treeDataProvider: changedFilesProvider,
    showCollapseAll: true,
  });

  const providerReg = vscode.workspace.registerTextDocumentContentProvider(
    SCHEME,
    graphProvider
  );

  const fileProviderReg = vscode.workspace.registerTextDocumentContentProvider(
    FILE_SCHEME,
    new GitFileContentProvider()
  );

  // Sidebar icon: auto-open graph when the view becomes visible
  const emptyTreeProvider: vscode.TreeDataProvider<never> = {
    getTreeItem: () => { throw new Error("no items"); },
    getChildren: () => [],
  };
  const sidebarView = vscode.window.createTreeView("boomergit.welcome", {
    treeDataProvider: emptyTreeProvider,
  });
  sidebarView.onDidChangeVisibility((e) => maybeReopenGraph(e.visible));

  // The welcome view is hidden once the graph is open, so also listen on the
  // views that are visible in that state — this is what lets the sidebar icon
  // reopen the graph after the editor tab was closed.
  changedFilesView.onDidChangeVisibility((e) => maybeReopenGraph(e.visible));

  let decorationEngine: GraphDecorationEngine | undefined;
  let workspaceCwd: string | undefined;
  let currentBranch: string | undefined;
  let lastRows: import("./graph/types.js").GraphRow[] | undefined;
  let lastCommits: Commit[] | undefined;
  // Left-click → toggle hover menu; Cmd-click → select rows for compare
  let lastHoverKey: string | undefined;
  let hoverTriggeredByClick = false;
  // Timestamp-based ignore: avoids boolean flag races where a real click gets eaten
  let ignoreSelectionUntil = 0;

  // Refresh state: guard against overlapping refreshes; auto-refresh is opt-in.
  let refreshing = false;
  let refreshDebounce: ReturnType<typeof setTimeout> | undefined;
  let autoRefreshEnabled = vscode.workspace.getConfiguration("boomergit").get<boolean>("autoRefresh", false);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "boomergit.toggleAutoRefresh";
  function updateStatusBar(): void {
    if (!isGraphEditorOpen()) { statusBar.hide(); return; }
    statusBar.text = autoRefreshEnabled ? "$(sync) Auto-refresh: On" : "$(sync-ignored) Auto-refresh: Off";
    statusBar.tooltip = "BoomerGit: toggle auto-refresh (updates the graph when .git changes)";
    statusBar.show();
  }

  function resetCursor(editor: vscode.TextEditor, pos: vscode.Position, delayMs = 0): void {
    const doReset = () => {
      if (editor.document.uri.scheme !== SCHEME) return;
      const lineLen = editor.document.lineAt(pos.line).text.length;
      const resetCol = pos.character === 0 ? lineLen : 0;
      ignoreSelectionUntil = Date.now() + 200;
      editor.selection = new vscode.Selection(pos.line, resetCol, pos.line, resetCol);
    };
    if (delayMs > 0) setTimeout(doReset, delayMs);
    else doReset();
  }

  function showSidebar(commit: Commit, activeRefName?: string): void {
    if (!workspaceCwd) return;
    commitInfoProvider.showCommit(commit, workspaceCwd, activeRefName);
    const parentHash = commit.parents[0] || "";
    changedFilesProvider.showCommit(commit.hash, parentHash, commit.parents.length === 0, workspaceCwd);
  }

  const selectionWatcher = vscode.window.onDidChangeTextEditorSelection((e) => {
    if (e.textEditor.document.uri.scheme !== SCHEME || !decorationEngine) return;
    if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;

    // Ignore events from our own programmatic cursor resets
    if (Date.now() < ignoreSelectionUntil) return;

    const isCmdClick = e.selections.length > 1;
    const pos = isCmdClick
      ? e.selections[e.selections.length - 1].active
      : e.selections[0].active;

    // Collapse multi-cursors back to single cursor
    if (isCmdClick) {
      ignoreSelectionUntil = Date.now() + 200;
      e.textEditor.selection = new vscode.Selection(pos, pos);
    }

    const commit = decorationEngine.getCommitAt(pos.line);
    if (!commit) return;

    const refHit = decorationEngine.getRefAt(pos);
    const hasSelections = decorationEngine.getSelectedRows().length > 0;
    let showingMenu = false;

    if (refHit && !isCmdClick) {
      // Badge click: clear selections, show badge menu, update sidebar with this ref as title
      decorationEngine.clearSelections(e.textEditor);
      showSidebar(commit, refHit.ref.name);
      const key = `ref:${pos.line}:${refHit.ref.name}`;
      if (lastHoverKey === key) {
        lastHoverKey = undefined;
      } else {
        lastHoverKey = key;
        showingMenu = true;
        setTimeout(() => {
          hoverTriggeredByClick = true;
          vscode.commands.executeCommand("editor.action.showHover");
        }, 50);
      }
    } else if (isCmdClick) {
      // Cmd-click: add row to selection, open menu on it
      lastHoverKey = undefined;
      decorationEngine.selectRow(e.textEditor, pos.line);
      showSidebar(commit);
      showingMenu = true;
      setTimeout(() => {
        hoverTriggeredByClick = true;
        vscode.commands.executeCommand("editor.action.showHover");
      }, 50);
    } else if (hasSelections) {
      // Plain click while rows are selected → dismiss everything
      lastHoverKey = undefined;
      decorationEngine.clearSelections(e.textEditor);
      commitInfoProvider.clear();
      changedFilesProvider.clear();
    } else {
      // Plain click, nothing selected → select row and open menu
      lastHoverKey = undefined;
      decorationEngine.selectRow(e.textEditor, pos.line);
      showSidebar(commit);
      showingMenu = true;
      setTimeout(() => {
        hoverTriggeredByClick = true;
        vscode.commands.executeCommand("editor.action.showHover");
      }, 50);
    }

    // Always reset cursor so the next click at the same spot still fires.
    // Delay when showing a menu so the hover appears at the right position first.
    if (!isCmdClick) {
      resetCursor(e.textEditor, pos, showingMenu ? 250 : 0);
    }
  });

  // Hover provider — click-triggered only, context-sensitive menu
  const hoverProvider = vscode.languages.registerHoverProvider(
    { scheme: SCHEME },
    {
      provideHover(document, position) {
        if (!decorationEngine) return;

        // Always apply hover highlight on badges
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          decorationEngine.highlightBadge(editor, position);
        }

        // Only show menu on click-triggered hover
        if (!hoverTriggeredByClick) return;
        hoverTriggeredByClick = false;

        const commit = decorationEngine.getCommitAt(position.line);
        if (!commit) return;

        const refHit = decorationEngine.getRefAt(position);
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;
        md.supportThemeIcons = true;

        const white = (text: string) => `<span style="color:#ffffff;">${text}</span>`;

        if (refHit) {
          // Badge menu
          const ref = refHit.ref;
          if (ref.type === "branch" || ref.type === "remote") {
            const args = encodeURIComponent(JSON.stringify([ref.name, ref.type]));
            md.appendMarkdown(`[${white("$(git-branch)&ensp;Checkout Branch")}](command:boomergit.checkoutRef?${args})\n\n`);
          }
          if (ref.type === "branch") {
            const isCurrent = ref.name === currentBranch;
            if (isCurrent) {
              const grey = (text: string) => `<span style="color:#888888;">${text}</span>`;
              md.appendMarkdown(`${grey("$(trash)&ensp;Cannot delete current branch")}\n\n`);
            } else {
              const delArgs = encodeURIComponent(JSON.stringify([ref.name]));
              md.appendMarkdown(`[${white("$(trash)&ensp;Delete Branch")}](command:boomergit.deleteBranch?${delArgs})\n\n`);
            }
          }
          const copyRefArgs = encodeURIComponent(JSON.stringify([ref.name, `Copied: ${ref.name}`]));
          md.appendMarkdown(`[${white("$(clippy)&ensp;Copy Ref Name")}](command:boomergit.copyText?${copyRefArgs})\n\n`);
          const copyHashArgs = encodeURIComponent(JSON.stringify([commit.hash, `Copied: ${commit.hash.slice(0, 8)}`]));
          md.appendMarkdown(`[${white("$(git-commit)&ensp;Copy Commit Hash")}](command:boomergit.copyText?${copyHashArgs})`);
          return new vscode.Hover(md, refHit.range);
        } else {
          // Row menu (commit actions)
          const createArgs = encodeURIComponent(JSON.stringify([commit.hash]));
          md.appendMarkdown(`[${white("$(git-branch)&ensp;Create Branch Here")}](command:boomergit.createBranch?${createArgs})\n\n`);
          const copyHashArgs = encodeURIComponent(JSON.stringify([commit.hash, `Copied: ${commit.hash.slice(0, 8)}`]));
          md.appendMarkdown(`[${white("$(git-commit)&ensp;Copy Commit Hash")}](command:boomergit.copyText?${copyHashArgs})\n\n`);
          const copyMsgArgs = encodeURIComponent(JSON.stringify([commit.subject, "Copied commit message"]));
          md.appendMarkdown(`[${white("$(note)&ensp;Copy Commit Message")}](command:boomergit.copyText?${copyMsgArgs})`);
          const range = new vscode.Range(position.line, 0, position.line, 0);
          return new vscode.Hover(md, range);
        }
      },
    }
  );

  // Re-apply decorations when VS Code recreates the graph editor instance (e.g. layout split)
  const visibleEditorsWatcher = vscode.window.onDidChangeVisibleTextEditors((editors) => {
    if (!decorationEngine || !lastRows || !lastCommits) return;
    const graphEditor = editors.find((e) => e.document.uri.scheme === SCHEME);
    if (graphEditor) {
      decorationEngine.apply(graphEditor, lastRows, lastCommits, currentBranch);
    }
  });

  // When the graph editor tab is closed, tear down the live state so the sidebar
  // reflects "no graph" and a later reopen rebuilds cleanly.
  const tabCloseWatcher = vscode.window.tabGroups.onDidChangeTabs(() => {
    if (!decorationEngine || isGraphEditorOpen()) return;
    decorationEngine.dispose();
    decorationEngine = undefined;
    lastRows = undefined;
    lastCommits = undefined;
    lastHoverKey = undefined;
    commitInfoProvider.clear();
    changedFilesProvider.clear();
    updateStatusBar();
  });

  /**
   * Re-read git log and refresh the graph view.
   * With `preserveView`, keep the user's selected commit and scroll position
   * (used by the manual refresh button and auto-refresh); otherwise focus the
   * editor and auto-select the current branch (initial open / after git ops).
   */
  async function refreshGraph(opts: { preserveView?: boolean } = {}) {
    if (!workspaceCwd || refreshing) return;
    refreshing = true;
    try {
      // Snapshot view state to restore after a preserve-view refresh.
      let prevSelectedHash: string | undefined;
      let prevTopLine: number | undefined;
      if (opts.preserveView) {
        const sel = decorationEngine?.getSelectedRows() ?? [];
        if (sel.length === 1 && lastCommits) prevSelectedHash = lastCommits[sel[0]]?.hash;
        const ge = vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === SCHEME);
        prevTopLine = ge?.visibleRanges[0]?.start.line;
      }

      currentBranch = await new Promise<string>((resolve) => {
        execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: workspaceCwd },
          (err, stdout) => resolve(err ? "" : stdout.trim()));
      });

      const commits = await parseGitLog(workspaceCwd);
      if (commits.length === 0) return;

      const rows = computeGraphLayout(commits);

      const uri = vscode.Uri.parse(`${SCHEME}:${TITLE}`);
      graphProvider.setCommits(commits);
      graphProvider.refresh(uri);

      // Wait for VS Code to pick up the new content before applying decorations
      await new Promise<void>((resolve) => {
        const sub = vscode.workspace.onDidChangeTextDocument((e) => {
          if (e.document.uri.toString() === uri.toString()) {
            sub.dispose();
            resolve();
          }
        });
        // Fallback in case the content didn't actually change
        setTimeout(() => { sub.dispose(); resolve(); }, 200);
      });

      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(doc, "boomergit");
      const editor = await vscode.window.showTextDocument(doc, {
        preview: false,
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: opts.preserveView === true,
      });

      vscode.commands.executeCommand("setContext", "boomergit:graphOpen", true);

      lastRows = rows;
      lastCommits = commits;
      decorationEngine?.dispose();
      decorationEngine = new GraphDecorationEngine(storageDir);
      decorationEngine.apply(editor, rows, commits, currentBranch);

      // Restore the previously selected commit if it still exists, otherwise
      // auto-select the current branch commit and show its details.
      let restored = false;
      if (opts.preserveView && prevSelectedHash) {
        const idx = commits.findIndex((c) => c.hash === prevSelectedHash);
        if (idx >= 0) {
          decorationEngine.selectRow(editor, idx);
          showSidebar(commits[idx]);
          restored = true;
        }
      }
      if (!restored && currentBranch) {
        const idx = commits.findIndex((c) =>
          c.refs.some((r) => r.type === "branch" && r.name === currentBranch)
        );
        if (idx >= 0) {
          decorationEngine.selectRow(editor, idx);
          showSidebar(commits[idx], currentBranch);
        }
      }

      // Restore scroll position on a preserve-view refresh.
      if (opts.preserveView && prevTopLine !== undefined) {
        const line = Math.min(prevTopLine, editor.document.lineCount - 1);
        editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
      }

      updateStatusBar();
    } catch { /* silently fail on refresh */ }
    finally { refreshing = false; }
  }

  const checkoutRefCmd = vscode.commands.registerCommand(
    "boomergit.checkoutRef",
    async (name: string, type: string) => {
      if (!workspaceCwd) return;
      let branchName = name;
      if (type === "remote") {
        const slashIdx = branchName.indexOf("/");
        if (slashIdx >= 0) branchName = branchName.slice(slashIdx + 1);
      }
      try {
        await new Promise<void>((resolve, reject) => {
          execFile("git", ["checkout", branchName], { cwd: workspaceCwd },
            (err, _stdout, stderr) => {
              if (err) return reject(new Error(stderr || err.message));
              resolve();
            });
        });
        vscode.window.showInformationMessage(`Checked out: ${branchName}`);
        await refreshGraph();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Checkout failed: ${msg}`);
      }
    }
  );

  const deleteBranchCmd = vscode.commands.registerCommand(
    "boomergit.deleteBranch",
    async (branchName: string) => {
      if (!workspaceCwd) return;
      const choice = await vscode.window.showWarningMessage(
        `Delete branch "${branchName}"?`,
        { modal: true, detail: "Use 'Force Delete' if the branch is not fully merged." },
        "Delete", "Force Delete"
      );
      if (!choice) return;
      const flag = choice === "Force Delete" ? "-D" : "-d";
      try {
        await new Promise<void>((resolve, reject) => {
          execFile("git", ["branch", flag, branchName], { cwd: workspaceCwd },
            (err, _stdout, stderr) => {
              if (err) return reject(new Error(stderr || err.message));
              resolve();
            });
        });
        vscode.window.showInformationMessage(`Deleted branch: ${branchName}`);
        await refreshGraph();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Delete failed: ${msg}`);
      }
    }
  );

  const createBranchCmd = vscode.commands.registerCommand(
    "boomergit.createBranch",
    async (commitHash: string) => {
      if (!workspaceCwd) return;
      const name = await vscode.window.showInputBox({
        prompt: "New branch name",
        placeHolder: "feature/my-branch",
      });
      if (!name) return;
      try {
        await new Promise<void>((resolve, reject) => {
          execFile("git", ["branch", name, commitHash], { cwd: workspaceCwd },
            (err, _stdout, stderr) => {
              if (err) return reject(new Error(stderr || err.message));
              resolve();
            });
        });
        vscode.window.showInformationMessage(`Created branch: ${name}`);
        await refreshGraph();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Create branch failed: ${msg}`);
      }
    }
  );

  const copyTextCmd = vscode.commands.registerCommand(
    "boomergit.copyText",
    async (text: string, message: string) => {
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage(message);
    }
  );

  const openFileDiffCmd = vscode.commands.registerCommand(
    "boomergit.openFileDiff",
    async (file: ChangedFile, commitHash: string, parentHash: string, cwd: string) => {
      const leftRef = (file.status === "A" || !parentHash) ? "empty" : parentHash;
      const rightRef = file.status === "D" ? "empty" : commitHash;
      const leftPath = file.oldPath ?? file.path;
      const rightPath = file.path;

      const leftLabel = leftRef === "empty" ? "New File" : `Parent ${parentHash.slice(0, 8)}`;
      const rightLabel = rightRef === "empty" ? "Deleted" : `Commit ${commitHash.slice(0, 8)}`;

      const leftUri = fileUri(leftPath, leftRef, cwd, leftLabel);
      const rightUri = fileUri(rightPath, rightRef, cwd, rightLabel);

      const basename = rightPath.split("/").pop() || rightPath;
      const title = `${basename} (${leftLabel} ↔ ${rightLabel})`;

      const groups = vscode.window.tabGroups.all;
      if (groups.length >= 2) {
        // Bottom group already exists — open directly in it
        await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title, {
          viewColumn: groups[1].viewColumn,
          preview: false,
        });
      } else {
        // First diff — open then split below
        await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title, {
          preview: false,
        });
        await vscode.commands.executeCommand("workbench.action.moveEditorToBelowGroup");
      }
    }
  );

  const showGraphCmd = vscode.commands.registerCommand(
    "boomergit.showGraph",
    async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(`${DISPLAY_NAME}: No workspace folder open.`);
        return;
      }
      workspaceCwd = workspaceFolder.uri.fsPath;
      await refreshGraph();
    }
  );

  // Manual refresh (editor-title button) — keep the user's selection & scroll.
  const refreshCmd = vscode.commands.registerCommand(
    "boomergit.refresh",
    () => refreshGraph({ preserveView: true })
  );

  const toggleAutoRefreshCmd = vscode.commands.registerCommand(
    "boomergit.toggleAutoRefresh",
    async () => {
      autoRefreshEnabled = !autoRefreshEnabled;
      await vscode.workspace.getConfiguration("boomergit")
        .update("autoRefresh", autoRefreshEnabled, vscode.ConfigurationTarget.Global);
      updateStatusBar();
      vscode.window.setStatusBarMessage(`BoomerGit auto-refresh ${autoRefreshEnabled ? "on" : "off"}`, 2000);
    }
  );

  // Keep runtime state in sync if the setting is changed elsewhere.
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("boomergit.autoRefresh")) {
      autoRefreshEnabled = vscode.workspace.getConfiguration("boomergit").get<boolean>("autoRefresh", false);
      updateStatusBar();
    }
  });

  // Change-driven auto-refresh: watch .git for ref/HEAD changes (objects are
  // excluded by VS Code's default watcher excludes). Debounced; only when the
  // graph is open and auto-refresh is enabled.
  let gitWatcher: vscode.FileSystemWatcher | undefined;
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder) {
    gitWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(wsFolder, ".git/**")
    );
    const relevant = /\/(HEAD|ORIG_HEAD|packed-refs)$|\/refs\//;
    const onGitChange = (changed: vscode.Uri) => {
      if (!autoRefreshEnabled || !isGraphEditorOpen()) return;
      if (!relevant.test(changed.path)) return;
      if (refreshDebounce) clearTimeout(refreshDebounce);
      refreshDebounce = setTimeout(() => refreshGraph({ preserveView: true }), 600);
    };
    gitWatcher.onDidChange(onGitChange);
    gitWatcher.onDidCreate(onGitChange);
    gitWatcher.onDidDelete(onGitChange);
  }

  const selectUpCmd = vscode.commands.registerCommand("boomergit.selectUp", () => {
    if (!decorationEngine) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== SCHEME) return;
    const selected = decorationEngine.getSelectedRows();
    if (selected.length !== 1) return;
    const targetLine = Math.max(0, selected[0] - 1);
    decorationEngine.navigateTo(editor, targetLine);
    const commit = decorationEngine.getCommitAt(targetLine);
    if (commit) showSidebar(commit);
    ignoreSelectionUntil = Date.now() + 200;
    editor.selection = new vscode.Selection(targetLine, 0, targetLine, 0);
    editor.revealRange(new vscode.Range(targetLine, 0, targetLine, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  });

  const selectDownCmd = vscode.commands.registerCommand("boomergit.selectDown", () => {
    if (!decorationEngine) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== SCHEME) return;
    const selected = decorationEngine.getSelectedRows();
    if (selected.length !== 1) return;
    const maxLine = decorationEngine.getTotalRows() - 1;
    const targetLine = Math.min(maxLine, selected[0] + 1);
    decorationEngine.navigateTo(editor, targetLine);
    const commit = decorationEngine.getCommitAt(targetLine);
    if (commit) showSidebar(commit);
    ignoreSelectionUntil = Date.now() + 200;
    editor.selection = new vscode.Selection(targetLine, 0, targetLine, 0);
    editor.revealRange(new vscode.Range(targetLine, 0, targetLine, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  });

  context.subscriptions.push(
    providerReg, fileProviderReg, sidebarView, showGraphCmd, checkoutRefCmd, deleteBranchCmd, createBranchCmd, copyTextCmd, hoverProvider, selectionWatcher,
    commitInfoReg, changedFilesView, selectUpCmd, selectDownCmd, openFileDiffCmd, visibleEditorsWatcher, tabCloseWatcher,
    refreshCmd, toggleAutoRefreshCmd, configWatcher, statusBar,
    ...(gitWatcher ? [gitWatcher] : []),
    { dispose: () => { if (refreshDebounce) clearTimeout(refreshDebounce); decorationEngine?.dispose(); } },
  );
}

export function deactivate() {
  vscode.commands.executeCommand("setContext", "boomergit:graphOpen", false);
}
