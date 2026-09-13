# Version Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare a stored version with its current original or another same-root, same-path version without changing files or synchronization state.

**Architecture:** VersionStore prepares and revalidates pinned read-only snapshots. A pure VersionComparison unit computes exact equality, bounded UTF-8 line differences and optional fingerprints. VersionManager owns a separate comparison child dialog and cancellation lifecycle; restore state stays separate.

**Tech Stack:** Existing vanilla JavaScript, HTML/CSS, File System Access, TextDecoder, Web Crypto, Node and Playwright; existing three-source standalone HTML build.

**Spec:** `docs/superpowers/specs/2026-09-13-version-comparison-design.md` (approved 2026-09-13).

## Global Constraints

- The left side is the row's selected stored version; the right side defaults to the current original. Historical alternatives must match its exact `originalPath` in the same pinned physical root and exclude the left ID.
- Historical `fromSide`/`toSide` and the configured sync direction never select or reverse comparison operands. Current root labels are presentation only.
- No writes, deletes, directory creation, permission requests, restore tickets, settings/index/schema changes, plan invalidation, scan changes, manifest/checkpoint changes or global sync-progress updates.
- Preserve version index schema v1, duplicate-ID rejection, 5 MiB/100,000-record limits and case-insensitive reserved-path protections. Never repair/reset an invalid index.
- Revalidate canonical records, existence, handle identity where available, size, type and mtime before publication. Do not perform a second full byte pass for this validation.
- Results describe pinned read-time snapshots, not an atomic/live filesystem. Same-size/same-mtime external edits after snapshot acquisition are not guaranteed detectable by final metadata validation. Unreadable pinned Files abort analysis.
- Exact byte equality is authoritative. Reuse the existing 4 MiB comparator, including empty-file readability and early exit; hashes and normalized text never establish equality.
- Text: each file at most 512 KiB (524,288 bytes), 5,000 logical lines, 8,192 UTF-16 code units per line excluding its terminator.
- LCS: at most 2,000,000 cells including the boundary row/column after trimming equal prefix/suffix. Empty unmatched sides need no matrix. Delete before insert on ties.
- Yield to the browser task queue and check cancellation at least every 16,384 LCS-cell evaluations and between bounded row-generation/render batches.
- Render 200 diff rows per result page, 100 historical records per selector page, and three unchanged context lines around changes with explicit omitted ranges.
- UTF-8 fatal decoding; recognize one leading BOM; preserve all other content without normalization. Recognize CRLF/LF/lone CR and final-newline metadata. Invalid UTF-8, NUL, disallowed C0 and DEL receive a specific non-text summary.
- SHA-256: each input at most 16 MiB (16,777,216 bytes); process eligible files sequentially. Text/hash budgets are independent. No alternate hash, cache or post-cancellation publication.
- Missing current means missing/not compared, not empty. Stored-file/index/path/read failures are errors and clear old output.
- One logical active comparison; explicit start only. Stop/Close remain available while working. Old reads/digests/finally handlers cannot publish into or unlock a new session.
- Child-open guards must protect both controls and handlers, including parent refresh/paging/download/restore preparation/confirmation. Parent closure invalidates the child.
- Korean/English, textContent for untrusted data, accessible labels/live status, focus preservation, internal scrolling at 375/768/1280 px.
- No new dependency, editor, router, merge/patch, export, worker subsystem, retention or cleanup. Keep the three development sources and generated root HTML.
- RED → GREEN for meaningful behavior. Baseline is 173 regression cases. Keep #12 open; no remote push without approval.

---

## File Structure and Execution Order

| File | Responsibility |
|---|---|
| `dev/js/file-nally.js` | Read-only VersionStore APIs; pure VersionComparison; existing VersionManager integration and bilingual copy |
| `dev/file-nally.html` | Sibling native comparison dialog |
| `dev/css/file-nally.css` | Scoped comparison layout, diff rows and responsive scrolling |
| `tests/file-nally.e2e.cjs` | Store, engine, UI, race, non-mutation and visual cases using existing harness |
| `README.md`, `docs/README_en.md` | Actual workflow, limits and snapshot semantics |
| `file-nally.html` | Generated output only; never edit directly |

Tasks execute **1 → 2 → 3** because Task 3 consumes both earlier APIs. Do not split production JavaScript or modify the mock filesystem preemptively: its existing real File snapshots and per-test method overrides suffice. Keep each task's tests with its implementation. At execution start, use `superpowers:using-git-worktrees` to establish an isolated `codex/issue-12-version-comparison` workspace from the approved local baseline; preserve existing user changes. Do not switch branches in the middle of this planning turn.

### Task 1: Read-only comparison snapshots and final validation

**Files:** Modify `dev/js/file-nally.js` (existing filesystem helpers and VersionStore), `tests/file-nally.e2e.cjs`; generate `file-nally.html`.

**Interfaces:**

- Consume existing `VersionRecord` (the allowlisted object returned by `VersionStore.cleanRecord`), `VersionStore.list(root)`, private `readVersion(root, record)` and non-creating file lookup.
- Produce `comparisonCheck(isCancelled: () => boolean): void`, throwing `DOMException('Comparison stopped', 'AbortError')` when cancelled.
- Extend read helpers with an optional final `check: () => void = () => {}` callback; existing callers remain unchanged: `directoryFor(root, parts, create, check)`, `fileHandleFor(root, path, check)`, private `getExistingFile(root, path, check)`, private `loadIndex(versionRoot, check)`, `VersionStore.list(root, check)`, private `readVersion(root, selected, check)`.
- Produce `VersionStore.comparisonChoices(root, selected, {isCancelled = () => false} = {}): Promise<VersionRecord[]>`, sorted capture time descending then ID, excluding selected ID and other original paths.
- Produce `VersionStore.prepareComparison(root, leftRecord, rightRecord = null, {isCancelled = () => false} = {}): Promise<ComparisonSnapshot>`; null right record means current original.
- Produce `VersionStore.validateComparison(snapshot, {isCancelled = () => false} = {}): Promise<void>`; metadata/identity only, no byte reread.
- `ComparisonSnapshot = {root, path: string, left: ComparisonSide, right: ComparisonSide}`; freeze the container and both sides, not browser handles/Files.
- `ComparisonSide = {kind: 'version'|'current', record: VersionRecord|null, handle: FileSystemFileHandle|null, file: File|null, readAt: string}`. Left always exists. Only current right may have null handle/File. `readAt` is ISO time after acquiring that side's snapshot (or observing its absence).

- [ ] **Step 1: Add read-only store acceptance tests.** Register with the harness's existing `add`, `mountVersion`, `versionFixture`, `snapshotMockPair` helpers:

```javascript
add('version comparison store pins current snapshots without writes', async ({ page }) => {
  await mountVersion(page);
  const before = await snapshotMockPair(page);
  const result = await page.evaluate(async () => {
    const calls = window.__getPermissionCalls();
    const store = window.FileNallyTest.VersionStore;
    const snapshot = await store.prepareComparison(window.__mockPair.target, window.__versionRecord);
    await store.validateComparison(snapshot);
    return { left: await snapshot.left.file.text(), right: await snapshot.right.file.text(),
      path: snapshot.path, kinds: [snapshot.left.kind, snapshot.right.kind],
      frozen: Object.isFrozen(snapshot) && Object.isFrozen(snapshot.left),
      times: [snapshot.left.readAt, snapshot.right.readAt],
      callsBefore: calls, callsAfter: window.__getPermissionCalls() };
  });
  assert.equal(result.left, 'old'); assert.equal(result.right, 'current');
  assert.equal(result.path, 'report.txt'); assert.equal(result.frozen, true);
  assert.deepEqual(result.kinds, ['version', 'current']);
  assert.ok(result.times.every(value => Number.isFinite(Date.parse(value))));
  assert.deepEqual(result.callsAfter, result.callsBefore);
  assert.deepEqual(await snapshotMockPair(page), before);
});

add('version comparison store rejects observed replacement without rereading bytes', async ({ page }) => {
  await mountVersion(page);
  const error = await page.evaluate(async () => {
    const store = window.FileNallyTest.VersionStore;
    const snapshot = await store.prepareComparison(window.__mockPair.target, window.__versionRecord);
    for (const side of [snapshot.left, snapshot.right]) {
      side.file.arrayBuffer = () => { throw new Error('Unexpected byte reread'); };
      side.file.slice = () => { throw new Error('Unexpected byte reread'); };
    }
    await store.validateComparison(snapshot);
    window.__setMockFile('target', 'report.txt', { content: 'changed', lastModified: 201 });
    try { await store.validateComparison(snapshot); return ''; }
    catch (error) { return error.message; }
  });
  assert.match(error, /changed/);
});
```

- [ ] **Step 2: Run RED.** `node tests/file-nally.e2e.cjs --grep 'version comparison store'` must fail because `prepareComparison` is absent, not because of syntax, server or browser errors.

- [ ] **Step 3: Add cancellation checks to the existing read chain and extract canonical selection.** Check immediately before and after each awaited directory/file/index read, including `file.text()`. Pass `check` through, preserving existing validation and missing-file catches; never convert AbortError into missing. Use this exact helper pattern:

