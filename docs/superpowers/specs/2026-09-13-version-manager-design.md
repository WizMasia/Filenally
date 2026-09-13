# Version Manager and Confirmed Restore

Date: 2026-09-13
Parent: GitHub #12, second delivery slice
Status: approved architecture; implementation details resolved under the user's instruction to continue

## Scope and approved decisions

Add an independent version-management dialog to the existing single-page app. Combine versions from both currently connected, verified roots, label each with its current root side and name, and sort newest first. Provide file download and a separate in-app restore confirmation dialog. Restore to the original relative path inside the root that physically owns the version, even after the source/target folders have been swapped. The historical `toSide` does not select the destination.

Confirmation shows the selected version and the current file side by side (path, size, modified/capture time and owning root). Both creating a missing file and replacing an existing file require an explicit confirm click. Replacing a file first preserves the current file and commits its version index. Cancel makes no filesystem changes. Existing sync direction remains visible; manual restore affects the selected owning root only and the next synchronization still follows the configured direction.

## Boundaries

`VersionStore` owns validated index reading, derived stored-file lookup, restore preparation, and restore execution. Extend the existing module rather than duplicating filesystem/index logic. `VersionManager` owns merged presentation state, current-root binding, dialog lifecycle, and operation exclusion with the rest of the app. Use existing native dialog, DOM text, translation, and download patterns; no dependencies or page router.

Settings remain schema v2. Version indexes remain schema v1 with an additive `before-restore` reason. A `before-restore` record uses equal `fromSide` and `toSide`, both equal to the current owning root side; `before-overwrite` continues requiring opposite sides. Both reasons carry the current direction and a unique operation/run ID. Earlier app builds cannot parse the new reason and will safely block overwrites on such an index; manuals must tell users to use the updated app. No migration or resetting is permitted.

## Listing and downloads

List reads neither create directories nor modify the index. Missing `.filenally` or missing index is an empty list; malformed, forbidden-key, unsupported, oversized or ambiguous duplicate-ID indexes produce a root-specific error. A root error does not hide healthy results from the other root. Page at 100 rows, newest capture first, with deterministic current-side/ID tie breaking. Show root, original path, capture time, size, reason and download/restore actions. Refresh re-reads both roots.

Before download or preparing restore, reload the owning root's index and require exactly one matching ID whose allowlisted metadata still matches the selected record. Resolve `versions/<id>/<originalPath>` from validated components instead of trusting an arbitrary stored path. Reject restore targets containing `.filenally` or `.trash` components, traversal, or a directory at the target. Validate the stored file exists and matches the recorded size. Missing/mutated entries report an error without writes. Downloads use the actual File/Blob bytes and original basename, including binary data.

## Restore ordering and freshness

Preparation is read-only and retains the owning root handle, canonical record, selected version File, and current destination File/handle (or absence). Confirmation belongs to that exact selection and current root. Before executing, re-read the index, stored version and destination. Require unchanged record, file identity where supported, metadata and exact bytes against the prepared snapshots. Compare bytes in bounded chunks so equal-size/equal-mtime edits cannot pass. A change, disappearance, new arrival, unreadable snapshot or root switch invalidates confirmation and requires a fresh selection/confirmation.

On explicit confirmation, obtain current write permission for the owning root from the user's click. Check permission before any write. If a current destination exists, call the common capture machinery with `before-restore`; close its backup bytes and validate/commit the post-append index (5 MiB, 100,000 records) before writing restored bytes. Recheck destination freshness after capture, before opening the destination writable. On absence, recheck absence before creation. Recheck selected version content before final writing. Write the selected snapshot and await close. An exception after backup retains that backup; report its ID/path with the restore failure.

No compare-and-swap or cross-process filesystem lock is supplied by this API: checks reject observed races but do not promise atomicity against an unrelated program editing at the final write boundary. This limit belongs in technical documentation, not extra product confirmation steps. No automatic rollback or cleanup is added.

## State and interaction

Require a verified connected pair to open the manager. Capture current root handles and current source/target names while the dialog is open. Operation guards block folder picking/swapping, profile reconnect, state import, comparison and synchronization during version reads/restores; all relevant handlers enforce the guard as well as disabling buttons. Dialog close/cancel during asynchronous reads discards stale results. During a restore write, prevent duplicate confirmation and cancellation that could imply rollback. Always release busy state in finally paths.

After a restore attempt that can mutate data, invalidate the pending synchronization plan and clear displayed scan snapshots; keep synchronization manifests/checkpoints untouched. Show restore success/failure and any backup reference in the manager/live log, refresh the version list, and require a fresh comparison before synchronization. No separate persistent restore-history subsystem.

Maintain Korean/English strings, keyboard focus entry/return, Escape cancellation before writing, textContent rendering, accessible dialog names, root-specific error announcements, and usable 375/768/1280 px layouts.

## Verification

Storage tests: empty root no writes, malformed one-side failure, duplicate IDs, reserved paths, stale metadata and missing bytes, exact download bytes, same-root ownership in all directions and after swaps, before-restore backup reason, restore-to-missing, same-size/same-mtime edits, late arrival/deletion, mutation during backup, permission denial, backup/index failure, restore-write failure retaining backup.

UI tests: merged root-labelled paging, refresh, partial errors, download event bytes, confirmation/cancel no writes, current/selected metadata, stale-confirmation recovery, busy handler guards and duplicate clicks, plan invalidation, locale/focus, responsive list and confirmation screenshots. Existing 108 browser tests and generated HTML checks remain green. Full suites run at deliverable boundaries and after relevant changes, not on every edit.
