# Exact Comparison and Bilingual README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, cancellable byte-for-byte comparison mode while preserving quick metadata comparison by default, then make Korean the primary documentation and English the secondary manual.

**Architecture:** Scan metadata as today, then precompute exact equality for matching paths only when `comparisonMode === 'exact'`. Feed those results into the synchronous planner, reuse the existing progress and stop controls, and keep schema v2 backward-compatible through boundary normalization.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, File System Access API, Blob chunk reads, Node.js builder, Playwright Chromium regression tests.

## Global Constraints

- `quick` remains the default and preserves size + modification-time behavior.
- `exact` compares bytes in 4 MiB chunks with bounded memory and early exit.
- No hash algorithms, hash cache, user-level toggle, parallelism, Worker, or new dependency.
- Root `file-nally.html` is generated; edit only `dev/` sources before `npm run build`.
- Existing schema v2 backups remain importable and normalize missing comparison mode to `quick`.
- Korean is the root README language; English lives at `docs/README_en.md`.

---

### Task 1: Planner content-equality contract

**Files:**
- Modify: `tests/file-nally.e2e.cjs`
- Modify: `dev/js/file-nally.js`

**Interfaces:**
- Consumes: existing `SyncPlanner.plan({ source, target, manifest, trustedManifest, direction, conflictPolicy })`.
- Produces: optional `contentEquality: Map<string, boolean>` input on `SyncPlanner.plan()`.

- [ ] **Step 1: Add failing planner tests**

Add browser assertions proving that `contentEquality.get(path) === false` turns equal metadata into a conflict, while `true` turns different timestamps with equal size into a baseline.

```js
const unequal = window.FileNallyTest.SyncPlanner.plan({
  source: { 'same.txt': file('same.txt', 4, 100) },
  target: { 'same.txt': file('same.txt', 4, 100) },
  contentEquality: new Map([['same.txt', false]]),
});
const equal = window.FileNallyTest.SyncPlanner.plan({
  source: { 'same.txt': file('same.txt', 4, 200) },
  target: { 'same.txt': file('same.txt', 4, 100) },
  contentEquality: new Map([['same.txt', true]]),
});
```

- [ ] **Step 2: Run the suite and confirm RED**

Run: `node tests/file-nally.e2e.cjs`

Expected: the new assertions fail because the planner ignores `contentEquality`.

- [ ] **Step 3: Implement the minimal planner branches**

Normalize the input to a map. When an exact result exists, use it for current source/target equality. If trusted manifest metadata reports neither side changed but exact content is unequal, mark both sides as conflict instead of unchanged.

- [ ] **Step 4: Run the suite and confirm GREEN**

Run: `node tests/file-nally.e2e.cjs`

Expected: all browser tests pass.

### Task 2: Exact byte comparison, settings, progress, and cancellation

**Files:**
- Modify: `tests/support/mock-file-system.cjs`
- Modify: `tests/file-nally.e2e.cjs`
- Modify: `dev/file-nally.html`
- Modify: `dev/js/file-nally.js`
- Modify only if required by responsive evidence: `dev/css/file-nally.css`

**Interfaces:**
- Consumes: scanned file records `{ path, size, lastModified, handle }`.
- Produces: `FileAdapter.compareContent(sourceFile, targetFile, onProgress, isCancelled): Promise<boolean>`.
- Produces: normalized `config.comparisonMode: 'quick' | 'exact'`.

- [ ] **Step 1: Add failing user-flow tests**

Add tests that select exact mode through the labelled control and assert:

```js
await page.getByLabel('비교 모드').selectOption('exact');
```

- same size/time with `AAAA` versus `BBBB` becomes a conflict;
- same content with different times has no copy action;
- quick mode retains the existing metadata result;
- a delayed multi-chunk comparison can be stopped and returns to `ready` with `model.plan === null`;
- imported schema v2 config without `comparisonMode` exports `quick`.

Extend `MockFileHandle` only with a configurable `readDelay` applied by `getFile()` chunk reads so cancellation is deterministic. Keep the returned object a real `File` or `Blob` boundary rather than asserting on the mock.

- [ ] **Step 2: Run the suite and confirm RED**

Run: `node tests/file-nally.e2e.cjs`

Expected: tests fail because the comparison selector and exact pipeline do not exist.

- [ ] **Step 3: Add the native comparison mode field**

Add one labelled `<select id="comparisonMode">` to the existing controls with `quick` and `exact` options. Add Korean and English labels and concise option text to `TEXT`. Bind it through the existing config-save path and disable it while busy.

- [ ] **Step 4: Implement bounded byte comparison**

Use a fixed `4 * 1024 * 1024` byte chunk size. For equal-size files, read matching `Blob.slice(offset, end).arrayBuffer()` chunks, compare `Uint8Array` values, report cumulative bytes, and throw a dedicated cancellation error when `isCancelled()` becomes true. Return immediately on the first difference.

