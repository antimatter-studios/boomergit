# Changelog

All notable changes to BoomerGit are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries you add under **[Unreleased]** are promoted into a versioned section by
`npm run release:*`, and the release pipeline uses that section as the GitHub
Release notes.

## [Unreleased]

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
