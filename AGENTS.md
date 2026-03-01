# BoomerGit — Agent Instructions

## Publishing
- When publishing a new release, you must remember to bump the version number. Decide whether it's a major, minor, or patch based on the changes.
- Use `npm run release:patch`, `npm run release:minor`, or `npm run release:major` — these bump the version, build, package, and publish to both VS Code Marketplace and Open VSX in one step.
- Never publish the same version twice. Always bump first.

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
