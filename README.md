# BoomerGit

**Old man shakes stick at crap git integrations.**

BoomerGit is a VS Code extension for native git graph visualization. No webviews. No bloat. No nonsense. Just a clean, fast git graph rendered entirely with native VS Code APIs.

## Why?

Every git graph extension out there uses a webview. That means a mini browser running inside your editor, eating memory, breaking theme consistency, and adding latency to something that should be instant. You click a branch and wait for a web page to render. In 2026. To look at a list of commits.

BoomerGit takes a different approach: the entire graph is rendered using VS Code's native text editor decorations. SVG tiles for the graph lines, CSS-injected badges for refs, and a virtual document that behaves like a first-class editor tab. It loads fast, scrolls smooth, and doesn't fight with your theme.

The philosophy is simple: git graph visualization is a solved problem. The hard part is doing it without dragging in a web runtime. BoomerGit proves you don't need one.

## Features

### Graph Visualization
- Lane-based commit graph with fork and merge curves
- 12-color cycling palette for distinct branch visualization
- SVG tiles rendered per-row with pixel-perfect alignment to VS Code's line height
- Handles merge commits, multiple parents, and complex branch topologies

### Ref Badges
- Inline colored badges for branches, tags, remotes, and HEAD
- Color-matched to the commit's graph lane
- Auto-contrast text (white on dark, black on light backgrounds)

### Interactive Menus
- Click any row to select it and open an action menu
- Click a badge for ref-specific actions (checkout, delete, copy)
- Cmd-click (Mac) / Ctrl-click (Windows) to multi-select up to 2 rows for comparison
- Click away to dismiss — no sticky popups cluttering the view

### Git Operations
- **Checkout branch** — local and remote branches, right from the graph
- **Create branch** — from any commit in the history
- **Delete branch** — with safe delete and force delete options, prevents deleting the current branch
- **Copy to clipboard** — commit hash, ref name, or commit message

### Visual Polish
- Active branch row highlighted with bold white background
- Badge hover highlight with red outline
- Auto-refresh after git operations (checkout, create, delete)
- No cursor, no text highlighting, no minimap — the editor chrome is stripped away so it feels like a purpose-built tool, not a text file

## How It Works

BoomerGit uses four layers to turn `git log` output into a visual graph:

1. **Git Parser** — Runs `git log --all --topo-order` and parses the output into structured commit objects with refs, parents, timestamps, and metadata.

2. **Graph Layout** — A lane allocation algorithm assigns each branch to a vertical column. Forks diverge to new lanes, merges converge, and lanes are reused when branches terminate. The output is a set of segments (lines) and commit positions per row.

3. **SVG Tile Renderer** — Each row's segments are rendered as an SVG file with Bezier curves for merges/forks and straight lines for pass-throughs. Tiles are cached by content hash so identical rows share a single file.

4. **Decoration Engine** — VS Code's `TextEditorDecorationType` API places each SVG tile as a `before` pseudo-element on the corresponding line. Text decorations handle badge colors, hash highlighting, author/date styling, row selection, and the active branch indicator.

The virtual document is provided via `TextDocumentContentProvider` with a custom URI scheme (`boomergit:`). Language-scoped configuration defaults disable the context menu, minimap, cursor, text highlighting, and scroll-past-end — making the editor behave like a custom UI rather than a text file.

## Installation

### From Source

```bash
git clone git@github.com:antimatter-studios/boomergit.git
cd boomergit
npm install
npm run build
```

Then press `F5` in VS Code to launch the extension in a development host.

### Usage

1. Open a workspace that contains a git repository
2. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run **BoomerGit: Show Graph**

## Requirements

- VS Code 1.85.0 or later
- Git installed and available on PATH

## License

MIT
