# Empty Folder Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize empty directories safely in every supported direction and fix the existing one-way file-deletion branch that can remove the authoritative copy.

**Architecture:** Keep file snapshots and directory existence separate. Files remain in the existing manifest while profiles gain an optional `directoryManifest`; the pure planner emits ordered directory actions consumed by the existing controller and executor.

**Tech Stack:** Vanilla JavaScript, File System Access API, localStorage/IndexedDB, Node.js, Playwright, deterministic single-HTML build.

**Spec:** `docs/superpowers/specs/2026-09-12-empty-folder-sync-design.md`

## Global Constraints

- Keep `schemaVersion: 2`; missing directory history normalizes to `{}`.
- Edit runtime sources under `dev/` and regenerate `file-nally.html` with `npm run build`.
- Add no dependency and do not restructure the single-file application.
- Never recursively delete a directory; re-check emptiness immediately before removal.
- Preserve deleted empty-directory structure under `.trash/<run stamp>/<original path>`.
- Apply all three direction modes identically to files and directories.
- Use only a verified folder-pair manifest for deletion inference.
- Observe every new test fail for the intended missing behavior before writing production code.

---

### Task 1: Correct One-Way File Deletion Direction

**Files:**
- Modify: `tests/file-nally.e2e.cjs`
- Modify: `dev/js/file-nally.js`
- Regenerate: `file-nally.html`

**Interfaces:**
- Consumes: `SyncPlanner.plan({ source, target, manifest, trustedManifest, direction })`.
- Produces: authoritative `copy` actions when the non-authoritative file was deleted.

- [ ] **Step 1: Write two failing planner tests**

Add after the current verified-deletion planner test:

```js
  add('one-way source recreates a target file deleted on the non-authoritative side', async ({ page }) => {
    const actions = await page.evaluate(() => {
      const file = { name: 'kept.txt', path: 'kept.txt', size: 4, lastModified: 100 };
      const previous = { source: { size: 4, lastModified: 100 }, target: { size: 4, lastModified: 100 } };
      return window.FileNallyTest.SyncPlanner.plan({
        source: { 'kept.txt': file }, target: {}, manifest: { 'kept.txt': previous },
        trustedManifest: true, direction: 'unidirectional',
      }).actions;
    });
    assert.deepEqual(actions, [{
      type: 'copy', path: 'kept.txt', sourcePath: 'kept.txt', destinationPath: 'kept.txt',
      fromSide: 'source', toSide: 'target',
    }]);
  });

  add('reverse sync recreates a source file deleted on the non-authoritative side', async ({ page }) => {
    const actions = await page.evaluate(() => {
      const file = { name: 'kept.txt', path: 'kept.txt', size: 4, lastModified: 100 };
      const previous = { source: { size: 4, lastModified: 100 }, target: { size: 4, lastModified: 100 } };
      return window.FileNallyTest.SyncPlanner.plan({
        source: {}, target: { 'kept.txt': file }, manifest: { 'kept.txt': previous },
        trustedManifest: true, direction: 'reverse',
      }).actions;
    });
    assert.deepEqual(actions, [{
      type: 'copy', path: 'kept.txt', sourcePath: 'kept.txt', destinationPath: 'kept.txt',
      fromSide: 'target', toSide: 'source',
    }]);
  });
```

These tests catch removal of either authoritative-copy branch.

- [ ] **Step 2: Verify RED**

```bash
node tests/file-nally.e2e.cjs --grep "one-way source recreates|reverse sync recreates"
```

Expected: both tests receive `trash` rather than `copy`.

- [ ] **Step 3: Give the configured side authority before deletion inference**

Change the two one-sided file branches to this ordering:

