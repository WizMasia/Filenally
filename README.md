# File-nally

**Beta v0.7.0** · [한국어 설명서](docs/README_ko.md)

File-nally is a self-contained browser application for comparing and synchronizing two local folders. The distributable runtime—HTML, CSS, and JavaScript—lives in the generated [file-nally.html](file-nally.html), so end users do not need a server, build process, or Node.js installation.

## Features

- Bidirectional synchronization or one-way Source → Target synchronization
- A reviewable file-by-file plan before anything is written
- Four explicit conflict policies: latest, source wins, skip, and preserve both
- Versioned `.trash/<run timestamp>/...` isolation instead of permanent deletion
- JSON schema v2 settings, folder-pair manifests, and synchronization history
- Safe stop after the current file operation finishes
- Per-folder-pair identity checks that reject same or nested directories
- Responsive Korean and English interface

## Requirements

- Current Google Chrome or Microsoft Edge with the File System Access API
- Permission to read and write both selected folders
- An independent backup of important data

File-nally runs locally in the browser and does not upload your files. Browser permissions, disk failures, operating-system limits, and unexpected shutdowns can still cause data loss, so it is not a replacement for a backup system.

## Start the application

1. Download `file-nally.html` from the repository or the [GitHub Releases page](https://github.com/WizMasia/Filenally/releases).
2. Open the HTML file in Chrome or Edge.
3. Select the **Source folder** and **Target folder** and grant read/write permission.
4. Review the synchronization direction, conflict policy, and excluded directory names.
5. Select **Compare changes**.
6. Review the queued actions in both file tables.
7. Select **Run synchronization**.

The application rejects a folder pair when both selections refer to the same directory or when one directory is inside the other. This prevents recursive synchronization and accidental self-copying.

## Synchronization directions

### Bidirectional

New and changed files can move from Source to Target or from Target to Source. When a trusted previous manifest shows that a file was deleted on one side and remained unchanged on the other, the remaining copy is moved into that side's versioned `.trash` directory.

### One-way: Source → Target

Source is authoritative for copy operations. Target-only files without a previous synchronized record are protected. A deletion recorded after an earlier successful synchronization can still be propagated by moving the corresponding Target file into `.trash`.

## Conflict policies

| Policy | Behavior |
|---|---|
| **Keep latest** | Copies the file with the newer modification time. A tied timestamp with a different size remains unresolved for manual review. |
| **Source wins** | Uses the Source version when both sides changed. |
| **Skip existing** | Never overwrites an existing destination path; new missing paths can still be copied. |
| **Rename and preserve both** | Keeps each original and copies the other version using `.conflict-source-*` and `.conflict-target-*` names. |

File-nally compares file size and modification time. It does not read every file to calculate a content hash, so two files with identical size and modification time are treated as equivalent.

## Deletion safety and `.trash`

File-nally does not permanently delete a synchronized file. Confirmed deletion propagation moves the remaining file to:

```text
.trash/<run timestamp>/<original relative path>
```

Repeated names in the same trash run receive a numeric suffix instead of being overwritten. The `.trash` directory is always excluded from synchronization, even if it is removed from the visible exclusion list. Recovery is manual: inspect `.trash` and move the required file back to its original location.

## JSON settings and folder profiles

Serializable application data is stored under the `smart_sync_state` localStorage key:

- Synchronization direction and conflict policy
- Excluded directory names and interface language
- Folder-pair profiles and manifests
- Per-profile and global synchronization history
- Incomplete-run checkpoints

Non-serializable directory handles are stored separately in IndexedDB. JSON backup files never contain the file contents or directory handles.

Use the application controls to:

- **Default JSON:** download a clean schema v2 configuration
- **Back up JSON:** export the current settings, profiles, manifests, and history
- **Restore JSON:** validate and import a backup up to 5 MB

Restored profiles and legacy v0.6.1 manifests remain unverified until the matching folder pair is selected again. An unverified manifest cannot trigger deletion propagation.

## Safe stop and failures

**Stop safely** requests cancellation between file actions. File-nally finishes the currently active write before stopping and does not start the next queued action. Successfully completed actions are checkpointed. A write failure stops later actions, records a failed run, and leaves the page ready for a fresh comparison.

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
- Filename case sensitivity and Unicode normalization differ by filesystem. Names that are distinct on one platform can collide or compare differently on another, especially between Windows, case-insensitive APFS, case-sensitive filesystems, and decomposed/composed Unicode forms.
- File-nally compares size and modification time without content hashes. It does not preserve original timestamps, ownership, permission bits, ACLs, extended attributes, macOS resource forks, or symbolic-link identity.

### Language and application behavior

- The interface is translated only into Korean and English. Browser, operating-system, and storage-provider error text may remain untranslated, and unusual Unicode filenames can render or sort differently across platforms.
- Checkpoints are saved after individual actions; there is no transaction covering the whole plan. A failure can therefore leave a partially completed run that must be compared again.
- Recovery from `.trash` is manual. There is no background folder monitor, scheduler, unattended synchronization, or automatic rollback.
- Very large folders can require substantial memory and comparison time. Private browsing, clearing browser data, permission revocation, disconnected removable media, unavailable network/cloud storage, or provider-side changes can invalidate saved handles and profiles.

Compatibility references:

- [Chrome File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [File System Access specification](https://wicg.github.io/file-system-access/)
- [MDN `showDirectoryPicker()` compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
- [WebKit origin-private filesystem](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/)
- [Microsoft case-sensitivity guidance](https://learn.microsoft.com/en-us/windows/wsl/case-sensitivity)
- [Apple APFS filename behavior](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html)

## Troubleshooting

### The folder picker does not open

Use a current Chrome or Edge release. Other browsers may not implement `showDirectoryPicker()` or writable directory handles.

### Compare changes is disabled

Select both folders. If the page reports an invalid pair, choose two separate, non-nested directories. Restored JSON profiles must also be rebound to their original folder pair.

### Access stops working after reopening the page

The browser may require folder permission again. Select the folders and approve read/write access. File-nally stores only the directory handle, not a way to bypass browser permission prompts.

### A file is reported as a conflict

Review both modification times and sizes, then choose an appropriate conflict policy. A deletion on one side combined with a modification on the other is intentionally left unresolved.

### I need to recover a deleted file

Look inside the affected folder's `.trash/<run timestamp>/` directory and restore the file manually.

## Development

Node.js and Playwright are development-only dependencies; end users only need `file-nally.html`. Edit only the three files under `dev/`; the root HTML is generated and must not be edited directly. See the [bilingual build guide](docs/BUILD.md) for the complete workflow and release checklist.

```bash
npm install
npm run build
npm run build:check
npm test
npm run test:visual
```

The Chrome regression suite covers state migration, JSON validation, folder-pair verification, conflict policies, copying, versioned trash, safe stop, write failures, untrusted filenames, accessibility labels, and mobile overflow. Responsive screenshots are written to the ignored `artifacts/visual/` directory.

## Repository layout

```text
dev/file-nally.html          # Editable development HTML
dev/css/file-nally.css       # Editable styles
dev/js/file-nally.js         # Editable application behavior
scripts/build.cjs            # Deterministic single-file builder
file-nally.html              # Generated standalone production artifact
README.md                    # English manual
docs/README_ko.md            # Korean manual
docs/BUILD.md                # Bilingual build guide
DESIGN.md                    # UI and accessibility contract
tests/                       # Builder and Chrome regression tests
```

## Design and license

See [DESIGN.md](DESIGN.md) for the design system and accessibility constraints. File-nally is provided under the MIT license notice included in the application.
