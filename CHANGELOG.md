# Changelog

All notable changes to BoomerGit are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries you add under **[Unreleased]** are promoted into a versioned section by
`npm run release:*`, and the release pipeline uses that section as the GitHub
Release notes.

## [Unreleased]

### Added
- Ref badges now carry a type sigil: a white box with a bold black capital at the head of each badge — **B** branch, **R** remote-tracking, **T** tag, **H** HEAD, **S** stash, **N** notes, **P** pull/merge-request ref, **?** anything else (bisect, replace, filter-branch backups, …). The name half of the badge keeps the commit's lane colour, so a badge now reads as one two-tone pill. Same badges in the Commit Info sidebar.
- Namespaces git hides by default are now decorated too (`--decorate-refs=refs/*`): notes, stash, PR refs from GitHub/GitLab/Bitbucket/Gerrit, and bisect/replace refs. Previously a notes commit showed up in the graph with no badge at all.

### Fixed
- Local branches with a `/` in the name (`chore/guard-refresh`) were classified as remote-tracking branches, so their badge menu offered no Delete Branch and the wrong Checkout. Ref classification now reads full ref paths (`--decorate=full`) instead of guessing from the slash.
- Two debug `console.log` calls were left in the release build. One fired on every commit click and dumped 300 characters of git output into the extension host log.
- A ref name longer than about 50 characters rendered as **two** badges, the second holding the overflow — `…premature-activatio` followed by a lone `n`, or a badge containing nothing at all. VS Code's line renderer splits any styled run over 50 characters into separate spans and applies the badge styling to each, so the rounded end, padding and margin were repeated mid-name. Full names are still shown in full; the pill is now assembled so that the part which can split carries only a background, while a one-character cap at each end owns the padding, the rounded end and the gap to the next badge. Badges short enough to render as a single span are unchanged.
- Files with non-ASCII or otherwise special characters in their names (`café.txt`) appeared in Changed Files under a mangled, C-quoted name, and their diff opened blank on both sides with no error. BoomerGit now reads `git diff-tree -z`, whose output is unquoted.
- A `git diff-tree` failure showed as an empty Changed Files list, indistinguishable from a commit that changed nothing. It now shows a "Failed to list changed files" entry with git's own message in the tooltip.
- Truncated `diff-tree` output threw while assembling the Changed Files tree, leaving the view stuck on the previous commit. Such records are now skipped and the rest of the diff is still shown.
- With no workspace folder open, Delete Branch asked for confirmation and Create Branch asked for a name, then both silently did nothing. They now return before prompting.
- The `origin/HEAD` badge offered "Checkout Branch", which ran `git checkout HEAD` — a no-op that still reported "Checked out: HEAD". A remote's symbolic HEAD is no longer offered for checkout.

### Changed
- Internal refactor for readability, with no change to behaviour: `git` invocation centralised into one module (it was hand-wrapped in a Promise in eight places, with an inconsistent output-buffer ceiling), the three repository-mutating commands reduced to one shared implementation, and interaction timings and colours moved into named, documented constants. Click-intent resolution, click-menu construction and diff-side selection are now separate pure modules. See `docs/human-code-report-2026-08-22.md`.
- Test coverage raised from 18.7% to 98.8% of lines (36 → 284 tests), unblocked by a `vscode` test double that makes the previously untestable extension modules loadable under Vitest. CI now enforces a 70% per-file floor via `npm run test:coverage`.

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