```javascript
const comparisonCheck = (isCancelled) => {
    if (isCancelled()) throw new DOMException('Comparison stopped', 'AbortError');
};
const directoryFor = async (root, parts, create, check = () => {}) => {
    let directory = root;
    check();
    for (const part of parts) {
        directory = await directory.getDirectoryHandle(part, { create });
        check();
    }
    return directory;
};
const fileHandleFor = async (root, path, check = () => {}) => {
    const parts = safeSegments(path);
    const name = parts.pop();
    check();
    const directory = await directoryFor(root, parts, false, check);
    check();
    const handle = await directory.getFileHandle(name);
    check();
    return handle;
};
// Inside VersionStore, reuse this in readVersion and comparisonChoices.
const selectedRecord = (records, selected) => {
    const expected = cleanRecord(selected);
    if (!expected) throw new Error('Invalid selected version');
    const record = records.find(record => record.id === expected.id);
    if (!record || JSON.stringify(record) !== JSON.stringify(expected)) {
        throw new Error('Selected version record changed');
    }
    return record;
};
const readVersion = async (root, selected, check = () => {}) => {
    check();
    const records = await list(root, check);
    check();
    const record = selectedRecord(records, selected);
    const path = ['.filenally', 'versions', record.id, ...originalSegments(record.originalPath)].join('/');
    const handle = await fileHandleFor(root, path, check);
    check();
    const file = await handle.getFile();
    check();
    if (file.size !== record.size) throw new Error('Stored version size changed');
    return { record, handle, file };
};
```

Complete the read chain as follows. The parser is unchanged; no cancellation callback is needed in write-only code.

```javascript
const getExistingFile = async (root, path, check = () => {}) => {
    check();
    try {
        const handle = await fileHandleFor(root, path, check);
        check();
        return handle;
    } catch (error) {
        check();
        if (error?.name === 'NotFoundError') return null;
        throw error;
    }
};
const loadIndex = async (versionRoot, check = () => {}) => {
    check();
    const handle = await getExistingFile(versionRoot, 'index.json', check);
    check();
    if (!handle) return emptyIndex();
    const file = await handle.getFile();
    check();
    if (file.size > MAX_IMPORT_BYTES) throw new Error('Version index exceeds 5MB');
    const text = await file.text();
    check();
    return parseIndexText(text);
};
const list = async (root, check = () => {}) => {
    check();
    let versionRoot;
    try { versionRoot = await root.getDirectoryHandle('.filenally'); }
    catch (error) {
        check();
        if (error?.name === 'NotFoundError') return [];
        throw error;
    }
    check();
    const { versions } = await loadIndex(versionRoot, check);
    check();
    if (new Set(versions.map(record => record.id)).size !== versions.length) throw new Error('Duplicate version IDs');
    return versions.map(Object.freeze);
};
```

- [ ] **Step 4: Implement the exported snapshot operations.** Add to the existing frozen VersionStore export; do not touch `preparedRestores`, `prepareRestore`, `requireSameFile`, or restore write behavior:

```javascript
const comparisonChoices = async (root, selected, { isCancelled = () => false } = {}) => {
    const check = () => comparisonCheck(isCancelled);
    check();
    const records = await list(root, check);
    check();
    const left = selectedRecord(records, selected);
    return records.filter(record => record.id !== left.id && record.originalPath === left.originalPath)
        .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt) || a.id.localeCompare(b.id));
};
const prepareComparison = async (root, leftRecord, rightRecord = null, { isCancelled = () => false } = {}) => {
    const check = () => comparisonCheck(isCancelled);
    check();
    const version = await readVersion(root, leftRecord, check);
    check();
    const left = Object.freeze({ kind: 'version', ...version, readAt: nowIso() });
    let right;
    if (rightRecord !== null) {
        if (rightRecord.id === left.record.id || rightRecord.originalPath !== left.record.originalPath) {
            throw new Error('Counterpart must be a different version of the same path');
        }
        const other = await readVersion(root, rightRecord, check);
        check();
        right = { kind: 'version', ...other, readAt: nowIso() };
    } else {
        const handle = await getExistingFile(root, left.record.originalPath, check);
        check();
        const file = handle ? await handle.getFile() : null;
        check();
        right = { kind: 'current', record: null, handle, file, readAt: nowIso() };
    }
    return Object.freeze({ root, path: left.record.originalPath, left, right: Object.freeze(right) });
};
const validateComparison = async (snapshot, { isCancelled = () => false } = {}) => {
    const check = () => comparisonCheck(isCancelled);
    check();
    const fresh = await prepareComparison(snapshot.root, snapshot.left.record,
        snapshot.right.kind === 'version' ? snapshot.right.record : null, { isCancelled });
    check();
    for (const key of ['left', 'right']) {
        const old = snapshot[key], next = fresh[key];
        if (Boolean(old.handle) !== Boolean(next.handle)) throw new Error('Comparison file changed');
        if (!old.handle) continue;
        if (old.handle.isSameEntry) {
            const same = await old.handle.isSameEntry(next.handle);
            check();
            if (!same) throw new Error('Comparison file identity changed');
        }
        if (old.file.size !== next.file.size || old.file.type !== next.file.type
            || old.file.lastModified !== next.file.lastModified) throw new Error('Comparison file changed');
    }
};
```

- [ ] **Step 5: Add table-driven safety tests before extending behavior.** Each row below is an independent `add('version comparison store …')` case using real mock handles. Assert rejection or literal expected output and compare full filesystem/permission snapshots after the intentional fixture mutation, not before it.

```javascript
for (const missing of [false, true]) {
  add(`version comparison store distinguishes empty and absent current: ${missing}`, async ({ page }) => {
    await mountVersion(page, { missing });
    if (!missing) await page.evaluate(() => window.__setMockFile('target', 'report.txt', { content: '' }));
    const before = await snapshotMockPair(page);
    const result = await page.evaluate(async () => {
      const store = window.FileNallyTest.VersionStore;
      const value = await store.prepareComparison(window.__mockPair.target, window.__versionRecord);
      await store.validateComparison(value);
      return value.right.file ? value.right.file.size : null;
    });
    assert.equal(result, missing ? null : 0);
    assert.deepEqual(await snapshotMockPair(page), before);
  });
}
```

| Fixture/mutation | Assertion |
|---|---|
| Two same-path records, other-path record, duplicate path on opposite root | Choices contain only local same-path different ID, sorted date then ID; historic comparison reads only the owning root |
| 102 same-path records with mixed capture times | API returns all 101 counterparts in deterministic order; UI paging is Task 3 |
| Wrong-root record absent locally; same ID with altered canonical metadata | Reject; no path fallback to the opposite root |
| Missing index/store, unsupported schema, invalid JSON, duplicate IDs | Selected record cannot be resolved; no repair or directory creation |
| Original `.FILENALLY/index.json`, nested `.Trash/x`, traversal, backslash, NUL | Existing safe-path rejection retained |
| Missing stored file, changed stored size, directory at file position, denied getFile | Reject, not missing-current summary |
| Current appears/disappears; either handle replaced; type/size/mtime changes | Final validation rejects; no content reread |
| Selected index entry changes while analyzing | Final validation rejects canonical mismatch |
| Cancel during delayed directory/index/getFile read | AbortError; next method's call counter remains zero |
| Same-size/same-mtime readable snapshot followed by unobservable external edit | Analyze pinned bytes; do not promise final metadata check detects this documented limitation |

- [ ] **Step 6: Verify and commit the store deliverable.** Run `npm run build`, focused `node tests/file-nally.e2e.cjs --grep 'version comparison store|version reader|version restore'`, then `npm test` and `git diff --check`. Record actual RED/GREEN counts, including all baseline tests. Stage only this task's sources, tests and generated HTML; commit `feat: add read-only version snapshots`. Review before Task 2.

### Task 2: Exact comparison, bounded text diff and fingerprints

**Files:** Modify `dev/js/file-nally.js` (a cohesive `VersionComparison` closure after VersionStore; add it to existing `window.FileNallyTest`), `tests/file-nally.e2e.cjs`; generate `file-nally.html`.

**Interfaces:**

- Consume `comparisonCheck(isCancelled)` from Task 1 and existing `equalFileBytes(left, right, onProgress = () => {}, isCancelled = () => false): Promise<boolean>` unchanged.
- Produce `VersionComparison.analyze(leftFile: File, rightFile: File|null, {isCancelled = () => false, onProgress = () => {}} = {}): Promise<ComparisonResult>`.
- `ComparisonResult = {kind: 'missing'|'identical'|'text'|'summary', equal: boolean|null, reason: null|'size'|'encoding'|'control'|'line-count'|'line-length'|'work-limit', formats: {left: TextFormat|null, right: TextFormat|null}, lineContentEqual: boolean|null, rows: DiffRow[], added: number, removed: number, hashes: {left: Fingerprint, right: Fingerprint}}`.
- `TextFormat = {bom: boolean, crlf: number, lf: number, cr: number, finalNewline: boolean}`.
- `DiffRow = {kind: 'context'|'remove'|'add'|'gap', leftLine: number|null, rightLine: number|null, text: string, count?: number}`. Gap count is an omitted unchanged range, with first omitted old/new line numbers and empty text.
- `Fingerprint = {status: 'ok'|'too-large'|'unavailable'|'missing', value: string}`; value is full lower-case hex only for `ok`, otherwise empty.
- Progress is `{stage: 'bytes'|'text'|'hash', done: number, total: number}`. Text uses evaluated cells, bytes uses the comparator's actually completed byte count, hash uses completed present files. A first-byte difference must not report a fully read byte pass.
- No File/root/handle retained in results. All helpers below are private inside VersionComparison except the Task 1 cancellation function.

