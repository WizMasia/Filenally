# Version Storage Usage and Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show honest per-root version storage usage and provide confirmed, restart-reconcilable deletion of selected stored versions without deleting originals or unrelated data.

**Architecture:** Extend the existing VersionStore closure with dual-schema index snapshots, a shared writer guard, bounded usage inspection and single-use cleanup/recovery preparations. VersionManager adds root-labelled usage and selection/confirmation flows using its existing native dialogs, session ownership and operation exclusions. Cleanup commits an index-v2 intent before removing individual files; interrupted operations reconcile missing records without deleting remaining files.

**Tech Stack:** Existing standalone HTML/CSS/JavaScript, File System Access API, native BigInt/WeakMap/Map, Node assert and the installed Playwright browser harness. No dependency changes. Execution branch: `codex/issue-12-version-storage-cleanup`.

**Spec:** `docs/superpowers/specs/2026-09-13-version-storage-cleanup-design.md`, approved by the user's subsequent “구현 진행” instruction. Base commit: `bda2bb0f1c156eb6595cd2f508fd3250aaad9cd4`. Baseline: 279 browser tests.

## Global Constraints

- 모든 조회·정리는 실제 선택된 루트 핸들에 고정한다. 저장된 `fromSide`/`toSide`, 현재 동기화 방향, 이름이 같은 다른 폴더를 경로 결정에 사용하지 않는다.
- 한 번의 수동 정리는 하나의 루트, 1~100개의 중복 없는 등록 버전만 대상으로 한다. 두 루트에 걸친 선택은 실행 전에 거부한다.
- 현재 원본 파일, 다른 루트, `.trash`, 미선택 버전, 미등록 파일은 삭제하지 않는다. 부모 폴더를 재귀적으로 삭제하거나 비우지 않는다.
- 사용자가 명시적으로 확인하기 전에는 권한 요청, 파일 생성·쓰기·삭제, 인덱스 업그레이드를 하지 않는다.
- 정리·복구에 필요한 핸들의 `isSameEntry`를 지원하지 않으면 쓰기 기능을 거부하고 읽기 전용 안내를 제공한다. 이름이나 크기만으로 핸들 정체성을 대신 판단하지 않는다.
- 수동 정리는 설정된 동기화 방향을 바꾸지 않는다. 다음 동기화는 기존 방향을 그대로 따른다.
- 인덱스 한도는 계속 5 MiB와 100,000개 버전이다.
- 루트당 최대 100,000개 엔트리, 상대 깊이 256, 상대 경로 8,192 UTF-16 코드 단위로 순회를 제한한다. 반복형 순회를 사용하고 128개 엔트리마다 브라우저 작업 큐에 제어를 양보한다.
- 오류 상세는 최대 100개, 추가 오류는 개수만 표시한다.
- 공개 `capture`, `restore`, `cleanup`, `recoverCleanup`는 같은 저장 계층 쓰기 잠금을 공유하고 중복 호출을 거부한다.
- 원본은 계속 `dev/js/file-nally.js`, `dev/file-nally.html`, `dev/css/file-nally.css` 세 개이다. 새로운 런타임 의존성·라우터·워커·서버는 추가하지 않는다. 루트 HTML은 빌드로만 생성한다.
- 한국어/영어, `textContent` 출력, 키보드 진입·복귀, 접근 가능한 상태 알림, 375/768/1280px 레이아웃을 유지한다.
- 수동 정리만으로 #12를 닫지 않는다.

Additional binding details: capture IDs must match `/^[a-z0-9-]+$/` across the entire index before destructive preparation; exact capture-directory names and derived paths are required. v1 stays v1 until confirmed cleanup; v2 writers retain v2. Pending cleanup blocks normal version reads and capture-backed overwrites, but allows inspection/recovery and normal non-overwriting new-file copies. No runtime retention settings or automatic cleanup in this plan. Do not push, merge, publish or close #12 during task execution.

## File Structure and Ownership

| File | Responsibility | Tasks |
|---|---|---|
| `dev/js/file-nally.js` | Existing VersionStore and VersionManager; bilingual copy | 1–4, sequential |
| `dev/file-nally.html` | Existing manager additions and sibling confirmation dialog | 4 |
| `dev/css/file-nally.css` | Scoped responsive storage/cleanup styles | 4 |
| `file-nally.html` | Build-generated artifact only | 1–4 |
| `tests/file-nally.e2e.cjs` | Real production API and UI regression cases | 1–4 |
| `tests/support/mock-file-system.cjs` | Narrow read/delete failure injection when needed | 1–4 |
| `README.md`, `docs/README_en.md` | Delivered behavior, limits, v2 compatibility and retention deferral | 4 |

Do not split the runtime into additional files. Existing production entry points are exported under `window.FileNallyTest`; keep new test fixture/setup methods in test utilities only. Preserve unrelated user edits. Only one implementer may mutate these files at a time.

## Shared Interface Contract

These private VersionStore interfaces are produced by Task 1 for Tasks 2/3. Existing exported method signatures remain compatible.

```js
// IndexSnapshot: { root, versionRoot, indexHandle, indexFile, text, index }
// Missing .filenally: versionRoot/indexHandle/indexFile/text are null.
// Missing index: indexHandle/indexFile/text are null; index is empty v1.
readIndexSnapshot(root, check = () => {}) // Promise<IndexSnapshot>, read-only
validateIndexSnapshot(snapshot, check = () => {}, strictIdentity = false)
// Promise<IndexSnapshot>; equal presence, index bytes and available identities.
// strictIdentity requires native isSameEntry on every pinned existing handle.
writeIndexSnapshot(snapshot, nextIndex) // Promise<IndexSnapshot>
// Revalidate, serialize/validate bounds, write+close, reread exact text.
// Requires existing versionRoot; cleanup also requires existing indexHandle.
withVersionWriter(work) // Promise<result>, rejects concurrent public writers
requireIdleIndex(index) // throws code VERSION_CLEANUP_PENDING with cleanup metadata
```

