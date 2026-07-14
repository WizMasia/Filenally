# File-nally Single-HTML Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild File-nally as a safe, testable, responsive application while keeping all production HTML, CSS, and JavaScript in one `file-nally.html` file and retaining JSON state backup/restore.

**Architecture:** `file-nally.html` remains the only production artifact and contains ordered internal namespaces for schema/storage, sync planning, file operations, rendering, and the controller. Development-only Playwright tests mock the File System Access API and exercise the real page in Chrome; no runtime dependency or build step is introduced.

**Tech Stack:** HTML5, CSS, browser JavaScript, File System Access API, IndexedDB, localStorage JSON, Node.js test runner conventions, Playwright 1.61.1 for development-only Chrome tests.

## Global Constraints

- Product implementation code must exist only in `file-nally.html`; no external product JavaScript, CSS, font, image, or CDN.
- End users must continue to open the HTML directly in Chrome or Edge without Node.js or a server.
- Keep the `smart_sync_state` localStorage key and JSON backup/restore capability.
- Migrate v0.6.1 state to schema version 2 without trusting legacy manifests for deletion.
- Store only non-serializable directory handles in IndexedDB; settings, profiles, histories, and manifests remain JSON.
- Dynamic filenames, paths, errors, and imported JSON values must never flow into `innerHTML`.
- Do not commit, push, or stage changes unless the user explicitly requests it.

## File Map

- Create `DESIGN.md`: extracted operational design system, responsive rules, primitives, and accessibility constraints.
- Create `package.json`: development-only test scripts and pinned Playwright dependency.
- Create `package-lock.json`: reproducible development dependency lock.
- Create `tests/support/mock-file-system.cjs`: in-memory File System Access API used only by tests.
- Create `tests/file-nally.e2e.cjs`: Chrome behavior, security, storage, and responsive tests.
- Modify `file-nally.html`: all production CSS, markup, state, planning, file operations, rendering, and controller logic.
- Modify `README.md`: updated policies, JSON v2 compatibility, safety model, and development verification commands.

---

### Task 1: Lock the design contract and failing browser safety net

**Files:**
- Create: `DESIGN.md`
- Create: `package.json`
- Create: `tests/support/mock-file-system.cjs`
- Create: `tests/file-nally.e2e.cjs`
- Generated: `package-lock.json`

**Interfaces:**
- Produces: `installMockFileSystem(page)`, `configureMockPair(page, sourceSpec, targetSpec)`, and `snapshotMockPair(page)` test helpers.
- Produces: `npm test` and `npm run test:visual` commands.

- [ ] **Step 1: Write `DESIGN.md` before UI implementation**

Document the existing indigo operational direction, semantic colors with WCAG AA contrast, 4px spacing base, type scale, buttons/cards/tables/status/banner primitives, SVG-only icons, 760px single-column breakpoint, table horizontal scrolling, and accepted debt limited to keeping product code in one HTML file.

- [ ] **Step 2: Add development-only package metadata**

```json
{
  "name": "file-nally",
  "private": true,
  "scripts": {
    "test": "node tests/file-nally.e2e.cjs",
    "test:visual": "node tests/file-nally.e2e.cjs --visual"
  },
  "devDependencies": {
    "playwright": "1.61.1"
  }
}
```

- [ ] **Step 3: Add a reusable in-memory File System Access API mock**

The mock must implement file/directory `kind`, `name`, `values()`, `getFile()`, `createWritable()`, `getFileHandle()`, `getDirectoryHandle()`, `removeEntry()`, `isSameEntry()`, `resolve()`, `queryPermission()`, and `requestPermission()`. It must support injected write failures and delayed writes for abort tests.

- [ ] **Step 4: Write failing regression tests before production edits**

Add named tests for:

```js
test('comparison re-enables synchronization when work is queued', ...);
test('skip policy never overwrites an existing destination', ...);
test('untrusted filenames render as text', ...);
test('an unrelated manifest cannot schedule deletion', ...);
test('375px viewport has no document-level horizontal overflow', ...);
```

- [ ] **Step 5: Run tests and verify RED**

Run: `npm install && npm test`