```js
                } else if (sourceFile) {
                    if (direction === 'unidirectional') {
                        pushCopy(path, 'source', 'target'); sourceStatus = 'copy-out'; targetStatus = 'copy-in';
                    } else if (previous?.source && previous?.target) {
                        if (sameSnapshot(sourceFile, previous.source)) { actions.push({ type: 'trash', path, side: 'source' }); sourceStatus = 'trash'; }
                        else { sourceStatus = 'conflict'; conflicts += 1; }
                    } else if (direction === 'reverse') sourceStatus = 'protected';
                    else { pushCopy(path, 'source', 'target'); sourceStatus = 'copy-out'; targetStatus = 'copy-in'; }
                } else if (targetFile) {
                    if (direction === 'reverse') {
                        pushCopy(path, 'target', 'source'); targetStatus = 'copy-out'; sourceStatus = 'copy-in';
                    } else if (previous?.source && previous?.target) {
                        if (sameSnapshot(targetFile, previous.target)) { actions.push({ type: 'trash', path, side: 'target' }); targetStatus = 'trash'; }
                        else { targetStatus = 'conflict'; conflicts += 1; }
                    } else if (direction === 'bidirectional') { pushCopy(path, 'target', 'source'); targetStatus = 'copy-out'; sourceStatus = 'copy-in'; }
                    else targetStatus = 'protected';
```

- [ ] **Step 4: Build and verify GREEN**

```bash
npm run build
node tests/file-nally.e2e.cjs --grep "one-way source recreates|reverse sync recreates|planner handles verified deletion"
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add dev/js/file-nally.js tests/file-nally.e2e.cjs file-nally.html
git commit -m "fix: respect sync direction for deletions"
```

---

### Task 2: Add Directory State and Pure Planner Actions

**Files:**
- Modify: `tests/file-nally.e2e.cjs`
- Modify: `dev/js/file-nally.js`
- Regenerate: `file-nally.html`

**Interfaces:**
- Consumes: `StateStore.sanitize()` and the current pure planner.
- Produces: `profile.directoryManifest` and `SyncPlanner.plan({ sourceDirectories, targetDirectories, directoryManifest })`.

- [ ] **Step 1: Write failing normalization and planner tests**

Add this state test near the schema tests:

```js
  add('state normalizes safe directory history and rejects malformed entries', async ({ page }) => {
    const profile = await page.evaluate(() => window.FileNallyTest.StateStore.sanitize({
      schemaVersion: 2, config: {}, activeProfileId: 'pair',
      profiles: { pair: {
        id: 'pair', bindingStatus: 'verified', manifest: {}, history: [],
        directoryManifest: {
          'reports/archive': { source: true, target: false },
          '../escape': { source: true, target: true },
          invalid: { source: 'yes', target: 1 },
        },
      } },
    })).profiles.pair;
    assert.deepEqual(profile.directoryManifest, {
      'reports/archive': { source: true, target: false },
    });
  });
```

Add these literal planner assertions:

```js
  add('directory planner follows authority and safe structural ordering', async ({ page }) => {
    const result = await page.evaluate(() => window.FileNallyTest.SyncPlanner.plan({
      source: {}, target: {},
      sourceDirectories: ['new/child', 'new'],
      targetDirectories: ['removed', 'protected'],
      directoryManifest: { removed: { source: true, target: true } },
      trustedManifest: true, direction: 'unidirectional',
    }));
    assert.deepEqual(result.actions.map(({ type, path, side }) => ({ type, path, side })), [
      { type: 'create-directory', path: 'new', side: 'target' },
      { type: 'create-directory', path: 'new/child', side: 'target' },
      { type: 'trash-directory', path: 'removed', side: 'target' },
    ]);
    assert.equal(result.rows.find((row) => row.path === 'protected').targetStatus, 'protected');
  });

  add('directory planner baselines unknown pairs and propagates verified bidirectional deletion', async ({ page }) => {
    const result = await page.evaluate(() => ({
      baseline: window.FileNallyTest.SyncPlanner.plan({
        source: {}, target: {}, sourceDirectories: ['empty'], targetDirectories: ['empty'],
      }).actions,
      deletion: window.FileNallyTest.SyncPlanner.plan({
        source: {}, target: {}, sourceDirectories: [], targetDirectories: ['empty'],
        directoryManifest: { empty: { source: true, target: true } },
        trustedManifest: true, direction: 'bidirectional',
      }).actions,
    }));
    assert.deepEqual(result.baseline, [{ type: 'baseline-directory', path: 'empty' }]);
    assert.deepEqual(result.deletion, [{ type: 'trash-directory', path: 'empty', side: 'target' }]);
  });
```

