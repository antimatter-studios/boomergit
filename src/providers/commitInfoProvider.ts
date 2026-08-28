import * as vscode from "vscode";
import { gitQueryTrimmed } from "../git/exec.js";
import { REF_HINT, REF_LABEL, REF_SIGIL, SIGIL_CHARS, type Commit, type RefType } from "../git/types.js";
import { COLOR, REF_BADGE_COLOR } from "../ui/theme.js";

/**
 * Line height shared by both halves of a ref badge. Named rather than inlined
 * twice: the two halves are only the same height while it is the same number.
 */
const BADGE_LINE_HEIGHT = 1.5;

/** Escape text for interpolation into the webview's HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A ref badge, in the same two-tone form the graph uses: a white box holding
 * the type sigil, then the ref name on a colour picked by type.
 *
 * The `title` says what the type is and what it means, matching the graph's
 * own badge tooltip — "Remote" alone left the sigil as cryptic as it found it.
 */
function badgeHtml(name: string, type: RefType): string {
  const tip = escapeHtml(`${REF_LABEL[type]} — ${REF_HINT[type]}`);
  // Both halves are laid out identically, because they have to end up the same
  // height. An inline-block box takes the whole line-height while a plain
  // inline one takes only the font's content area, so giving the sigil a
  // min-width (and nothing else) made it visibly taller than the name beside
  // it. Same display, same vertical padding, same line-height, and
  // vertical-align so neither sits on a different baseline.
  const half =
    `display:inline-block;vertical-align:middle;line-height:${BADGE_LINE_HEIGHT};padding:1px 6px;`;
  return (
    `<span style="font-size:0.85em;font-weight:bold;margin-right:4px;white-space:nowrap;" title="${tip}">` +
    // The sigil field is a fixed width rather than padding: HTML collapses the
    // trailing space the graph's text badges rely on to align `T` with `RB`.
    `<span style="${half}text-align:center;min-width:${SIGIL_CHARS}ch;background:${COLOR.sigilBackground};color:${COLOR.sigilText};border-radius:3px 0 0 3px;">${REF_SIGIL[type]}</span>` +
    `<span style="${half}background:${REF_BADGE_COLOR[type]};color:${COLOR.badgeTextOnLight};border-radius:0 3px 3px 0;">${escapeHtml(name)}</span>` +
    `</span>`
  );
}

const STYLES = `
  body { padding: 8px 12px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); font-size: var(--vscode-font-size); line-height: 1.5; }
  .title { font-size: 1.3em; font-weight: bold; margin-bottom: 2px; }
  .title-label { color: var(--vscode-descriptionForeground); font-weight: normal; font-size: 0.8em; }
  .badges { line-height: 2; margin-bottom: 8px; }
  .row { margin-bottom: 4px; }
  .label { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .value { word-break: break-all; }
  .message { white-space: pre-wrap; word-wrap: break-word; margin-top: 8px; padding: 8px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); border-radius: 2px; }
  hr { border: none; border-top: 1px solid var(--vscode-widget-border); margin: 10px 0; }
`;

/**
 * Which ref a commit's detail panel should be titled after, when the user
 * selected the row rather than a specific badge.
 *
 * Local branches first: that's the name the user thinks of the commit by.
 * HEAD is never a useful title — it names the cursor, not the thing.
 */
export function titleRef(commit: Commit): { name: string; type: RefType } | undefined {
  const preferred =
    commit.refs.find((r) => r.type === "branch") ??
    commit.refs.find((r) => r.type === "remote") ??
    commit.refs.find((r) => r.type === "tag");
  return preferred ? { name: preferred.name, type: preferred.type } : undefined;
}

export class CommitInfoProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private commit: Commit | undefined;
  private activeRefName: string | undefined;
  private activeRefType: RefType | undefined;
  private fullMessage = "";
  private fetchSeq = 0;

  constructor(private onDidBecomeVisible?: () => void) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: false };
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.onDidBecomeVisible?.();
    });
    this.render();
  }

  async showCommit(commit: Commit, cwd: string, activeRefName?: string): Promise<void> {
    // Sequence number so a slow fetch can't overwrite a newer selection.
    const seq = ++this.fetchSeq;
    this.commit = commit;
    this.fullMessage = commit.subject;

    if (activeRefName) {
      this.activeRefName = activeRefName;
      this.activeRefType = commit.refs.find((r) => r.name === activeRefName)?.type;
    } else {
      const preferred = titleRef(commit);
      this.activeRefName = preferred?.name;
      this.activeRefType = preferred?.type;
    }
    // Render immediately with the subject, then again with the full body.
    this.render();

    const message = await gitQueryTrimmed(["show", "-s", "--format=%B", commit.hash], cwd);
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
      this.view.webview.html = this.emptyHtml();
      this.view.title = "Commit Info";
      return;
    }

    const c = this.commit;
    this.view.title = this.activeRefName || "Commit Info";
    this.view.webview.html = this.commitHtml(c);
  }

  private emptyHtml(): string {
    return `<!DOCTYPE html><html><body style="padding:8px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);font-size:var(--vscode-font-size);">
        <p style="color:var(--vscode-descriptionForeground);">Click a commit to see details</p>
      </body></html>`;
  }

  private commitHtml(c: Commit): string {
    const date = new Date(c.timestamp * 1000).toLocaleString();
    const msgHtml = escapeHtml(this.fullMessage || c.subject);
    const titleLabel = this.activeRefType ? REF_LABEL[this.activeRefType] : "";

    // Every ref except the one in the title, and never HEAD — it names the
    // cursor rather than the commit, and the title already implies it.
    const badges = c.refs
      .filter((r) => r.name !== this.activeRefName && r.type !== "head")
      .map((r) => badgeHtml(r.name, r.type))
      .join("");

    return `<!DOCTYPE html>
<html>
<head><style>${STYLES}</style></head>
<body>
  ${this.activeRefName ? `<div class="title"><span class="title-label">${escapeHtml(titleLabel)}:</span> ${escapeHtml(this.activeRefName)}</div>` : ""}
  ${badges ? `<div class="badges">${badges}</div>` : ""}
  <div class="row"><span class="label">Hash </span><span class="value" style="color:${COLOR.commitHash};font-weight:bold;">${escapeHtml(c.hash)}</span></div>
  <div class="row"><span class="label">Author </span><span class="value">${escapeHtml(c.author)} &lt;${escapeHtml(c.email)}&gt;</span></div>
  <div class="row"><span class="label">Date </span><span class="value">${escapeHtml(date)}</span></div>
  <hr>
  <div class="message">${msgHtml}</div>
</body>
</html>`;
  }
}
