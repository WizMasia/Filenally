# Version Capture Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the live destination file and a validated metadata record under `.filenally` before any synchronization copy overwrites that destination.

**Architecture:** Add a small `VersionStore` module inside the existing standalone JavaScript and invoke it as the executor's mandatory precondition for `copy` actions. Keep the planner unchanged, check the live destination at execution time, fail closed on capture/index errors, and add optional version fields to detailed run logs.

**Tech Stack:** Vanilla JavaScript, File System Access API, localStorage/IndexedDB for existing application state and logs, Node.js test runner, Playwright browser integration tests, generated standalone HTML.

**Spec:** `docs/superpowers/specs/2026-09-13-version-capture-foundation-design.md`

## Global Constraints

- Store versions only inside the affected root at `.filenally/versions/<capture-id>/<original-relative-path>`.
- Store metadata in `.filenally/index.json` using schema version 1.
- Limit the index to 5 MiB and 100,000 records.
- Abort before overwriting when version bytes or index persistence fails.
- Never silently reset a damaged, unsupported, oversized, or over-limit index.
- Always exclude every directory named `.filenally`, regardless of visible user exclusions.
- Do not change the application settings schema version 2.
- Do not replace the existing versioned `.trash` deletion flow.
- Do not add automatic retention, cleanup, restore, diff, compression, deduplication, or persistent hashing.
- Do not add dependencies.
- Use the existing safe relative-path and forbidden-key defenses.
- Regenerate `file-nally.html` from `dev/`; never edit the generated JavaScript inline.
- Every production change follows RED → GREEN and every task receives an independent review.

## File Structure

- Modify `dev/js/file-nally.js`: reserved exclusion, `VersionStore`, executor integration, run-log normalization and CSV fields.
- Modify `file-nally.html`: generated artifact only, via `npm run build`.
- Modify `tests/support/mock-file-system.cjs`: controlled write/close failures and live filesystem inspection.
- Modify `tests/file-nally.e2e.cjs`: index, capture, failure, direction, logging, and export regression tests.
- Modify `README.md`: Korean storage and safety documentation.
- Modify `docs/README_en.md`: English storage and safety documentation.
- Modify `docs/BUILD.md` only if the current verification checklist does not already name every command used by this plan.

---

### Task 1: Reserved Directory and Version Index Contract

**Files:**
- Modify: `dev/js/file-nally.js:7-150`
- Modify: `tests/file-nally.e2e.cjs:100-405`
- Generate: `file-nally.html`

**Interfaces:**
- Consumes: existing `MAX_IMPORT_BYTES`, `FORBIDDEN_KEYS`, `normalizeExcludes()`, `safeSegments()`, `cloneJson()`.
- Produces: `VersionStore.emptyIndex(): { schemaVersion: 1, versions: [] }`.
- Produces: `VersionStore.parseIndexText(text: string): VersionIndex`; throws on invalid, oversized, unsupported, malformed, forbidden-key, or over-limit input.
- Produces: `VersionStore.cleanRecord(value): VersionRecord | null` for allowlisted schema v1 fields.
- Produces: `VersionStore` on `window.FileNallyTest` for pure contract tests.

- [ ] **Step 1: Write failing index-contract tests**

Add literal behavior tests to `tests/file-nally.e2e.cjs`:

```javascript
add('version index accepts schema v1 and reconstructs allowlisted records', async ({ page }) => {
  const parsed = await page.evaluate(() => window.FileNallyTest.VersionStore.parseIndexText(JSON.stringify({
    schemaVersion: 1,
    versions: [{
      id: 'version-1',
      capturedAt: '2026-09-13T00:00:00.000Z',
      originalPath: 'docs/report.txt',
      storedPath: 'versions/version-1/docs/report.txt',
      size: 4,
      type: 'text/plain',
      lastModified: 100,
      reason: 'before-overwrite',
      runId: 'run-1',
      direction: 'unidirectional',
      fromSide: 'source',
      toSide: 'target',
      ignored: 'drop-me',
    }],
  })));
  assert.deepEqual(parsed, {
    schemaVersion: 1,
    versions: [{
      id: 'version-1',
      capturedAt: '2026-09-13T00:00:00.000Z',
      originalPath: 'docs/report.txt',
      storedPath: 'versions/version-1/docs/report.txt',
      size: 4,
      type: 'text/plain',
      lastModified: 100,
      reason: 'before-overwrite',
      runId: 'run-1',
      direction: 'unidirectional',
      fromSide: 'source',
      toSide: 'target',
    }],
  });
});

add('version index rejects unsafe or unsupported input without resetting it', async ({ page }) => {
  const results = await page.evaluate(() => {
    const parse = window.FileNallyTest.VersionStore.parseIndexText;
    const inputs = [
      '{"schemaVersion":2,"versions":[]}',
      '{"schemaVersion":1,"versions":[{"id":"v","originalPath":"../escape"}]}',
      '{"schemaVersion":1,"versions":{"not":"an array"}}',
      '{"schemaVersion":1,"versions":[],"constructor":{}}',
    ];
    return inputs.map((text) => {
      try { parse(text); return 'accepted'; } catch (error) { return error.message; }
    });
  });
  assert.deepEqual(results.map((value) => value === 'accepted'), [false, false, false, false]);
});
```

- [ ] **Step 2: Write the failing forced-exclusion test**

```javascript
add('reserved version directories never enter scans or plans', async ({ page }) => {
  await mountPair(page, {
    source: {
      '.filenally': { type: 'directory', entries: {
        'index.json': { content: '{"schemaVersion":1,"versions":[]}' },
        versions: { type: 'directory', entries: { secret: { type: 'directory', entries: {
          'old.txt': { content: 'old' },
        } } } },
      } },
      'visible.txt': { content: 'new' },
    },
    target: {},
  });
  await page.locator('#excludeDirs').fill('');
  await compare(page);
  const plan = await page.evaluate(() => window.FileNallyTest.getModel().plan);
  assert.deepEqual(plan.actions.map(({ type, path }) => ({ type, path })), [
    { type: 'copy', path: 'visible.txt' },
  ]);
  assert.doesNotMatch(await page.locator('#srcFileBody').innerText(), /\.filenally|old\.txt/);
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node tests/file-nally.e2e.cjs --grep "version index|reserved version"
```

Expected: FAIL because `VersionStore` is not exported/defined and `.filenally` is not forced into exclusions.

- [ ] **Step 4: Implement the schema v1 parser and forced exclusion**

Add constants and keep the existing normalized exclusion list as the single scan input:

```javascript
const VERSION_INDEX_SCHEMA = 1;
const MAX_VERSION_RECORDS = 100000;
const RESERVED_EXCLUDES = ['.trash', '.filenally'];
const DEFAULT_EXCLUDES = ['node_modules', '.git', 'dist', 'temp', ...RESERVED_EXCLUDES];

const normalizeExcludes = (value) => {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const normalized = values.map((item) => String(item).trim()).filter(Boolean);
  normalized.push(...RESERVED_EXCLUDES);
  return [...new Set(normalized)].slice(0, 100);
};
```

Create `VersionStore` after the shared path utilities. Reuse the recursive forbidden-key check by extracting it from `StateStore` into a shared helper without weakening the existing directory-manifest exception. Reconstruct records from an explicit field allowlist:

```javascript
const VersionStore = (() => {
  const emptyIndex = () => ({ schemaVersion: VERSION_INDEX_SCHEMA, versions: [] });
  const cleanRecord = (value) => {
    if (!isObject(value)
      || typeof value.id !== 'string' || !value.id
      || typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))
      || typeof value.originalPath !== 'string'
      || typeof value.storedPath !== 'string'
      || !Number.isFinite(Number(value.size))
      || !Number.isFinite(Number(value.lastModified))
      || value.reason !== 'before-overwrite'
      || !['bidirectional', 'unidirectional', 'reverse'].includes(value.direction)
      || !['source', 'target'].includes(value.fromSide)
      || !['source', 'target'].includes(value.toSide)
      || value.fromSide === value.toSide) return null;
    safeSegments(value.originalPath);
    const expectedStoredPath = ['versions', value.id, ...safeSegments(value.originalPath)].join('/');
    if (value.storedPath !== expectedStoredPath) return null;
    return {
      id: value.id,
      capturedAt: value.capturedAt,
      originalPath: value.originalPath,
      storedPath: expectedStoredPath,
      size: Number(value.size),
      type: typeof value.type === 'string' ? value.type : '',
      lastModified: Number(value.lastModified),
      reason: 'before-overwrite',
      runId: typeof value.runId === 'string' ? value.runId : '',
      direction: value.direction,
      fromSide: value.fromSide,
      toSide: value.toSide,
    };
  };
  const parseIndexText = (text) => {
    if (new Blob([text]).size > MAX_IMPORT_BYTES) throw new Error('Version index exceeds 5MB');
    const raw = JSON.parse(text);
    rejectForbidden(raw);
    if (!isObject(raw) || raw.schemaVersion !== VERSION_INDEX_SCHEMA || !Array.isArray(raw.versions)) {
      throw new Error('Unsupported version index');
    }
    if (raw.versions.length > MAX_VERSION_RECORDS) throw new Error('Version index has too many records');
    const versions = raw.versions.map(cleanRecord);
    if (versions.some((record) => !record)) throw new Error('Malformed version record');
    return { schemaVersion: VERSION_INDEX_SCHEMA, versions };
  };
  return Object.freeze({ cleanRecord, emptyIndex, parseIndexText });
})();
```

Export `VersionStore` through `window.FileNallyTest`.

- [ ] **Step 5: Generate and verify GREEN**

Run:

```bash
npm run build
node tests/file-nally.e2e.cjs --grep "version index|reserved version"
npm run build:check
git diff --check
```

Expected: focused tests PASS; generated HTML is current; no whitespace errors.

- [ ] **Step 6: Commit**

```bash
git add dev/js/file-nally.js file-nally.html tests/file-nally.e2e.cjs
git commit -m "feat: define version index contract"
```

---

### Task 2: Capture Live Destination Before Overwrite

**Files:**
- Modify: `dev/js/file-nally.js:610-1145`
- Modify: `tests/file-nally.e2e.cjs:820-920`
- Modify: `tests/support/mock-file-system.cjs:1-280`
- Generate: `file-nally.html`

**Interfaces:**
- Consumes: Task 1 `VersionStore.emptyIndex()`, `VersionStore.parseIndexText()`, `safeSegments()`, `uid()`, `nowIso()`.
- Produces: `VersionStore.capture({ action, handles, runId, direction }): Promise<VersionRecord | null>`.
- Produces: shared `directoryFor(root, parts, create)` and `fileHandleFor(root, path)` helpers used by VersionStore and FileAdapter.
- Contract: returns `null` only when the live destination file is absent; never creates `.filenally` for a new-file copy.

- [ ] **Step 1: Extend the filesystem double for exact inspection**

Add a helper that reads a file by relative path without changing production behavior:

```javascript
window.__getMockFile = (side, path) => {
  const parts = path.split('/');
  const name = parts.pop();
  const entry = getDirectory(window.__mockPair[side], parts).entries.get(name);
  if (!entry || entry.kind !== 'file') throw new Error(`File not found: ${path}`);
  return { content: entry.content, lastModified: entry.lastModified };
};
```

Keep this helper in `tests/support/mock-file-system.cjs`; do not add test-only methods to production modules.

- [ ] **Step 2: Write failing Source → Target and new-file tests**

```javascript
add('one-way overwrite captures the live target before writing', async ({ page }) => {
  await page.locator('#dirOne').click();
  await mountPair(page, {
    source: { 'report.txt': { content: 'new', lastModified: 200 } },
    target: { 'report.txt': { content: 'old', lastModified: 100 } },
  });
  await compare(page);
  await executeCurrentPlan(page);
  const snapshot = await snapshotMockPair(page);
  assert.equal(snapshot.target['report.txt'].content, 'new');
  const index = JSON.parse(snapshot.target['.filenally']['index.json'].content);
  assert.equal(index.versions.length, 1);
  const version = index.versions[0];
  assert.equal(version.originalPath, 'report.txt');
  assert.equal(version.toSide, 'target');
  assert.equal(snapshot.target['.filenally'].versions[version.id]['report.txt'].content, 'old');
});

add('new-file copy does not create the version store', async ({ page }) => {
  await mountPair(page, { source: { 'new.txt': { content: 'new' } }, target: {} });
  await compare(page);
  await executeCurrentPlan(page);
  const snapshot = await snapshotMockPair(page);
  assert.equal(snapshot.target['new.txt'].content, 'new');
  assert.equal(snapshot.target['.filenally'], undefined);
});
```

