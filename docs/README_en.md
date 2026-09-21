# File-nally

**Beta v0.15.1** · [한국어 메인 설명서](../README.md)

Comparison diagnostics and filename recovery guidance: [Usage guide](DEBUG-COMPARISON.md)

File-nally is a self-contained browser application for comparing and synchronizing two local folders. The distributable runtime—HTML, CSS, and JavaScript—lives in the generated [file-nally.html](../file-nally.html), so end users do not need a server, build process, or Node.js installation.

## Features

- Bidirectional synchronization or one-way Source → Target synchronization
- Safe synchronization of folder structure, including empty folders
- A reviewable file-by-file plan before anything is written
- Four explicit conflict policies: latest, source wins, skip, and preserve both
- Synchronization deletions use versioned `.trash/<run timestamp>/...` isolation instead of permanent deletion
- JSON schema v2 settings, folder-pair manifests, and synchronization history
- Safe stop after the current file operation finishes
- Per-folder-pair identity checks that reject same or nested directories
- Responsive Korean and English interface

- Recent folders history and bookmarks (up to 5) — reuse saved directory handles. Selecting an item requests renewed permission when needed, and comparison is enabled only after both folders have read/write access.
- File rename detection — plan a rename only when deleted and added files have identical content and form one unambiguous candidate. It uses an atomic move when supported and otherwise falls back to copy plus removal. Different or ambiguous candidates keep the copy plus `.trash` preservation path.
- Reverse synchronization (Target → Source) and a glassmorphic segmented toggle UI — three direction options: `Source ⇄ Target`, `Source → Target`, `Target → Source`.
- Responsive synchronization options disclosure — options start collapsed on mobile and an explicit user choice persists across visits.
- Source/Target folder swap — exchange a verified folder pair with one control and swap it back again.
- Per-run detailed history — inspect every action, path, duration, status, and error, then download the complete log as CSV or JSON.
- An in-app quick guide in the standalone HTML — open the header guide for the Korean or English workflow, saved-folder permission renewal, backups, and manual `.trash` recovery notes.

## Requirements

- Current Google Chrome or Microsoft Edge with the File System Access API
- Permission to read and write both selected folders
- An independent backup of important data

File-nally runs locally in the browser and does not upload your files. Browser permissions, disk failures, operating-system limits, and unexpected shutdowns can still cause data loss, so it is not a replacement for a backup system.

## Start the application

