# Version Capture Foundation Design

**Date:** 2026-09-13  
**Parent issue:** GitHub #12 — 파일 버전 관리 체계 구성  
**Status:** Approved design

## Purpose

File-nally currently protects confirmed deletions with versioned `.trash` folders, but overwriting an existing destination file destroys the previous destination bytes. This first increment establishes a recoverable on-disk version store and captures the destination immediately before an overwrite.

This design is the storage foundation for later version browsing, restore, text diff, storage reporting, and retention work. It does not add those user interfaces yet.

## Goals

- Preserve the exact existing destination file before any synchronization copy overwrites it.
- Store versions beside the affected folder data so recovery does not depend on browser storage.
- Abort the overwrite if capture or metadata persistence fails.
- Apply the same rule in bidirectional, Source → Target, and Target → Source synchronization.
- Keep version storage outside all synchronization scans and plans.
- Record enough metadata to support later listing and restore work.
- Expose the created version ID and path in the detailed run log.

## Non-goals

- A version list, restore button, or diff interface.
- Automatic expiry, maximum-version enforcement, or storage cleanup.
- Delta storage, compression, deduplication, or persistent hashes.
- Capturing a file that does not already exist at the destination path.
- Replacing the existing `.trash` deletion-preservation flow.
- Recording creation time, author, owner, ACLs, or other metadata unavailable through the File System Access API.

## Storage Location

Each selected root owns versions of files changed inside that root:

```text
<selected-root>/
└── .filenally/
    ├── index.json
    └── versions/
        └── <capture-id>/
            └── <original-relative-path>
```

A Source → Target overwrite stores the previous Target bytes under Target's `.filenally`. A Target → Source overwrite stores the previous Source bytes under Source's `.filenally`. Bidirectional synchronization follows the actual copy destination for each action.

Versions are not duplicated into the opposite root. This avoids extra permissions and duplicate storage.

## Reserved Directory

Any directory named `.filenally` is always excluded at every scan depth, even if the user removes it from the visible exclusion list. The exclusion applies to files, directories, manifests, comparison rows, rename detection, and synchronization plans.

The application never treats user content inside `.filenally` as synchronizable data. If a file named `.filenally` blocks creation of the reserved directory, version capture fails and the destination file is not overwritten.

## Index Schema

`.filenally/index.json` uses an independent schema version so it can evolve without changing the application settings schema:

```json
{
  "schemaVersion": 1,
  "versions": [
    {
      "id": "018f...-uuid",
      "capturedAt": "2026-09-13T01:23:45.678Z",
      "originalPath": "documents/report.txt",
      "storedPath": "versions/018f...-uuid/documents/report.txt",
      "size": 1234,
      "type": "text/plain",
      "lastModified": 1789250000000,
      "reason": "before-overwrite",
      "runId": "sync-run-id",
      "direction": "unidirectional",
      "fromSide": "source",
      "toSide": "target"
    }
  ]
}
```

Capture IDs use `crypto.randomUUID()`. Paths are relative, normalized through the existing safe-segment rules, and never contain `.` or `..` traversal segments. `storedPath` is derived by the application rather than accepted as an arbitrary write target.

The index is limited to 5 MiB and 100,000 version records in this increment. A missing index creates an empty schema v1 index. Invalid JSON, an unsupported schema version, malformed records, forbidden object keys, an oversized index, or too many records is a hard failure. The application never silently resets a damaged index.

## Capture and Overwrite Sequence

The executor performs these steps for every `copy` action:

1. Resolve the destination path without creating the destination file.
2. If the destination file is absent, perform the normal new-file copy without creating `.filenally`.
3. If the destination file exists, read its current `File` snapshot.
4. Create a unique capture ID and copy that snapshot to `.filenally/versions/<capture-id>/<original-path>`.
5. Load and validate `.filenally/index.json`, or create a new schema v1 document if it is absent.
6. Append the capture metadata and finish writing and closing the index.
7. Record `versionId` and `versionPath` on the current run-log entry.
8. Only after the version bytes and index are durable, overwrite the actual destination file.

The capture uses the destination file observed at execution time, not stale comparison metadata. This also protects a destination that appears after comparison but before execution.

Writing the index uses `createWritable()` and is successful only after `close()` resolves. The design does not claim stronger crash atomicity than the browser's File System Access implementation provides.