Usage API produced by Task 2:

```js
VersionStore.inspectUsage(root, {
  scan = true, isCancelled = () => false, onProgress = () => {},
} = {}) // Promise<UsageReport>
// UsageReport:
// { indexStatus: 'valid'|'missing'|'error', indexError: string|null,
//   registered: null | { count, pathCount, bytes: string,
//     paths: [{ path, count, bytes: string }] },
//   cleanup: null | validatedCleanup,
//   observed: null | { count, bytes: string, indexBytes: string,
//     registeredCount: number|null, registeredBytes: string|null,
//     unregisteredCount: number|null, unregisteredBytes: string|null,
//     otherCount, otherBytes: string, missingIds: string[],
//     mismatchedIds: string[], unknownCount },
//   inspection: 'not-run'|'complete'|'partial'|'stale'|'cancelled',
//   readAt: string, visited: number, errors: [{path, message}], errorCount }
// scan:false reads the index only, observed:null, inspection:'not-run'.
// A missing index may report registered zero, but physical files cannot be
// classified as registered/unregistered without a valid index.
```

Cleanup API produced by Task 3:

```js
VersionStore.prepareCleanup(root, records, { isCancelled = () => false } = {})
// Promise<opaquePrepared>, with frozen display-only .summary:
// { records, count, bytes: string, lastPaths: string[], upgradesIndex: boolean }
VersionStore.cleanup(prepared, {
  acknowledgeLastVersions = false, isCancelled = () => false,
  onProgress = () => {},
} = {})
// Resolves CleanupResult for complete/stopped; failures throw an Error with
// .cleanupResult when an operation has been accepted.
// { operationId, status:'complete'|'stopped'|'failed', completedIds:string[],
//   completedBytes:string, remainingIds:string[], failedId:string|null,
//   recoveryRequired:boolean, error:string|null }
VersionStore.prepareCleanupRecovery(root, { isCancelled = () => false } = {})
// Promise<opaqueRecovery>, frozen .summary:
// { operationId, missingRecords, preservedRecords, completedCount, completedBytes }
VersionStore.recoverCleanup(prepared)
// Promise<{ operationId, removedIds:string[], preservedIds:string[] }>
```

All File/handle/index snapshots live in private WeakMaps, not mutable public summaries. Freeze record/array summaries. UI keeps the selected root separately for permission requests. Native metadata getters are not a historical content-integrity guarantee. `onProgress` is never invoked inside a file-removal/index-commit unit.

---

### Task 1: Dual-schema snapshots and the version writer guard

**Files:** Modify `dev/js/file-nally.js` (VersionStore currently around lines144–410), `tests/file-nally.e2e.cjs` (fixtures around100 and store tests around2500); generate `file-nally.html`. Touch the filesystem mock only for a specific required failure seam.

**Interfaces:** Consume existing `safeSegments`, `originalSegments`, `cleanRecord`, `getExistingFile`, `writeFile`, `equalFileBytes`, capture and prepared-restore logic. Produce the private snapshot/writer contract above; existing capture/list/read/restore/comparison public contracts remain unchanged. Do not implement usage, cleanup execution or UI here.

- [ ] **Step 1: Add shared fixtures and failing schema/pending-write tests.** Existing `versionFixture`, `mountPair`, `mountVersion`, mutation spies and snapshot helpers remain the foundation. Add this test utility near those helpers:

```js
function cleanupFixture(id, originalPath = 'report.txt', content = 'old',
  capturedAt = '2026-09-13T00:00:00.000Z') {
  const fixture = versionFixture(originalPath, content);
  fixture.record = { ...fixture.record, id, capturedAt,
    storedPath: `versions/${id}/${originalPath}` };
  return fixture;
}
async function mountCleanup(page, fixtures, {
  owner = 'target', schemaVersion = 1, cleanup = null,
} = {}) {
  await mountPair(page, { source: { 'report.txt': { content: 'source-current' } },
    target: { 'report.txt': { content: 'target-current' } } });
  await page.evaluate(({ fixtures, owner, schemaVersion, cleanup }) => {
    window.__cleanupOwner = owner;
    window.__cleanupRecords = fixtures.map(item => item.record);
    const index = { schemaVersion, versions: window.__cleanupRecords };
    if (schemaVersion === 2) index.cleanup = cleanup;
    window.__setMockFile(owner, '.filenally/index.json', { content: JSON.stringify(index) });
    for (const { record, content } of fixtures) {
      window.__setMockFile(owner, `.filenally/${record.storedPath}`,
        { content, lastModified: 100 });
    }
  }, { fixtures, owner, schemaVersion, cleanup });
}
```

Use `version maintenance` as the new test-name prefix. The initial reader case independently expects a valid v2 listing rather than inspecting source text:

```js
add('version maintenance lists an idle v2 index without rewriting it', async ({ page }) => {
  await mountCleanup(page, [cleanupFixture('saved-1')], { schemaVersion: 2 });
  await installComparisonMutationSpies(page);
  const files = await snapshotMockPair(page), state = await comparisonState(page);
  const ids = await page.evaluate(async () => (await window.FileNallyTest.VersionStore
    .list(window.__mockPair.target)).map(record => record.id));
  assert.deepEqual(ids, ['saved-1']);
  await assertComparisonReadOnly(page, files, state);
});
```

Add independent table cases for missing cleanup field, extra top-level/intent fields, unknown schema, duplicate records, unknown/duplicate/empty/>100 remaining IDs, invalid startedAt/ID, negative/fractional/>100 completed count, count-plus-remaining >100, leading-zero/negative/non-string/>18-digit/above-max completed bytes, count0 with nonzero bytes, and invalid v2 record sizes. All must reject without modifying the fixture. Keep legacy v1 acceptance unchanged.

