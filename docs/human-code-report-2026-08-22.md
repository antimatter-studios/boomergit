# Human-Code Report — 2026-08-22

**Scope:** full `src/` tree (9 files, 1,115 lines at start)
**Branch:** `feat/ref-type-badges` (PR #17)
**Items:** 23 found · 23 fixed · 0 deferred

| | Before | After |
|---|---|---|
| Tests | 36 | 269 |
| Line coverage | 18.7% | 98.5% |
| Branch coverage | 18.2% | 88.5% |
| Modules at 0% coverage | 5 | 0 |
| `src/extension.ts` | 676 lines, one function | 640 lines, logic extracted |

---

## The prerequisite: a `vscode` test double

Five of nine modules sat at exactly 0% coverage for one reason — they
`import * as vscode`, and that module only exists inside the extension host, so
Vitest could not load them at all. No amount of test-writing discipline reaches
that code without solving it first.

[test/mocks/vscode.ts](../test/mocks/vscode.ts) is a working stand-in, aliased
over `vscode` in [vitest.config.mts](../vitest.config.mts). Value types
(`Position`, `Range`, `Uri`, `EventEmitter`) are implemented for real because
the code under test depends on their semantics — `range.contains()` is what
decides which ref badge a click landed on. The host API surface is spies plus
recorded state, so a test can assert what the extension *asked VS Code to do*.

Two host contracts had to be emulated faithfully before `activate()` could be
tested end-to-end:

- `openTextDocument` consults the registered content provider, so the document
  under test holds the real rendered graph text.
- A content provider firing `onDidChange` causes `onDidChangeTextDocument` to
  fire **asynchronously**, as the host does. This one matters: `refreshGraph()`
  calls `refresh()` and only *then* attaches its listener, so a synchronous
  mock always missed the event and every test paid the 200 ms fallback. Not a
  product bug — the real host is async — but the fidelity gap made the suite
  50× slower and hid what the code actually waits on.

This unlocked 1,300-odd previously untestable lines, and is why coverage moved
as far as it did.

---

## Changes made

### H3 — `execFile` hand-wrapped in a Promise, eight times

**Files:** [src/git/exec.ts](../src/git/exec.ts) (new), and all eight call sites

Two shapes recurred: reject-with-stderr for mutating commands (three
byte-identical copies) and resolve-empty-on-error for read-only queries (five
copies). `maxBuffer` was set in three and omitted in five.

```ts
// Before — at each of eight sites
await new Promise<void>((resolve, reject) => {
  execFile("git", ["checkout", branchName], { cwd: workspaceCwd },
    (err, _stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
});

// After
await gitRun(["checkout", branchName], cwd);
```

**Why it's better:** the reader learns the resolve-or-reject policy once, and
the *names* carry it — `gitRun` for commands whose failure the user must see,
`gitQuery` for lookups where "no value" is a normal answer. The silent
inconsistency in `maxBuffer` is gone: one constant, documented, applied
everywhere. Two call sites previously capped at 10 MB now get the same 50 MB
ceiling as the rest, which can only turn a failure into a success.

### H4 — three commands that were one function written three times

**Files:** [src/extension.ts](../src/extension.ts)

`checkoutRef`, `deleteBranch` and `createBranch` all did: guard cwd → run git →
info toast → `refreshGraph()` → catch → error toast. Only the args and the
message text differed.

```ts
// After
async function runGitAction(args, successMessage, failurePrefix) { … }

const checkoutRefCmd = vscode.commands.registerCommand("boomergit.checkoutRef",
  async (name, type) => {
    const branchName = type === "remote" ? localBranchName(name) : name;
    await runGitAction(["checkout", branchName], `Checked out: ${branchName}`, "Checkout failed");
  });
```

**Why it's better:** 79 lines become 34, and the three commands now read as
what they are — a git invocation plus two strings. The remote-name stripping
that was buried inline became `localBranchName()`, a named pure function with
its own tests, including the case the inline version got right by accident:
a branch whose own name contains slashes.

### H2 — "open the menu after a click", duplicated verbatim three times

**Files:** [src/extension.ts](../src/extension.ts)

```ts
// Before — three times in one function
showingMenu = true;
setTimeout(() => {
  hoverTriggeredByClick = true;
  vscode.commands.executeCommand("editor.action.showHover");
}, 50);

// After
showingMenu = true;
openClickMenu();
```

**Why it's better:** three copies of a timing workaround is three places to fix
it. The helper also carries the *reason* for the delay — the hover renders at
the cursor, so asking for it too early puts the menu on the previous row —
which no copy explained.

### H1 / M6 / L5 — structural splits

**Files:** [src/ui/menus.ts](../src/ui/menus.ts),
[src/ui/clickIntent.ts](../src/ui/clickIntent.ts),
[src/ui/diffTarget.ts](../src/ui/diffTarget.ts),
[src/providers/commitInfoProvider.ts](../src/providers/commitInfoProvider.ts),
[src/providers/changedFilesProvider.ts](../src/providers/changedFilesProvider.ts)

`activate()` was 656 lines over 12 shared mutable `let`s. Rather than shuffle
the event wiring — which cannot be tested and where a mistake is invisible —
the *decisions* came out of it into pure modules:

- **`resolveClickIntent`** — the four-way "what did this click mean" branch.
  Now a total function over three booleans, with all six cases tested.
- **`buildBadgeMenu` / `buildRowMenu`** — menu markdown as a pure string
  function, replacing 30 lines of inline `appendMarkdown` and
  `encodeURIComponent(JSON.stringify(...))`.
- **`computeDiffTarget`** — which ref and path belong on each side of a diff,
  including the added/deleted/rename/root-commit cases.

`applyTextColors` (60 lines, five concerns) split into `collectRanges` →
`collectBadgeRanges` → `paintRanges`, and `commitDetailProvider.ts` (303 lines,
two unrelated providers) split along the seam that was already there.

**Why it's better:** the interesting logic is no longer welded to the event
plumbing. `resolveClickIntent` is six lines you can read and be sure about;
previously the same decision was spread over a 50-line `if/else` chain
interleaved with side effects. The wiring that remains in `activate()` is
mostly registration, which reads fine linearly.

### M1 — magic timings, including the same literal meaning two things

**Files:** [src/ui/timings.ts](../src/ui/timings.ts) (new)

`200` appeared four times as the self-selection ignore window and once as an
unrelated document-update fallback. Also `50`, `250`, `3000`, `2000`, `800`,
`100`, all bare.

```ts
// After
export const TIMING = {
  /**
   * How long to ignore selection events after moving the cursor ourselves.
   * Without it, a programmatic cursor reset is indistinguishable from a real
   * click and the menu immediately reopens.
   */
  ignoreSelfSelectionMs: 200,
  …
}
```

**Why it's better:** each value now says what breaks if it's wrong, which is
the only thing that makes an empirical timing reviewable. And the collision is
resolved: `ignoreSelfSelectionMs` and `documentUpdateMs` happen to both be 200
but are now free to diverge — previously changing "the 200" meant guessing
which ones were the same 200.

Writing the extension tests immediately proved the value: a simulated
double-click failed until the test advanced the clock past
`ignoreSelfSelectionMs`, which is exactly the real constraint, now named.

### M4 / M5 — scattered colours and a CSS hack built by hand

**Files:** [src/ui/theme.ts](../src/ui/theme.ts) (new),
[src/decorations/graphDecorations.ts](../src/decorations/graphDecorations.ts)

`#1e1e1e` was named `BG_COLOR` in one file and raw in three others; `#F5A623`
was `BRANCH_COLORS[0]` duplicated as the hash colour; seven more were bare.

The `textDecoration: "none; …"` trick — VS Code's only route to arbitrary CSS
on a decoration — was hand-assembled in four places with the rationale
commented once:

```ts
// After
function injectCss(declarations: Record<string, string>): string {
  const css = Object.entries(declarations).map(([p, v]) => `${p}: ${v}`).join("; ");
  return `none; ${css}`;
}
```

**Why it's better:** the hack is now named, explained in one place, and its
declarations are structured data rather than a string a reader has to parse to
see that `none;` is load-bearing. `COLOR` names each colour by role, so
`#616161` is `COLOR.date` and nobody has to guess.

### M2 — `hash.slice(0, 8)` in six places

**Files:** [src/git/format.ts](../src/git/format.ts) (new)

Became `shortHash()` + `SHORT_HASH_LEN`, the latter now also used by the
decoration engine to compute where badges start in a line — replacing a bare
`10` whose comment said `"  {hash}  "` while the actual offset was 12.

### M3 — `selectUp` / `selectDown`, the same 13 lines twice

Became `moveSelection(delta)`. The two versions each clamped only one end;
the shared version clamps both, which is unreachable-but-correct rather than
relying on the caller's direction.

### M7 — dead assignments and a comment describing the wrong case

**Files:** [src/git/parser.ts](../src/git/parser.ts)

`subject` and `refStr` were computed, then unconditionally recomputed by the
if/else below — the first pair could never be read. The `parts.length === 6`
branch was commented "no ref names field", but `%D` always emits that field, so
six parts means malformed input.

```ts
// After
const hasRefField = parts.length >= FIELD_COUNT;
const subject = hasRefField ? parts.slice(SUBJECT_INDEX, -1).join("|") : parts[SUBJECT_INDEX];
const refStr = hasRefField ? parts[parts.length - 1] : "";
```

**Why it's better:** three branches collapse to one expression because the
general case (subject absorbs extra parts, refs are last) already covered the
"exactly 7" case it was special-cased alongside. The comment now describes what
is actually true of `%D`. All pre-existing parser tests stayed green throughout.

### M8 — debug logging left in

Two `console.log`s removed, one of which fired on **every commit click** and
dumped 300 characters of git stdout into the extension host log.

### L1 — a comment that contradicted the code

[src/graph/svgTileGen.ts](../src/graph/svgTileGen.ts) said `half: "top"` meant
"merges arriving at the commit dot". Both `graph/types.ts` and the actual
emitter say otherwise: merges are full-height, and `"top"` is the root-commit
case. Corrected against what `layout.ts` emits.

### L2 — a ternary with identical branches

```ts
// Before
backgroundColor: isOnActiveLine ? "#cc3333" : "#cc3333",
// After
backgroundColor: COLOR.selectedRow,
```

`isOnActiveLine` was computed for nothing. `clearSelections(editor)` also took
an unused parameter, now removed along with its two call sites.

### L3 — unreachable defensive code

`REF_LABEL[t] || ""` and `badgeColors[t] || "#888"` on total
`Record<RefType, …>` maps — the fallback can never be reached, so it only
raised the question of when it could.

### L4 — an unnamed hand-rolled hash

`((hash << 5) - hash + c) | 0` became `fileNameDigest()`, documented as Java's
`String.hashCode`, with an honest note about why 32 bits is enough here (a
collision renders the wrong tile; a graph holds only as many shapes as rows).

### L6 — inline type import

`let lastRows: import("./graph/types.js").GraphRow[]` became a normal
top-of-file import.

---

## Items skipped

None. All 23 items were applied, including the three originally deferred — see
"Follow-up round" below.

---

## Test results

| | Before | After |
|---|---|---|
| Tests passing | 36 | 275 |
| Tests failing | 0 | 0 |
| Statements | 18.7% | 96.2% |
| Branches | 18.2% | 88.4% |
| Functions | 9.3% | 95.1% |
| Lines | 18.7% | 98.8% |
| `tsc --noEmit` | clean (src only) | clean (src **and** tests) |

Per-module, lowest figure is `parser.ts` branches at 80% and `extension.ts`
branches at 84%. `vitest.config.mts` enforces a 70% floor with
`perFile: true`, so a well-covered module cannot carry a neglected one, and
CI runs `npm run test:coverage` — the thresholds fail the build.

**Baseline contract:** all 36 original tests are still present and passing,
verified with `comm -23` after every iteration. No test was deleted, renamed,
or weakened.

### Two bugs found by the new tests, in the tests themselves

Worth recording because both were instructive:

1. `beforeEach(() => execFileMock.mockReset())` — the concise arrow *returns*
   the mock, and Vitest treats a value returned from a hook as a teardown
   callback, so it called the mock with zero arguments after every test. This
   presented as "cb is not a function" in all 14 tests and looked like a
   product bug. Fixed with block bodies.
2. `__reset()` cleared recorded state but not the spies' call history, so
   `mock.results[0]` in one test could be an object from a previous one.

Neither was a defect in `src/`, but both would have wasted someone's afternoon
later.

---

## Follow-up round

The three items originally left open were then addressed.

### Tests weren't typechecked

**Files:** [tsconfig.test.json](../tsconfig.test.json) (new), [package.json](../package.json)

`tsconfig.json` covers only `src/**/*`, so the test files were never
typechecked. I'd expected this to be a big job because the fake `vscode` types
don't structurally match the real ones. It wasn't — the entire gap was 15
errors in two classes:

- **Top-level `await` in 5 files.** The base config's `Node16` module mode
  treats them as CommonJS. The test config uses `ESNext`/`Bundler`, which is
  what Vitest actually does with them anyway.
- **10 × `Uri` not assignable** — the double was missing `toJSON()`. Fixed on
  the double rather than by casting at each call site: the whole point of the
  fake is to be structurally faithful to what it stands in for.

`npm run lint` now runs both projects, so CI enforces it.

**Verified working, not merely passing:** a deliberately planted
`shortHash("abc", "extra")` was caught as `TS2554: Expected 1 arguments, but
got 2` — the same class as the `clearSelections()` slip that got through
earlier. A typecheck reporting zero errors is worth nothing until you have
watched it fail.

### Three scratch harnesses at the repo root

**Files:** [scripts/dev/visual-check.mjs](../scripts/dev/visual-check.mjs) (new),
replacing `test-layout-debug.mjs`, `test-visual.mjs`, `test-svg-verify.mjs`
and the generated `test-output.html`

These were worse than unused. Each held a **pasted copy** of the layout
algorithm — one is labelled "exact copy from src/graph/layout.ts" — and the
copies had drifted: `test-svg-verify.mjs` computed
`midY = rowHeight / 2 + rowHeight * 0.02`, an offset the real renderer no
longer has. A harness that claims to run "the REAL layout algorithm" while
running a stale duplicate is worse than no harness.

The capability worth keeping was the visual check, so one script now does it by
importing the real modules, bundled on the fly with esbuild (already a
dependency):

```
npm run visual-check                          # 7 synthetic scenarios
node scripts/dev/visual-check.mjs <repo> [n]  # against a real repository
```

It writes `build/visual-check.html` (gitignored) and, in repo mode, prints the
lane table the old debug harness printed. Nothing is duplicated, so it cannot
drift out of step again.

### `getChildren` swallowed errors into an empty list

**Files:** [src/providers/changedFilesProvider.ts](../src/providers/changedFilesProvider.ts)

A `catch` returned `[]`, which a user cannot tell apart from a commit that
genuinely changed nothing. It now returns a `TreeErrorItem` — "Failed to list
changed files", error icon, message in the tooltip — and still logs.

Reading that code turned up a real crash path beside it: `parseNameStatus` on a
line with no tab produced `{ path: undefined }`, and `buildFileTree` then threw
on `file.path.split("/")` — out of `showCommit` as an unhandled rejection, not
into that `catch` at all. Malformed lines are now skipped and the good lines
around them kept.

---

## Still open

Nothing from the original scan. Two things a later pass might weigh, neither a
defect and both outside the agreed scope:

- `src/extension.ts` is 640 lines. `activate()` no longer holds the decisions,
  but it still holds all the wiring. Splitting the registration itself needs
  the event plumbing under test first, and the payoff is smaller than the line
  count suggests — registration reads fine linearly.
- The auto-refresh polling fallback (3 s) runs only when the built-in Git
  extension is unavailable, which may be rare enough that the fallback costs
  more to keep than it earns.