The tests catch unsafe path acceptance, missing baseline state, wrong authority, and parent-first deletion.

- [ ] **Step 2: Verify RED**

```bash
node tests/file-nally.e2e.cjs --grep "state normalizes safe directory|directory planner"
```

Expected: `directoryManifest`, directory actions, and directory rows are absent.

- [ ] **Step 3: Normalize optional directory manifests**

Add beside `cleanManifest()`:

```js
        const cleanDirectoryManifest = (raw) => {
            const result = {};
            if (!isObject(raw)) return result;
            for (const [path, entry] of Object.entries(raw).slice(0, MAX_MANIFEST_ENTRIES)) {
                try { safeSegments(path); } catch { continue; }
                if (!isObject(entry)) continue;
                const source = entry.source === true;
                const target = entry.target === true;
                if (source || target) result[path] = { source, target };
            }
            return result;
        };
```

Set `directoryManifest: cleanDirectoryManifest(profile.directoryManifest)` in `sanitizeV2()`. Set `directoryManifest: {}` on legacy and newly created profile records.

- [ ] **Step 4: Extend planner inputs and directory planning**

Add the boundary helpers:

```js
        const asSet = (value) => value instanceof Set ? value : new Set(value || []);
        const directoryEntry = (path) => ({ kind: 'directory', name: safeSegments(path).at(-1), path });
        const depth = (path) => safeSegments(path).length;
```

Extend the planner signature exactly as follows. After file rename matching, add the directory loop below and add `kind: 'file'` to existing file rows:

```js
        const plan = ({
            source, target, manifest = {}, sourceDirectories = [], targetDirectories = [],
            directoryManifest = {}, trustedManifest = false, direction = 'bidirectional',
            conflictPolicy = 'latest', contentEquality, stamp = runStamp(),
        }) => {
```

```js
            const sourceDirs = asSet(sourceDirectories);
            const targetDirs = asSet(targetDirectories);
            const directoryActions = [];
            for (const path of new Set([...sourceDirs, ...targetDirs, ...Object.keys(directoryManifest || {})])) {
                const hasSource = sourceDirs.has(path);
                const hasTarget = targetDirs.has(path);
                const previous = trustedManifest ? directoryManifest[path] : null;
                const previousBoth = previous?.source && previous?.target;
                let sourceStatus = hasSource ? 'unchanged' : 'missing';
                let targetStatus = hasTarget ? 'unchanged' : 'missing';
                if (hasSource && hasTarget) {
                    if (!previous) {
                        directoryActions.push({ type: 'baseline-directory', path });
                        sourceStatus = targetStatus = 'baseline-directory';
                    }
                } else if (hasSource) {
                    if (direction === 'unidirectional') {
                        directoryActions.push({ type: 'create-directory', path, side: 'target' });
                        sourceStatus = 'copy-out'; targetStatus = 'create-directory';
                    } else if (previousBoth) {
                        directoryActions.push({ type: 'trash-directory', path, side: 'source' });
                        sourceStatus = 'trash-directory';
                    } else if (direction === 'reverse') sourceStatus = 'protected';
                    else {
                        directoryActions.push({ type: 'create-directory', path, side: 'target' });
                        sourceStatus = 'copy-out'; targetStatus = 'create-directory';
                    }
                } else if (hasTarget) {
                    if (direction === 'reverse') {
                        directoryActions.push({ type: 'create-directory', path, side: 'source' });
                        targetStatus = 'copy-out'; sourceStatus = 'create-directory';
                    } else if (previousBoth) {
                        directoryActions.push({ type: 'trash-directory', path, side: 'target' });
                        targetStatus = 'trash-directory';
                    } else if (direction === 'bidirectional') {
                        directoryActions.push({ type: 'create-directory', path, side: 'source' });
                        targetStatus = 'copy-out'; sourceStatus = 'create-directory';
                    } else targetStatus = 'protected';
                }
                if (hasSource || hasTarget) rows.push({
                    kind: 'directory', path,
                    source: hasSource ? directoryEntry(path) : null,
                    target: hasTarget ? directoryEntry(path) : null,
                    sourceStatus, targetStatus,
                });
            }
```