- [ ] **Step 2: Run the focused tests RED.**

```bash
node tests/file-nally.e2e.cjs --grep 'version maintenance'
```

Expect valid-v2 behavior to fail with the current unsupported-schema error. Save the actual output and confirm fixture setup succeeds first. Cases already green against old code are guard regressions, not new RED evidence.

- [ ] **Step 3: Extend parsing and pending-state validation.** Retain `emptyIndex()` returning schema1. Return the parsed schema rather than always coercing to1. Continue the existing bounded raw parse/forbidden-key/cleanRecord checks and reject duplicate IDs in both writer and reader paths. Add strict v2 key sets and required cleanup property; preserve `cleanup:null` in idle v2.

```js
const hasKeys = (value, keys) => Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const validSize = value => Number.isSafeInteger(value) && value >= 0;
const validCompletedBytes = (value, count) => typeof value === 'string'
  && value.length <= 18 && /^(0|[1-9][0-9]*)$/.test(value)
  && BigInt(value) <= 100n * BigInt(Number.MAX_SAFE_INTEGER)
  && (count !== 0 || value === '0');
const requireIdleIndex = (index) => {
  if (!index.cleanup) return;
  const error = new Error('Version cleanup requires recovery');
  error.code = 'VERSION_CLEANUP_PENDING';
  error.cleanup = Object.freeze({ ...index.cleanup,
    remainingIds: Object.freeze([...index.cleanup.remainingIds]) });
  throw error;
};
```

Validate intent ID with the existing single-segment/no-backslash/no-NUL rules. Require a canonical ISO string for startedAt by round-tripping `new Date(value).toISOString()` after finite date checking. New intents use `nowIso()`. Validate `remainingIds` membership against the canonical version-ID set and uniqueness. Do not impose destructive-preparation ASCII restrictions on ordinary legacy listing/restoration.

- [ ] **Step 4: Implement read-only index snapshots.** `readIndexSnapshot` resolves optional `.filenally`, optional index, its File and text with cancellation before/after awaits. Bound the index File before reading text. Missing directories/index are represented by null handles, not created. Preserve original raw text for freshness checks. `validateIndexSnapshot` rereads and compares versionRoot/index presence, available identities and exact raw text; strict mode requires `isSameEntry` and rejects unsupported identity even if names match. Return the newly observed snapshot.

```js
const sameSnapshotHandle = async (before, after, strict, check) => {
  check();
  if (Boolean(before) !== Boolean(after)) throw new Error('Version index changed');
  if (!before) return;
  if (strict && (typeof before.isSameEntry !== 'function'
    || typeof after.isSameEntry !== 'function')) throw new Error('Handle identity unavailable');
  if (typeof before.isSameEntry === 'function' && !await before.isSameEntry(after)) {
    throw new Error('Version index identity changed');
  }
  check();
};
```

Use the same helper for the root when strict identity is needed; compare pinned root against itself to detect unsupported native identity, and compare the resolved versionRoot/index against their original handles. Do not export this optional strict flag publicly.

`writeIndexSnapshot` validates the next parsed object and byte cap, revalidates the old snapshot, writes through the existing handle (or creates index only for ordinary capture), waits for close, and rereads the root. Reject if exact output text differs. Retain pretty JSON for v1 and compact JSON for v2. Never automatically restore an old index after a failed write.

- [ ] **Step 5: Put all existing writers behind one non-reentrant guard.**

```js
let versionWriting = false;
const withVersionWriter = async (work) => {
  if (versionWriting) throw new Error('Version write already running');
  versionWriting = true;
  try { return await work(); }
  finally { versionWriting = false; }
};
const capture = options => withVersionWriter(() => captureOwned(options));
```

Rename the existing capture body to private `captureOwned`; only public capture acquires the lock. Public restore also owns that guard and calls `captureOwned` internally rather than public capture. Retain single-use prepared restore validation and its error backup metadata. Do not add public skip-lock flags.

For an actual overwrite, read/validate idle index before creating any capture bytes. If `.filenally` is missing, create it only after that preflight, then obtain a new snapshot with that owned directory and still-absent index. Write capture bytes, require unchanged snapshot before append, then write/close/read back the same-schema index before returning the record. A changed index leaves any newly written orphan bytes but never authorizes the actual destination overwrite. A missing current destination still returns null without creating a store or rejecting an unrelated pending store.

Route `list` through idle-index checking; existing `read`, prepareRestore and comparison consumers inherit it. Internal raw snapshots must remain available for inspection and recovery in later tasks.

- [ ] **Step 6: Add the writer safety RED/GREEN cycles and full checks.** Test successful v1 capture stays v1, v2 capture stays v2, restore backup works without self-deadlock, two directly concurrent captures reject the second, pending v2 capture/list/read/restore/comparison reject with zero capture-byte creation, and missing-destination capture still returns null. Use a held stored-file close and mutate the index during capture; the original destination must stay unchanged and the external index must not be lost. Also cover versionRoot/index arrival/replacement and first-capture empty-store initialization.

```bash
npm run build
node tests/file-nally.e2e.cjs --grep 'version maintenance|version store|version capture|restore'
npm test
git diff --check
git add dev/js/file-nally.js file-nally.html tests/file-nally.e2e.cjs
git commit -m "feat: guard version index maintenance"
```

If the mock was intentionally changed, stage its exact path too. Report RED/GREEN outputs, final full test count, interfaces and any compatibility observation. No task-complete claim before independent task review.

### Task 2: Honest bounded read-only storage inspection

**Files:** Modify `dev/js/file-nally.js` (VersionStore), `tests/file-nally.e2e.cjs`; generate `file-nally.html`. Mock changes only to inject concrete metadata/enumeration failures.

