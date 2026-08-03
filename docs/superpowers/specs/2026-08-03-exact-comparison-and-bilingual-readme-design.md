# Exact Comparison and Bilingual README Design

## Goal

Preserve File-nally's fast metadata comparison as the default while adding an opt-in exact-content comparison that is bounded in memory and cancellable, then make Korean the primary project documentation with English as the secondary manual.

## Scope

- Add two comparison modes: `quick` and `exact`.
- Keep `quick` as the default for existing and new users.
- In `exact`, compare same-path, same-size files byte-for-byte in fixed-size chunks.
- Show comparison progress and allow the existing safe-stop button to cancel comparison without writing files.
- Keep comparison settings in schema v2; missing or invalid values normalize to `quick`.
- Make the root README Korean-first and move the English manual to `docs/README_en.md`.
- Document defaults, performance trade-offs, contribution and issue-reporting guidance, and the MIT license.

## Explicitly Excluded

- General/advanced user-level toggles.
- Hash algorithm selection, MD5, SHA-1, or custom digest formats.
- Hash caches keyed by path, size, and modification time.
- Parallel hashing or Web Workers.
- Partial first/middle/last chunk fingerprints presented as exact equality.

These are excluded because direct byte comparison solves the current correctness gap with no dependency or cache-validity ambiguity. They can be reconsidered only after measurements show repeated exact comparisons are too slow.

## Architecture

`FileAdapter.scan()` continues to collect relative path, size, modification time, and the file handle. A new content-comparison function reads matching `File` objects using `Blob.slice()` and `arrayBuffer()` in 4 MiB chunks. It stops on the first differing byte and checks cancellation between chunks.

Before synchronous planning, `Controller.compare()` builds a map of exact equality results for paths present on both sides. `SyncPlanner.plan()` consumes that map:

- equal content overrides modification-time differences and produces a baseline rather than a copy;
- unequal content prevents equal metadata from being treated as unchanged;
- when metadata cannot identify which side changed, unequal content becomes a conflict;
- different sizes are unequal without reading file contents.

The existing progress region reports comparison bytes as well as synchronization actions. The existing stop button is enabled during `comparing` and `syncing`; comparison cancellation returns to the ready state and leaves no plan or file writes.

## UI and Accessibility

The controls panel gains one labelled native `<select>` following the existing Field primitive. Its options are concise and bilingual:

- Quick: size + modified time, recommended default.
- Exact: byte-for-byte content, slower.

No new color, spacing, motion, or component token is required. The existing Progress and Button contracts in `DESIGN.md` apply. Busy controls remain disabled, the progressbar exposes current numeric progress, and safe stop stays keyboard-accessible with a 40 px target.

## State and Compatibility

`config.comparisonMode` accepts only `exact`; every other value becomes `quick`. Existing schema v2 backups import without migration because the field is optional and normalized at the boundary. Exports include the normalized value.

## Verification

Browser regression coverage must prove:

1. Exact mode detects different contents with identical size and modification time.
2. Exact mode treats identical contents with different modification times as equal.
3. Quick mode preserves the current metadata behavior.
4. Exact comparison cancellation stops before planning and performs no writes.
5. Imported legacy settings default to quick mode.
6. The new select is labelled, responsive, and translated.

The complete build and Playwright suite must pass. Fresh screenshots at 375, 768, and 1280 px must show no overflow or Korean text defects.

## Documentation

The current Korean manual becomes `README.md`; the current English manual becomes `docs/README_en.md`. Both describe the same shipped behavior and link to each other. A concise contribution section covers local setup, tests, focused pull requests, and reproducible issue reports. A root `LICENSE` contains the MIT license text with `2026 WizMasia` as the copyright notice.
