# Version Comparison: Text Diff and Binary Summary

Date: 2026-09-13
Parent: GitHub #12, third delivery slice
Baseline: local main `d0bbdac`, version manager and confirmed restore
Status: detailed specification approved by the user on 2026-09-13

## Scope and selected approach

Add a read-only comparison dialog opened from each existing Version Manager row. Compare the selected stored version with either the current original file or another stored version of the same exact relative path in the same physical root. The current file is the default counterpart. Support line-level differences for small UTF-8 text and byte-equality/metadata summaries for other files, with size-limited SHA-256 fingerprints.

The user approved this scope after considering current-file-only comparison. That smaller alternative omits historical-version-to-historical-version comparison. A separate comparison page would allow a broader workspace but is unnecessary for this slice; retain the existing single-page/native-dialog interaction.

This feature never restores, writes, deletes, creates directories, requests write permission, or changes synchronization direction. It does not invalidate an existing synchronization plan or alter displayed scan snapshots, manifests, checkpoints, settings, or version indexes. Existing folder connection permission requirements remain unchanged. No new dependency, router, editor, merge/patch application, diff export, retention policy, or storage cleanup is included.

## Component boundaries

- `VersionStore`: add a small read-only comparison-snapshot interface using its existing record, index, original-path, and file-handle validation. Resolve and retain both actual `File` snapshots, canonical version records, file handles, physical root, and read timestamps. Reuse the non-creating current-original lookup; do not call `prepareRestore`, register a restore ticket, or expose capture/write operations through comparison.
- `VersionComparison`: analyze the two pinned Files, produce exact-equality status, bounded text-diff rows, optional fingerprints, metadata, and explicit fallback reasons. It owns computation limits and cancellation checks, not root selection, index access, DOM, or persistent state. Reuse `equalFileBytes` for chunked byte comparison without duplicating or changing synchronization/restore semantics.
- `VersionManager`: own the child dialog, counterpart selection, busy state, cancellation generation, progress/status, paging, and focus return. Comparison state is separate from `owner.selection` and other restore-confirmation state.

Keep these cohesive units in the existing JavaScript source. Modify the existing HTML/CSS sources for the child dialog and scoped styles; do not split the build pipeline or refactor unrelated modules. Continue generating the standalone root HTML from the three development sources.

## Selection and read contract

The left side is the row's selected stored version. The right side is either the current original or a different stored record. A historical counterpart must have an exact matching `originalPath` and belong to the same pinned physical root. Exclude the left record itself from the history choices. Current Source/Target labels and root name are presentation only; historical `fromSide`/`toSide` never select either file. Cross-root comparison and automatic rename-history tracking are out of scope.

Populate the historical counterpart choices from a fresh validated index, newest first with ID tie-breaking. Render at most 100 historical choices per page, independently of the manager's current list page. Keep the current-original choice available. Changing the history-choice page clears any selected historical counterpart and old result; the comparison action stays disabled until a visible valid counterpart is chosen. Do not silently substitute the current file for a discarded historical selection.

Before each comparison, re-read the index and require the selected version records to match their unique allowlisted canonical records. Use derived safe paths and existing size checks. Preserve the schema v1 parser, duplicate-ID rejection, 5 MiB/100,000-record limits, and case-insensitive reserved-path protections. Never reset or repair an invalid index.

Missing current original is a distinct `missing` result, not an empty file and not an insertion/deletion diff. The dialog remains usable for choosing another historical version. Missing stored bytes, a directory in place of a file, unreadable data, invalid records, and revoked read access are errors, not an empty or equal result. Clear old comparison output before reporting an error.

After analysis and before publishing, revalidate selected index records, file identity where supported, existence, size, type, and modification time against the pinned snapshots. Observed changes invalidate the result and require a new comparison. Do not reread entire large files solely to perform a second byte comparison at publication.

Results explicitly describe the snapshots read for that comparison and show the read time for each side. They do not promise an atomic cross-process snapshot or continuously current filesystem state. A same-size/same-mtime external edit after a readable snapshot was acquired is not guaranteed to be detected by the final metadata check. Equality and fingerprints must always refer to the pinned Files, never a mixture of newly fetched and retained Files. An unreadable pinned snapshot aborts the result.

## Exact comparison and resource limits