**Interfaces:** Consume Task1 private snapshots, record validation and test `cleanupFixture`/`mountCleanup`. Produce `VersionStore.inspectUsage` with the complete UsageReport contract above. Do not add cleanup execution or UI. The function may read a valid pending index but never call `requireIdleIndex` for inspection.

- [ ] **Step 1: Write initial read-only usage tests, then verify RED.**

```js
add('version usage distinguishes recorded bytes from physical orphan bytes', async ({ page }) => {
  await mountCleanup(page, [cleanupFixture('saved-1', 'report.txt', 'old')]);
  await page.evaluate(() => {
    window.__setMockFile('target', '.filenally/versions/orphan/left.txt', { content: 'spare' });
    window.__setMockFile('target', '.filenally/note.txt', { content: 'xy' });
  });
  await installComparisonMutationSpies(page);
  const files = await snapshotMockPair(page), state = await comparisonState(page);
  const result = await page.evaluate(() => window.FileNallyTest.VersionStore
    .inspectUsage(window.__mockPair.target));
  assert.equal(result.registered.count, 1);
  assert.equal(result.registered.bytes, '3');
  assert.equal(result.observed.registeredBytes, '3');
  assert.equal(result.observed.unregisteredBytes, '5');
  assert.equal(result.observed.otherBytes, '2');
  assert.equal(result.inspection, 'complete');
  await assertComparisonReadOnly(page, files, state);
});
```

```bash
node tests/file-nally.e2e.cjs --grep 'version usage'
```

Expected RED: inspectUsage absent; confirm fixtures and mutation instrumentation are valid. Add a scan:false case whose directory enumeration/getFile calls for stored payloads throw, proving quick summaries inspect only the index.

- [ ] **Step 2: Implement exact metadata aggregation.** Validate every canonical size as a nonnegative safe integer. Group by exact originalPath with a Map and BigInt totals; return decimal strings. Sort paths lexicographically with a deterministic comparator. Empty/missing store yields zero summary; corrupt index or invalid sizes yields registered:null plus indexError, not fabricated zero.

```js
const summarizeUsage = (records) => {
  const paths = new Map();
  let bytes = 0n;
  for (const record of records) {
    if (!Number.isSafeInteger(record.size) || record.size < 0) throw new Error('Invalid version size');
    const size = BigInt(record.size);
    bytes += size;
    const value = paths.get(record.originalPath) || { path: record.originalPath, count: 0, bytes: 0n };
    value.count++; value.bytes += size; paths.set(value.path, value);
  }
  return { count: records.length, pathCount: paths.size, bytes: bytes.toString(),
    paths: [...paths.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      .map(value => ({ ...value, bytes: value.bytes.toString() })) };
};
```

Keep this private. `scan:false` returns without traversing payload directories. Return validated cleanup metadata even when normal listing would be blocked. When reading raw index fails, still resolve `.filenally` read-only so explicit physical inspection can produce an unknown-classification partial result.

- [ ] **Step 3: Implement bounded iterative inspection.** Keep a stack of iterator frames, not a recursively accumulated unbounded list. Frames carry `{directory, iterator, path, depth}`; use `directory.values()[Symbol.asyncIterator]()` so the current mock and real browser both work. Count every visited file/directory toward100000. Check cancellation before/after each awaited `next()` and `getFile()`. Stop with partial status at depth256, path8192 or entry ceiling; do not silently truncate a path and then resolve it. Yield via `setTimeout(resolve,0)` every128 visited entries. Close active iterators where available on exit.

```js
const frames = [{ directory: versionRoot, iterator: versionRoot.values()[Symbol.asyncIterator](), path: '', depth: 0 }];
while (frames.length) {
  check();
  const frame = frames.at(-1);
  const next = await frame.iterator.next();
  check();
  if (next.done) { frames.pop(); continue; }
  if (visited >= 100000) { inspection = 'partial'; break; }
  const entry = next.value;
  const path = frame.path ? `${frame.path}/${entry.name}` : entry.name;
  visited++;
  if (frame.depth + 1 > 256 || path.length > 8192) { inspection = 'partial'; break; }
  if (entry.kind === 'directory') {
    frames.push({ directory: entry, iterator: entry.values()[Symbol.asyncIterator](), path, depth: frame.depth + 1 });
  } else if (entry.kind === 'file') {
    const file = await entry.getFile(); check();
    // Classify this observed path using the exact categories in Step4.
    observedFiles.set(path, file.size);
  }
  if (visited % 128 === 0) { onProgress({ visited }); await new Promise(resolve => setTimeout(resolve, 0)); check(); }
}
```

Wrap the loop's individual enumeration/getFile operations with path-specific failure recording and end the incomplete branch safely. Keep at most100 error details but retain total count. A callback failure produces an explicit error/partial result; it must not cause filesystem mutation. Cancellation returns the observed portion with inspection:'cancelled', rather than presenting a completed total. Only keep bounded path/size observations, not File contents or a File snapshot per tree entry.

- [ ] **Step 4: Classify observations and validate freshness.** `index.json` contributes only to indexBytes; indexed stored paths contribute to registeredCount/registeredBytes even if size differs, with their IDs in mismatchedIds; a directory at an indexed stored path is a mismatch. `versions/` paths without an index reference are unregistered only with a valid canonical index. Other files contribute to otherCount/otherBytes. Under an invalid or missing index, registered/unregistered physical counts and byte totals are null; payloads contribute to unknownCount and total bytes. Sum observed.count/bytes once per real file, not per index record. Derive missingIds only after complete traversal with a stable valid index. On partial/cancelled/stale inspection, leave missingIds empty; retain observed mismatches, clearly labelled partial/stale.