- [ ] **Step 5: Integrate exact results before planning**

In `Controller.compare()`, reset `abortRequested`, scan both sides, then build `contentEquality` only in exact mode. Different sizes map directly to `false`; matching sizes use `compareContent`. Pass the map to `SyncPlanner.plan()`.

- [ ] **Step 6: Reuse the safe-stop control for comparison**

Enable the stop button in `comparing` and `syncing`. A comparison stop sets `abortRequested`; cancellation clears the plan, returns to `ready`, restores controls, and logs a translated comparison-cancelled message. No file action is invoked during comparison.

- [ ] **Step 7: Run the suite and confirm GREEN**

Run: `node tests/file-nally.e2e.cjs`

Expected: all user-flow and accessibility tests pass with no page errors.

### Task 3: Korean-first and English-secondary documentation

**Files:**
- Modify: `README.md`
- Create: `docs/README_en.md`
- Delete after content is preserved: `docs/README_ko.md`
- Create: `LICENSE`

**Interfaces:**
- Consumes: shipped quick/exact behavior and verified commands.
- Produces: Korean root manual and linked English manual with matching settings information.

- [ ] **Step 1: Move existing manuals without losing content**

Use the current Korean manual as the root README and the current English README as `docs/README_en.md`. Correct all relative links and repository-layout entries.

- [ ] **Step 2: Document shipped comparison behavior**

Both manuals must state:

- Quick is the default and compares size plus modification time.
- Exact reads same-size file contents byte-for-byte in chunks.
- Exact is slower, bounded in memory, and cancellable.
- No hashes or persistent content cache are used.

- [ ] **Step 3: Add contribution, issue-reporting, and license guidance**

Document `npm ci`, `npm test`, `npm run test:visual`, editing only `dev/`, focused pull requests, and issue reports containing reproduction steps, browser/OS, expected behavior, and observed behavior. Add the standard MIT text to `LICENSE` with `Copyright (c) 2026 WizMasia`.

- [ ] **Step 4: Validate document references**

Run: `rg -n 'README_ko|README_en|comparisonMode|빠른 비교|Exact comparison|LICENSE' README.md docs package.json`

Expected: no stale `README_ko.md` link and both manuals link to each other and `LICENSE` correctly.

### Task 4: Build, visual QA, and release verification

**Files:**
- Regenerate: `file-nally.html`
- Evidence only, ignored: `artifacts/visual/*.png`

**Interfaces:**
- Consumes: all source and documentation changes.
- Produces: deterministic standalone HTML and fresh visual evidence.

- [ ] **Step 1: Regenerate the standalone artifact**

Run: `npm run build`

Expected: `file-nally.html` contains the current development HTML, CSS, and JavaScript.

- [ ] **Step 2: Run complete verification**

Run: `npm test`

Expected: build pipeline, generated-artifact check, and all Chromium regression tests pass.

- [ ] **Step 3: Capture all responsive states**

Run: `npm run test:visual`

Expected: fresh mobile, tablet, and desktop default/planned/changed-only screenshots with no document overflow.

- [ ] **Step 4: Perform independent visual QA**

Dispatch two read-only visual reviewers against all fresh screenshots and the changed HTML/CSS/JS. Both must return PASS with no blocking layout, interaction, accessibility, or Korean wrapping findings.

- [ ] **Step 5: Inspect final diff and working tree**

Run: `git diff --check && git status --short && git diff --stat`

Expected: only planned source, generated artifact, tests, manuals, license, spec, and plan changes are present; no QA artifacts are tracked.

### Task 5: Publish, merge, comment, and close issues

**Files:**
- Git history only.
- GitHub issues: `WizMasia/Filenally#2` and `WizMasia/Filenally#3`.

**Interfaces:**
- Consumes: verified implementation commits.
- Produces: merged and pushed `main`, issue comments containing the shipped scope, then closed issues.

- [ ] **Step 1: Commit atomic change groups**

Commit implementation/tests/generated artifact separately from documentation/license. Follow the repository's imperative subject style.

- [ ] **Step 2: Merge and push**

Merge `issue-2-3-exact-compare` into `main` without rewriting history, run `npm test` on merged `main`, and push `main` to `origin`.

- [ ] **Step 3: Comment before closing**

For #2, describe quick/exact modes, byte comparison, progress/cancellation, defaults, tests, and intentionally excluded hash/cache/parallel controls. For #3, describe Korean-first README, English manual, defaults, contribution guidance, and MIT license. Include the merged commit SHA.

- [ ] **Step 4: Close and verify**

Close #2 and #3 only after their comments succeed. Fetch both issues again and confirm `state: closed` and the new comments are present.