Use byte comparison, not metadata or hash equality, as the authoritative identical/different result. Different sizes establish different bytes immediately. Same-size files use the existing 4 MiB chunk comparator, including its empty-file readability check. Stop at the first difference; check cancellation around every asynchronous read. Surface progress without claiming that finding a difference requires reading the remaining bytes.

Initial limits are fixed product defaults, not new settings:

| Resource | Limit and fallback |
|---|---|
| Text decoding | Each file at most 512 KiB (524,288 bytes); larger files receive a summary |
| Logical lines | At most 5,000 per file; otherwise summary |
| Single logical line | At most 8,192 UTF-16 code units, excluding its terminator; otherwise summary |
| LCS matrix | At most 2,000,000 cells after trimming equal prefix/suffix lines; otherwise summary |
| Rendered result | At most 200 diff rows per result page |
| Historical selector | At most 100 historical records per page |
| SHA-256 input | At most 16 MiB (16,777,216 bytes) per file; larger fingerprints are explicitly not computed |

Check the applicable limit before allocation or whole-file reading. Text and fingerprint budgets are independent: a file too large for text decoding may still qualify for a bounded whole-file hash read. The LCS allocation includes the extra boundary row and column. Empty unmatched sides need no matrix. Release large buffers and obsolete results when an operation finishes, is cancelled, or its dialog closes; do not retain a hash/content cache.

## Text interpretation and line diff

For unequal files within the byte limit, decode each entire bounded snapshot as UTF-8 using fatal decoding. Do not rely on filename extension or MIME type to decide that bytes are text. Invalid UTF-8, NUL, or C0 control characters other than tab/CR/LF, plus DEL, produce a non-text summary; show the reason instead of replacement-character text. Other encodings, including UTF-16, are not converted in this slice.

Recognize one leading UTF-8 BOM and record its presence. Exclude that initial marker from line-content comparison only. Preserve all other characters, spaces, tabs, case, and Unicode representation; no trimming or Unicode normalization. Recognize CRLF, LF, and lone CR terminators, record their counts and whether a final terminator exists, and compare logical line content without terminators. Empty text has zero lines; a final terminator is metadata, not a phantom additional line.

Never equate normalized line content with byte identity. When only BOM/line terminators/final-newline details differ, retain the `different bytes` status and show a line-content-equal explanation plus format metadata. Even if the terminator counts are equal but their positions differ, do not claim byte equality or invent an unchanged-file result.

For line-content differences, trim common prefix/suffix lines, use bounded longest-common-subsequence alignment on the remaining lines, and emit deterministic unchanged/deleted/added rows. On equally good alignment choices, emit deletion before insertion. A changed line is a deletion and addition, not a new word-level diff feature. Keep original one-based line numbers for both sides and total added/deleted counts. Additions/deletions describe left-to-right comparison only, not a synchronization plan; the configured sync direction never reverses these operands.

Show changed rows with three unchanged context lines on either side; merge overlapping context and mark omitted unchanged ranges explicitly. Page the resulting rows at 200 without truncating the comparison or its counts. Text is rendered through `textContent`, with visible addition/deletion symbols and labels as well as color. Long paths and lines must wrap or scroll inside the dialog, never expand the document width.

Yield to the browser task queue and check cancellation at least every 16,384 LCS-cell evaluations, and between bounded row-generation/render batches. A microtask-only yield is not sufficient for button/Escape responsiveness. Input limits and work limits remain required even with yielding; no worker subsystem is needed in this slice.

## Binary and oversized-file summary

Always show the two identities, path, owning folder, file presence, byte size, MIME type when available, modification/capture times as appropriate, and read times. Show exact byte-equality status when both files exist; a missing current file has an explicit not-compared status and unavailable metadata, never a false equality result. A text fallback names its specific cause: size, encoding/control characters, line count, line length, or diff work limit. Oversized valid text is not mislabeled as a known binary format.

When a present file is within the fingerprint limit and Web Crypto is available, calculate SHA-256 from that same pinned snapshot and display the full hexadecimal digest. Compute eligible fingerprints one at a time to bound peak input-buffer allocation. For exact-equal snapshots, one digest may be reused for both. For oversized files or unavailable/unsupported crypto, show a labelled fingerprint-unavailable reason; continue to provide the exact byte comparison. Do not silently replace SHA-256 with another hash.

Read failures while gathering hash bytes invalidate the comparison. A crypto-capability failure may instead omit the optional fingerprint with an explicit warning. A cancelled operation must not publish a delayed digest. The browser's `digest()` has no incremental input or in-flight abort contract; cancellation discards that bounded pending result and schedules no further work after it settles.