Expected: the five regression tests fail for the observed current behaviors, while the test harness itself launches Chrome and reaches the page without setup errors.

- [ ] **Step 6: Record checkpoint without committing**

Run: `git diff --check && git status --short`

Expected: only the design/test setup files are new; no production file is modified.

---

### Task 2: Introduce JSON schema v2, migration, and validated import

**Files:**
- Modify: `file-nally.html` script state/storage section
- Modify: `tests/file-nally.e2e.cjs`

**Interfaces:**
- Produces: `StateStore.createDefault()`, `StateStore.migrate(raw)`, `StateStore.sanitize(raw)`, `StateStore.load()`, `StateStore.save(state)`, and `StateStore.export(state)`.
- Produces schema fields: `schemaVersion`, `config`, `activeProfileId`, `profiles`, `globalHistory`.

- [ ] **Step 1: Write failing state tests**

Test exact v0.6.1 migration, `overwrite`→`source-overwrite`, malformed JSON fallback, forbidden prototype keys, type stripping, 5MB import rejection, profile/manifest/history limits, and v2 export/re-import equality.

- [ ] **Step 2: Run only state tests and verify RED**

Run: `npm test -- --grep "state|migration|import|export"`

Expected: FAIL because the v2 API and validation are absent.

- [ ] **Step 3: Implement minimal state namespace in `file-nally.html`**

Use a null-prototype object walk, explicit allowlists, bounded arrays/maps, and these constants:

```js
const STATE_VERSION = 2;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_PROFILES = 100;
const MAX_MANIFEST_ENTRIES = 100000;
const MAX_PROFILE_HISTORY = 30;
const MAX_GLOBAL_HISTORY = 100;
```

Legacy manifests migrate to one `bindingStatus: "unverified"` profile and cannot drive deletion.

- [ ] **Step 4: Run state tests and verify GREEN**

Run: `npm test -- --grep "state|migration|import|export"`

Expected: all selected tests pass with no browser console errors.

- [ ] **Step 5: Run full suite and inspect diff**

Run: `npm test && git diff --check`

Expected: state tests pass; behavior tests not yet implemented remain failing and are clearly separated.

---

### Task 3: Implement the pure synchronization planner and all policies

**Files:**
- Modify: `file-nally.html` core planning section
- Modify: `tests/file-nally.e2e.cjs`

**Interfaces:**
- Consumes normalized maps `{ path -> { path, name, size, lastModified, handle? } }` and a trusted/untrusted manifest.
- Produces: `SyncPlanner.plan({ source, target, manifest, trustedManifest, direction, conflictPolicy, runStamp })` returning `{ id, actions, rows, summary }`.
- Action types: `copy`, `trash`, `forget`, `conflict`, `noop`; copy actions include `fromSide`, `toSide`, `sourcePath`, `destinationPath`.

- [ ] **Step 1: Write the planner matrix as failing tests**

Cover source-only, target-only, equal, source newer, target newer, one-side changed since manifest, both changed, verified deletion, unverified deletion, deletion+modification conflict, both missing, and each conflict policy in both directions.

- [ ] **Step 2: Verify planner RED**

Run: `npm test -- --grep "planner|policy|deletion"`

Expected: FAIL because `SyncPlanner.plan` does not exist.

- [ ] **Step 3: Implement deterministic planner rules**

Use `(lastModified, size)` for manifest equality. `latest` skips tied-time/different-size conflicts, `source-overwrite` selects source for a true two-sided conflict, `skip` never overwrites an existing path, and `rename` emits two cross-copy actions using `.conflict-source-<runStamp>` and `.conflict-target-<runStamp>` names.

- [ ] **Step 4: Verify planner GREEN and stability**

Run: `npm test -- --grep "planner|policy|deletion"`

Expected: all planner tests pass; calling the planner twice with equal inputs returns deeply equal serializable plans except for explicitly supplied IDs.

- [ ] **Step 5: Run full tests and diff check**

Run: `npm test && git diff --check`

Expected: planner/state/security tests pass; remaining controller/UI cases may still fail.

---

### Task 4: Bind profiles to real folder pairs and reject unsafe pairs

