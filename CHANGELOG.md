# Changelog

All notable changes to BoomerGit are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries you add under **[Unreleased]** are promoted into a versioned section by
`npm run release:*`, and the release pipeline uses that section as the GitHub
Release notes.

## [Unreleased]

### Added
- **Ref badges now say what kind of ref they are.** Every badge leads with a
  white box holding a bold capital: **B** branch, **R** remote-tracking,
  **T** tag, **H** HEAD, **S** stash, **N** notes, **P** pull or merge request,
  and **?** for anything else — bisect, replace, filter-branch backups. The name
  half keeps its commit's lane colour, so a badge reads as one two-tone pill.
  The same badges appear in the Commit Info sidebar.
- **More of your refs are visible.** Stashes, notes and pull-request refs
  (GitHub, GitLab, Bitbucket and Gerrit) are now labelled in the graph. A notes
  commit previously appeared as an unexplained row carrying no badge at all.

### Fixed
- A ref name longer than about 50 characters rendered as **two** badges, the
  second holding the overflow — `…premature-activatio` followed by a stray `n`,
  or a badge with nothing in it. Long names now show in full, in one badge.
- Local branches with a `/` in the name (`fix/my-thing`) were treated as
  remote-tracking branches, so their badge menu offered the wrong Checkout and
  no Delete Branch at all.
- The `origin/HEAD` badge offered "Checkout Branch", which did nothing while
  still reporting success. A remote's symbolic HEAD is no longer offered.
- Files whose names contain non-ASCII or special characters (`café.txt`) showed
  in Changed Files under a mangled name, and opening their diff gave two blank
  panes with no explanation.
- A failure listing a commit's changed files was indistinguishable from a commit
  that changed nothing. It now says "Failed to list changed files" and shows
  git's own message.
- With no folder open, Delete Branch asked for confirmation and Create Branch
  asked for a name, then both silently did nothing.
- Debug logging was left in the released build — one line fired on every commit
  click and dumped git output into the extension host log.

### Changed
- Internals only, no change to how the extension behaves: git invocation is
  centralised in one module, interaction timings and colours are named
  constants, and click handling, menu building and diff selection are now
  separate modules. Test coverage went from 18.7% to 98.8% of lines
  (36 → 293 tests), with a 70% per-file floor enforced in CI. The full account
  is in `docs/human-code-report-2026-08-22.md`.
- The packaged extension no longer carries a stray test config or coverage
  output.

## [0.3.2] - 2026-06-22

### Fixed
- Row-compare selection no longer leaks: a refresh previously orphaned the red selection highlights and `[n]` markers (their decorations were never disposed), so they piled up on more than two rows across refreshes. The decoration engine now disposes selection + hover decorations on teardown, and a refresh preserves both selected compare rows.

## [0.3.1] - 2026-06-18

### Fixed
- Auto-refresh now reliably detects external git changes (commits, rebases, fetches done in a terminal). It previously relied on a `.git` file watcher that VS Code doesn't fire for; it now listens to the built-in Git extension's change event (falling back to a light poll if that extension is unavailable) and refreshes only when refs actually move.
- A refresh no longer pulls the graph tab to the foreground or interrupts what you're doing. It updates the graph in place when it's visible, and silently when it's a background tab (re-decorating when you switch back).

## [0.3.0] - 2026-06-18

### Added
- Refresh button in the graph editor's title bar that re-reads the log while keeping the selected commit and scroll position.
- Opt-in auto-refresh (`boomergit.autoRefresh`, default off) that updates the graph when the repository's refs change, toggled from the status bar.

## [0.2.1] - 2026-06-18

### Added
- CI/CD pipeline (build → test → release) via GitHub Actions; the release stage
  publishes to the VS Code Marketplace and Open VSX on `v*` tags and creates a
  GitHub Release with the packaged VSIX attached.
- Unit tests (Vitest) covering the pure git-log parsing and graph-layout functions.

### Fixed
- The git graph can be reopened from the sidebar icon after its editor tab is closed.

## [0.2.0] - 2026-03-01

### Added
- File diff viewer for the changed files in a commit.
- Sidebar activity-bar icon; the current commit is auto-selected on open.

## [0.1.0] - 2026-03-01

### Added
- Commit detail sidebar shown when a commit is clicked.
- More responsive row selection.

## [0.0.1] - 2026-02-26

### Added
- Initial release — native git graph visualization with no webview.