Sort and combine actions exactly as follows:

```js
const creates = directoryActions.filter((a) => a.type === 'create-directory').sort((a, b) => depth(a.path) - depth(b.path));
const baselines = directoryActions.filter((a) => a.type === 'baseline-directory');
const directoryTrashes = directoryActions.filter((a) => a.type === 'trash-directory').sort((a, b) => depth(b.path) - depth(a.path));
actions.unshift(...creates, ...baselines);
actions.push(...directoryTrashes);
```

- [ ] **Step 5: Build and verify GREEN**

```bash
npm run build
node tests/file-nally.e2e.cjs --grep "state normalizes safe directory|directory planner|state migration|planner handles verified deletion"
```

Expected: all focused planner and compatibility tests pass.

- [ ] **Step 6: Commit**

```bash
git add dev/js/file-nally.js tests/file-nally.e2e.cjs file-nally.html
git commit -m "feat: plan empty folder synchronization"
```

---

### Task 3: Scan and Execute Directory Actions Safely

**Files:**
- Modify: `tests/file-nally.e2e.cjs`
- Modify: `tests/support/mock-file-system.cjs` only if an existing helper cannot express the test fixture
- Modify: `dev/js/file-nally.js`
- Regenerate: `file-nally.html`

**Interfaces:**
- Consumes: directory actions from Task 2 and the existing mock directory API.
- Produces: `FileAdapter.scan() -> { files, directories }`, safe directory operations, controller directory state, and rebuilt directory manifests.

- [ ] **Step 1: Write failing end-to-end tests for creation and protection**

```js
  add('one-way sync creates a source empty folder and protects an untracked target folder', async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: { 'source-empty': { type: 'directory', entries: {} } },
      target: { 'target-only': { type: 'directory', entries: {} } },
    });
    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.deepEqual(actions.map(({ type, path, side }) => ({ type, path, side })), [
      { type: 'create-directory', path: 'source-empty', side: 'target' },
    ]);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.deepEqual(snapshot.target['source-empty'], {});
    assert.deepEqual(snapshot.target['target-only'], {});
  });

  add('one-way sync recreates an authoritative empty folder deleted from target', async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: { empty: { type: 'directory', entries: {} } },
      target: { empty: { type: 'directory', entries: {} } },
    });
    await compare(page);
    await executeCurrentPlan(page);
    await page.evaluate(() => window.__deleteMockEntry('target', 'empty'));
    await compare(page);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.deepEqual(snapshot.source.empty, {});
    assert.deepEqual(snapshot.target.empty, {});
  });
```

Add the reverse counterpart:

```js
  add('reverse sync recreates an authoritative empty folder deleted from source', async ({ page }) => {
    await page.locator('#dirReverse').click();
    const pair = { empty: { type: 'directory', entries: {} } };
    await mountPair(page, { source: pair, target: pair });
    await compare(page);
    await executeCurrentPlan(page);
    await page.evaluate(() => window.__deleteMockEntry('source', 'empty'));
    await compare(page);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.deepEqual(snapshot.source.empty, {});
    assert.deepEqual(snapshot.target.empty, {});
  });
```

- [ ] **Step 2: Write failing trash-order and last-moment safety tests**

```js
  add('one-way deletion preserves a synchronized empty tree in target trash', async ({ page }) => {
    await page.locator('#dirOne').click();
    const tree = { a: { type: 'directory', entries: { b: { type: 'directory', entries: { c: { type: 'directory', entries: {} } } } } } };
    await mountPair(page, { source: tree, target: tree });
    await compare(page);
    await executeCurrentPlan(page);
    await page.evaluate(() => window.__deleteMockEntry('source', 'a'));
    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.deepEqual(actions.map(({ type, path }) => ({ type, path })), [
      { type: 'trash-directory', path: 'a/b/c' },
      { type: 'trash-directory', path: 'a/b' },
      { type: 'trash-directory', path: 'a' },
    ]);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target.a, undefined);
    assert.deepEqual(Object.values(snapshot.target['.trash'])[0].a.b.c, {});
  });

  add('directory trash refuses a folder that becomes non-empty after comparison', async ({ page }) => {
    await page.locator('#dirOne').click();
    const pair = { empty: { type: 'directory', entries: {} } };
    await mountPair(page, { source: pair, target: pair });
    await compare(page);
    await executeCurrentPlan(page);
    await page.evaluate(() => window.__deleteMockEntry('source', 'empty'));
    await compare(page);
    await page.evaluate(() => window.__setMockFile('target', 'empty/late.txt', { content: 'late' }));
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target.empty['late.txt'].content, 'late');
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().phase), 'error');
  });
```