- [ ] **Step 1: Add engine tests independent of the filesystem UI.**

```javascript
add('version comparison engine keeps byte truth and deterministic changed rows', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const analyze = window.FileNallyTest.VersionComparison.analyze;
    return {
      changed: await analyze(new File(['a\nb\nc\n'], 'a'), new File(['a\nx\nc\n'], 'b')),
      format: await analyze(new File(['\uFEFF가😀\r\n'], 'a'), new File(['가😀\n'], 'b')),
      missing: await analyze(new File([''], 'a'), null),
      equal: await analyze(new File(['same'], 'a', { lastModified: 1 }), new File(['same'], 'b', { lastModified: 2 }))
    };
  });
  assert.equal(result.changed.equal, false);
  assert.deepEqual(result.changed.rows.map(row => [row.kind, row.leftLine, row.rightLine, row.text]),
    [['context', 1, 1, 'a'], ['remove', 2, null, 'b'], ['add', null, 2, 'x'], ['context', 3, 3, 'c']]);
  assert.deepEqual([result.changed.added, result.changed.removed], [1, 1]);
  assert.equal(result.format.equal, false); assert.equal(result.format.lineContentEqual, true);
  assert.equal(result.format.formats.left.bom, true); assert.equal(result.format.formats.left.crlf, 1);
  assert.equal(result.missing.kind, 'missing'); assert.equal(result.missing.equal, null);
  assert.equal(result.equal.kind, 'identical'); assert.equal(result.equal.equal, true);
});

add('version comparison engine hashes known complete snapshots', async ({ page }) => {
  const result = await page.evaluate(() => window.FileNallyTest.VersionComparison.analyze(
    new File(['abc'], 'a'), new File(['abd'], 'b')));
  const { createHash } = require('node:crypto');
  assert.equal(result.hashes.left.value, createHash('sha256').update('abc').digest('hex'));
  assert.equal(result.hashes.right.value, createHash('sha256').update('abd').digest('hex'));
});
```

- [ ] **Step 2: Run RED.** `node tests/file-nally.e2e.cjs --grep 'version comparison engine'` must fail on absent VersionComparison.

- [ ] **Step 3: Implement bounded decoding and task-queue yielding inside VersionComparison.** Whole-file read errors deliberately escape the decoder catch; only decoder failures become encoding fallback.

```javascript
const TEXT_BYTES = 524288, TEXT_LINES = 5000, LINE_UNITS = 8192;
const MATRIX_CELLS = 2000000, HASH_BYTES = 16777216;
const pause = async (isCancelled) => {
    comparisonCheck(isCancelled);
    await new Promise(resolve => setTimeout(resolve, 0));
    comparisonCheck(isCancelled);
};
const decode = async (file, isCancelled) => {
    comparisonCheck(isCancelled);
    if (file.size > TEXT_BYTES) return { reason: 'size', format: null };
    const bytes = new Uint8Array(await file.arrayBuffer());
    comparisonCheck(isCancelled);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { return { reason: 'encoding', format: null }; }
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    if (bom) text = text.slice(1);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return { reason: 'control', format: null };
    const format = { bom, crlf: 0, lf: 0, cr: 0, finalNewline: /[\r\n]$/.test(text) };
    const lines = [];
    let start = 0;
    for (const match of text.matchAll(/\r\n|\r|\n/g)) {
        format[match[0] === '\r\n' ? 'crlf' : match[0] === '\n' ? 'lf' : 'cr']++;
        if (match.index - start > LINE_UNITS) return { reason: 'line-length', format: null };
        if (lines.length === TEXT_LINES) return { reason: 'line-count', format: null };
        lines.push(text.slice(start, match.index));
        start = match.index + match[0].length;
    }
    if (start < text.length) {
        if (text.length - start > LINE_UNITS) return { reason: 'line-length', format: null };
        if (lines.length === TEXT_LINES) return { reason: 'line-count', format: null };
        lines.push(text.slice(start));
    }
    return { reason: null, format, lines };
};
```

The bounded text buffer may be released once decoding returns; do not attach bytes or full decoded strings to results. Do not allocate an unbounded `split()` line array first and check its length afterwards.

- [ ] **Step 4: Implement bounded deterministic LCS and contextual rows.** No matrix is allocated before its inclusive work limit is checked. Row generation yields every 256 operations; context compaction also yields in bounded batches.

```javascript
const lineDiff = async (left, right, isCancelled, onProgress) => {
    let prefix = 0, suffix = 0;
    while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
    while (suffix < left.length - prefix && suffix < right.length - prefix
        && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix++;
    const n = left.length - prefix - suffix, m = right.length - prefix - suffix;
    if (!n && !m) return { reason: null, lineContentEqual: true, rows: [], added: 0, removed: 0 };
    const cells = (n + 1) * (m + 1);
    if (n && m && cells > MATRIX_CELLS) return { reason: 'work-limit' };
    let matrix = null;
    if (n && m) {
        matrix = new Uint32Array(cells);
        let done = 0;
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
            const at = i * (m + 1) + j;
            matrix[at] = left[prefix + i] === right[prefix + j]
                ? matrix[at + m + 2] + 1 : Math.max(matrix[at + m + 1], matrix[at + 1]);
            if (++done % 16384 === 0) {
                onProgress({ stage: 'text', done, total: n * m });
                await pause(isCancelled);
            }
        }
        onProgress({ stage: 'text', done: n * m, total: n * m });
    }
    comparisonCheck(isCancelled);
    const full = [];
    let added = 0, removed = 0;
    const append = (kind, i, j, text) => {
        full.push({ kind, leftLine: i === null ? null : i + 1, rightLine: j === null ? null : j + 1, text });
        if (kind === 'add') added++;
        if (kind === 'remove') removed++;
    };
    for (let k = 0; k < prefix; k++) {
        append('context', k, k, left[k]);
        if (full.length % 256 === 0) await pause(isCancelled);
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
        if (i < n && j < m && left[prefix + i] === right[prefix + j]) {
            append('context', prefix + i, prefix + j, left[prefix + i]); i++; j++;
        } else if (i < n && (j === m || (matrix && matrix[(i + 1) * (m + 1) + j] >= matrix[i * (m + 1) + j + 1]))) {
            append('remove', prefix + i, null, left[prefix + i]); i++;
        } else { append('add', null, prefix + j, right[prefix + j]); j++; }
        if (full.length % 256 === 0) await pause(isCancelled);
    }
    matrix = null;
    for (let k = suffix; k > 0; k--) {
        append('context', left.length - k, right.length - k, left[left.length - k]);
        if (full.length % 256 === 0) await pause(isCancelled);
    }
    const visible = new Uint8Array(full.length);
    for (let k = 0; k < full.length; k++) {
        if (full[k].kind !== 'context') visible.fill(1, Math.max(0, k - 3), Math.min(full.length, k + 4));
        if (k % 256 === 255) await pause(isCancelled);
    }
    const rows = [];
    let gap = null;
    for (let k = 0; k < full.length; k++) {
        if (visible[k]) { gap = null; rows.push(full[k]); }
        else if (gap) gap.count++;
        else { gap = { kind: 'gap', leftLine: full[k].leftLine, rightLine: full[k].rightLine, text: '', count: 1 }; rows.push(gap); }
        if (k % 256 === 255) await pause(isCancelled);
    }
    comparisonCheck(isCancelled);
    return { reason: null, lineContentEqual: false, rows, added, removed };
};
```

- [ ] **Step 5: Add bounded sequential fingerprints and compose analyze.** Read exceptions are outside the optional digest-capability catch. Check cancellation after the native digest settles, even when it rejects. Reusing one hash is permitted only after exact byte equality.

