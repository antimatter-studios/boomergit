import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { parseGitLog } from "./git/parser.js";
import { computeGraphLayout } from "./graph/layout.js";
import { GitGraphProvider } from "./providers/gitGraphProvider.js";
import { GraphDecorationEngine } from "./decorations/graphDecorations.js";

const SCHEME = "boomergit";

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

  const providerReg = vscode.workspace.registerTextDocumentContentProvider(
    SCHEME,
    graphProvider
  );

  let decorationEngine: GraphDecorationEngine | undefined;
  let workspaceCwd: string | undefined;
  let currentBranch: string | undefined;
  // Left-click → toggle hover menu; Cmd-click → select rows for compare
  let lastHoverKey: string | undefined;
  let hoverTriggeredByClick = false;
  let ignoreNextSelection = false;
  const selectionWatcher = vscode.window.onDidChangeTextEditorSelection((e) => {
    if (e.textEditor.document.uri.scheme !== SCHEME || !decorationEngine) return;
    if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;

    // Ignore events we fire when resetting cursor position
    if (ignoreNextSelection) {
      ignoreNextSelection = false;
      return;
    }

    const isCmdClick = e.selections.length > 1;
    const pos = isCmdClick
      ? e.selections[e.selections.length - 1].active
      : e.selections[0].active;

    // Collapse multi-cursors back to single cursor
    if (isCmdClick) {
      ignoreNextSelection = true;
      e.textEditor.selection = new vscode.Selection(pos, pos);
    }

    const commit = decorationEngine.getCommitAt(pos.line);
    if (!commit) return;

    const refHit = decorationEngine.getRefAt(pos);
    const hasSelections = decorationEngine.getSelectedRows().length > 0;
    let showingMenu = false;

    if (refHit && !isCmdClick) {
      // Badge click: clear selections, show badge menu
      decorationEngine.clearSelections(e.textEditor);
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
      showingMenu = true;
      setTimeout(() => {
        hoverTriggeredByClick = true;
        vscode.commands.executeCommand("editor.action.showHover");
      }, 50);
    } else if (hasSelections) {
      // Plain click while rows are selected → dismiss everything
      lastHoverKey = undefined;
      decorationEngine.clearSelections(e.textEditor);
    } else {
      // Plain click, nothing selected → select row and open menu
      lastHoverKey = undefined;
      decorationEngine.selectRow(e.textEditor, pos.line);
      showingMenu = true;
      setTimeout(() => {
        hoverTriggeredByClick = true;
        vscode.commands.executeCommand("editor.action.showHover");
      }, 50);
    }

    // Reset cursor so next click anywhere registers — skip when showing menu
    if (!isCmdClick && !showingMenu) {
      const lineLen = e.textEditor.document.lineAt(pos.line).text.length;
      const resetCol = pos.character === 0 ? lineLen : 0;
      ignoreNextSelection = true;
      e.textEditor.selection = new vscode.Selection(pos.line, resetCol, pos.line, resetCol);
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

  /** Re-read git log and refresh the graph view */
  async function refreshGraph() {
    if (!workspaceCwd) return;
    try {
      currentBranch = await new Promise<string>((resolve) => {
        execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: workspaceCwd },
          (err, stdout) => resolve(err ? "" : stdout.trim()));
      });

      const commits = await parseGitLog(workspaceCwd);
      if (commits.length === 0) return;

      const rows = computeGraphLayout(commits);

      const uri = vscode.Uri.parse(`${SCHEME}:Git Graph`);
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
      });

      decorationEngine?.dispose();
      decorationEngine = new GraphDecorationEngine(storageDir);
      decorationEngine.apply(editor, rows, commits, currentBranch);
    } catch { /* silently fail on refresh */ }
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

  const showGraphCmd = vscode.commands.registerCommand(
    "boomergit.showGraph",
    async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("BoomerGit: No workspace folder open.");
        return;
      }
      workspaceCwd = workspaceFolder.uri.fsPath;
      await refreshGraph();
    }
  );

  context.subscriptions.push(
    providerReg, showGraphCmd, checkoutRefCmd, deleteBranchCmd, createBranchCmd, copyTextCmd, hoverProvider, selectionWatcher,
    { dispose: () => decorationEngine?.dispose() },
  );
}

export function deactivate() {}
