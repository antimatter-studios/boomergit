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
- `npm run lint` — typecheck `src` **and** `test` (two tsconfigs; tests would otherwise go unchecked)
- `npm test` — run unit tests (Vitest)
- `npm run test:coverage` — tests plus coverage thresholds (70% per file, enforced in CI)
- `npm run visual-check` — render graph scenarios to `build/visual-check.html` for eyeballing; pass a repo path to run against real history
- `npm run demo-repo` — build a repository at `/tmp/boomergit-test` (where `launch.json` points) exercising every badge type, worktrees, merges and an unmerged branch. VS Code cannot open the same folder twice, so boomergit itself can't be the F5 subject while it's open — use this instead.
- `npm run package` — build + create VSIX in `build/`

## Testing
- `test/mocks/vscode.ts` is a test double for the `vscode` module, aliased in `vitest.config.mts`. The real module only exists inside the extension host, so anything importing it is untestable without this. Value types (`Position`, `Range`, `Uri`, `EventEmitter`) are real implementations because the code depends on their semantics; the host API is spies plus recorded state in `__state`.
- `test/extension.test.ts` drives `activate()` end to end: it fires the mock's event emitters and invokes registered commands, with `node:child_process` mocked so git responses are scripted per subcommand.
- Use block bodies in `beforeEach` — a concise arrow returning a value makes Vitest treat that value as a teardown callback.
- Dev harnesses live in `scripts/dev/` and must import the real modules (bundled via esbuild), never copy them. The previous root-level `test-*.mjs` scripts held pasted copies of the layout algorithm that drifted out of step with `src/`, so they verified code the extension didn't run.

## Architecture
- No webviews — fully native VS Code APIs
- SVG tiles via decoration `before` contentIconPath (file paths only, no data URIs)
- TextDocumentContentProvider for virtual document
- Parse git log directly, no external git libraries
- esbuild for bundling