```javascript
const fingerprint = async (file, isCancelled) => {
    comparisonCheck(isCancelled);
    if (!file) return { status: 'missing', value: '' };
    if (file.size > HASH_BYTES) return { status: 'too-large', value: '' };
    if (!globalThis.crypto?.subtle?.digest) return { status: 'unavailable', value: '' };
    let buffer = await file.arrayBuffer();
    comparisonCheck(isCancelled);
    let digest;
    try { digest = await crypto.subtle.digest('SHA-256', buffer); }
    catch { comparisonCheck(isCancelled); return { status: 'unavailable', value: '' }; }
    finally { buffer = null; }
    comparisonCheck(isCancelled);
    return { status: 'ok', value: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') };
};
const analyze = async (leftFile, rightFile, { isCancelled = () => false, onProgress = () => {} } = {}) => {
    comparisonCheck(isCancelled);
    const result = { kind: 'missing', equal: null, reason: null,
        formats: { left: null, right: null }, lineContentEqual: null, rows: [], added: 0, removed: 0, hashes: null };
    if (rightFile) {
        result.equal = await equalFileBytes(leftFile, rightFile,
            (done, total) => onProgress({ stage: 'bytes', done, total }), isCancelled);
        comparisonCheck(isCancelled);
        result.kind = result.equal ? 'identical' : 'summary';
        if (!result.equal) {
            if (leftFile.size > TEXT_BYTES || rightFile.size > TEXT_BYTES) result.reason = 'size';
            else {
                const left = await decode(leftFile, isCancelled);
                comparisonCheck(isCancelled);
                const right = await decode(rightFile, isCancelled);
                comparisonCheck(isCancelled);
                result.formats = { left: left.format, right: right.format };
                result.reason = left.reason || right.reason;
                if (!result.reason) {
                    const diff = await lineDiff(left.lines, right.lines, isCancelled, onProgress);
                    comparisonCheck(isCancelled);
                    result.reason = diff.reason;
                    if (!diff.reason) { Object.assign(result, diff); result.kind = 'text'; }
                }
            }
        }
    }
    const left = await fingerprint(leftFile, isCancelled);
    comparisonCheck(isCancelled);
    onProgress({ stage: 'hash', done: 1, total: rightFile ? 2 : 1 });
    const right = result.equal ? { ...left } : await fingerprint(rightFile, isCancelled);
    comparisonCheck(isCancelled);
    onProgress({ stage: 'hash', done: rightFile ? 2 : 1, total: rightFile ? 2 : 1 });
    result.hashes = { left, right };
    return result;
};
// The closure returns Object.freeze({ analyze }); add VersionComparison to FileNallyTest.
```

- [ ] **Step 6: Add boundary and cancellation tests, running RED before each missing behavior is implemented.** Table-drive exact literals; do not lower production limits for testing. Use per-test File/subtle overrides with restoration in `finally`, never a production test-only switch.

```javascript
for (const [name, leftBytes, expected] of [
  ['invalid UTF-8', [0xc3, 0x28], 'encoding'], ['NUL', [65, 0], 'control'],
  ['DEL', [65, 127], 'control'], ['UTF-16 LE', [65, 0, 66, 0], 'control']
]) {
  add(`version comparison engine fallback: ${name}`, async ({ page }) => {
    const result = await page.evaluate(async ({ leftBytes }) => {
      return window.FileNallyTest.VersionComparison.analyze(
        new File([new Uint8Array(leftBytes)], 'a.txt'), new File(['xyz'], 'b.bin'));
    }, { leftBytes });
    assert.equal(result.kind, 'summary'); assert.equal(result.reason, expected);
    assert.equal(result.equal, false); assert.deepEqual(result.rows, []);
  });
}

add('version comparison engine yields and stops during matrix work', async ({ page }) => {
  const result = await page.evaluate(async () => {
    let stopped = false, timerFired = false;
    const lines = prefix => Array.from({ length: 999 }, (_, index) => `${prefix}${index}`).join('\n');
    try {
      await window.FileNallyTest.VersionComparison.analyze(new File([lines('L')], 'a'), new File([lines('R')], 'b'), {
        isCancelled: () => stopped,
        onProgress: progress => {
          if (progress.stage === 'text' && !timerFired) setTimeout(() => { timerFired = true; stopped = true; }, 0);
        }
      });
      return { name: '', timerFired };
    } catch (error) { return { name: error.name, timerFired }; }
  });
  assert.deepEqual(result, { name: 'AbortError', timerFired: true });
});
```

| Inputs/instrumentation | Required assertions |
|---|---|
| Empty/empty, empty/one line, one line/empty, equal bytes/different mtime, unequal bytes/equal size and mtime | Correct exact equality and full added/removed counts; missing remains distinct |
| `a\nb` versus `b\na` | Deletion wins first ambiguous LCS step; repeat runs identical |
| Leading BOM twice, Korean/supplementary characters, tabs/spaces, canonically equivalent but distinct Unicode | Remove only one BOM; no normalization or whitespace loss |
| LF/CRLF/CR, final terminator only, same terminator counts at different positions | Byte-different, line-content-equal where appropriate; exact format counts |
| Changed lines separated by 6 or 7 unchanged lines | Merge overlapping context; exactly three context lines per side and accurate omitted ranges |
| 524,288 bytes (`('a'.repeat(8191)+'\n').repeat(64)`) and 524,289 bytes | Inclusive text limit; over limit reason size; hash may still read under its independent cap |
| 5,000 versus 5,001 logical lines; 8,192 versus 8,193 UTF-16 units | Inclusive limits, specific fallback; no partial rows or counts |
| Unmatched lengths 999×1999 and 1000×1999 with distinct `L#`/`R#` lines | 2,000,000 inclusive boundary cells accepted; next case work-limit before Uint32Array allocation |
| Huge matching prefix/suffix with small changed center; one unmatched side empty | Matrix based only on trimmed region; no matrix for insertion/deletion-only region |
| 16,777,216 versus 16,777,217 bytes, crypto absent/unsupported | Full known digest at cap; explicit too-large/unavailable; no whole-file read over hash cap |
| >16 MiB equal files; unequal lengths; first chunk differs | Full 4 MiB exact pass when needed; early exit otherwise; no false byte progress completion |
| Throw from File.arrayBuffer during hash after successful exact comparison | Reject entire analysis, not optional-hash fallback |
| Delay slice, File.arrayBuffer or subtle.digest; then cancel | AbortError after pending operation; no next file hash/read, no delayed publication |

Use test-local spies on `File.slice`/`arrayBuffer` and `Uint32Array` to distinguish bounded chunk reads, optional hash reads and matrix allocation. Restore overridden globals after each assertion. Exact comparison may legitimately read chunks above the text/hash caps; do not prohibit those reads.

- [ ] **Step 7: Verify and commit the engine deliverable.** Run `npm run build`, `node tests/file-nally.e2e.cjs --grep 'version comparison engine|version comparison store'`, `npm test`, `git diff --check`. Record counts and resource-bound assertions; commit `feat: compare version snapshots safely`. Review before Task 3.

### Task 3: Read-only comparison dialog, lifecycle and user guidance

**Files:** Modify `dev/js/file-nally.js` (TEXT and VersionManager), `dev/file-nally.html`, `dev/css/file-nally.css`, `tests/file-nally.e2e.cjs`, `README.md`, `docs/README_en.md`; generate `file-nally.html`.

**Interfaces:**

- Consume Task 1 `comparisonChoices`, `prepareComparison`, `validateComparison` and Task 2 `VersionComparison.analyze` with their exact fields; never consume `prepareRestore` for comparison.
- Existing manager `owner` retains roots/names/direction and gains `comparison: ComparisonSession|null`; `owner.selection` remains restore-only.
- `ComparisonSession = {row, trigger, choices: VersionRecord[], choicePage: number, counterpart: VersionRecord|null|undefined, result: ComparisonResult|null, metadata: ComparisonMetadata|null, resultPage: number, generation: number, run: ComparisonRun|null, message: string, attempted: boolean}`.
- `ComparisonMetadata = {path: string, left: ComparisonMetadataSide, right: ComparisonMetadataSide}`; `ComparisonMetadataSide = {kind: 'version'|'current', record: VersionRecord|null, file: {size: number, type: string, lastModified: number}|null, readAt: string}`. This value contains no File/handle/root references; pinned snapshots remain local to the active async operation.
- Counterpart null means current; undefined means no valid selection. Choice-page changes clear historical counterpart to undefined, never null. Current selection may remain null.
- `ComparisonRun = {cancelled: boolean, generation: number, loading?: boolean}`. `run` exists until a pending native read/digest settles, even after Stop. Choices/start stay disabled until settlement; Close can invalidate immediately.
- Private manager functions: `comparisonCurrent(owner, child): boolean`, `openComparison(owner, row, trigger): Promise<void>`, `startComparison(): Promise<void>`, `stopComparison(): void`, `closeComparison(returnFocus = true): void`, `comparisonControls(owner, child): void`, `renderComparisonChoices(owner, child): void`, `renderComparisonOutput(owner, child): Promise<void>`, `clearComparisonOutput(owner, child): void`, `comparisonMetadata(snapshot): ComparisonMetadata`. Existing `current`, `controls`, `node`, `rootLabel`, `directionLabel`, `t` are reused.
- DOM IDs and copy contracts are defined in Steps 3–4; rendered diff rows use `data-diff-kind`, with no HTML interpolation.

- [ ] **Step 1: Add primary UI and non-mutation acceptance tests.** Preserve saved config/manifests/checkpoints through the full persisted state; preserve displayed scan rows and current plan separately. Exclude transient `versionBusy` from the saved comparison.