Revalidate `.filenally` identity, index presence, raw text and available handle identities at completion; changed state sets inspection:'stale'. Missing/invalid index is compared by its raw observed state where available; inability to prove freshness never yields complete. An absent store which remains absent yields complete zero. Never use `navigator.storage.estimate()` as local selected-folder usage.

- [ ] **Step 5: Add independent boundary/failure tests and verify.** Cover both physical roots and swapped labels; same path aggregation; zero bytes; sum `9007199254740991 + 2` is literal `'9007199254740993'` in quick mode; invalid sizes; missing/corrupt/duplicate indexes; pending intents; missing/extra/wrong-size/directory-substituted files; unknown sibling files; inaccessible one root; enumeration/getFile errors; each scan cap; cancellation before and during reads; stale `.filenally`/index replacement; unchanged attempted mutations and settings/plans. Use controlled iterator fakes only for the100000/depth/path limits and assert application status/output, not the fake's existence.

```bash
npm run build
node tests/file-nally.e2e.cjs --grep 'version usage|version maintenance'
npm test
git diff --check
git add dev/js/file-nally.js file-nally.html tests/file-nally.e2e.cjs
git commit -m "feat: inspect version storage usage"
```

Report real RED/GREEN and full counts. Do not broaden into deletion of unknown files or storage repair.

### Task 3: Confirmed cleanup and restart reconciliation engine

**Files:** Modify `dev/js/file-nally.js` (VersionStore), `tests/file-nally.e2e.cjs`, and only the narrowly required fault injection in `tests/support/mock-file-system.cjs`; generate `file-nally.html`.

**Interfaces:** Consume Task1's private `readIndexSnapshot`, `validateIndexSnapshot`, `writeIndexSnapshot`, `withVersionWriter`, `requireIdleIndex`, and existing chunked `equalFileBytes`. Produce all four cleanup/recovery APIs and their exact summary/result contracts from Shared Interface Contract. Consume test helpers `cleanupFixture` and `mountCleanup`. No DOM integration, retention or new public bypass option.

- [ ] **Step 1: Add one successful cleanup test and witness RED.** Use test-name prefix `version cleanup`; independently read persisted bytes/index through the filesystem test helpers rather than assuming the returned success means deletion occurred.

```js
add('version cleanup removes only a confirmed selected stored file', async ({ page }) => {
  await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
  const result = await page.evaluate(async () => {
    const root = window.__mockPair.target;
    const store = window.FileNallyTest.VersionStore;
    const prepared = await store.prepareCleanup(root, [window.__cleanupRecords[0]]);
    const completed = await store.cleanup(prepared);
    const folder = await root.getDirectoryHandle('.filenally');
    const index = JSON.parse(await (await (await folder.getFileHandle('index.json')).getFile()).text());
    const selected = await (await folder.getDirectoryHandle('versions')).getDirectoryHandle('saved-1');
    let missing = false;
    try { await selected.getFileHandle('report.txt'); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; missing = true; }
    return { completed, index, missing,
      original: await (await (await root.getFileHandle('report.txt')).getFile()).text() };
  });
  assert.equal(result.completed.status, 'complete');
  assert.deepEqual(result.completed.completedIds, ['saved-1']);
  assert.equal(result.completed.completedBytes, '3');
  assert.equal(result.missing, true);
  assert.equal(result.original, 'target-current');
  assert.equal(result.index.schemaVersion, 2);
  assert.equal(result.index.cleanup, null);
  assert.deepEqual(result.index.versions.map(record => record.id), ['saved-2']);
});
```

```bash
node tests/file-nally.e2e.cjs --grep 'version cleanup'
```

Expected RED: production `prepareCleanup` absent. Establish granted mock write permission explicitly if its default differs; never change production permission checks to satisfy a fixture.

- [ ] **Step 2: Prepare pinned single-use selections without writes.** Add private WeakMaps for cleanup/recovery tokens. Resolve each supplied record against the root's canonical index; reject duplicate, empty, >100, missing or changed records. The root argument is the sole physical owner. Require strict native identity for root, `.filenally`, index, each existing path directory and each target file. Reject every non-ASCII-safe capture ID anywhere in the index before preparing destructive work. Resolve only `['versions', record.id, ...originalSegments(record.originalPath)]`, validate actual capture-directory `name === record.id`, pin each parent and File snapshot. Missing targets, directories instead of files, unsafe sizes and size disagreement reject preparation; MIME disagreement does not.

```js
const cleanupPreparations = new WeakMap();
const recoveryPreparations = new WeakMap();
const displayRecord = record => Object.freeze({ ...record });
const freezeRecords = records => Object.freeze(records.map(displayRecord));
const takePreparation = (map, prepared) => {
  const state = map.get(prepared);
  if (!state) throw new Error('Invalid or consumed version preparation');
  map.delete(prepared);
  return state;
};
const orderedCleanupRecords = records => [...records].sort((a, b) =>
  Date.parse(a.capturedAt) - Date.parse(b.capturedAt)
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
```

Use private `pinCleanupFile(snapshot, record, check, allowMissing = false)` to produce `{record, parents, handle, file}`; missing recovery paths produce null handle/file while preserving all existing parent handles and the missing-segment boundary. `validateCleanupFile(snapshot, pinned, check, compareBytes)` resolves again, requires strict identities and same metadata/presence, then calls `equalFileBytes` only when compareBytes is true. `parents` includes the derived-path directories from `.filenally` onward, in order. Native identity is mandatory on all existing handles in either resolution. A previously absent segment appearing or any formerly present segment disappearing invalidates the preparation even if the final file remains absent.

For each selected originalPath, find one unselected canonical version whose file exists and size matches, pin it privately as the retained-copy witness. If none can be proved, include that path in `lastPaths`; inability to prove a retained copy never silently exempts the warning. Pinning errors for unselected witnesses may move the path into lastPaths, but cancellation still stops preparation. Revalidate witnesses' record, handle and metadata before the intent and before each deletion for their path; no historical integrity-hash claim. Freeze all display summaries; expose no handles, Files, raw text or mutable canonical records.