## Failure Semantics

- Failure before index commit aborts the copy and leaves the existing destination file untouched.
- If version bytes were written but the index write fails, the destination remains untouched and the unindexed version is an orphan for a future repair/cleanup tool.
- If the destination overwrite fails after a successful capture, the version and index entry remain valid and the run log reports the copy failure together with its version ID and path.
- A corrupt or unsupported index blocks overwrites until the user repairs or moves the reserved directory. It is never replaced automatically.
- Version-capture failures use the existing executor rule: mark the current action failed, stop later actions, preserve the checkpoint, and retain the detailed error.
- Existing new-file copies, conflict-preservation copies to new names, rename operations, and `.trash` moves do not create versions unless they would overwrite an already existing destination path.

## Components and Boundaries

### VersionStore

A small module inside the existing standalone JavaScript owns:

- reserved paths and limits;
- index loading, validation, and writing;
- copying a destination snapshot into a capture path;
- returning immutable capture metadata.

It depends only on File System Access handles and existing safe-path utilities. It does not know about UI elements or planner rows.

### FileAdapter and SyncExecutor

The executor calls VersionStore as the mandatory precondition for a `copy` action. FileAdapter retains responsibility for reading and writing file bytes.

The run-log entry is updated immediately after the version index commits, before the destination overwrite begins. This preserves audit information even if the subsequent overwrite fails.

### Planner

No new planner action is required. Whether a copy overwrites is checked again against the live destination filesystem during execution. The existing copy status remains the reviewable action; documentation explains that overwrites include mandatory version capture.

## Run-log Additions

Each detailed entry gains optional fields:

- `versionId`: created capture ID, or an empty string when no version was needed;
- `versionPath`: path relative to `.filenally`, or an empty string.

JSON export preserves these raw fields. CSV export adds matching columns. Existing stored run logs without these fields normalize to empty values, so no run-log database migration is required.

## Security and Compatibility

- All version paths pass the existing relative-path validation.
- Index parsing applies bounded input checks and forbidden-key validation.
- Index records are reconstructed from an allowlist of fields; unknown fields are ignored.
- `.filenally` paths never originate from imported application settings.
- No executable content is rendered from index metadata in this increment.
- The application settings remain schema v2.
- Existing folders without `.filenally` continue to work and create it only on the first actual overwrite.
- No new dependency is added.

## Test Strategy

### Storage and execution

- Source → Target overwrite preserves the previous Target bytes and writes valid metadata.
- Target → Source overwrite preserves the previous Source bytes.
- Bidirectional copies capture on whichever side is the action destination.
- A new-file copy succeeds without creating `.filenally`.
- Repeated overwrites of the same path create distinct capture IDs and retain every version.
- A destination created after comparison is captured before it is overwritten.

### Failure safety

- Version-file creation or write failure leaves the destination unchanged and stops the run.
- Index read, parse, validation, write, and close failures leave the destination unchanged.
- A destination write failure after capture retains the indexed version and reports both the error and version metadata.
- A malformed, oversized, unsupported, or over-limit index is never reset automatically.

### Exclusion and paths

- `.filenally` is excluded even when absent from the user exclusion setting.
- Nested reserved directories do not enter file or directory manifests, comparison rows, rename candidates, or plans.
- Unsafe relative paths cannot escape a capture directory.

### Logs, artifacts, and documentation

- Successful and failed overwrite entries expose `versionId` and `versionPath`.
- JSON and CSV exports preserve version fields; older log entries remain readable.
- The generated `file-nally.html` matches development sources.
- Korean and English manuals describe capture location, failure behavior, manual preservation, and the absence of automatic cleanup.
- Full browser and visual regression suites pass.

## Delivery Decomposition

GitHub #12 remains the parent feature. It should be delivered as these ordered child issues:

1. **Version storage format and pre-overwrite capture** — this design.
2. **Version list, download, and conflict-confirmed restore UI.**
3. **Small UTF-8 text diff; binary size and byte-equality summary only.**
4. **Storage usage display and explicit manual cleanup.**
5. **Optional retention limits after manual inspection and cleanup are proven safe.**

Delta storage, content-addressed deduplication, and author/ownership metadata remain out of scope until real usage demonstrates a need and the platform exposes reliable data.