```javascript
async function comparisonState(page) {
  return page.evaluate(() => ({
    storage: Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])),
    plan: window.FileNallyTest.getModel().plan,
    sourceRows: document.querySelector('#srcFileBody').innerHTML,
    targetRows: document.querySelector('#tgtFileBody').innerHTML,
    permissionCalls: window.__getPermissionCalls()
  }));
}
add('version comparison UI is explicit and preserves files and sync state', async ({ page }) => {
  await mountVersion(page);
  await compare(page);
  const files = await snapshotMockPair(page), state = await comparisonState(page);
  await page.locator('#btnVersions').click();
  await page.locator('#versionBody [data-version-action="compare"]').first().click();
  await page.locator('#comparisonDialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#comparisonTarget').inputValue(), 'current');
  assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
  await page.locator('#btnRunComparison').click();
  await page.waitForFunction(() => document.querySelector('#comparisonBody [data-diff-kind]'));
  assert.match(await page.locator('#comparisonSummary').innerText(), /report\.txt/);
  assert.equal(await page.locator('#restoreDialog').evaluate(dialog => dialog.open), false);
  await page.locator('#btnCloseComparison').click();
  assert.equal(await page.locator('#versionDialog').evaluate(dialog => dialog.open), true);
  await page.locator('#btnCloseVersions').click();
  assert.deepEqual(await snapshotMockPair(page), files);
  assert.deepEqual(await comparisonState(page), state);
});
```

Reuse this state capture in success, fallback, error, Stop and Close cases. Install per-test failing spies on `createWritable`, `removeEntry`, directory/file lookup with `create: true`, and root `requestPermission` after mount to detect attempted mutations even if they leave no final filesystem difference. Do not treat a final unchanged snapshot alone as proof of no attempted writes.

- [ ] **Step 2: Run RED.** `node tests/file-nally.e2e.cjs --grep 'version comparison UI'` fails on absent compare action/dialog.

- [ ] **Step 3: Add the sibling native dialog and scoped layout.** Place after restoreDialog; use existing translation updates and native focus trapping.

```html
<dialog id="comparisonDialog" class="run-detail-dialog comparison-dialog" aria-labelledby="comparisonTitle" aria-describedby="comparisonDescription">
    <div class="run-detail-surface comparison-surface">
        <header class="run-detail-header">
            <div><h2 id="comparisonTitle" data-i18n="comparisonTitle">버전 비교</h2><p id="comparisonDescription" data-i18n="comparisonDescription">선택한 버전을 왼쪽에 두고 읽기 전용으로 비교합니다. 동기화 방향은 변경되지 않습니다.</p></div>
            <button id="btnCloseComparison" type="button" class="button-ghost" data-i18n="close">닫기</button>
        </header>
        <div class="comparison-target-controls">
            <label for="comparisonTarget" data-i18n="comparisonTarget">오른쪽 비교 대상</label>
            <select id="comparisonTarget"></select>
            <div class="run-detail-pagination">
                <button id="btnComparisonTargetPrevious" type="button" class="button-ghost" data-i18n="previousPage">이전</button>
                <span id="comparisonTargetPageStatus" aria-live="polite"></span>
                <button id="btnComparisonTargetNext" type="button" class="button-ghost" data-i18n="nextPage">다음</button>
            </div>
        </div>
        <p id="comparisonStatus" class="version-message" role="status" aria-live="polite"></p>
        <progress id="comparisonProgress" max="1" value="0" hidden></progress>
        <div class="comparison-scroll" tabindex="0" role="region" aria-labelledby="comparisonTitle">
            <div id="comparisonSummary" class="comparison-summary"></div>
            <p id="comparisonLegend" data-i18n="comparisonLegend">왼쪽 줄 / 오른쪽 줄 · − 삭제 · + 추가 · = 문맥</p>
            <ol id="comparisonBody" class="comparison-diff"></ol>
        </div>
        <div class="run-detail-pagination">
            <button id="btnComparisonPrevious" type="button" class="button-ghost" data-i18n="previousPage">이전</button>
            <span id="comparisonPageStatus" aria-live="polite"></span>
            <button id="btnComparisonNext" type="button" class="button-ghost" data-i18n="nextPage">다음</button>
        </div>
        <div class="run-detail-actions">
            <button id="btnRunComparison" type="button" data-i18n="comparisonRun">비교</button>
            <button id="btnStopComparison" type="button" class="button-ghost" data-i18n="comparisonStop" disabled>비교 중지</button>
        </div>
    </div>
</dialog>
```

```css
.comparison-dialog { width: min(1100px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); }
.comparison-surface { display: flex; flex-direction: column; max-height: calc(100dvh - 24px); min-height: 0; }
.comparison-surface > :not(.comparison-scroll) { flex: 0 0 auto; }
.comparison-scroll { min-height: 0; overflow: auto; overscroll-behavior: contain; }
.comparison-target-controls { min-width: 0; padding: 0 20px; }
#comparisonTarget { display: block; width: 100%; min-width: 0; max-width: 100%; }
.comparison-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 16px 20px; }
.comparison-summary p { grid-column: 1 / -1; }
.comparison-summary dd { margin: 0 0 8px; overflow-wrap: anywhere; }
.comparison-diff { list-style: none; margin: 0; padding: 0 16px 16px; }
.comparison-diff li { display: grid; grid-template-columns: 4ch 4ch 2ch minmax(0, 1fr); gap: 8px; }
.comparison-diff code { white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; }
.comparison-diff [data-diff-kind="add"] { background: #e7f4ec; color: #17482c; }
.comparison-diff [data-diff-kind="remove"] { background: #fbe9e7; color: #69251f; }
.comparison-diff [data-diff-kind="gap"] { display: block; padding: 8px 0; }
@media (max-width: 760px) {
    .comparison-summary { grid-template-columns: minmax(0, 1fr); }
    .comparison-target-controls { padding-inline: 12px; }
    .comparison-diff { padding-inline: 8px; }
    .comparison-diff li { gap: 4px; }
}
```

Verify actual inherited padding/header/footer heights in the visual pass; keep result scroll as the flexible child, with the heading, Close, start/stop and paging reachable at all specified widths. Style only comparison selectors.

- [ ] **Step 4: Add KO/EN keys to existing TEXT objects.** This is the exact copy inventory; use existing keys for owningRoot/pathHead/sizeHead/dateHead/capturedAt/versionIdHead/currentFile/selectedVersion/close/page buttons.

| Key | Korean | English |
|---|---|---|
| `versionCompare` | 비교 | Compare |
| `comparisonTitle` | 버전 비교 | Version comparison |
| `comparisonDescription` | 선택한 버전을 왼쪽에 두고 읽기 전용으로 비교합니다. 동기화 방향은 변경되지 않습니다. | Read-only comparison with the selected version on the left. Sync direction is unchanged. |
| `comparisonTarget` | 오른쪽 비교 대상 | Right-hand counterpart |
| `comparisonLeft` / `comparisonRight` | 왼쪽 / 오른쪽 | Left / Right |
| `comparisonChoose` | 비교 대상을 선택하세요 | Choose a counterpart |
| `comparisonRun` / `comparisonAgain` | 비교 / 다시 비교 | Compare / Compare again |
| `comparisonStop` | 비교 중지 | Stop comparison |
| `comparisonStopping` / `comparisonStopped` | 비교 중지 중… / 비교를 중지했습니다. | Stopping comparison… / Comparison stopped. |
| `comparisonReady` | 대상을 확인한 뒤 비교를 실행하세요. | Check the counterpart, then start comparison. |
| `comparisonLoading` | 비교 대상을 읽는 중… | Reading comparison choices… |
| `comparisonWorking` | 비교 중: {stage} ({done}/{total}) | Comparing: {stage} ({done}/{total}) |
| `comparisonBytes` / `comparisonText` / `comparisonHash` | 바이트 / 텍스트 / 지문 | Bytes / Text / Fingerprints |
| `comparisonFailed` | 비교 실패: {message} | Comparison failed: {message} |
| `comparisonIdentical` | 바이트가 같습니다. | Bytes are identical. |
| `comparisonDifferent` | 바이트가 다릅니다. | Bytes are different. |
| `comparisonMissing` | 현재 파일이 없어 비교하지 않았습니다. | Current file is missing; not compared. |
| `comparisonLineEqual` | 줄 내용은 같습니다. BOM·줄바꿈 형식 또는 위치가 다릅니다. | Line content is equal; BOM or line-ending format/positions differ. |
| `comparisonCounts` | 왼쪽 → 오른쪽: 추가 {added}줄, 삭제 {removed}줄 | Left → right: {added} added, {removed} removed |
| `comparisonSnapshot` | 각 읽기 시점의 스냅샷입니다. 외부 변경을 원자적으로 잠그지 않으며 같은 크기·수정 시각의 후속 변경은 감지되지 않을 수 있습니다. | Snapshots at their read times, not an atomic lock. Later edits retaining size and mtime may be undetected. |
| `comparisonReadAt` / `comparisonType` / `comparisonPresence` | 읽은 시각 / MIME 유형 / 파일 상태 | Read time / MIME type / File presence |
| `comparisonPresent` / `comparisonAbsent` / `comparisonUnavailable` | 있음 / 없음 / 정보 없음 | Present / Missing / Unavailable |
| `comparisonFormat` | BOM: {bom} · CRLF {crlf} · LF {lf} · CR {cr} · 마지막 줄바꿈: {final} | BOM: {bom} · CRLF {crlf} · LF {lf} · CR {cr} · Final newline: {final} |
| `comparisonYes` / `comparisonNo` | 있음 / 없음 | Yes / No |
| `comparisonSize` | 텍스트 크기 한도(파일당 512 KiB)를 초과했습니다. | Text exceeds the 512 KiB per-file limit. |
| `comparisonEncoding` | 유효한 UTF-8 텍스트가 아닙니다. | Not valid UTF-8 text. |
| `comparisonControl` | 텍스트로 표시하지 않는 제어 문자가 있습니다. | Contains control characters not displayed as text. |
| `comparisonLineCount` | 파일당 5,000줄 한도를 초과했습니다. | Exceeds 5,000 lines per file. |
| `comparisonLineLength` | 한 줄 8,192 UTF-16 코드 단위 한도를 초과했습니다. | Exceeds 8,192 UTF-16 code units per line. |
| `comparisonWorkLimit` | 줄 차이 계산 한도(2,000,000셀)를 초과했습니다. | Exceeds the 2,000,000-cell line-diff limit. |
| `comparisonHashLarge` | SHA-256 미계산: 파일당 16 MiB 한도 초과 | SHA-256 not computed: exceeds 16 MiB per file |
| `comparisonHashUnavailable` | SHA-256 미계산: Web Crypto를 사용할 수 없습니다. | SHA-256 not computed: Web Crypto unavailable. |
| `comparisonHashMissing` | SHA-256 미계산: 파일 없음 | SHA-256 not computed: file missing |
| `comparisonLegend` | 왼쪽 줄 / 오른쪽 줄 · − 삭제 · + 추가 · = 문맥 | Left line / right line · − removed · + added · = context |
| `comparisonGap` | 문맥 {count}줄 생략: 왼쪽 {left}, 오른쪽 {right} | {count} context lines omitted: left {left}, right {right} |

