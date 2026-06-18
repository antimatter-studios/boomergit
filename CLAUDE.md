# BoomerGit — Agent Instructions

## Publishing
- CI/CD is a single pipeline (`.github/workflows/pipeline.yml`) with three stages: **build → test → release**. build and test run on every PR/push to `main`; the release stage runs only on `v*` tag pushes, publishing to both VS Code Marketplace and Open VSX, then creating a GitHub Release.
- To cut a release: decide major/minor/patch based on the changes, then run `npm run release:patch` / `release:minor` / `release:major`. These bump the version (commit + tag) and push with `--follow-tags`; CI does the build/package/publish.
- Never publish the same version twice. Always bump first — the release job fails if the tag doesn't match `package.json`'s version.
- Requires repo secrets `VSCE_PAT` (Azure DevOps PAT) and `OVSX_PAT` (Open VSX token).

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
