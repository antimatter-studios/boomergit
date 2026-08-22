import * as vscode from "vscode";
import { parseGitLog } from "./git/parser.js";
import { gitRun, gitQuery, gitQueryTrimmed } from "./git/exec.js";
import { localBranchName } from "./git/types.js";
import { TIMING } from "./ui/timings.js";
import { COLOR } from "./ui/theme.js";
import { buildBadgeMenu, buildRowMenu, type BadgeMenuContext } from "./ui/menus.js";
import { resolveClickIntent } from "./ui/clickIntent.js";
import { computeDiffTarget } from "./ui/diffTarget.js";
import type { GraphRow } from "./graph/types.js";
import { computeGraphLayout } from "./graph/layout.js";
import { GitGraphProvider } from "./providers/gitGraphProvider.js";
import type { Commit } from "./git/types.js";
import { GraphDecorationEngine, findActiveLine } from "./decorations/graphDecorations.js";
import { CommitInfoProvider } from "./providers/commitInfoProvider.js";
import { ChangedFilesProvider } from "./providers/changedFilesProvider.js";
import type { ChangedFile } from "./providers/changedFilesProvider.js";
import { GitFileContentProvider, FILE_SCHEME, fileUri } from "./providers/gitFileContentProvider.js";
import { WorktreesProvider } from "./providers/worktreesProvider.js";
import {
  listWorktrees,
  resolveWorktreePath,
  worktreeHolding,
  worktreeLabel,
  type Worktree,
  type WorktreeLocation,
} from "./git/worktrees.js";

const SCHEME = "boomergit";
const DISPLAY_NAME = "BoomerGit";
const TITLE = `${DISPLAY_NAME} - Git Graph`;

/** Status bar priority — higher sits further left among right-aligned items. */
const STATUS_BAR_PRIORITY = 100;

/**
 * Hang a synthetic `worktree` ref on every commit another working tree has
 * checked out.
 *
 * `git log` cannot report this — nothing in its decorations says a branch is
 * checked out elsewhere — so worktrees arrive as a separate query and are
 * joined onto the graph here, by commit hash. Presenting them as refs means the
 * badge rendering, hit testing and menus all carry them without knowing.
 *
 * The current worktree is skipped: its row already gets the inverted
 * active-branch treatment, and a second marker saying "you are here" is noise.
 * The bare parent of a worktree set has no working tree, so it is skipped too.
 */