- [ ] **Step 3: Implement intent-first, one-file commit units.** Public `cleanup` consumes its token under the shared writer guard, checks owning-root `queryPermission({mode:'readwrite'}) === 'granted'`, requires the explicit last-copy acknowledgment where needed, and revalidates the entire pinned index/selected bytes/retained witnesses before any write. Store methods must not call `requestPermission`. Produce operationId with the existing safe ID generator, startedAt with `nowIso()`, sorted remainingIds, zero counters and schema2. `writeIndexSnapshot` must validate compact size before creation/writing. Keep all cleanup writes on the already existing index handle.

```js
const nextCleanupIndex = (index, record) => {
  const remainingIds = index.cleanup.remainingIds.filter(id => id !== record.id);
  return { schemaVersion: 2,
    versions: index.versions.filter(value => value.id !== record.id),
    cleanup: remainingIds.length ? { ...index.cleanup, remainingIds,
      completedCount: index.cleanup.completedCount + 1,
      completedBytes: (BigInt(index.cleanup.completedBytes) + BigInt(record.size)).toString(),
    } : null };
};
```

After verified intent publication, for each sorted item: check cancellation; revalidate expected full snapshot, operation ID membership, strict parent/file identities, exact selected bytes and retained witness; call `parent.removeEntry(fileName)` with no recursive option; prove absence with a file/directory-aware lookup; revalidate expected index; write/close/read back `nextCleanupIndex`; only then append completedIds/bytes and publish a frozen progress result. Check cancellation during byte comparison and at boundaries only. Do not call cancellation/progress callbacks between removeEntry starting and index commit finishing. Never pass UI cancellation into that commit unit's index validation.

Cancellation before intent produces stopped/no-write/no-recovery. Cancellation after intent with remaining IDs produces stopped/recoveryRequired. Any intent write attempt whose outcome is not confirmed is conservatively recovery-required; never delete after an unverified intent. An error after accepted token throws with a frozen `.cleanupResult`, confirmed completed IDs only, failedId when applicable and conservative recoveryRequired. Finish the current unit before honoring stop. Callback exceptions stop further work without undoing a completed unit or executing it twice. A last-item post-commit callback failure must not fabricate a pending marker. No rollback writes or file recreation.

- [ ] **Step 4: Exercise independent destructive-boundary tests in RED/GREEN cycles.** Cover preparation/cancel/permission denial/forged and reused tokens, 101/duplicate/unknown records, full-index unsafe IDs and actual-directory case aliases, unavailable identity, read errors, same-size/same-mtime byte changes, index/root/parent/file replacement, intent-size cap, v2 intent write/close/readback failures with zero deletes, remove failure before first and middle items, remove returning without absence, and each post-delete index failure with no subsequent delete. Preserve originals, opposite root, `.trash`, unregistered files, unselected files and unexpected siblings byte-for-byte. Assert no recursive remove calls and no body recreation. Test retained witness mutation both before intent and after a first completed item. Test lastPaths acknowledgment in the store, not only UI. A MIME-only metadata difference must not reject valid stored bytes.

Hold each awaited boundary with explicit promises rather than timing sleeps. Assert oldest-first ordering with equal-time ID ties. Cancel during byte reads and during remove/commit, and verify committed-count boundaries. Test directly concurrent capture/restore/cleanup/recovery entry points and lock release on thrown callbacks. Pending cleanup must block ordinary reads/overwrites but not usage or another root. Every new branch must have an observed intended RED before implementation, not merely a green test added afterward.

- [ ] **Step 5: Add recovery RED and implement index-only reconciliation.** Use test-name prefix `version recovery`. Build a persisted pending index where saved-1 is absent, saved-2 exists, and an unrelated unselected record is missing. Open a fresh page/mount from that persisted state, prepare recovery, and assert the summary distinguishes missing/preserved pending records. Confirm and independently verify only saved-1's record was removed, saved-2 and unrelated records survived, cleanup:null/schema2 remains, and no stored body/directory creation or removal occurred.

```js
const reconciledIndex = (index, missingRecords) => {
  const missingIds = new Set(missingRecords.map(record => record.id));
  return { schemaVersion: 2,
    versions: index.versions.filter(record => !missingIds.has(record.id)),
    cleanup: null };
};
```

`prepareCleanupRecovery` requires a valid pending index, strict native root/index/path identity and all-index safe IDs. Read only remainingIds' derived paths. FileNotFound is absence; permission/read errors or a directory/type/size mismatch reject. Pin missing boundaries and valid present Files/handles privately. Summary returns the intent's completed counters, missingRecords and preservedRecords. `recoverCleanup` owns the shared writer guard, consumes the recovery token, checks granted permission, revalidates the full snapshot and every pending presence/identity/metadata, then performs one bounded v2 index write/close/readback using the exact reconciled index. It never invokes removeEntry or writes version payloads. Present files need metadata/identity checks, not historical hashes. No auto-run after restart.

Add restart fixtures at intent-only, deletion-before-commit, and completed-item-before-next-deletion states. Test missing->present, present->missing, same-meta handle replacement, missing parent replacement/arrival, index swap, malformed intent, wrong size/type, denied permission, forged/reused token and recovery write/close/readback failures. Failed recovery requires fresh preparation; do not reuse or restore the old snapshot.

- [ ] **Step 6: Verify native OPFS behavior and complete task checks.** In a secure localhost browser page, allocate a uniquely named directory under OPFS, write actual index and version files with the File System Access API and call the same public VersionStore methods. Assert native selected-file absence, preserved sibling bytes, v2 final state and a persisted pending-state recovery after page reload. Use test adapter root permission methods only if OPFS omits picker permission methods; all directory/file identity and remove operations remain native. Clean up only that exact validated test directory after assertions, never the whole OPFS root. A native test cannot be replaced by a mock-only success claim.