**Files:**
- Modify: `file-nally.html` IndexedDB/selection/controller sections
- Modify: `tests/file-nally.e2e.cjs`

**Interfaces:**
- Produces: `HandleStore.open()`, `HandleStore.put(profileId, sourceHandle, targetHandle)`, `HandleStore.findMatching(sourceHandle, targetHandle)`, and `validateFolderPair(sourceHandle, targetHandle)`.
- Controller produces a verified profile only after both handles match via `isSameEntry()`.

- [ ] **Step 1: Write failing pair-binding tests**

Test exact-pair reuse, same names but different handle identities, same folder rejection, source-inside-target rejection, target-inside-source rejection, IndexedDB unavailable fallback, and restored handle permission states.

- [ ] **Step 2: Verify pair-binding RED**

Run: `npm test -- --grep "profile|folder pair|nested|permission"`

Expected: FAIL because current state has one global manifest and no identity checks.

- [ ] **Step 3: Implement IndexedDB handle storage and safe fallback**

Use database `file-nally-handles`, version 1, object store `pairs`, key path `profileId`. Store only handles and update timestamps. If IndexedDB fails, keep the pair in memory and mark persisted profiles unverified after reload.

- [ ] **Step 4: Implement pair validation and controller invalidation**

Reject `isSameEntry()` matches and non-empty results from either direction's `resolve()`. Any folder/config change clears `currentPlan`, disables sync, and requires a new comparison.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- --grep "profile|folder pair|nested|permission" && npm test`

Expected: all binding cases pass and an unrelated manifest never produces a trash action.

---

### Task 5: Implement checkpointed execution, versioned trash, and abort

**Files:**
- Modify: `file-nally.html` file adapter/executor section
- Modify: `tests/file-nally.e2e.cjs`

**Interfaces:**
- Produces: `FileAdapter.scan()`, `FileAdapter.copy()`, `FileAdapter.moveToTrash()`, and `SyncExecutor.run(plan, context)`.
- `SyncExecutor.run` returns `{ status: "success"|"aborted"|"failed", completed, total, errors }`.

- [ ] **Step 1: Write failing execution tests**

Test nested copy, target→source copy, rename conflict preservation, `.trash/<runStamp>/<path>`, repeated trash runs without overwrite, abort after current write, write failure stopping later actions, and successful-action manifest checkpoint persistence.

- [ ] **Step 2: Verify execution RED**

Run: `npm test -- --grep "copy|trash|abort|checkpoint|write failure"`

Expected: FAIL against the current flat trash and non-checkpointed executor.

- [ ] **Step 3: Implement minimal adapter and executor**

Validate every relative path segment, create directories recursively, close each writable before recording success, save JSON after each completed action, and check the abort flag only between actions.

- [ ] **Step 4: Verify execution GREEN**

Run: `npm test -- --grep "copy|trash|abort|checkpoint|write failure"`

Expected: all execution cases pass and no action after the first injected failure runs.

- [ ] **Step 5: Run full suite**

Run: `npm test`

Expected: all state, planner, pair, execution, and original regression tests pass except explicitly pending visual/accessibility cases.

---

### Task 6: Replace unsafe rendering and repair the controller state machine

**Files:**
- Modify: `file-nally.html` markup/render/controller sections
- Modify: `tests/file-nally.e2e.cjs`

**Interfaces:**
- Produces render helpers that accept strings and nodes but never HTML fragments from external data.
- Controller states: `idle`, `ready`, `comparing`, `planned`, `syncing`, `aborting`, `success`, `error`.

- [ ] **Step 1: Write failing security and state-transition tests**

Test malicious filenames, malicious imported history/time/count strings, malicious thrown error messages, compare success/failure re-enabling controls, sync availability only in `planned`, abort unavailable during comparison, and stale plan rejection after config change.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --grep "untrusted|malicious|controls|stale plan|comparison"`

Expected: the filename XSS and locked comparison regressions fail.

- [ ] **Step 3: Implement DOM-safe rendering**

Create elements with `document.createElement`, assign all external text with `textContent`, use `DocumentFragment` for tables/logs, cap rendered logs at 500 rows, and reserve `innerHTML` only for static SVG sprite markup authored in the file.

- [ ] **Step 4: Implement explicit controller transitions**

Centralize enable/disable logic in `renderControls(state)`. Every async compare and sync path must set a terminal state in `finally`; comparison must never enable abort.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- --grep "untrusted|malicious|controls|stale plan|comparison" && npm test`