Add an excluded-directory test:

```js
  add('excluded directory trees never enter the plan or result tables', async ({ page }) => {
    await mountPair(page, {
      source: { '.git': { type: 'directory', entries: { empty: { type: 'directory', entries: {} } } } },
      target: {},
    });
    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.deepEqual(actions, []);
    assert.doesNotMatch(await page.locator('#srcFileBody').innerText(), /\.git/);
    assert.doesNotMatch(await page.locator('#tgtFileBody').innerText(), /\.git/);
  });
```

These tests catch missing scans, parent-first removal, recursive deletion, and omission of the final emptiness check.

- [ ] **Step 3: Verify RED**

```bash
node tests/file-nally.e2e.cjs --grep "empty folder|empty tree|directory trash|excluded directory"
```

Expected: the application sees no directories and cannot execute directory actions.

- [ ] **Step 4: Return tree snapshots from `FileAdapter.scan()`**

Replace the scanner with:

```js
        const scan = async (directory, excludes, currentPath = '') => {
            const files = new Map();
            const directories = new Set();
            for await (const entry of directory.values()) {
                const path = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                safeSegments(path);
                if (entry.kind === 'file') {
                    const file = await entry.getFile();
                    files.set(path, { kind: 'file', name: entry.name, path, size: file.size, lastModified: file.lastModified, handle: entry });
                } else if (!excludes.includes(entry.name)) {
                    directories.add(path);
                    const nested = await scan(entry, excludes, path);
                    for (const [key, value] of nested.files) files.set(key, value);
                    for (const nestedPath of nested.directories) directories.add(nestedPath);
                }
            }
            return { files, directories };
        };
```

- [ ] **Step 5: Implement non-recursive directory operations**

Add beside the file operations:

```js
        const createDirectory = async (action, handles) => {
            await directoryFor(handles[action.side], safeSegments(action.path), true);
        };
        const moveDirectoryToTrash = async (action, handles, stamp) => {
            const root = handles[action.side];
            const parts = safeSegments(action.path);
            const name = parts.pop();
            const parent = await directoryFor(root, parts, false);
            const directory = await parent.getDirectoryHandle(name);
            for await (const entry of directory.values()) {
                throw new DOMException(`Directory is not empty: ${entry.name}`, 'InvalidModificationError');
            }
            await directoryFor(root, ['.trash', stamp, ...parts, name], true);
            await parent.removeEntry(name);
        };
```

Export them through `FileAdapter`. Dispatch `create-directory` to `createDirectory()` and `trash-directory` to `moveDirectoryToTrash()` in `SyncExecutor.run()`. `baseline-directory` deliberately performs no filesystem call, matching file baseline actions.

- [ ] **Step 6: Connect scans and manifests to the controller**

Extend the model with `sourceDirectories: new Set()` and `targetDirectories: new Set()`. Add:

```js
    const buildDirectoryManifest = (sourceDirectories, targetDirectories) => {
        const manifest = {};
        for (const path of new Set([...sourceDirectories, ...targetDirectories])) {
            manifest[path] = { source: sourceDirectories.has(path), target: targetDirectories.has(path) };
        }
        return manifest;
    };
    const applyScans = (sourceScan, targetScan) => {
        model.sourceFiles = sourceScan.files;
        model.targetFiles = targetScan.files;
        model.sourceDirectories = sourceScan.directories;
        model.targetDirectories = targetScan.directories;
    };
```

Use the following pattern in compare and post-run rescan paths, with each path's existing `excludes` value:

```js
const [sourceScan, targetScan] = await Promise.all([
    FileAdapter.scan(model.source, excludes),
    FileAdapter.scan(model.target, excludes),
]);
applyScans(sourceScan, targetScan);
```

Pass both directory Sets and `model.profile.directoryManifest` to the planner. After execution, rebuild both manifests from the actual scans:

```js
model.profile.manifest = buildManifest(model.sourceFiles, model.targetFiles);
model.profile.directoryManifest = buildDirectoryManifest(model.sourceDirectories, model.targetDirectories);
```

- [ ] **Step 7: Render directories through the existing table path**

Replace `appendFileRow` with:

```js
    const appendEntryRow = (body, entry, path, status) => {
        const row = body.insertRow();
        const nameCell = row.insertCell();
        const isDirectory = entry.kind === 'directory';
        const name = document.createElement('div'); name.className = 'file-name'; name.textContent = isDirectory ? `${entry.name}/` : entry.name;
        const pathText = document.createElement('div'); pathText.className = 'file-path'; pathText.textContent = isDirectory ? `${path}/` : path;
        nameCell.append(name, pathText);
        row.insertCell().textContent = isDirectory ? '—' : entry.size < 1024 ? `${entry.size} B` : `${(entry.size / 1024).toFixed(1)} KB`;
        row.insertCell().textContent = isDirectory ? '—' : new Date(entry.lastModified).toLocaleString(language());
        const statusCell = row.insertCell();
        const [key, tone] = statusPresentation(status);
        const badge = document.createElement('span'); badge.className = `badge badge-${tone}`; badge.textContent = t(key);
        statusCell.append(badge);
    };
```

Build no-plan rows from the union of both file Maps and both directory Sets, using `directoryEntry(path)` for directory values. Call `appendEntryRow` from the existing row loop and keep changed-only filtering unchanged.

- [ ] **Step 8: Build and verify GREEN**

```bash
npm run build
node tests/file-nally.e2e.cjs --grep "empty folder|empty tree|directory trash|excluded directory|one-way source recreates|reverse sync recreates"
```

Expected: all directory and direction tests pass, and a late file prevents folder deletion.

- [ ] **Step 9: Commit**

```bash
git add dev/js/file-nally.js tests/file-nally.e2e.cjs tests/support/mock-file-system.cjs file-nally.html
git commit -m "feat: synchronize empty folders safely"
```

Omit `tests/support/mock-file-system.cjs` from staging if its existing helpers required no change.

---

### Task 4: Complete Bilingual UI and Run-Log Presentation

**Files:**
- Modify: `tests/file-nally.e2e.cjs`
- Modify: `dev/js/file-nally.js`
- Modify: `dev/file-nally.html`
- Regenerate: `file-nally.html`

**Interfaces:**
- Consumes: directory rows and raw directory action values.
- Produces: bilingual folder labels while preserving raw action names in CSV/JSON exports.

- [ ] **Step 1: Write a failing presentation/export test**

```js
  add('directory actions render bilingually and remain intact in JSON export', async ({ page }) => {
    await mountPair(page, { source: { empty: { type: 'directory', entries: {} } }, target: {} });
    await compare(page);
    assert.match(await page.locator('#tgtFileBody').innerText(), /폴더 생성/);
    await executeCurrentPlan(page);
    await page.locator('.history-detail-button').first().click();
    assert.match(await page.locator('#runDetailBody').innerText(), /폴더 생성/);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btnDownloadRunJson').click();
    const json = JSON.parse(await downloadText(await downloadPromise));
    assert.equal(json.entries[0].action, 'create-directory');
    const csvPromise = page.waitForEvent('download');
    await page.locator('#btnDownloadRunCsv').click();
    assert.match(await downloadText(await csvPromise), /create-directory,empty/);
  });
```

Add this assertion after switching to English in the existing language/accessibility coverage:

```js
assert.equal(await page.getByLabel('Show changed items only', { exact: true }).count(), 1);
```

This catches missing presentation mappings without asserting on mock internals.

- [ ] **Step 2: Verify RED**

```bash
node tests/file-nally.e2e.cjs --grep "directory actions render bilingually"
```