```bash
npm run build
node tests/file-nally.e2e.cjs --grep 'version cleanup|version recovery|version maintenance|version usage'
npm test
git diff --check
git add dev/js/file-nally.js file-nally.html tests/file-nally.e2e.cjs
git commit -m "feat: reconcile confirmed version cleanup"
```

Stage a changed mock by exact path if needed. Report the actual mutation-boundary evidence and native test results; do not claim crash-atomic filesystem transactions or concurrency protection against other processes.

### Task 4: Root-labelled usage, selection and confirmation UI

**Files:** Modify `dev/js/file-nally.js` (VersionManager plus KO/EN dictionary), `dev/file-nally.html`, `dev/css/file-nally.css`, `tests/file-nally.e2e.cjs`, `README.md`, `docs/README_en.md`; generate `file-nally.html`.

**Interfaces:** Consume `inspectUsage`, `prepareCleanup`, `cleanup`, `prepareCleanupRecovery`, `recoverCleanup` with the exact Shared Interface Contract above. Preserve existing list/read/restore/comparison signatures, manager session ownership, `versionBusy`, root labels, page size100, focus restoration and app-wide operation guards. No backend or additional runtime files.

- [ ] **Step 1: Add an initial usage-and-preview UI test and witness RED.** Use prefix `version storage UI`. Mount saved-1 and saved-2 on target, open `#btnVersions`, assert `#versionUsage` identifies the target's two registered versions and six logical bytes, select `[data-cleanup-id="saved-1"][data-cleanup-side="target"]`, open `#btnPrepareCleanup`, expect `#cleanupDialog` visible and one selected record. Install mutation spies before manager opening and prove cancel via `#btnCancelCleanup` leaves all files/settings/current sync plan unchanged and requests no permission. Expected RED is missing UI, not failed fixtures.

The following exact DOM contract is added to the existing manager and a sibling native dialog:

```html
<section id="versionUsage" aria-labelledby="versionUsageTitle">
  <h3 id="versionUsageTitle" data-i18n="versionUsageTitle">등록된 버전 용량</h3>
  <div id="versionUsageRoots"></div>
</section>
<div class="version-cleanup-toolbar">
  <p id="versionCleanupSelection" role="status" aria-live="polite"></p>
  <button id="btnSelectVersionPage" type="button" data-i18n="versionSelectPage">현재 페이지 선택</button>
  <button id="btnClearVersionSelection" type="button" data-i18n="versionClearSelection">선택 해제</button>
  <button id="btnPrepareCleanup" type="button" data-i18n="versionPrepareCleanup" disabled>선택 버전 정리</button>
</div>
```

Sibling `#cleanupDialog` uses `aria-labelledby="cleanupTitle"` and `aria-describedby="cleanupDescription"`; contains `#cleanupTitle`, `#cleanupDescription`, `#cleanupSummary`, `#cleanupRecords`, a labelled `#cleanupLastAcknowledged` checkbox inside `#cleanupLastWarning`, `#cleanupStatus` with role=status/live=polite, and `#btnCancelCleanup`, `#btnConfirmCleanup`, `#btnStopCleanup`. Show the last-warning checkbox only for destructive preparations with nonempty lastPaths; recovery uses the same dialog in a distinct mode with no deletion checkbox. Build dynamic root cards using textContent, `data-usage-side`, buttons `data-inspect-side`/`data-recover-side`, and local path-summary previous/next controls with `data-usage-page-side` and `data-page-delta`. Render selection checkboxes with `data-cleanup-id` and `data-cleanup-side` and a full path/time accessible label.

- [ ] **Step 2: Extend existing session state and quick usage rendering.** Add owner-local maps for root usage and per-root path-summary page offsets, `cleanupSelection` as `{side:null,records:new Map()}`, and `maintenance` child state with `{mode,token,reading,writing,stopRequested,prepared,trigger,result}`. This does not replace existing restore `owner.selection`. Child-current checks require owner session identity and exact maintenance token; no late completion may modify a replacement child's locks or result.

```js
const maintenanceCurrent = (owner, child) => current(owner)
  && owner.maintenance === child;
const hasVersionChild = owner => Boolean(owner.comparison || owner.maintenance || restoreDialog.open);
const clearCleanupSelection = owner => {
  owner.cleanupSelection.side = null;
  owner.cleanupSelection.records.clear();
};
```

On manager refresh clear cleanup selection/tokens/old usage and load each physical root independently with scan:false, retaining valid summaries when another root fails. Show registered count, pathCount and exact decimal bytes; never coerce totals through Number. Show combined total only when both selected roots' registered summaries are valid. Page each root's path summary100 entries. Pending-root ordinary list errors remain visible alongside its usage and recovery entry, while other-root rows remain operable. Dynamic filenames/errors/IDs must use textContent. Preserve keyboard navigation and manager session ownership.

- [ ] **Step 3: Add cancellable explicit inspection and bounded selection.** Root inspect buttons call inspectUsage(scan:true) with child/session cancellation and throttled accessible progress; no permission request. Display all observed categories, counts, exact bytes, timestamp, missing/mismatched counts, bounded errors and explicit partial/stale/cancelled status. Keep registered and physical observations separately labelled. A closed manager discards late results. Inspection may be stopped/closed and cannot overlap a comparison/restore/cleanup preparation.