Set the progress element's accessible label to `t('comparisonTitle')` during opening. Do not display raw enum strings as translated status; map reasons/stages/hash statuses explicitly in Step 7.

- [ ] **Step 5: Integrate child-open guards and history selection.** Add `compare` to the existing row-action list with explicit label mapping. In `select`, branch `compare` **before** setting the existing download/restore read-busy state; preserve download behavior and replace the old catch-all restore `else` with `else if (action === 'restore')`.

```javascript
const comparisonDialog = $('#comparisonDialog');
const comparisonCurrent = (owner, child) => current(owner)
    && owner.comparison === child && comparisonDialog.open;
const clearComparisonOutput = (owner, child) => {
    if (!comparisonCurrent(owner, child)) return;
    child.result = null; child.metadata = null; child.resultPage = 0;
    $('#comparisonBody').replaceChildren();
    $('#comparisonSummary').replaceChildren(node('p', `${t('comparisonLeft')} · ${t('selectedVersion')} · ${rootLabel(owner, child.row.side)} · ${child.row.record.originalPath} · ${child.row.record.id}`));
    $('#comparisonPageStatus').textContent = '1 / 1';
};
const comparisonMetadata = (snapshot) => {
    const value = { path: snapshot.path };
    for (const key of ['left', 'right']) {
        const { kind, record, file, readAt } = snapshot[key];
        value[key] = { kind, record, readAt,
            file: file ? { size: file.size, type: file.type, lastModified: file.lastModified } : null };
    }
    return value;
};
const comparisonControls = (owner, child) => {
    if (!comparisonCurrent(owner, child)) return;
    const busy = Boolean(child.run);
    $('#comparisonTarget').disabled = busy;
    $('#btnRunComparison').disabled = busy || child.counterpart === undefined;
    $('#btnRunComparison').textContent = t(child.attempted ? 'comparisonAgain' : 'comparisonRun');
    $('#btnStopComparison').disabled = !busy || child.run.cancelled || child.run.loading;
    $('#btnComparisonTargetPrevious').disabled = busy || child.choicePage === 0;
    $('#btnComparisonTargetNext').disabled = busy || (child.choicePage + 1) * 100 >= child.choices.length;
    $('#btnComparisonPrevious').disabled = busy || child.resultPage === 0;
    $('#btnComparisonNext').disabled = busy || (child.resultPage + 1) * 200 >= (child.result?.rows.length || 0);
    $('#comparisonStatus').textContent = child.message;
    controls();
};
const renderComparisonChoices = (owner, child) => {
    if (!comparisonCurrent(owner, child)) return;
    const select = $('#comparisonTarget'); select.replaceChildren();
    for (const [value, label] of [['', t('comparisonChoose')], ['current', t('currentFile')]]) {
        const option = node('option', label); option.value = value; select.append(option);
    }
    for (const record of child.choices.slice(child.choicePage * 100, (child.choicePage + 1) * 100)) {
        const option = node('option', `${new Date(record.capturedAt).toLocaleString(language())} · ${record.id}`);
        option.value = `version:${record.id}`; select.append(option);
    }
    select.value = child.counterpart === undefined ? '' : child.counterpart === null ? 'current' : `version:${child.counterpart.id}`;
    $('#comparisonTargetPageStatus').textContent = `${child.choicePage + 1} / ${Math.max(1, Math.ceil(child.choices.length / 100))}`;
    comparisonControls(owner, child);
};
```

In existing `controls`, include `Boolean(owner.comparison)` in manager refresh/paging/row-action disablement and disable confirm while comparison exists. Keep manager Close available unless writing. Add `owner.comparison` to early-return guards in refresh/select/confirm and both manager-page listeners. Existing `model.versionBusy`/Controller guards continue excluding app operations; do not replace them.

Opening creates a child with fixed `row`, fresh choices, no result and null default counterpart, then calls `showModal`. Use a loading run token to guard the async index lookup. Close stays available during loading; Stop is for analysis, not choice loading:

```javascript
const openComparison = async (owner, row, trigger) => {
    if (!current(owner) || owner.reading || owner.writing || owner.comparison || restoreDialog.open) return;
    const child = { row, trigger, choices: [], choicePage: 0, counterpart: null,
        result: null, metadata: null, resultPage: 0, generation: 1, run: null,
        message: t('comparisonLoading'), attempted: false };
    const run = { cancelled: false, generation: child.generation, loading: true };
    child.run = run; owner.comparison = child; owner.reading = true;
    comparisonDialog.showModal();
    $('#comparisonProgress').hidden = true;
    $('#comparisonProgress').setAttribute('aria-label', t('comparisonTitle'));
    clearComparisonOutput(owner, child);
    renderComparisonChoices(owner, child); $('#btnCloseComparison').focus();
    const isCancelled = () => run.cancelled || !comparisonCurrent(owner, child) || child.generation !== run.generation;
    try {
        const choices = await VersionStore.comparisonChoices(row.root, row.record, { isCancelled });
        if (isCancelled()) return;
        child.choices = choices; child.message = t('comparisonReady');
    } catch (error) {
        if (!isCancelled()) { child.counterpart = undefined; child.message = t('comparisonFailed', { message: safeMessage(error) }); }
    } finally {
        if (comparisonCurrent(owner, child) && child.run === run) {
            child.run = null; owner.reading = false; renderComparisonChoices(owner, child);
        }
    }
};
```

Bind selection and page handlers explicitly; only visible records are selectable. Result-page generations discard an older detached render without starting analysis:

```javascript
$('#comparisonTarget').addEventListener('change', event => {
    const owner = session, child = owner?.comparison;
    if (!child || !comparisonCurrent(owner, child) || child.run) return;
    const value = event.target.value;
    const visible = child.choices.slice(child.choicePage * 100, (child.choicePage + 1) * 100);
    child.counterpart = value === 'current' ? null : visible.find(record => `version:${record.id}` === value);
    child.generation++; clearComparisonOutput(owner, child);
    child.message = t('comparisonReady'); comparisonControls(owner, child);
});
for (const [id, delta] of [['btnComparisonTargetPrevious', -1], ['btnComparisonTargetNext', 1]]) {
    $(`#${id}`).addEventListener('click', () => {
        const owner = session, child = owner?.comparison;
        if (!child || !comparisonCurrent(owner, child) || child.run) return;
        const next = child.choicePage + delta;
        if (next < 0 || next >= Math.max(1, Math.ceil(child.choices.length / 100))) return;
        child.choicePage = next;
        if (child.counterpart !== null) child.counterpart = undefined;
        child.generation++; clearComparisonOutput(owner, child);
        child.message = t('comparisonReady'); renderComparisonChoices(owner, child);
    });
}
for (const [id, delta] of [['btnComparisonPrevious', -1], ['btnComparisonNext', 1]]) {
    $(`#${id}`).addEventListener('click', async () => {
        const owner = session, child = owner?.comparison;
        if (!child || !comparisonCurrent(owner, child) || child.run || !child.result) return;
        const next = child.resultPage + delta;
        if (next < 0 || next >= Math.max(1, Math.ceil(child.result.rows.length / 200))) return;
        child.resultPage = next; child.generation++;
        $('#comparisonBody').replaceChildren(); comparisonControls(owner, child);
        await renderComparisonOutput(owner, child);
    });
}
```

- [ ] **Step 6: Implement explicit analysis, cancellation, closure and guarded cleanup.** The snapshot used for fingerprints and metadata is always the pair prepared for this run. Never publish the fresh validation pair.

```javascript
const startComparison = async () => {
    const owner = session, child = owner?.comparison;
    if (!child || !comparisonCurrent(owner, child) || child.run || owner.reading || owner.writing
        || restoreDialog.open || child.counterpart === undefined) return;
    const run = { cancelled: false, generation: ++child.generation };
    const focusWasStart = document.activeElement === $('#btnRunComparison');
    child.run = run; child.attempted = true; clearComparisonOutput(owner, child);
    child.message = t('comparisonLoading'); owner.reading = true;
    $('#comparisonProgress').hidden = true;
    const isCancelled = () => run.cancelled || !comparisonCurrent(owner, child) || child.generation !== run.generation;
    comparisonControls(owner, child);
    if (focusWasStart) $('#btnStopComparison').focus();
    try {
        const snapshot = await VersionStore.prepareComparison(child.row.root, child.row.record, child.counterpart, { isCancelled });
        if (isCancelled()) return;
        const result = await VersionComparison.analyze(snapshot.left.file, snapshot.right.file, {
            isCancelled, onProgress: ({ stage, done, total }) => {
                if (isCancelled()) return;
                const keys = { bytes: 'comparisonBytes', text: 'comparisonText', hash: 'comparisonHash' };
                child.message = t('comparisonWorking', { stage: t(keys[stage]), done, total });
                $('#comparisonStatus').textContent = child.message;
                const progress = $('#comparisonProgress'); progress.hidden = false;
                progress.max = Math.max(1, total); progress.value = done;
            }
        });
        if (isCancelled()) return;
        await VersionStore.validateComparison(snapshot, { isCancelled });
        if (isCancelled()) return;
        child.metadata = comparisonMetadata(snapshot); child.result = result;
        child.message = t(result.kind === 'missing' ? 'comparisonMissing' : result.equal ? 'comparisonIdentical' : 'comparisonDifferent');
        await renderComparisonOutput(owner, child);
        if (isCancelled()) return;
    } catch (error) {
        if (!isCancelled()) {
            clearComparisonOutput(owner, child);
            child.message = t('comparisonFailed', { message: safeMessage(error) });
        }
    } finally {
        if (comparisonCurrent(owner, child) && child.run === run) {
            const focusWasStop = document.activeElement === $('#btnStopComparison');
            child.run = null; owner.reading = false;
            if (run.cancelled) child.message = t('comparisonStopped');
            $('#comparisonProgress').hidden = true;
            comparisonControls(owner, child);
            if (focusWasStop) $('#btnRunComparison').focus();
        }
    }
};
const stopComparison = () => {
    const owner = session, child = owner?.comparison;
    if (!child || !comparisonCurrent(owner, child) || !child.run || child.run.loading) return;
    const focusWasStop = document.activeElement === $('#btnStopComparison');
    child.run.cancelled = true; child.generation++;
    clearComparisonOutput(owner, child); $('#comparisonProgress').hidden = true;
    child.message = t('comparisonStopping'); comparisonControls(owner, child);
    if (focusWasStop) $('#btnCloseComparison').focus();
};
const closeComparison = (returnFocus = true) => {
    const owner = session, child = owner?.comparison;
    if (!child) return;
    if (child.run) child.run.cancelled = true;
    child.generation++; child.metadata = null; child.result = null; child.choices = [];
    owner.comparison = null; owner.reading = false;
    $('#comparisonBody').replaceChildren(); $('#comparisonSummary').replaceChildren();
    $('#comparisonProgress').hidden = true;
    if (comparisonDialog.open) comparisonDialog.close();
    controls();
    if (returnFocus && current(owner)) {
        (child.trigger?.isConnected ? child.trigger : $('#btnCloseVersions')).focus();
    }
};
$('#btnRunComparison').addEventListener('click', startComparison);
$('#btnStopComparison').addEventListener('click', stopComparison);
$('#btnCloseComparison').addEventListener('click', () => closeComparison());
comparisonDialog.addEventListener('cancel', event => { event.preventDefault(); closeComparison(); });
comparisonDialog.addEventListener('close', () => {
    // A queued old close event must not close a reopened dialog.
    if (!comparisonDialog.open) closeComparison();
});
```

Call `closeComparison(false)` before parent close/session clearing, including the parent's native `close` event (Escape). Old finally blocks must test both current child and run identity, not only generation, so Stop can release its own read flag without unlocking a newer run. Closing can release the logical session while an uncancellable native digest settles; its token schedules no subsequent work. Do not return focus from async progress/render; completion may move focus only if it is still on the control being disabled.

- [ ] **Step 7: Render metadata, complete summaries and at most 200 rows.** Define the asynchronous renderer declared in Interfaces. Build detached output and check identity/generation before attaching; yield after each 50 rows so cancellation/closing can discard unmounted work. Counterpart/page events clear or replace output, never trigger analyze.

```javascript
const renderComparisonOutput = async (owner, child) => {
    if (!comparisonCurrent(owner, child) || !child.result || !child.metadata) return;
    const generation = child.generation, result = child.result, metadata = child.metadata;
    const stale = () => !comparisonCurrent(owner, child) || child.generation !== generation;
    const summary = document.createDocumentFragment();
    summary.append(node('p', t('comparisonSnapshot')));
    summary.append(node('p', t('versionDirection', { direction: directionLabel(owner) })));
    const reasons = { size: 'comparisonSize', encoding: 'comparisonEncoding', control: 'comparisonControl',
        'line-count': 'comparisonLineCount', 'line-length': 'comparisonLineLength', 'work-limit': 'comparisonWorkLimit' };
    if (result.reason) summary.append(node('p', t(reasons[result.reason])));
    if (result.lineContentEqual) summary.append(node('p', t('comparisonLineEqual')));
    if (result.kind === 'text' && !result.lineContentEqual) summary.append(node('p', t('comparisonCounts', result)));
    for (const key of ['left', 'right']) {
        const side = metadata[key], file = side.file, record = side.record;
        const section = node('section', '');
        section.append(node('h3', `${t(key === 'left' ? 'comparisonLeft' : 'comparisonRight')} · ${t(side.kind === 'current' ? 'currentFile' : 'selectedVersion')}`));
        const fields = [['owningRoot', rootLabel(owner, child.row.side)], ['pathHead', metadata.path],
            ['comparisonPresence', t(file ? 'comparisonPresent' : 'comparisonAbsent')],
            ['comparisonReadAt', new Date(side.readAt).toLocaleString(language())]];
        const absent = t('comparisonUnavailable');
        fields.push(['sizeHead', file ? `${file.size} B` : absent], ['comparisonType', file?.type || absent],
            ['dateHead', file ? new Date(record ? record.lastModified : file.lastModified).toLocaleString(language()) : absent]);
        if (record) fields.push(['versionIdHead', record.id], ['capturedAt', new Date(record.capturedAt).toLocaleString(language())]);
        const dl = node('dl', '');
        for (const [label, value] of fields) dl.append(node('dt', t(label)), node('dd', value));
        const hash = result.hashes[key];
        const hashKeys = { 'too-large': 'comparisonHashLarge', unavailable: 'comparisonHashUnavailable', missing: 'comparisonHashMissing' };
        dl.append(node('dt', 'SHA-256'), node('dd', hash.status === 'ok' ? hash.value : t(hashKeys[hash.status])));
        section.append(dl);
        const format = result.formats[key];
        if (format) section.append(node('p', t('comparisonFormat', { ...format,
            bom: t(format.bom ? 'comparisonYes' : 'comparisonNo'), final: t(format.finalNewline ? 'comparisonYes' : 'comparisonNo') })));
        summary.append(section);
    }
    const body = document.createDocumentFragment();
    const rows = result.rows.slice(child.resultPage * 200, (child.resultPage + 1) * 200);
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index], li = node('li', ''); li.dataset.diffKind = row.kind;
        if (row.kind === 'gap') li.textContent = t('comparisonGap', { count: row.count,
            left: `${row.leftLine}–${row.leftLine + row.count - 1}`, right: `${row.rightLine}–${row.rightLine + row.count - 1}` });
        else li.append(node('span', row.leftLine ?? ''), node('span', row.rightLine ?? ''),
            node('span', { context: '=', remove: '−', add: '+' }[row.kind]), node('code', row.text));
        body.append(li);
        if (index % 50 === 49) { await new Promise(resolve => setTimeout(resolve, 0)); if (stale()) return; }
    }
    if (stale()) return;
    $('#comparisonSummary').replaceChildren(summary); $('#comparisonBody').replaceChildren(body);
    $('#comparisonPageStatus').textContent = `${child.resultPage + 1} / ${Math.max(1, Math.ceil(result.rows.length / 200))}`;
    comparisonControls(owner, child);
};
```

The fixed left path/ID/root stays visible before analysis through `clearComparisonOutput`; it is selected identity, not a claim about current file metadata. Left/right headings distinguish two historical versions. Only metadata and diff strings remain after analysis; paging does not retain live Files. On error/Stop preserve selected identity but remove all previous computed results and hashes.

- [ ] **Step 8: Add UI race, paging, direction and security regressions.** Extend the earlier failing UI test with literal assertions; keep tests scoped to the comparison dialog to avoid counting manager tables or unrelated rows.

```javascript
add('version comparison UI cancels delayed reads without late output', async ({ page }) => {
  await mountVersion(page, { content: 'old' });
  await page.evaluate(() => {
    window.__setMockFile('target', 'report.txt', { content: 'new', lastModified: 200 });
    const handle = window.__getMockFile('target', 'report.txt');
    const getFile = handle.getFile.bind(handle);
    window.__comparisonReadStarted = false;
    window.__comparisonReadSettled = false;
    handle.getFile = async () => {
      const file = await getFile(), slice = file.slice.bind(file);
      file.slice = (...args) => {
        const chunk = slice(...args), arrayBuffer = chunk.arrayBuffer.bind(chunk);
        chunk.arrayBuffer = async () => {
          window.__comparisonReadStarted = true;
          await new Promise(resolve => { window.__releaseComparisonRead = resolve; });
          const bytes = await arrayBuffer();
          window.__comparisonReadSettled = true;
          return bytes;
        };
        return chunk;
      };
      return file;
    };
  });
  const before = await snapshotMockPair(page), state = await comparisonState(page);
  await page.locator('#btnVersions').click();
  await page.locator('[data-version-action="compare"]').first().click();
  await page.locator('#btnRunComparison').click();
  await page.waitForFunction(() => window.__comparisonReadStarted);
  await page.locator('#btnCloseComparison').click();
  await page.locator('[data-version-action="compare"]').first().click();
  await page.waitForFunction(() => !document.querySelector('#comparisonTarget').disabled);
  await page.evaluate(() => window.__releaseComparisonRead());
  await page.waitForFunction(() => window.__comparisonReadSettled);
  assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
  await page.locator('#btnCloseComparison').click();
  await page.locator('#btnCloseVersions').click();
  assert.deepEqual(await snapshotMockPair(page), before);
  assert.deepEqual(await comparisonState(page), state);
});
```

The delayed-read fixture uses equal-size Files so the comparator actually reaches the held read. It observes settlement before checking stale output. For digest races, hold a test-local promise around `crypto.subtle.digest`; release it after Close/reopen and assert no next hash call or DOM write.

| Scenario | Exact acceptance |
|---|---|
| All three direction controls, before and after `#btnSwapFolders` | Left remains stored bytes; current/historical right is read from the selected row's physical root, never historic toSide; direction config unchanged |
| 102 same-path historic records | First page has at most 100 historic options plus placeholder/current; second-page selection resolves correct ID; switching pages clears historic choice and disables Compare without choosing current |
| 150 deleted + 150 added lines, page 2 | At most 200 displayed rows; totals remain 150/150; original line numbers continue, not page-relative |
| Current missing, empty, binary, too-large text, work fallback | Distinct explicit outcomes; no misleading equal/empty/partial diff; historic selector still usable |
| Corrupt/stale index, missing stored bytes, directory, revoked read, unreadable pinned File | Error clears prior result/hashes; no restore dialog or permission request |
| Duplicate start, programmatic parent refresh/page/download/restore/confirm click while child open | Only one analysis; handler guards ignore all competing manager actions |
| Stop during bytes/LCS/hash, selection/page changes, Close/reopen, parent close | No stale progress/rows/errors/hashes; old finally cannot clear newer read-busy flag |
| Start by keyboard, Stop, error completion; deliberately focus Close while waiting | Focus remains usable; intentional focus is not stolen; Close/Escape returns to connected row or manager Close fallback |
| HTML-like paths/IDs/content such as `<img src=x onerror=alert(1)>` | Literal text only; no inserted img/script nodes or browser errors |
| KO/EN and 375/768/1280, long path/line, many rows | Header/Close/start/stop reachable, document width unchanged, internal region scrolls, row symbols and live status present |