## Dialog lifecycle and safety

The row's **Compare** action opens a sibling native comparison dialog only for the current manager session when no manager read/write or restore confirmation is active. The selected version is fixed on the left. Show the current original as the initial right-side choice and provide historical selection, an explicit **Compare / Compare again** action, **Stop comparison**, and **Close**. Opening the dialog or changing a choice does not automatically start analysis. Starting a new comparison clears the previous output.

Allow one active comparison per manager session. During it, disable selection/paging/duplicate start; keep Stop and Close available. Cancellation changes the operation generation immediately, clears incomplete output, and checks the token after every pending read/digest before any next step or publication. Native operations already pending may settle later. Release the read-busy flag in guarded `finally` paths without allowing an old operation to clear a newer operation's state.

While this child dialog is open, prevent manager refresh, paging, downloads, restore preparation, and restore confirmation through handlers as well as controls. Closing the manager also closes and invalidates its comparison child. Preserve the existing guard against root picking/swapping, profile connection, state import, configuration changes, comparison planning, and synchronization while the manager owns the roots. Closing the child returns to the manager, which continues to own that session.

Escape closes/cancels the comparison without writes. Restore focus to its connected row trigger, or the manager's Close button if that row no longer exists. Keyboard start/stop/error paths must remain usable and must not steal focus the user deliberately moved elsewhere. Close/reopen, selection changes and cancellation generations discard stale rows, errors, progress, and hashes. Discard old File references/results on close.

Use Korean/English labels, accessible headings/selection labels, and live status/error announcements. At 375/768/1280 px, keep the heading and controls reachable while result content scrolls internally. Small screens may stack metadata; the diff remains a single unified list rather than two wide editors. No comparison action changes restore selection, consumes a restore ticket, requests permissions, or modifies a synchronization plan.

## Verification and delivery

Follow RED → GREEN for meaningful new behavior. Add coverage to the existing harness, with no new test framework. Cover:

- Current-original and historical-counterpart comparisons, same-root/path enforcement, and misleading historical sides after root swap in each sync direction.
- A historical choice beyond the first 100 entries; result paging beyond 200 rows; stable identity/line numbering across pages.
- Missing current versus empty current, absent/corrupt/duplicate/stale indexes, unsafe paths, missing stored bytes, directory collisions, denied reads, and no-write/no-permission-call assertions.
- Full filesystem, plan, scan, configuration, manifest, and checkpoint snapshots unchanged after success, fallback, error, stop, and close.
- Insertions, deletions, changed lines, repeated-line tie-breaking, empty files, same bytes with different metadata, and unequal bytes with equal size/mtime.
- UTF-8 Korean and supplementary characters, invalid UTF-8, NUL/control bytes, UTF-16 fallback, BOM, CRLF/LF/lone CR, final newline, and untrusted HTML-like file contents/names.
- Inclusive and just-over byte/line/line-length/matrix/hash limits, allocation/read avoidance beyond limits, and explicit fallback reasons without partial diff claims.
- Known SHA-256 values, unavailable crypto, fingerprint limit, full exact comparison of larger files, and early exit for unequal size/content.
- Delayed reads/digests, observed record/file changes, stop during diff work, duplicate starts, close/reopen, child/parent guards, stale-result suppression, and keyboard focus preservation.
- Both locales and responsive comparison screenshots at 375/768/1280 px with long paths, long lines, many diff rows, and scrollable content.

Run generated-build checks, focused comparison tests, the full existing regression suite (baseline 173 cases), and visual checks at delivery boundaries. Update Korean and English manuals with limits, snapshot semantics, supported text formats, hash restrictions, and unchanged sync direction. Remove only the obsolete claim that difference viewing is unavailable; usage/cleanup/retention remain future work. Keep issue #12 open until its remaining slices are addressed. No remote push without user approval.

## Reference constraints

- [MDN: fatal UTF-8 decoding](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/fatal): fatal decoding rejects malformed input instead of substituting replacement characters.
- [MDN: SubtleCrypto.digest](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest): hashing takes the whole input in memory rather than streaming; this motivates the independent fingerprint cap.
- [File System Standard: getFile](https://fs.spec.whatwg.org/#api-filesystemfilehandle-getfile): filesystem snapshots can become unreadable when backing data changes; do not silently fetch replacement bytes during an analysis.