Selection persists through version list paging, is cleared by refresh/close/root change, is bound to the first selected physical side, and never exceeds100. Disable other-root checkboxes and expose the reason. Current-page selection selects only eligible rows on that page and root; if no side is selected, choose the first eligible visible row's side. Refuse an over-limit addition rather than silently auto-batching; previously selected rows remain available to deselect. Recheck side/count and manager/child busy state in event handlers, not only disabled attributes. Render selected exact logical bytes using BigInt and record sizes.

- [ ] **Step 4: Implement safe preparation and confirmed write handlers.** Preparation calls the store read-only with session cancellation, shows frozen record summaries, physical root label, permanent-delete/backup/original-preservation guidance, upgrade warning when upgradesIndex, and lastPaths requiring explicit acknowledgment. Cancel/Escape discards token and returns focus without requesting permissions. Confirmation starts the selected physical root's permission request synchronously in the click handler, then verifies session/child identity before store invocation. Ignore duplicate programmatic clicks. Existing comparison and restore preparation/confirmation handlers must also check maintenance exclusion.

```js
// In the confirmed click handler, after owner/child/acknowledgment guards:
const permission = child.root.requestPermission({ mode: 'readwrite' });
child.writing = true;
owner.writing = true;
// Await permission, check current ownership, then call the appropriate store API.
// cleanup gets acknowledgeLastVersions and stop/session cancellation;
// recoverCleanup has no cancellation after its index write starts.
```

Keep root on the UI child, not in the public prepared summary. Store still independently checks granted permission. Denial consumes/discards the UI preparation without any write. During writes block close/Escape and duplicate confirmation; cleanup exposes safe stop, with wording that the current item will finish. Recovery writing has no stop button. A programmatic dialog close during writing must retain the lock and restore the active dialog using the existing restore pattern.

Track whether a store write-capable invocation was attempted, separately from mere inspection/permission denial. In its finally path invalidate owner version/usage/selection and child tokens, clear the sync plan and require a fresh comparison using the existing restore path; do not modify manifests/checkpoints/direction. Refresh while preserving a detached display-only result until the user dismisses it. Report operation ID, physical root, confirmed completed logical bytes/count, failed ID/error and recoveryRequired in dialog plus existing live log. Do not describe bytes as guaranteed recovered disk space. Recovery displays removed missing records and preserved pending records, never a continued deletion.

- [ ] **Step 5: Complete focused UI RED/GREEN cases.** Independently assert KO/EN labels, partial/unknown vs zero summaries, both roots including equal folder names, three sync directions and swapped physical roots, per-path100 pagination, list paging and current-page-only selection, mixed-root programmatic requests, max100, last-version acknowledgment and invalid retained-copy warning, safe upgrade copy, pending-root recovery entry and other-root access. Hold preparation/inspection/permission/deletion promises to cover cancel/close/reopen/root replacement and late results. Verify no read-only/cancel path clears an existing sync plan and every write-attempt path does, preserving settings/manifests/checkpoints. Verify close/Escape during writes, duplicate direct handlers, cleanup/restore/comparison exclusion, stop-after-unit behavior, callback failure result and focus return. Test errors using text that looks like HTML and prove it is displayed literally.

```bash
npm run build
node tests/file-nally.e2e.cjs --grep 'version storage UI|version manager|version comparison|version cleanup|version recovery'
```

- [ ] **Step 6: Document compatibility and visually inspect the delivered UI.** Update both manuals with exact registered-vs-observed usage semantics, partial caps and logical-byte limits, one-root1–100 permanent deletion confirmation, protected originals/unselected/unregistered files, last-version acknowledgment, nonrecursive leftover directories, explicit index-only interruption recovery, v2 upgrade and v0.14 unsupported-index/orphan-write limitation, local writer lock vs external race limitations, and automatic retention still deferred. Do not claim #12 complete.

Extend visual mode fixtures to show root usage, destructive confirmation with last warning, and pending recovery in KO and EN at375/768/1280 widths. Save screenshots under the task's artifacts directory and actually open representative images for every width and language, including long paths and error text. Verify wrapping, no horizontal clipping, visible action controls and focus; include filenames/observations in the task report. Use scoped flex-wrap/min-width:0/overflow-wrap:anywhere styles following existing version/comparison dialogs, not a new layout system.

```bash
npm run build
npm run build:test
npm run build:check
npm test
npm run test:visual
git diff --check
git add dev/js/file-nally.js dev/file-nally.html dev/css/file-nally.css file-nally.html tests/file-nally.e2e.cjs README.md docs/README_en.md
git commit -m "feat: manage version storage cleanup"
```

Report fresh full-suite counts, native OPFS coverage and inspected visual paths. Final whole-branch review must check all approved spec invariants, not only Task4 UI. Resolve actionable findings through a bounded reviewed fix wave before declaring implementation complete. Leave integration/push/release and the later retention design for the user's next direction.

## Plan Self-Review

- Spec sections1–3 and12–13: global constraints and Tasks3/4 preserve exact physical ownership, exclusions, legacy compatibility, no retention and no transactional guarantees.
- Spec section4: Task2 implements bounded metadata inspection and exact sums; Task4 implements labels, partial/error display and both100-row pagers.
- Spec sections5/9: Task1 establishes schemas/snapshots/writer lock; Task3 adds the intent/recovery protocol; Task4 maintains manager-wide exclusions.
- Spec sections6–8: Task3 covers pinning, retained-copy proof, intent-first single-file commits, conservative error accounting, safe stop and index-only recovery.
- Spec sections10–11: Task4 adds all UI/permission/token/focus/invalidation states, bilingual manuals and native/visual/full regression verification.
- Interfaces: Shared Interface Contract is authoritative; private snapshot helpers are Task1-owned, usage is Task2-owned, cleanup/recovery is Task3-owned, DOM/session state is Task4-owned. Each task receives that contract with its brief.
- Execution is sequential because every task changes the same runtime and generated file. No parallel implementation writes. No placeholder implementation or speculative retention configuration.