function attachWorktreeRefs(commits: Commit[], worktrees: Worktree[]): void {
  const byHash = new Map<string, Worktree[]>();
  for (const worktree of worktrees) {
    if (worktree.isCurrent || worktree.bare || !worktree.head) continue;
    const existing = byHash.get(worktree.head) ?? [];
    existing.push(worktree);
    byHash.set(worktree.head, existing);
  }
  if (byHash.size === 0) return;

  for (const commit of commits) {
    for (const worktree of byHash.get(commit.hash) ?? []) {
      commit.refs.push({ name: worktreeLabel(worktree), type: "worktree" });
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const graphProvider = new GitGraphProvider();
  const storageDir = context.globalStorageUri.fsPath;

  // Set hover widget border for our menus
  const wbConfig = vscode.workspace.getConfiguration("workbench");
  const colors = wbConfig.get<Record<string, string>>("colorCustomizations") ?? {};
  const hoverColors: Record<string, string> = {
    "editorHoverWidget.border": COLOR.hoverWidgetBorder,
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

  const worktreesProvider = new WorktreesProvider();
  const worktreesView = vscode.window.createTreeView("boomergit.worktrees", {
    treeDataProvider: worktreesProvider,
  });

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
  worktreesView.onDidChangeVisibility((e) => maybeReopenGraph(e.visible));

  let decorationEngine: GraphDecorationEngine | undefined;
  let workspaceCwd: string | undefined;
  let currentBranch: string | undefined;
  let lastRows: GraphRow[] | undefined;
  let lastCommits: Commit[] | undefined;
  let worktrees: Worktree[] = [];
  // Left-click → toggle hover menu; Cmd-click → select rows for compare
  let lastHoverKey: string | undefined;
  let hoverTriggeredByClick = false;
  // Timestamp-based ignore: avoids boolean flag races where a real click gets eaten
  let ignoreSelectionUntil = 0;

  // Refresh state: guard against overlapping refreshes; auto-refresh is opt-in.
  let refreshing = false;
  let autoRefreshTimer: ReturnType<typeof setInterval> | undefined;
  let lastRefSig: string | undefined;
  let autoRefreshEnabled = vscode.workspace.getConfiguration("boomergit").get<boolean>("autoRefresh", false);

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    STATUS_BAR_PRIORITY
  );
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
      ignoreSelectionUntil = Date.now() + TIMING.ignoreSelfSelectionMs;
      editor.selection = new vscode.Selection(pos.line, resetCol, pos.line, resetCol);
    };
    if (delayMs > 0) setTimeout(doReset, delayMs);
    else doReset();
  }

  /**
   * Open the click menu (a hover we trigger ourselves) on the clicked row.
   *
   * Deferred rather than immediate: the hover renders wherever the cursor is,
   * so asking for it before VS Code finishes handling the click puts the menu
   * on the previous row.
   */
  function openClickMenu(): void {
    setTimeout(() => {
      hoverTriggeredByClick = true;
      vscode.commands.executeCommand("editor.action.showHover");
    }, TIMING.openMenuMs);
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
      ignoreSelectionUntil = Date.now() + TIMING.ignoreSelfSelectionMs;
      e.textEditor.selection = new vscode.Selection(pos, pos);
    }

    const commit = decorationEngine.getCommitAt(pos.line);
    if (!commit) return;

    const refHit = decorationEngine.getRefAt(pos);
    const intent = resolveClickIntent({
      isCmdClick,
      onBadge: !!refHit,
      hasSelections: decorationEngine.getSelectedRows().length > 0,
    });
    let showingMenu = false;

    if (intent === "badge-menu" && refHit) {
      // Title the sidebar after the badge, and toggle its menu: clicking the
      // same badge twice closes rather than reopens.
      decorationEngine.clearSelections();
      showSidebar(commit, refHit.ref.name);
      const key = `ref:${pos.line}:${refHit.ref.name}`;
      if (lastHoverKey === key) {
        lastHoverKey = undefined;
      } else {
        lastHoverKey = key;
        showingMenu = true;
        openClickMenu();
      }
    } else if (intent === "select-row") {
      lastHoverKey = undefined;
      decorationEngine.selectRow(e.textEditor, pos.line);
      showSidebar(commit);
      showingMenu = true;
      openClickMenu();
    } else {
      lastHoverKey = undefined;
      decorationEngine.clearSelections();
      commitInfoProvider.clear();
      changedFilesProvider.clear();
    }

    // Always reset cursor so the next click at the same spot still fires.
    // Delay when showing a menu so the hover appears at the right position first.
    if (!isCmdClick) {
      resetCursor(e.textEditor, pos, showingMenu ? TIMING.cursorResetWithMenuMs : 0);
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

        if (refHit) {
          md.appendMarkdown(buildBadgeMenu(refHit.ref, commit, menuContextFor(refHit.ref)));
          return new vscode.Hover(md, refHit.range);
        }
        md.appendMarkdown(buildRowMenu(commit));
        return new vscode.Hover(md, new vscode.Range(position.line, 0, position.line, 0));
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
    worktrees = [];
    worktreesProvider.clear();
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
      let prevSelectedHashes: string[] = [];
      let prevTopLine: number | undefined;
      if (opts.preserveView) {
        const sel = decorationEngine?.getSelectedRows() ?? [];
        if (lastCommits) {
          prevSelectedHashes = sel
            .map((l) => lastCommits![l]?.hash)
            .filter((h): h is string => !!h);
        }
        const ge = vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === SCHEME);
        prevTopLine = ge?.visibleRanges[0]?.start.line;
      }

      currentBranch = await gitQueryTrimmed(["rev-parse", "--abbrev-ref", "HEAD"], workspaceCwd);

      const [commits, allWorktrees] = await Promise.all([
        parseGitLog(workspaceCwd),
        listWorktrees(workspaceCwd),
      ]);
      if (commits.length === 0) return;

      worktrees = allWorktrees;
      worktreesProvider.setWorktrees(allWorktrees);
      attachWorktreeRefs(commits, allWorktrees);

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
        setTimeout(() => { sub.dispose(); resolve(); }, TIMING.documentUpdateMs);
      });

      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(doc, "boomergit");

      lastRows = rows;
      lastCommits = commits;
      decorationEngine?.dispose();
      decorationEngine = new GraphDecorationEngine(storageDir);

      // Get the graph editor WITHOUT stealing focus or pulling its tab to the
      // front. Only the initial open actively shows it. A refresh just
      // decorates it if it's already visible; if the user is on another tab,
      // the content + state are updated silently and the visible-editors
      // watcher re-applies decorations when they switch back — so a background
      // refresh never interrupts what they're doing.
      let editor: vscode.TextEditor | undefined;
      if (opts.preserveView) {
        editor = vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.toString() === uri.toString()
        );
      } else {
        editor = await vscode.window.showTextDocument(doc, {
          preview: false,
          viewColumn: vscode.ViewColumn.One,
        });
        vscode.commands.executeCommand("setContext", "boomergit:graphOpen", true);
      }

      if (editor) {
        decorationEngine.apply(editor, rows, commits, currentBranch);

        // Restore the previously selected commit(s) if they still exist
        // (up to the 2-row compare limit), otherwise auto-select the current
        // branch commit and show its details.
        let restored = false;
        if (opts.preserveView && prevSelectedHashes.length) {
          for (const hash of prevSelectedHashes) {
            const idx = commits.findIndex((c) => c.hash === hash);
            if (idx >= 0) decorationEngine.selectRow(editor, idx);
          }
          const sel = decorationEngine.getSelectedRows();
          if (sel.length) {
            showSidebar(commits[sel[0]]);
            restored = true;
          }
        }
        if (!restored && currentBranch) {
          // Same predicate the decoration engine paints with, so the selected
          // row and the highlighted row can't drift apart.
          const idx = findActiveLine(commits, currentBranch);
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
      }

      updateStatusBar();
      // Align the baseline with what's now rendered BEFORE the finally releases
      // the `refreshing` guard — otherwise a git event firing in that gap could
      // compare against the stale pre-refresh signature and fire a redundant
      // refresh.
      const sig = await getRefSignature();
      if (sig) lastRefSig = sig;
    } catch { /* silently fail on refresh */ }
    finally { refreshing = false; }
  }

  /**
   * Run a git command that changes the repository, then refresh the graph.
   *
   * Every repository-mutating command shares this shape: the user gets a
   * confirmation on success, or git's own message on failure, and either way
   * the graph ends up reflecting reality.
   */
  async function runGitAction(
    args: string[],
    successMessage: string,
    failurePrefix: string
  ): Promise<void> {
    if (!workspaceCwd) return;
    try {
      await gitRun(args, workspaceCwd);
      vscode.window.showInformationMessage(successMessage);
      await refreshGraph();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`${failurePrefix}: ${msg}`);
    }
  }

  const checkoutRefCmd = vscode.commands.registerCommand(
    "boomergit.checkoutRef",
    async (name: string, type: string) => {
      const branchName = type === "remote" ? localBranchName(name) : name;
      await runGitAction(["checkout", branchName], `Checked out: ${branchName}`, "Checkout failed");
    }
  );

  const deleteBranchCmd = vscode.commands.registerCommand(
    "boomergit.deleteBranch",
    async (branchName: string) => {
      // Before the prompt, not after: runGitAction's own guard would let the
      // user answer a modal and then do nothing, with no message either way.
      if (!workspaceCwd) return;
      const choice = await vscode.window.showWarningMessage(
        `Delete branch "${branchName}"?`,
        { modal: true, detail: "Use 'Force Delete' if the branch is not fully merged." },
        "Delete", "Force Delete"
      );
      if (!choice) return;
      const flag = choice === "Force Delete" ? "-D" : "-d";
      await runGitAction(
        ["branch", flag, branchName],
        `Deleted branch: ${branchName}`,
        "Delete failed"
      );
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
      await runGitAction(
        ["branch", name, commitHash],
        `Created branch: ${name}`,
        "Create branch failed"
      );
    }
  );

  /**
   * What a badge's menu needs to know about the ref it belongs to.
   *
   * A remote ref is resolved to the local branch a checkout or worktree would
   * actually create, since that is the name git refuses to use twice.
   */
  function menuContextFor(ref: { name: string; type: string }): BadgeMenuContext {
    if (ref.type !== "branch" && ref.type !== "remote") return { currentBranch };
    const branch = ref.type === "remote" ? localBranchName(ref.name) : ref.name;
    const holder = worktreeHolding(worktrees, branch);
    return {
      currentBranch,
      heldByWorktree: holder ? worktreeLabel(holder) : undefined,
      // git refuses a branch checked out anywhere, this tree included, so the
      // branch you are on can't get a worktree either.
      worktreeBlockedBy:
        branch === currentBranch
          ? "this worktree"
          : holder
            ? worktreeLabel(holder)
            : undefined,
    };
  }

  /** Where new worktrees go, from settings. */
  function worktreePlacement(repoPath: string) {
    const config = vscode.workspace.getConfiguration("boomergit");
    return {
      location: config.get<WorktreeLocation>("worktrees.location", "sibling"),
      customPath: config.get<string>("worktrees.customPath", ""),
      repoPath,
    };
  }

  const createWorktreeCmd = vscode.commands.registerCommand(
    "boomergit.createWorktree",
    async (refName: string, refType: string) => {
      if (!workspaceCwd) return;
      // A remote ref becomes a local branch tracking it; `worktree add` with a
      // remote ref alone would leave the new tree on a detached HEAD.
      const isRemote = refType === "remote";
      const branch = isRemote ? localBranchName(refName) : refName;
      const suggested = resolveWorktreePath(branch, worktreePlacement(workspaceCwd));

      // Always shown, never silent: a worktree creates a directory outside the
      // project, so the path is confirmed before anything touches the disk.
      const chosen = await vscode.window.showInputBox({
        title: `Create worktree for ${branch}`,
        prompt: "Directory for the new working tree",
        value: suggested,
        valueSelection: [suggested.lastIndexOf("/") + 1, suggested.length],
      });
      if (!chosen) return;

      const args = isRemote
        ? ["worktree", "add", "-b", branch, chosen, refName]
        : ["worktree", "add", chosen, refName];
      try {
        await gitRun(args, workspaceCwd);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Create worktree failed: ${msg}`);
        return;
      }

      await refreshGraph({ preserveView: true });
      const open = await vscode.window.showInformationMessage(
        `Worktree for ${branch} created at ${chosen}`,
        "Open in New Window"
      );
      if (open) {
        await vscode.commands.executeCommand(
          "vscode.openFolder",
          vscode.Uri.file(chosen),
          { forceNewWindow: true }
        );
      }
    }
  );

  /** Select and scroll to the row a worktree's HEAD sits on. */
  const revealWorktreeCmd = vscode.commands.registerCommand(
    "boomergit.revealWorktree",
    async (head: string) => {
      if (!decorationEngine || !lastCommits) return;
      const line = lastCommits.findIndex((c) => c.hash === head);
      if (line < 0) {
        vscode.window.showInformationMessage(
          `That worktree's commit isn't in the graph (${head.slice(0, 8)}).`
        );
        return;
      }
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.scheme === SCHEME
      );
      if (!editor) return;
      decorationEngine.navigateTo(editor, line);
      const commit = decorationEngine.getCommitAt(line);
      if (commit) showSidebar(commit);
      editor.revealRange(
        new vscode.Range(line, 0, line, 0),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
      );
    }
  );

  const openWorktreeCmd = vscode.commands.registerCommand(
    "boomergit.openWorktree",
    async (item?: { worktree?: Worktree }) => {
      const worktree = item?.worktree;
      if (!worktree) return;
      // A new window, because the graph is built around a single root folder.
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(worktree.path),
        { forceNewWindow: true }
      );
    }
  );

  const copyWorktreePathCmd = vscode.commands.registerCommand(
    "boomergit.copyWorktreePath",
    async (item?: { worktree?: Worktree }) => {
      const path = item?.worktree?.path;
      if (!path) return;
      await vscode.env.clipboard.writeText(path);
      vscode.window.showInformationMessage(`Copied: ${path}`);
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
      const target = computeDiffTarget(file, commitHash, parentHash);
      const leftUri = fileUri(target.leftPath, target.leftRef, cwd, target.leftLabel);
      const rightUri = fileUri(target.rightPath, target.rightRef, cwd, target.rightLabel);
      const title = target.title;

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
      vscode.window.setStatusBarMessage(
        `BoomerGit auto-refresh ${autoRefreshEnabled ? "on" : "off"}`,
        TIMING.toastMs
      );
    }
  );

  // Keep runtime state in sync if the setting is changed elsewhere.
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("boomergit.autoRefresh")) {
      autoRefreshEnabled = vscode.workspace.getConfiguration("boomergit").get<boolean>("autoRefresh", false);
      updateStatusBar();
    }
  });

  // A cheap signature of all ref OIDs + HEAD. Refs cover commits/rebase/fetch/
  // merge/branch+tag ops; HEAD covers checkout. Used to dedupe refresh triggers
  // so we only do the real (expensive) refresh when refs actually moved.
  async function getRefSignature(): Promise<string> {
    if (!workspaceCwd) return "";
    const cwd = workspaceCwd;
    // Worktrees are in the signature because their HEADs are per-worktree and
    // appear in neither for-each-ref nor our own rev-parse — without this, a
    // checkout in another worktree would never refresh the graph or the list.
    const [refs, head, trees] = await Promise.all([
      gitQuery(["for-each-ref", "--format=%(objectname) %(refname)"], cwd),
      gitQuery(["rev-parse", "HEAD"], cwd),
      gitQuery(["worktree", "list", "--porcelain"], cwd),
    ]);
    return refs + head + trees;
  }

  async function maybeAutoRefresh(): Promise<void> {
    if (!autoRefreshEnabled || !isGraphEditorOpen() || refreshing) return;
    const sig = await getRefSignature();
    if (!sig) return;
    if (lastRefSig === undefined) { lastRefSig = sig; return; } // establish baseline
    if (sig !== lastRefSig) {
      lastRefSig = sig;
      refreshGraph({ preserveView: true });
    }
  }

  // Change-driven auto-refresh trigger. Prefer the built-in Git extension's
  // change event (event-driven and reliable cross-platform — it does the .git
  // watching for us; VS Code's own FileSystemWatcher does not fire for .git).
  // Its event also fires on working-tree/index edits, so maybeAutoRefresh()
  // dedupes via the ref signature. Fall back to a light poll only if that
  // extension is unavailable.
  let gitStateSub: vscode.Disposable | undefined;
  let openRepoSub: vscode.Disposable | undefined;
  async function setupGitEventTrigger(): Promise<boolean> {
    try {
      const ext = vscode.extensions.getExtension<any>("vscode.git");
      if (!ext) return false;
      const git = ext.isActive ? ext.exports : await ext.activate();
      const api = git.getAPI(1);
      const mine = () =>
        api.repositories.find((r: any) => r.rootUri?.fsPath === workspaceCwd) ?? api.repositories[0];
      const hook = (repo: any) => {
        if (gitStateSub || !repo) return;
        gitStateSub = repo.state.onDidChange(() => { void maybeAutoRefresh(); });
      };
      hook(mine());
      openRepoSub = api.onDidOpenRepository(() => hook(mine())); // repos may load after activation
      return true;
    } catch {
      return false;
    }
  }

  void setupGitEventTrigger().then((ok) => {
    if (ok) return;
    autoRefreshTimer = setInterval(() => { void maybeAutoRefresh(); }, TIMING.refreshPollMs);
  });

  /**
   * Move the single-row selection by one row and follow it with the sidebar.
   *
   * Only acts on a single selection: with two rows picked for compare, the
   * arrow keys would have no obvious row to move.
   */
  function moveSelection(delta: -1 | 1): void {
    if (!decorationEngine) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== SCHEME) return;
    const selected = decorationEngine.getSelectedRows();
    if (selected.length !== 1) return;

    const lastLine = decorationEngine.getTotalRows() - 1;
    // max() outermost, so an empty graph (lastLine === -1) can't yield -1
    const targetLine = Math.max(0, Math.min(lastLine, selected[0] + delta));
    decorationEngine.navigateTo(editor, targetLine);
    const commit = decorationEngine.getCommitAt(targetLine);
    if (commit) showSidebar(commit);

    ignoreSelectionUntil = Date.now() + TIMING.ignoreSelfSelectionMs;
    editor.selection = new vscode.Selection(targetLine, 0, targetLine, 0);
    editor.revealRange(
      new vscode.Range(targetLine, 0, targetLine, 0),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
  }

  const selectUpCmd = vscode.commands.registerCommand("boomergit.selectUp", () =>
    moveSelection(-1)
  );
  const selectDownCmd = vscode.commands.registerCommand("boomergit.selectDown", () =>
    moveSelection(1)
  );

  context.subscriptions.push(
    providerReg, fileProviderReg, sidebarView, showGraphCmd, checkoutRefCmd, deleteBranchCmd, createBranchCmd, copyTextCmd, hoverProvider, selectionWatcher,
    commitInfoReg, changedFilesView, worktreesView, selectUpCmd, selectDownCmd, openFileDiffCmd, visibleEditorsWatcher, tabCloseWatcher,
    refreshCmd, toggleAutoRefreshCmd, configWatcher, statusBar,
    revealWorktreeCmd, openWorktreeCmd, copyWorktreePathCmd, createWorktreeCmd,
    { dispose: () => { if (autoRefreshTimer) clearInterval(autoRefreshTimer); gitStateSub?.dispose(); openRepoSub?.dispose(); decorationEngine?.dispose(); } },
  );
}

export function deactivate() {
  vscode.commands.executeCommand("setContext", "boomergit:graphOpen", false);
}
