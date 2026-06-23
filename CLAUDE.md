# BoomerGit — Agent Instructions

## Publishing
- `main` is **protected** (PR-only, linear history, no force-push, enforced for admins) by the github-guard hooks, so nothing — including releases — is pushed to `main` directly.
- CI/CD is a single pipeline (`.github/workflows/pipeline.yml`) with three stages: **build → test → release**, all running on PRs and pushes to `main`. The release stage is **release-on-merge**: on a push to `main` it checks whether `package.json`'s version already has a `v*` tag; if not (a release PR just merged), it publishes to VS Code Marketplace + Open VSX and creates the GitHub Release + tag. Ordinary merges are no-ops.
- To cut a release: record the changes under `## [Unreleased]` in `CHANGELOG.md`, then run `npm run release:patch` / `release:minor` / `release:major`. These (`scripts/release-prepare.mjs`) bump the version, promote the Unreleased changelog section (`scripts/bump-changelog.mjs`), and open a `release: vX.Y.Z` **PR**. **Merge that PR** (squash) and CI does the rest.
- The release stage extracts the new version's `CHANGELOG.md` section (`scripts/extract-changelog.mjs`) for the GitHub Release notes, attaches the VSIX, and falls back to auto-generated notes if that section is empty.
- Never publish the same version twice. The release job self-gates on the version's tag already existing.
- Requires repo secrets `VSCE_PAT` (Azure DevOps PAT) and `OVSX_PAT` (Open VSX token).
- **Partial-publish recovery:** publishes are idempotent (each marketplace is skipped if that version is already live). Re-run the release job (re-run the `main` workflow run) to complete a missing publish; it won't duplicate. No version bump needed.

## Build
- `npm run build` — esbuild bundle
- `npm run lint` — typecheck with `tsc --noEmit`
- `npm test` — run unit tests (Vitest) over the pure functions in `src/git` and `src/graph`
- `npm run package` — build + create VSIX in `build/`

## Architecture
- No webviews — fully native VS Code APIs
- SVG tiles via decoration `before` contentIconPath (file paths only, no data URIs)
- TextDocumentContentProvider for virtual document
- Parse git log directly, no external git libraries
- esbuild for bundling