- [ ] **Step 3: Write failing direction, repeat, and late-destination tests**

Add the direction table and repeated-capture assertions explicitly:

```javascript
add('version capture follows each copy destination', async ({ page }) => {
  const scenarios = [
    {
      control: '#dirBoth', owner: 'target',
      source: { content: 'incoming', lastModified: 200 },
      target: { content: 'existing', lastModified: 100 },
    },
    {
      control: '#dirOne', owner: 'target',
      source: { content: 'incoming', lastModified: 200 },
      target: { content: 'existing', lastModified: 100 },
    },
    {
      control: '#dirReverse', owner: 'source',
      source: { content: 'existing', lastModified: 100 },
      target: { content: 'incoming', lastModified: 200 },
    },
  ];
  for (const scenario of scenarios) {
    await page.locator(scenario.control).click();
    await mountPair(page, {
      source: { 'report.txt': scenario.source },
      target: { 'report.txt': scenario.target },
    });
    await compare(page);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    const index = JSON.parse(snapshot[scenario.owner]['.filenally']['index.json'].content);
    assert.equal(index.versions.length, 1);
    assert.equal(snapshot[scenario.owner]['.filenally'].versions[index.versions[0].id]['report.txt'].content, 'existing');
    await page.reload();
  }
});

add('repeated overwrites retain distinct versions', async ({ page }) => {
  await page.locator('#dirOne').click();
  await mountPair(page, {
    source: { 'report.txt': { content: 'one', lastModified: 200 } },
    target: { 'report.txt': { content: 'zero', lastModified: 100 } },
  });
  await compare(page);
  await executeCurrentPlan(page);
  await page.evaluate(() => window.__setMockFile('source', 'report.txt', {
    content: 'two', lastModified: 300,
  }));
  await compare(page);
  await executeCurrentPlan(page);
  const snapshot = await snapshotMockPair(page);
  const index = JSON.parse(snapshot.target['.filenally']['index.json'].content);
  assert.equal(index.versions.length, 2);
  assert.notEqual(index.versions[0].id, index.versions[1].id);
  assert.deepEqual(index.versions.map((version) =>
    snapshot.target['.filenally'].versions[version.id]['report.txt'].content), ['zero', 'one']);
});
```

For the execution-time check:

```javascript
add('a destination created after comparison is versioned before overwrite', async ({ page }) => {
  await mountPair(page, { source: { 'late.txt': { content: 'planned' } }, target: {} });
  await compare(page);
  await page.evaluate(() => window.__setMockFile('target', 'late.txt', { content: 'appeared' }));
  await executeCurrentPlan(page);
  const snapshot = await snapshotMockPair(page);
  const index = JSON.parse(snapshot.target['.filenally']['index.json'].content);
  assert.equal(snapshot.target['late.txt'].content, 'planned');
  assert.equal(snapshot.target['.filenally'].versions[index.versions[0].id]['late.txt'].content, 'appeared');
});
```

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
node tests/file-nally.e2e.cjs --grep "captures the live|version store|destination created|repeated overwrite|version capture follows"
```

Expected: FAIL because copies overwrite without creating `.filenally`.

- [ ] **Step 5: Implement live capture**

Move `directoryFor` and `fileHandleFor` out of the FileAdapter closure so both modules use the exact same safe path resolution.

Extend `VersionStore`:

```javascript
const getExistingFile = async (root, path) => {
  try {
    return await fileHandleFor(root, path);
  } catch (error) {
    if (error?.name === 'NotFoundError') return null;
    throw error;
  }
};

const writeFile = async (root, path, value) => {
  const parts = safeSegments(path);
  const name = parts.pop();
  const directory = await directoryFor(root, parts, true);
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(value);
  await writable.close();
};

const loadIndex = async (versionRoot) => {
  try {
    const handle = await versionRoot.getFileHandle('index.json');
    const file = await handle.getFile();
    if (file.size > MAX_IMPORT_BYTES) throw new Error('Version index exceeds 5MB');
    return parseIndexText(await file.text());
  } catch (error) {
    if (error?.name === 'NotFoundError') return emptyIndex();
    throw error;
  }
};