Expected: injected strings remain text, no `/x` image request occurs, controls recover from both success and error, and the full behavior suite passes.

---

### Task 7: Rebuild the one-page UI responsively and accessibly

**Files:**
- Modify: `file-nally.html` CSS and semantic markup
- Modify: `tests/file-nally.e2e.cjs`
- Read/obey: `DESIGN.md`

**Interfaces:**
- Preserves all existing control IDs needed by the controller and tests.
- Adds `aria-live` status/log regions and accessible SVG icon labels.

- [ ] **Step 1: Write failing responsive/accessibility tests**

For 375×900, 768×1000, and 1280×900, assert `scrollWidth === clientWidth`; check unique accessible names, semantic landmarks, visible focus outlines, status live regions, disabled states, and computed foreground/background contrast ≥4.5 for normal text.

- [ ] **Step 2: Verify visual/accessibility RED**

Run: `npm test -- --grep "viewport|accessibility|contrast|focus"`

Expected: current mobile overflow and contrast tests fail.

- [ ] **Step 3: Implement token-driven CSS and semantic markup**

Use the `DESIGN.md` tokens, a 4px spacing grid, responsive single-column cards below 760px, wrapping action buttons, `min-width: 520px` inside horizontally scrollable table wrappers, `overflow-wrap: anywhere` only for paths/logs, `:focus-visible` rings, `prefers-reduced-motion`, and SVG symbols instead of emoji icons.

- [ ] **Step 4: Verify responsive/accessibility GREEN**

Run: `npm test -- --grep "viewport|accessibility|contrast|focus"`

Expected: all three viewports have zero document-level overflow and all automated accessibility assertions pass.

- [ ] **Step 5: Capture fresh screenshots**

Run: `npm run test:visual`

Expected artifacts: `artifacts/visual/mobile.png`, `artifacts/visual/tablet.png`, `artifacts/visual/desktop.png`, plus interaction-state captures for focus, planned, syncing, success, and error.

---

### Task 8: Documentation, compatibility, and final verification

**Files:**
- Modify: `README.md`
- Verify: `file-nally.html`, `DESIGN.md`, `package.json`, `tests/**`

**Interfaces:**
- Documents the exact v2 JSON schema behavior, policies, browser requirements, safety limitations, and development commands.

- [ ] **Step 1: Update README from verified behavior**

Document single-file runtime, dev-only tests, profile-scoped manifests, IndexedDB handle limitation, policy semantics, versioned trash layout, legacy JSON migration, mobile behavior, and the warning that important data still requires backup.

- [ ] **Step 2: Run JavaScript syntax verification**

Run: `sed -n '/<script>/,/<\/script>/p' file-nally.html | sed '1d;$d' | node --check -`

Expected: exit 0 with no output.

- [ ] **Step 3: Run the complete automated suite fresh**

Run: `npm test`

Expected: exit 0, every named test passes, no browser console errors or unhandled rejections.

- [ ] **Step 4: Run final static checks**

Run: `git diff --check && rg -n "innerHTML" file-nally.html && git status --short`

Expected: no whitespace errors; every remaining `innerHTML` occurrence is static authored SVG/template content with no external interpolation; status lists only intended files.

- [ ] **Step 5: Run real-browser visual QA**

Open the fresh 375px, 768px, and 1280px captures; verify no clipped controls, vertical Korean word breaks, table overlap, CJK baseline clipping, or missing states. Inspect focus, planned, syncing, success, error, and both languages.

- [ ] **Step 6: Compare requirements against the approved design**

Verify every completion criterion in `docs/superpowers/specs/2026-07-14-single-html-refactor-design.md`, report any gap instead of claiming completion, and leave the worktree unstaged and uncommitted.