For each outcome class assert complete filesystem and `comparisonState` equality. Inspect unchanged app-operation guards and existing restore tests after modifying shared manager controls. Do not weaken the 173 baseline assertions to accommodate the new dialog.

- [ ] **Step 9: Update both manuals with the delivered behavior.** Insert under version management; replace only “difference viewing is unavailable,” leaving usage/manual cleanup/automatic expiry deferred.

```markdown
**비교**는 선택한 보관 버전을 왼쪽에 두고 같은 보관 폴더·원래 경로의 현재 파일(기본값) 또는 다른 보관 버전을 오른쪽에 놓는 읽기 전용 기능입니다. 대상을 고른 뒤 **비교**를 눌러야 실행되며, 중지·닫기·Escape는 파일이나 기존 동기화 계획을 변경하지 않습니다. 기록의 과거 원본/대상 구분이나 현재 동기화 방향으로 비교 대상을 뒤집지 않습니다.

바이트 일치 여부를 먼저 확인합니다. 서로 다른 UTF-8 텍스트는 파일당 512 KiB, 5,000줄, 줄당 8,192 UTF-16 코드 단위 이내에서 줄 차이를 표시합니다. 공통 앞뒤 줄을 제외한 계산은 경계 행·열을 포함해 2,000,000셀까지이며, 초과하면 이유와 요약을 표시합니다. 변경 전후 문맥은 3줄, 결과는 200행씩, 과거 비교 대상은 100개씩 표시합니다. 대상 페이지를 바꾸면 이전 과거 선택을 다시 골라야 합니다. BOM·CRLF/LF/CR·마지막 줄바꿈 차이는 바이트 차이로 유지하며, 유효하지 않은 UTF-8·제어 문자·UTF-16을 임의 변환하지 않습니다.

파일당 16 MiB 이하이며 Web Crypto가 가능하면 전체 SHA-256 지문을 표시합니다. 한도 초과나 기능 미지원은 미계산 사유를 표시하며 바이트 비교 결과와 구분합니다. 현재 파일이 없으면 빈 파일이 아니라 미비교로 표시합니다. 결과는 각 표시된 읽기 시점의 스냅샷입니다. 게시 전 관찰된 파일·기록 변경은 오류가 되지만, 외부 편집에 대한 원자적 잠금은 없으며 같은 크기·수정 시각의 후속 변경은 감지되지 않을 수 있습니다.
```

```markdown
**Compare** is read-only: the selected stored version stays on the left; the right side is the current original (default) or another stored version with the same original path in the same owning folder. Choose a counterpart and explicitly start comparison. Stop, Close and Escape do not change files or the existing sync plan. Historical Source/Target fields and the configured sync direction never reverse the operands.

Exact byte equality is checked first. Unequal UTF-8 text receives a line diff within 512 KiB and 5,000 lines per file, 8,192 UTF-16 code units per line, and 2,000,000 LCS cells including boundary rows/columns after trimming common prefix/suffix lines. Larger work receives a reasoned summary. Changes include three context lines; results page at 200 rows and historical choices at 100. Changing history pages clears a historical selection until a visible counterpart is chosen. BOM, CRLF/LF/CR and final-newline differences remain byte differences. Invalid UTF-8, control characters and UTF-16 are not silently converted.

Full SHA-256 fingerprints are optional for each file up to 16 MiB when Web Crypto is available; unavailable fingerprints have explicit reasons and do not determine byte equality. Missing current files are not compared, not treated as empty. Results describe snapshots at their displayed read times. Observed file/record changes before publication cause an error, but there is no atomic lock against external edits; later changes retaining size and mtime may be undetected.
```

- [ ] **Step 10: Run final verification, inspect visuals and commit.** `npm run build`, `node tests/file-nally.e2e.cjs --grep 'version comparison'`, `npm test`, `npm run test:visual`, `git diff --check`. Add visual capture cases using the harness's existing `VISUAL` pattern, save under `artifacts/issue-12-version-comparison/visual/`, and inspect every 375/768/1280 image in both locales. A screenshot file existing is not visual approval. Record the actual total (173 baseline plus additions), build results, no-mutation checks and any browser limitations. Commit `feat: add read-only version comparison dialog` only after fresh passing evidence and review.

## Self-review and Delivery Checkpoints

| Approved spec section | Implementation / verification owner |
|---|---|
| Boundaries, same physical root/path, fresh records, missing/error, final metadata validation | Task 1 APIs and safety matrix; Task 3 operands/guards |
| Exact bytes and resource limits, independent text/hash budgets | Task 2 engine and instrumented inclusive/over-limit tests |
| UTF-8/BOM/EOL semantics, deterministic LCS, context/numbering | Task 2 decoding/alignment tests; Task 3 output/row paging |
| Optional SHA, read failures, uncancellable digest | Task 2 fingerprints and delayed-native tests; Task 3 discard lifecycle |
| Child/parent exclusion, no writes/state mutation, generations and focus | Task 3 handler/control changes and all-outcome snapshots |
| KO/EN, accessibility, hostile content, responsive sizes | Task 3 copy, textContent, keyboard cases and inspected screenshots |
| Manuals, baseline regressions, generated build, no push, remaining #12 scope | Task 3 final verification and handoff |

- Planning self-review must resolve code/interface inconsistencies before execution; execution reviews may simplify code without relaxing the approved contract.
- After each task, record RED/GREEN evidence and review findings in `artifacts/issue-12-version-comparison/review/`; fix findings before the dependent task.
- At final completion use `superpowers:requesting-code-review`, `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`. Integrate only by the user's selected method; do not infer remote push or issue closure from local success.
- Post the verified slice result to the already-authorized #12 discussion only after implementation exists; explicitly leave storage usage/manual cleanup and optional retention open. No planning-only comment claiming a feature is implemented.