const capture = async ({ action, handles, runId, direction }) => {
  const root = handles[action.toSide];
  const destinationPath = action.destinationPath || action.path;
  const destination = await getExistingFile(root, destinationPath);
  if (!destination) return null;
  const snapshot = await destination.getFile();
  const id = uid();
  const storedPath = ['versions', id, ...safeSegments(destinationPath)].join('/');
  const filenally = await directoryFor(root, ['.filenally'], true);
  await writeFile(filenally, storedPath, snapshot);
  const index = await loadIndex(filenally);
  const record = cleanRecord({
    id,
    capturedAt: nowIso(),
    originalPath: destinationPath,
    storedPath,
    size: snapshot.size,
    type: snapshot.type,
    lastModified: snapshot.lastModified,
    reason: 'before-overwrite',
    runId,
    direction,
    fromSide: action.fromSide,
    toSide: action.toSide,
  });
  if (!record) throw new Error('Could not create version record');
  index.versions.push(record);
  await writeFile(filenally, 'index.json', JSON.stringify(index, null, 2));
  return Object.freeze(record);
};
```

Call capture in `SyncExecutor.run()` immediately before `FileAdapter.copy()`:

```javascript
if (action.type === 'copy') {
  const version = await VersionStore.capture({
    action,
    handles: context.handles,
    runId: plan.id,
    direction: context.direction,
  });
  if (version) {
    entry.versionId = version.id;
    entry.versionPath = version.storedPath;
  }
  await FileAdapter.copy(action, context.handles);
}
```

- [ ] **Step 6: Generate and verify GREEN**

Run:

```bash
npm run build
node tests/file-nally.e2e.cjs --grep "captures the live|version store|destination created|repeated overwrite|version capture follows"
npm test
git diff --check
```

Expected: focused and full suites PASS.

- [ ] **Step 7: Commit**

```bash
git add dev/js/file-nally.js file-nally.html tests/file-nally.e2e.cjs tests/support/mock-file-system.cjs
git commit -m "feat: capture files before overwrite"
```

---

### Task 3: Fail Closed Across Capture and Overwrite Errors

**Files:**
- Modify: `dev/js/file-nally.js:650-1145`
- Modify: `tests/support/mock-file-system.cjs:1-280`
- Modify: `tests/file-nally.e2e.cjs:820-980`
- Generate: `file-nally.html`

**Interfaces:**
- Consumes: Task 2 `VersionStore.capture()` and executor integration.
- Produces: test helper `window.__setMockFailure({ operation, name, occurrence })` scoped to filesystem writes/closes.
- Contract: any pre-overwrite failure retains the destination bytes; a post-capture overwrite failure retains the indexed version and exposes its metadata on the failed run entry.

- [ ] **Step 1: Add deterministic write/close failure controls**

Track failure rules inside the page-injected mock:

```javascript
window.__mockFailure = null;
window.__setMockFailure = (rule) => { window.__mockFailure = { ...rule, seen: 0 }; };
const shouldFail = (operation, name) => {
  const rule = window.__mockFailure;
  if (!rule || rule.operation !== operation || (rule.name && rule.name !== name)) return false;
  rule.seen += 1;
  return rule.seen === (rule.occurrence || 1);
};
```

In `MockFileHandle.createWritable()`, make `write` throw when `shouldFail('write', this.name)` and make `close` throw before committing content when `shouldFail('close', this.name)`. Preserve all existing `failWrite`, delays, and commit-on-close behavior.

- [ ] **Step 2: Write failing pre-overwrite safety tests**

Cover three literal cases:

```javascript
for (const failure of [
  { name: 'report.txt', operation: 'write', label: 'version bytes' },
  { name: 'index.json', operation: 'write', label: 'index write' },
  { name: 'index.json', operation: 'close', label: 'index close' },
]) {
  add(`a ${failure.label} failure leaves the destination unchanged`, async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: { 'report.txt': { content: 'new', lastModified: 200 } },
      target: { 'report.txt': { content: 'old', lastModified: 100 } },
    });
    await compare(page);
    await page.evaluate((rule) => window.__setMockFailure(rule), failure);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target['report.txt'].content, 'old');
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().phase), 'error');
  });
}
```

Add concrete damaged-index cases:

```javascript
for (const fixture of [
  { label: 'malformed', index: { content: '{bad json' } },
  { label: 'unsupported', index: { content: '{"schemaVersion":2,"versions":[]}' } },
  { label: 'oversized', index: { contentSize: (5 * 1024 * 1024) + 1 } },
]) {
  add(`a ${fixture.label} version index is never reset`, async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: { 'report.txt': { content: 'new', lastModified: 200 } },
      target: {
        'report.txt': { content: 'old', lastModified: 100 },
        '.filenally': { type: 'directory', entries: {
          'index.json': fixture.index,
        } },
      },
    });
    const before = await page.evaluate(() => window.__getMockFile('target', '.filenally/index.json'));
    await compare(page);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    const after = await page.evaluate(() => window.__getMockFile('target', '.filenally/index.json'));
    assert.equal(snapshot.target['report.txt'].content, 'old');
    assert.deepEqual(after, before);
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().phase), 'error');
  });
}

