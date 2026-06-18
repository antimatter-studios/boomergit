# Changelog

All notable changes to BoomerGit are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries you add under **[Unreleased]** are promoted into a versioned section by
`npm run release:*`, and the release pipeline uses that section as the GitHub
Release notes.

## [Unreleased]

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
