# Version Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse, download and explicitly restore versions in their physical owning roots while preserving overwritten current files.

**Architecture:** Extend VersionStore with read-only discovery and prepared, revalidated same-root restore. Add a small VersionManager controller and two native dialogs using existing application state/DOM/download conventions.

**Tech Stack:** Vanilla JavaScript/CSS/native HTML dialogs, File System Access, existing Node/Playwright harness and standalone build.

**Spec:** docs/superpowers/specs/2026-09-13-version-manager-design.md

## Global Constraints

- Use the root that physically owns the selected version, never the record's historical `toSide`, to select the restore destination.
- Preserve 100 user-controlled exclusions plus mandatory `.trash` and `.filenally`.
- Settings remain schema v2; version index remains v1, allowing `before-restore` with equal current sides in addition to existing opposite-side `before-overwrite` records.
- Index size remains 5 MiB and 100,000 records before and after append. Never reset damaged indexes.
- Explicit confirmation is required for both missing and existing destinations; backup bytes/index commit precede replacement of existing files.
- Revalidate prepared index/bytes/destination, including equal-size/equal-mtime edits and changes during backup; observed changes require fresh confirmation.
- No writes during list/download/prepare/cancel. No dependencies, cleanup, diff UI, automatic rollback or separate persistent restore history.
- Regenerate file-nally.html from dev sources; meaningful behavior tests follow RED → GREEN.

## File Structure

- dev/js/file-nally.js: existing VersionStore plus VersionManager/Controller integration and bilingual labels.
- dev/file-nally.html: version manager button, list dialog, restore-confirmation dialog.
- dev/css/file-nally.css: narrowly scoped responsive version list/confirmation layouts using existing tokens.
- tests/file-nally.e2e.cjs: store/UI regressions and visual cases; small fixture helpers may live here.
- tests/support/mock-file-system.cjs: only realistic mismatch/abort semantics needed by new filesystem tests.
- README.md and docs/README_en.md: user workflow and format/backward-reader limits.
- file-nally.html: generated output.

### Task 1: Validated Version Reads and Prepared Restore

**Files:** Modify dev/js/file-nally.js, tests/file-nally.e2e.cjs, tests/support/mock-file-system.cjs only where required; generate file-nally.html.

**Interfaces:**
- Existing capture accepts optional `reason = 'before-overwrite'`; `before-restore` uses equal sides.
- Produce `VersionStore.list(root): Promise<VersionRecord[]>`, empty only for missing store/index; ambiguous duplicate IDs reject at the read/list boundary.
- Produce `VersionStore.read(root, record): Promise<File>`: reload index, require unchanged unique matching canonical record and safe derived path, verify size.
- Produce `VersionStore.prepareRestore(root, record): Promise<PreparedRestore>` with root, record, versionFile, currentFile (or null), currentHandle (or null), and any private identity state needed.
- Produce `VersionStore.restore(prepared, { side, direction, runId }): Promise<{ record, backup }>`; `backup` is null or capture record; thrown post-backup errors carry `.backup` for UI recovery references. Require current write permission via query, do not initiate prompts here.
- Preserve existing exports; VersionStore already exposed on FileNallyTest.

- [ ] Step 1: Write direct browser behavior tests with literal indexed fixtures.