add('an over-limit version index is rejected by the parser', async ({ page }) => {
  const message = await page.evaluate(() => {
    const record = {
      id: 'v', capturedAt: '2026-09-13T00:00:00.000Z',
      originalPath: 'a', storedPath: 'versions/v/a',
      size: 0, type: '', lastModified: 0, reason: 'before-overwrite',
      runId: 'r', direction: 'bidirectional', fromSide: 'source', toSide: 'target',
    };
    try {
      window.FileNallyTest.VersionStore.parseIndexText(JSON.stringify({
        schemaVersion: 1,
        versions: Array.from({ length: 100001 }, () => record),
      }));
      return 'accepted';
    } catch (error) {
      return error.message;
    }
  });
  assert.notEqual(message, 'accepted');
});
```

- [ ] **Step 3: Write the failing post-capture overwrite test**

Configure the failure to hit the second `report.txt` write: the first is the version snapshot, the second is the real destination overwrite.

```javascript
add('destination write failure retains the indexed version and log reference', async ({ page }) => {
  await page.locator('#dirOne').click();
  await mountPair(page, {
    source: { 'report.txt': { content: 'new', lastModified: 200 } },
    target: { 'report.txt': { content: 'old', lastModified: 100 } },
  });
  await compare(page);
  await page.evaluate(() => window.__setMockFailure({
    operation: 'write', name: 'report.txt', occurrence: 2,
  }));
  await executeCurrentPlan(page);
  const snapshot = await snapshotMockPair(page);
  const index = JSON.parse(snapshot.target['.filenally']['index.json'].content);
  assert.equal(snapshot.target['report.txt'].content, 'old');
  assert.equal(snapshot.target['.filenally'].versions[index.versions[0].id]['report.txt'].content, 'old');
  const run = await page.evaluate(async () => {
    const id = JSON.parse(localStorage.getItem('smart_sync_state')).globalHistory[0].logId;
    return window.FileNallyTest.RunLogStore.get(id);
  });
  assert.equal(run.entries[0].status, 'failed');
  assert.equal(run.entries[0].versionId, index.versions[0].id);
});
```

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
node tests/file-nally.e2e.cjs --grep "failure leaves|damaged version index|destination write failure"
```

Expected: FAIL until failure injection and version-log retention are complete.

- [ ] **Step 5: Implement only the error-path changes required by RED**

- Do not catch and continue inside `VersionStore.capture()`.
- Treat only `NotFoundError` as a missing destination/index.
- Set `entry.versionId` and `entry.versionPath` before starting the real destination write.
- Let the existing executor catch mark the current entry failed and stop later actions.
- Preserve the current destination handle until capture and index close have succeeded.
- Never call `emptyIndex()` for parse, schema, size, record-count, write, close, permission, or type errors.

- [ ] **Step 6: Generate and verify GREEN**

Run:

```bash
npm run build
node tests/file-nally.e2e.cjs --grep "failure leaves|damaged version index|destination write failure"
npm test
git diff --check
```

Expected: all failure-path and full tests PASS with the old destination retained.

- [ ] **Step 7: Commit**

```bash
git add dev/js/file-nally.js file-nally.html tests/file-nally.e2e.cjs tests/support/mock-file-system.cjs
git commit -m "fix: fail closed when version capture fails"
```