1. Download `file-nally.html` from the repository or the [GitHub Releases page](https://github.com/WizMasia/Filenally/releases).
2. Open the HTML file in Chrome or Edge.
3. Select the **Source folder** and **Target folder** and grant read/write permission.
4. Review the synchronization direction, conflict policy, comparison mode, and excluded directory names.
5. Select **Compare changes**.
6. Review the queued actions in both file tables.
7. Select **Run synchronization**.

Select **Quick guide** in the header whenever you need the workflow and safety notes inside the app. Close it with Escape or **Close**; focus returns to the **Quick guide** button.

The application rejects a folder pair when both selections refer to the same directory or when one directory is inside the other. This prevents recursive synchronization and accidental self-copying.

## Synchronization directions

### Bidirectional

New and changed files can move from Source to Target or from Target to Source. When a trusted previous manifest shows that a file was deleted on one side and remained unchanged on the other, the remaining copy is moved into that side's versioned `.trash` directory.

Empty folders follow the same creation and trusted-deletion rules. A folder present on only one side can be created on the other, while a deletion confirmed by a trusted previous manifest moves the remaining empty folder tree into that side's versioned `.trash` directory.

### One-way: Source → Target

Source is authoritative for copy operations. Target-only files without a previous synchronized record are protected. A deletion recorded after an earlier successful synchronization can still be propagated by moving the corresponding Target file into `.trash`.

In one-way and reverse synchronization, files and empty folders on the authoritative side are created or recreated on the other side. Deleting an item on the non-authoritative side never deletes the authoritative copy. Only a deletion on the authoritative side confirmed by a trusted manifest moves the other copy into the run-specific `.trash` directory.

### Reverse: Target → Source

Reverse synchronization makes Target authoritative and applies the same rules in the opposite direction: Target files and empty folders are created or recreated on Source, while deletions on authoritative Target are propagated only when confirmed by a trusted manifest.

## Conflict policies

| Policy | Behavior |
|---|---|
| **Keep latest** | Copies the file with the newer modification time. A tied timestamp with a different size remains unresolved for manual review. |
| **Source wins** | Uses the Source version when both sides changed. |
| **Skip existing** | Never overwrites an existing destination path; new missing paths can still be copied. |
| **Rename and preserve both** | Keeps each original and copies the other version using `.conflict-source-*` and `.conflict-target-*` names. |

## Comparison modes

| Mode | Behavior |
|---|---|
| **Quick comparison (default)** | Compares file size and modification time. Matching metadata is treated as equivalent. |
| **Exact comparison** | Reads same-size files in 4 MiB chunks and compares every byte. It stops at the first difference and avoids copying identical content merely because modification times differ. |

Exact comparison is slower because it reads file contents, but it keeps only two chunks in memory at once. **Stop safely** can cancel it between chunk reads. File-nally does not expose hash algorithms, partial-chunk fingerprints, or a persistent content-hash cache.

Rename candidates are still compared byte-for-byte in quick mode to prevent false matches.

## Deletion safety and `.trash`

File-nally does not permanently delete a synchronized file. Confirmed deletion propagation moves the remaining file to:

```text
.trash/<run timestamp>/<original relative path>
```

Repeated names in the same trash run receive a numeric suffix instead of being overwritten. The `.trash` directory is always excluded from synchronization, even if it is removed from the visible exclusion list. Recovery is manual: inspect `.trash` and move the required file back to its original location.

File-nally never recursively deletes a non-empty directory. If a directory becomes non-empty after comparison, the directory move stops and the run reports an error.

## Pre-overwrite version capture

Before overwriting an existing destination file, File-nally captures it. Captures are stored below the affected destination root at:

```text
.filenally/versions/<capture-id>/<original relative path>
```

Capture metadata is stored in `.filenally/index.json`. New indexes and ordinary v1 writes use schema v1; explicitly confirmed manual cleanup upgrades the index to v2, which subsequent writes preserve. `.filenally` is always excluded from synchronization, regardless of the visible exclusion list. If capture or index writing fails, File-nally does not perform that overwrite and stops the synchronization run.

After connecting both folders, open **Version manager** to see captures from both roots, newest first, in pages of 100. Each entry shows its owning folder's current Source/Target side and name, original path, capture time, size, reason, and version ID. An unreadable index produces a folder-specific error while the healthy folder's entries remain available. **Refresh** rereads both folders; **Download** saves the exact file bytes with the original filename.

**Compare** is read-only: the selected stored version stays on the left; the right side is the current original (default) or another stored version with the same original path in the same owning folder. Choose a counterpart and explicitly start comparison. Stop, Close and Escape do not change files or the existing sync plan. Historical Source/Target fields and the configured sync direction never reverse the operands.

Exact byte equality is checked first. Unequal UTF-8 text receives a line diff within 512 KiB and 5,000 lines per file, 8,192 UTF-16 code units per line, and 2,000,000 LCS cells including boundary rows/columns after trimming common prefix/suffix lines. Larger work receives a reasoned summary. Changes include three context lines; results page at 200 rows and historical choices at 100. Changing history pages clears a historical selection until a visible counterpart is chosen. BOM, CRLF/LF/CR and final-newline differences remain byte differences. Invalid UTF-8, control characters and UTF-16 are not silently converted.

Full SHA-256 fingerprints are optional for each file up to 16 MiB when Web Crypto is available; unavailable fingerprints have explicit reasons and do not determine byte equality. Missing current files are not compared, not treated as empty. Results describe snapshots at their displayed read times. Observed file/record changes before publication cause an error, but there is no atomic lock against external edits; later changes retaining size and mtime may be undetected.

**Restore** opens a separate confirmation showing the selected version and current file, including their path, size, modified time, and owning folder. **Restore this version** requests write permission and starts the operation. An existing file is saved as a new version and its index committed before replacement. A missing file is created at the original path only after the same explicit confirmation. Cancel and Escape make no filesystem changes. Duplicate execution and cancellation are blocked while restoration writes are running.

Restoration always targets the folder that physically stores the version. Swapping Source and Target does not cause historical `toSide` metadata to redirect it. The displayed next synchronization direction remains in effect; manual restoration affects only the selected owning folder. Every restore attempt clears the old plan and displayed scans, so **Compare changes** again before synchronizing. Restoration does not rebuild synchronization manifests or checkpoints.

Changes to the version or current file after preparation invalidate confirmation, including byte changes with identical size and modified time. Select the version again to retry with a fresh confirmation. If restoration fails after a backup was committed, its retained ID and `.filenally/versions/...` path appear in the manager status and live log. Folder selection/swapping, profile connection, settings import, comparison, and synchronization are locked while the manager is open.

The `before-restore` reason and v2 indexes after cleanup may be incompatible with older builds. In particular, v0.14 cannot read a v2 index and may leave an unregistered capture file before rejecting an overwrite. Use the updated app with cleaned folders. Settings remain schema v2.

### Version usage inspection and manual cleanup

**Registered version usage** shows each connected physical folder's indexed version count, original-path count, and exact decimal logical-byte sum. Path summaries page at 100 per folder independently of the version list. A combined total appears only when both registered summaries can be read. Index errors are unknown, distinct from zero registrations when no index exists. Opening the manager does not traverse physical files or request permission.

**Inspect physical files** observes files under `.filenally`: all files, registered files, unregistered version files, other files, index bytes, missing/size-mismatched records, read time, and errors. Without a valid index, registered/unregistered classification is unknown. Registered totals and physical observations can differ; neither measures allocated disk space or guarantees reclaimed space. Inspection does not hash file contents. Traversal is capped at 100,000 entries per root, relative depth 256, 8,192 UTF-16 code units per relative path, and 100 error details, yielding to the browser every 128 entries. Limits, errors, stopping, or changes during inspection produce explicit partial/cancelled/stale results. Zero in a partial result does not establish total absence; missing records are determined only after a complete traversal. Index limits remain 5 MiB and 100,000 records.

Select **1–100 registered versions in one physical folder** and choose **Clean up selected versions** to review a frozen confirmation list. Selection persists across list pages but clears on refresh, close, or folder change. **Select current page** selects only that page's entries in the chosen folder; additions beyond 100 are refused. Source/Target labels and actual handles distinguish even equally named folders. Historical metadata and any of the three synchronization directions never redirect deletion.

Cleanup is **permanent deletion**. Back up important versions separately before confirming. Current originals, the other folder, `.trash`, unselected versions, and unregistered files are preserved. Parent directories are never recursively removed, so empty capture directories can remain. Paths without a verified retained registered copy require a last-version warning and separate acknowledgment. Missing or size-mismatched retained files do not prove preservation. Preparation, inspection, Cancel, and Escape change no files, indexes, settings, or existing sync plan. Only the confirmation click requests write permission for the selected root; denial discards the preparation but preserves the existing plan.

While cleanup writes, duplicate confirmation and Close/Escape are blocked. **Stop after current item** waits for the current file deletion and its index commit. The dialog and live log report the operation ID, physical folder, confirmed completed count and logical bytes, failed ID/error, and recovery requirement. Any attempted store cleanup/recovery invocation clears the old plan and scans on success, failure, or stop, requiring a fresh comparison before synchronization. Direction, manifests, and checkpoints are preserved.

A pending cleanup blocks that root's ordinary version reads and capture-backed overwrites. The other root's entries and non-overwriting new-file copies remain available. **Recover interrupted cleanup index** uses a separate confirmation to remove only registrations for already missing versions and preserve remaining pending files and registrations. It does not resume deletion and cannot be stopped once writing starts. Select and confirm a fresh cleanup afterward if needed.

Capture, restore, cleanup, and recovery share a writer lock within this app instance. Other tabs/programs are not atomically locked. Cleanup/recovery refuse writes when required handles lack `isSameEntry`; inspection remains available. Identity, metadata, and selected-byte checks still cannot guarantee historical inode identity: native `isSameEntry` compares locators. Recreating the same path with identical observable values, or an external change after the final check, may be undetectable.

Automatic retention and expiry remain deferred; manual cleanup does not complete the follow-up retention work in #12. Creation date, author, owner, ACL, and similar metadata are unavailable.

## JSON settings and folder profiles

Serializable application data is stored under the `smart_sync_state` localStorage key:

- Synchronization direction, conflict policy, and comparison mode
- Excluded directory names and interface language
- Folder-pair profiles and manifests
- Per-profile and global synchronization history
- Incomplete-run checkpoints

Non-serializable directory handles and per-run detailed logs are stored separately in IndexedDB. JSON backup files never contain file contents, directory handles, or detailed run logs; use the run-details CSV/JSON controls to download a complete individual log.

Use the application controls to:

- **Default JSON:** download a clean schema v2 configuration
- **Back up JSON:** export the current settings, profiles, manifests, and history
- **Restore JSON:** validate and import a backup up to 5 MB

Restored profiles and legacy v0.6.1 manifests remain unverified until the matching folder pair is selected again. An unverified manifest cannot trigger deletion propagation.

## Safe stop and failures

During exact comparison, **Stop safely** finishes the current chunk read and stops without writing files. During synchronization, it finishes the currently active write and does not start the next action.

Always compare again after an aborted or failed run before attempting another synchronization.

## Supported environments and limitations

| Classification | Environment |
|---|---|
| Supported target | Current desktop Chrome or Edge on Windows, macOS, Linux, and ChromeOS |
| Verified in this project | Current macOS Chrome plus mocked Chrome filesystem flows |
| Experimental / not supported | Android Chromium |
| Unsupported | Safari, Firefox, iOS/iPadOS browsers, and Brave without its feature flag |

### Permissions and filesystems

- Folder access always depends on a user gesture and browser permission. Protected system directories, read-only locations, and paths blocked by the operating system or storage provider cannot be synchronized.
- OS-reserved names, maximum path lengths, removable media, network drives, and cloud-provider placeholders or hydration rules can reject or delay operations.
- Filename case sensitivity and Unicode normalization differ by filesystem. Names that are distinct on one platform can collide or compare differently on another, especially between Windows, case-insensitive APFS, and case-sensitive filesystems.
- Quick mode compares only size and modification time. Exact mode reads content but creates no hash or persistent content cache. Neither mode preserves original timestamps, ownership, permission bits, ACLs, extended attributes, macOS resource forks, or the identity of symbolic links.

### Language and application behavior

- The interface is translated only into Korean and English. Browser, operating-system, and storage-provider error text may remain untranslated, and unusual Unicode filenames can render or sort differently across platforms.
- Checkpoints are saved after individual actions; there is no transaction covering the whole plan. A failure can therefore leave a partially completed run that must be compared again.
- Recovery from `.trash` is manual. There is no background folder monitor, scheduler, unattended synchronization, or automatic rollback.
- Very large folders can require substantial memory and comparison time. Private browsing, clearing browser data, permission revocation, disconnected removable media, unavailable network/cloud storage, or platform-specific file placeholders can affect operation.

Compatibility references:

- [Chrome File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [File System Access specification](https://wicg.github.io/file-system-access/)
- [MDN `showDirectoryPicker()` compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
- [WebKit origin-private filesystem](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/)

## Troubleshooting

### The folder picker does not open

Use a current Chrome or Edge release. Other browsers may not implement `showDirectoryPicker()` or writable directory handles.

### Compare changes is disabled

Select both folders. If the page reports an invalid pair, choose two separate, non-nested directories. Restored JSON profiles must also be rebound to their original folder pair.

### Access stops working after reopening the page

The browser may require folder permission again. Select a recent folder or bookmark and approve read/write access. If permission is denied or the saved connection is no longer valid, select the Source and Target folders again. File-nally stores only the directory handle, not a way to bypass browser permission prompts.

### A file is reported as a conflict

Review both modification times and sizes, then choose an appropriate conflict policy. A deletion on one side combined with a modification on the other is intentionally left unresolved.

### I need to recover a deleted file

Look inside the affected folder's `.trash/<run timestamp>/` directory and restore the file manually.

## Development

Node.js and Playwright are development-only dependencies; end users only need `file-nally.html`. Edit only the three files under `dev/`; the root HTML is generated and must not be edited directly.

```bash
npm ci
npm run build
npm run build:check
npm test
npm run test:visual
```

The Chrome regression suite covers quick/exact comparison, comparison cancellation, state migration, JSON validation, folder-pair verification, conflict policies, copying, versioned trash, safe stop, write failure handling, and rename detection.

## Contributing and reporting issues

Keep each change focused on one purpose and include a regression test for behavior changes. Run `npm test` before a pull request and `npm run test:visual` for UI changes. Regenerate `file-nally.html` with `npm run build` when modifying `dev/` sources.

When filing a [GitHub issue](https://github.com/WizMasia/Filenally/issues), include reproduction steps, browser and operating system, expected behavior, and observed behavior. For potential data-loss issues, include which folder pair and whether a JSON backup exists.

## Repository layout

```text
dev/file-nally.html          # Editable development HTML
dev/css/file-nally.css       # Editable styles
dev/js/file-nally.js         # Editable application behavior
scripts/build.cjs            # Deterministic single-file builder
file-nally.html              # Generated standalone production artifact
README.md                    # Korean primary manual
docs/README_en.md            # English secondary manual
docs/BUILD.md                # Bilingual build guide
DESIGN.md                    # UI and accessibility contract
tests/                       # Builder and Chrome regression tests
```

## Design and license

See [DESIGN.md](../DESIGN.md) for the design system and accessibility constraints. File-nally is provided under the [MIT License](../LICENSE).