```javascript
function versionFixture(originalPath = 'report.txt', content = 'old') {
  const record = { id: 'saved-1', capturedAt: '2026-09-13T00:00:00.000Z', originalPath,
    storedPath: `versions/saved-1/${originalPath}`, size: Buffer.byteLength(content),
    type: 'text/plain', lastModified: 100, reason: 'before-overwrite', runId: 'old-run',
    direction: 'unidirectional', fromSide: 'source', toSide: 'target' };
  return { record, content };
}
add('version restore backs up the current file inside its owning root', async ({page}) => {
  await mountPair(page, { source: {}, target: { 'report.txt': {content:'current', lastModified:200} } });
  const {record, content} = versionFixture();
  const result = await page.evaluate(async ({record, content}) => {
    window.__setMockFile('target', '.filenally/index.json', {content:JSON.stringify({schemaVersion:1,versions:[record]})});
    window.__setMockFile('target', `.filenally/${record.storedPath}`, {content});
    const store=window.FileNallyTest.VersionStore;
    const prepared=await store.prepareRestore(window.__mockPair.target, record);
    return store.restore(prepared,{side:'target',direction:'unidirectional',runId:'restore-1'});
  }, {record, content});
  const snapshot=await snapshotMockPair(page);
  assert.equal(snapshot.target['report.txt'].content,'old');
  assert.equal(snapshot.target['.filenally'].versions[result.backup.id]['report.txt'].content,'current');
  assert.equal(result.backup.reason,'before-restore');
  assert.equal(result.backup.fromSide,'target');
  assert.equal(result.backup.toSide,'target');
  assert.equal(snapshot.source['.filenally'],undefined);
});
```

Using these real store operations and fixture helpers, table-drive the following concrete mutations with no-write assertions against complete snapshots: missing store (empty); unsupported/corrupt index; duplicate selected ID; `.filenally/index.json` and nested `.trash/file` originals; absent stored file; stored byte-size mismatch; index record changed after selection; destination changed from `current` to `changed` retaining size/mtime; destination appears/disappears/replaced handle after preparation; stored file edited after preparation; root write permission denied; version write/index-close failure; destination write failure after backup. Test post-backup destination mutation using a focused mock close hook; current external bytes must survive.

- [ ] Step 2: `node tests/file-nally.e2e.cjs --grep 'version restore|version reader'` must fail before new production behavior.

- [ ] Step 3: Extend validation/capture and add list/read/prepare/restore. Follow this sequence (helpers private to VersionStore):

```javascript
// list: getDirectoryHandle('.filenally') without create -> loadIndex -> reject duplicate IDs -> return versions.
// read: list -> unique matching ID plus JSON equality of canonical record -> derived safe path -> getFile -> size check.
// prepare: read -> resolve current handle/file without creation -> retain root/record/File snapshots.
// restore: validate side/direction/permission -> validate prepared snapshot against freshly read record/version/current.
// if current exists: capture({action:{path:record.originalPath,fromSide:side,toSide:side},
//   handles:{[side]:root}, direction,runId,reason:'before-restore'}).
// Recheck current handle/metadata and bytes, version record and bytes -> write prepared version -> close -> return {record,backup}.
// Failure: attach backup if committed; abort an opened writable on failure where supported; rethrow.
```

Exact freshness compares pinned Files with live Files in CONTENT_CHUNK_BYTES chunks; metadata alone is insufficient. Use isSameEntry when handles are present. Reject any reserved original-path component before capture/restore path construction. Reuse shared filesystem functions; do not duplicate the index persistence code. Mock wrong-kind lookups must return TypeMismatchError, distinguishing missing file from directory collision. Protect duplicate use/concurrent restore in the same page with minimal operation state if the public API needs it.

- [ ] Step 4: Build, focused tests, full npm test, diff check; record relevant RED/GREEN outputs and commit `feat: add validated version restore operations`.

### Task 2: Version Manager UI, Operation Guards and Manuals

**Files:** Modify dev/js/file-nally.js, dev/file-nally.html, dev/css/file-nally.css, tests/file-nally.e2e.cjs, README.md, docs/README_en.md; generate file-nally.html.

**Interfaces:** Consume all Task 1 methods exactly. Create `VersionManager` UI/controller using a current root pair, operation generation and `model.versionBusy` guard. Expose no new test-only production logic; tests use DOM and existing store/test hooks.