Expected: raw directory actions fall back to “기타” and folder status text is absent.

- [ ] **Step 3: Add bilingual keys and mappings**

Add these Korean/English status and action keys:

```js
statusCreateDirectory: '폴더 생성', statusBaselineDirectory: '폴더 기준 저장', statusTrashDirectory: '폴더 휴지통 이동',
actionCreateDirectory: '폴더 생성', actionBaselineDirectory: '폴더 기준 저장', actionTrashDirectory: '폴더 휴지통 이동',
```

```js
statusCreateDirectory: 'Create folder', statusBaselineDirectory: 'Save folder baseline', statusTrashDirectory: 'Move folder to trash',
actionCreateDirectory: 'Create folder', actionBaselineDirectory: 'Save folder baseline', actionTrashDirectory: 'Move folder to trash',
```

Map `create-directory`, `baseline-directory`, and `trash-directory` in both `statusPresentation()` and `actionText()`. Change visible “file(s)” filter/table/empty-state copy to “item(s)” in `TEXT` and the Korean HTML fallbacks; do not change IDs or table structure.

- [ ] **Step 4: Build and verify GREEN**

```bash
npm run build
node tests/file-nally.e2e.cjs --grep "directory actions render bilingually|run details persist|interactive controls expose"
```

Expected: folder actions render in both languages, exports keep raw action values, and accessibility tests pass.

- [ ] **Step 5: Commit**

```bash
git add dev/js/file-nally.js dev/file-nally.html tests/file-nally.e2e.cjs file-nally.html
git commit -m "feat: show folder actions in sync history"
```

---

### Task 5: Document and Verify the Feature

**Files:**
- Modify: `README.md`
- Modify: `docs/README_en.md`
- Modify: `docs/BUILD.md` only if its existing checklist lacks a command used here
- Regenerate: `file-nally.html`

**Interfaces:**
- Consumes: shipped empty-folder and direction-safe deletion behavior.
- Produces: user-facing safety documentation and a verified deterministic artifact.

- [ ] **Step 1: Update Korean and English manuals**

Add empty-folder synchronization to both feature lists. Document these exact semantics in the direction sections:

```text
단방향에서는 권위 폴더에 존재하는 파일과 빈 폴더를 반대편에 생성하거나 다시 생성합니다. 비권위 폴더에서 항목을 삭제해도 권위 원본은 삭제되지 않습니다. 권위 폴더에서 삭제된 것으로 신뢰된 매니페스트가 확인한 항목만 반대편의 실행별 .trash로 이동합니다.
```

```text
In one-way and reverse synchronization, files and empty folders on the authoritative side are created or recreated on the other side. Deleting an item on the non-authoritative side never deletes the authoritative copy. Only a deletion on the authoritative side confirmed by a trusted manifest moves the other copy into the run-specific .trash directory.
```

Also state that File-nally never recursively deletes non-empty directories and stops if a directory becomes non-empty after comparison.

- [ ] **Step 2: Run deterministic build checks**

```bash
npm run build
npm run build:test
npm run build:check
git diff --check
```

Expected: builder tests pass, generated HTML is current, and no whitespace errors appear.

- [ ] **Step 3: Run the complete functional suite**

```bash
npm test
```

Expected: the original 44 tests and every new test pass with zero page errors.

- [ ] **Step 4: Run visual verification**

```bash
npm run test:visual
```

Open the 375, 768, and 1280 px screenshots. Verify directory paths ending in `/`, em dashes, badges, filter copy, Korean wrapping, and tables have no clipping or document-level overflow.

- [ ] **Step 5: Review scope and artifact consistency**

```bash
git status --short
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- dev/js/file-nally.js dev/file-nally.html tests/file-nally.e2e.cjs tests/support/mock-file-system.cjs README.md docs/README_en.md
npm run build:check
```

Expected: no dependency change, no unrelated refactor, and `file-nally.html` matches the development sources.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md docs/README_en.md file-nally.html
git commit -m "docs: explain empty folder synchronization"
```

If `docs/BUILD.md` changed because its checklist was incomplete, include it explicitly in the same commit.