---

### Task 4: Run-log Compatibility and Version Exports

**Files:**
- Modify: `dev/js/file-nally.js:350-410,960-1035,1090-1145,1360-1385`
- Modify: `tests/file-nally.e2e.cjs:900-1035`
- Generate: `file-nally.html`

**Interfaces:**
- Consumes: optional `entry.versionId` and `entry.versionPath` assigned by Tasks 2-3.
- Produces: normalized entries always containing `versionId: string` and `versionPath: string`.
- Produces: JSON run download with raw version fields.
- Produces: CSV columns `versionId` and `versionPath`.
- UI: add read-only version ID/path values to each run-detail row without changing dialog IDs or paging.

- [ ] **Step 1: Write failing legacy-normalization and export tests**

```javascript
add('legacy run entries normalize missing version fields', async ({ page }) => {
  const normalized = await page.evaluate(async () => {
    const run = {
      id: 'legacy-run', entries: [{
        sequence: 1, action: 'copy', path: 'a.txt', status: 'success',
      }],
    };
    await window.FileNallyTest.RunLogStore.put(run);
    return window.FileNallyTest.RunLogStore.get('legacy-run');
  });
  assert.equal(normalized.entries[0].versionId, '');
  assert.equal(normalized.entries[0].versionPath, '');
});

add('versioned overwrite exports raw version fields to JSON and CSV', async ({ page }) => {
  await page.locator('#dirOne').click();
  await mountPair(page, {
    source: { 'report.txt': { content: 'new', lastModified: 200 } },
    target: { 'report.txt': { content: 'old', lastModified: 100 } },
  });
  await compare(page);
  await executeCurrentPlan(page);
  const snapshot = await snapshotMockPair(page);
  const index = JSON.parse(snapshot.target['.filenally']['index.json'].content);
  await page.locator('.history-detail-button').first().click();

  const jsonPromise = page.waitForEvent('download');
  await page.locator('#btnDownloadRunJson').click();
  const json = JSON.parse(await downloadText(await jsonPromise));
  assert.equal(json.entries[0].versionId, index.versions[0].id);
  assert.equal(json.entries[0].versionPath, index.versions[0].storedPath);

  const csvPromise = page.waitForEvent('download');
  await page.locator('#btnDownloadRunCsv').click();
  const csv = await downloadText(await csvPromise);
  assert.match(csv, /versionId,versionPath/);
  assert.match(csv, new RegExp(index.versions[0].id));
  assert.match(csv, /versions\//);
});
```

- [ ] **Step 2: Write the failing failed-run detail presentation test**

Use Task 3's destination-write failure and assert both locales:

```javascript
add('failed overwrite details retain the captured version reference', async ({ page }) => {
  await page.locator('#dirOne').click();
  await mountPair(page, {
    source: { 'report.txt': { content: 'new', lastModified: 200 } },
    target: { 'report.txt': { content: 'old', lastModified: 100 } },
  });
  await compare(page);
  await page.evaluate(() => window.__setMockFailure({
    operation: 'write', name: 'report.txt', occurrence: 2,
  }));
  await executeCurrentPlan(page);
  const snapshot = await snapshotMockPair(page);
  const version = JSON.parse(snapshot.target['.filenally']['index.json'].content).versions[0];
  await page.locator('.history-detail-button').first().click();
  assert.match(await page.locator('#runDetailBody').innerText(), new RegExp(version.id));
  assert.match(await page.locator('#runDetailBody').innerText(), /\.filenally\/versions\//);
  await page.locator('#btnCloseRunDetail').click();
  await page.locator('#btnLangEn').click();
  await page.locator('.history-detail-button').first().click();
  assert.match(await page.locator('#runDetailBody').innerText(), new RegExp(version.id));
  assert.match(await page.locator('#runDetailBody').innerText(), /\.filenally\/versions\//);
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node tests/file-nally.e2e.cjs --grep "version fields|versioned overwrite exports|failed version capture detail"
```

Expected: FAIL because normalization, dialog rows, and CSV omit version metadata.

- [ ] **Step 4: Implement compatible log fields**

Add defaults when entries are created and normalized:

```javascript
versionId: typeof entry.versionId === 'string' ? entry.versionId : '',
versionPath: typeof entry.versionPath === 'string' ? entry.versionPath : '',
```

Add bilingual labels `versionIdHead` and `versionPathHead`. Render `versionPath` as `.filenally/<storedPath>` or `—`. Render text with `textContent`; never use `innerHTML`.

Extend the CSV allowlist without renaming existing columns:

```javascript
const columns = [
  'sequence', 'action', 'path', 'sourcePath', 'destinationPath',
  'fromSide', 'toSide', 'versionId', 'versionPath',
  'durationMs', 'status', 'error',
];
```

- [ ] **Step 5: Generate and verify GREEN**

Run:

```bash
npm run build
node tests/file-nally.e2e.cjs --grep "version fields|versioned overwrite exports|failed version capture detail"
npm test
git diff --check
```

Expected: focused and full suites PASS; old entries display `—`.

- [ ] **Step 6: Commit**

```bash
git add dev/js/file-nally.js file-nally.html tests/file-nally.e2e.cjs
git commit -m "feat: expose captured versions in run logs"
```

---

### Task 5: Bilingual Documentation and Full Verification

**Files:**
- Modify: `README.md:1-200`
- Modify: `docs/README_en.md:1-205`
- Modify: `docs/BUILD.md` only if required commands are absent
- Verify: `dev/js/file-nally.js`
- Verify: `file-nally.html`
- Verify: `tests/file-nally.e2e.cjs`

**Interfaces:**
- Consumes: the final storage layout, limits, failure semantics, log fields, and tested commands from Tasks 1-4.
- Produces: accurate Korean and English operator documentation.
- Produces: final green build, browser, visual, and whitespace evidence.

- [ ] **Step 1: Update the Korean manual**

Document these exact facts in `README.md`:

- Existing destination files are captured before overwrite.
- Captures live under the affected root's `.filenally/versions/<capture-id>/...`.
- Metadata lives in schema v1 `.filenally/index.json`.
- `.filenally` is always excluded.
- Capture/index failure prevents overwrite and stops the run.
- Deletion still uses `.trash`.
- Version recovery is manual in this increment; list/restore/diff UI is not present.
- There is no automatic expiry or cleanup.
- Creation date, author, owner, ACL, and similar metadata are unavailable.

- [ ] **Step 2: Update the English manual**

Mirror the same claims in `docs/README_en.md` without promising atomic index writes, automatic recovery, browser-independent permission, or metadata the platform cannot expose.

- [ ] **Step 3: Check build documentation**

Verify `docs/BUILD.md` contains every command used below. If any is missing, add the literal command to both Korean and English sections:

```bash
npm run build
npm run build:test
npm run build:check
npm test
npm run test:visual
git diff --check
```

- [ ] **Step 4: Run final generated-artifact checks**

```bash
npm run build
npm run build:test
npm run build:check
git diff --check
```

Expected: build pipeline PASS, generated HTML current, no whitespace errors.

- [ ] **Step 5: Run complete browser and visual verification**

```bash
npm test
npm run test:visual
```

Expected: every browser test passes in both commands. Inspect the generated 375 px, 768 px, and 1280 px screenshots, especially run-detail rows containing version fields, for clipping and document-level horizontal overflow.

- [ ] **Step 6: Review final scope**

```bash
git status --short
git diff --stat HEAD~4..HEAD
git log --oneline -5
```

Confirm:

- no dependency or application settings schema changes;
- no automatic deletion or cleanup;
- no version list, restore, or diff UI;
- no direct edits to generated JavaScript;
- only approved files changed.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/README_en.md docs/BUILD.md
git commit -m "docs: explain pre-overwrite version capture"
```

If `docs/BUILD.md` did not change, omit it from `git add`.

---

## Final Review Gate

After all five tasks have their own clean reviews:

1. Review the complete range from the plan's starting commit to HEAD against the design.
2. Treat destination-byte loss, silent index reset, `.filenally` leakage into synchronization, missing direction handling, path traversal, and log/export incompatibility as blocking.
3. Run one fix round for any findings and one scoped re-review.
4. Run `npm test`, `npm run test:visual`, `npm run build:check`, and `git diff --check` fresh on the final HEAD.
5. Use `superpowers:finishing-a-development-branch` to present integration options.