**DOM contract:** `btnVersions`, `versionDialog`, `versionBody`, `versionStatus`, `btnVersionRefresh`, `btnVersionPrevious`, `btnVersionNext`, `versionPageStatus`, `btnCloseVersions`; `restoreDialog`, `restoreSummary`, `restoreStatus`, `btnConfirmRestore`, `btnCancelRestore`. Row action buttons use `data-version-action="download"` or `"restore"`. Native dialogs get meaningful labelled headings and descriptions.

- [ ] Step 1: Add real end-to-end tests by seeding versions with Task 1 fixture then using DOM. The primary acceptance path:

```javascript
await page.locator('#btnVersions').click();
await page.locator('#versionBody [data-version-action="restore"]').first().click();
await page.locator('#restoreDialog').waitFor({state:'visible'});
assert.match(await page.locator('#restoreSummary').innerText(), /report\.txt/);
await page.locator('#btnCancelRestore').click();
assert.deepEqual(await snapshotMockPair(page), before);
await page.locator('#versionBody [data-version-action="restore"]').first().click();
await page.locator('#btnConfirmRestore').click();
await page.waitForFunction(() => !document.querySelector('#restoreDialog').open);
assert.equal((await snapshotMockPair(page)).target['report.txt'].content,'old');
assert.equal(await page.locator('#btnSync').isDisabled(),true);
```

Add independent scenarios: both-root latest-first list and 101-entry paging; one-side malformed with healthy list retained; download exact UTF-8 and binary bytes using page download event; missing-file restore; root swap with misleading historical toSide; read-only cancel/Escape and focus return; same-size/same-mtime change while confirmation open rejects; denied permission; backup failure and post-backup write failure display retained version ID/path; double-click restore only once; invoke existing controller hooks during delayed restore to prove no stale plan/sync/profile mutation; close during delayed read discards results. Test Korean and English names/labels and text injection via filenames. Assertions name actual behavior, not incidental wording.

- [ ] Step 2: Run `node tests/file-nally.e2e.cjs --grep 'version manager'`; confirm failures caused by missing UI/behavior.

- [ ] Step 3: Add native dialogs/buttons, labels and responsive styles. Use existing run-detail shell styles and 100-row paging. Selected/current comparison renders two metadata blocks. Before user confirms, main prompt explains backup-before-replace or create-new. Busy write cannot be cancelled; error clears prepared selection so next attempt requires fresh preparation.

```javascript
// Refresh both roots independently and preserve current root identity on each row.
const results = await Promise.allSettled(['source','target'].map(side => VersionStore.list(roots[side])));
// Each healthy row: {side, root:roots[side], record}; each rejected side: visible side-labelled error.
// Prepare/download use row.root and row.record, not record.toSide.
// Confirm click: immediately start owning-root requestPermission({mode:'readwrite'}), then store.restore.
// On attempted restore: invalidate plan and clear displayed file/directory snapshots, keep manifest/checkpoint untouched.
// Finally: release versionBusy and rerender controls; discard stale async output using generation checks.
```

Factor Blob download from current text download helper to preserve arbitrary bytes. All user strings use textContent. Guard Controller pick/swap/connect/import/compare/sync and their controls while manager operation owns roots; prevent opening manager during pending folder/profile/sync operations. Guard direct handler entry, not only buttons. Keep confirmation bound to the dialog generation and roots. Refresh controls and focus on success/failure/cancel.

- [ ] Step 4: Update both manuals: manager workflow, physical ownership after swap, explicit restore independent of next sync direction, backup-before-restore, fresh comparison, stale confirmation, partial root errors, format same-version additive reason/older-build fail-closed restriction, available metadata and external filesystem concurrency limits. Remove obsolete claim that no restore/list UI exists; diff and cleanup remain future work.

- [ ] Step 5: Run build/focused/full suites and visual suite. Add and inspect `artifacts/visual/{mobile,tablet,desktop}-versions.png` and `*-restore.png` at 375/768/1280px including long paths. Verify no document-level overflow, keyboard access and both dialogs' scrollable content. Commit `feat: add version manager and confirmed restore`.
