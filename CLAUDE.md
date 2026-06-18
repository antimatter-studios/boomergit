# BoomerGit — Agent Instructions

## Publishing
- Publishing is automated via GitHub Actions (`.github/workflows/release.yml`). It triggers on `v*` tag pushes and publishes to both VS Code Marketplace and Open VSX, then creates a GitHub Release.
- To cut a release: decide major/minor/patch based on the changes, then run `npm run release:patch` / `release:minor` / `release:major`. These bump the version (commit + tag) and push with `--follow-tags`; CI does the build/package/publish.
- Never publish the same version twice. Always bump first — the release job fails if the tag doesn't match `package.json`'s version.
- Requires repo secrets `VSCE_PAT` (Azure DevOps PAT) and `OVSX_PAT` (Open VSX token).

## Build
- `npm run build` — esbuild bundle
- `npm run lint` — typecheck with `tsc --noEmit`
- `npm run package` — build + create VSIX in `build/`

## Architecture
- No webviews — fully native VS Code APIs
- SVG tiles via decoration `before` contentIconPath (file paths only, no data URIs)
- TextDocumentContentProvider for virtual document
- Parse git log directly, no external git libraries
- esbuild for bundling
