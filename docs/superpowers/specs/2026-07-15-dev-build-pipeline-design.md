# File-nally Development Source and Single-HTML Build Design

- **Date:** 2026-07-15
- **Status:** Approved for implementation
- **Branch:** `codex/dev-build-pipeline`

## 1. Objective

Keep `file-nally.html` as the only production artifact while making routine development easier through three separated source files. A dependency-free Node.js build script must deterministically inline the development CSS and JavaScript into the root HTML. The English and Korean manuals must explain the workflow and clearly state supported environments and known limitations.

## 2. Goals

- Add exactly three browser source files below `dev/`: one HTML template, one CSS file, and one JavaScript file.
- Treat the `dev/` files as the editable source of truth.
- Generate the root `file-nally.html` as a self-contained distributable.
- Detect and reject stale generated output before tests pass.
- Preserve direct `file://` execution of the production file in supported browsers.
- Keep all existing synchronization behavior and browser regression coverage.
- Add a practical build guide.
- Maintain separate English and Korean manuals with reciprocal language links.
- Document OS, filesystem, international filename, permission, metadata, performance, and unsupported-browser limitations.

## 3. Non-goals

- No framework, bundler, transpiler, minifier, development server, or module migration.
- No change to synchronization semantics, JSON schema, storage keys, UI layout, or release version.
- No attempt to polyfill `showDirectoryPicker()` in unsupported browsers.
- No automated `.trash` restore interface.
- No content hashing or file metadata preservation.
- No modification or commit of the unrelated untracked `README 2.md` file.

## 4. Repository Structure

```text
dev/
├── file-nally.html
├── css/
│   └── file-nally.css
└── js/
    └── file-nally.js

scripts/
└── build.cjs

docs/
├── BUILD.md
└── README_ko.md

file-nally.html
README.md
package.json
tests/
```

Responsibilities:

- `dev/file-nally.html`: semantic markup, inline SVG sprite, and explicit CSS/JavaScript build blocks.
- `dev/css/file-nally.css`: all application styling currently inside the production `<style>` element.
- `dev/js/file-nally.js`: all application behavior currently inside the production `<script>` element.
- `scripts/build.cjs`: validation, deterministic composition, check mode, and atomic output replacement.
- `file-nally.html`: generated and committed production artifact; never edited directly.
- `docs/BUILD.md`: source layout, commands, troubleshooting, verification, and release checklist.

## 5. Development HTML Contract

The development HTML remains runnable directly and references its two sibling assets with relative URLs. Exact build comments delimit the replaceable blocks:

```html
<!-- file-nally:css:start -->
<link rel="stylesheet" href="./css/file-nally.css">
<!-- file-nally:css:end -->
```

```html
<!-- file-nally:js:start -->
<script src="./js/file-nally.js"></script>
<!-- file-nally:js:end -->
```

Each start and end marker must appear exactly once. The build script replaces the complete CSS block with one inline `<style>` element and the complete JavaScript block with one inline `<script>` element. Build comments and external asset references must not remain in the production file.

## 6. Build Algorithm

`scripts/build.cjs` uses only `node:fs` and `node:path`.

1. Resolve all paths relative to the repository root, never the caller's current directory.
2. Read the development HTML, CSS, and JavaScript as UTF-8.
3. Normalize CRLF and CR line endings to LF and normalize each source to one trailing newline.
4. Validate that every build marker occurs exactly once and in the correct order.
5. Reject CSS containing a case-insensitive `</style` sequence.
6. Reject JavaScript containing a case-insensitive `</script` sequence because it would terminate the generated HTML script element.
7. Replace the CSS and JavaScript blocks and insert a generated-file notice after the doctype.
8. Produce deterministic UTF-8 output with one trailing newline.
9. In build mode, write a temporary sibling file and rename it over `file-nally.html` only after all validation succeeds.
10. In check mode, compare the generated string with the current production file without writing. Return a nonzero exit code and an actionable `npm run build` instruction when they differ.

The build never reads the existing root HTML as an input. This prevents accidental two-way source drift.

## 7. Commands

`package.json` adds:

```json
{
  "scripts": {
    "build": "node scripts/build.cjs",
    "build:check": "node scripts/build.cjs --check",
    "test": "npm run build:check && node tests/file-nally.e2e.cjs",
    "test:visual": "npm run build:check && node tests/file-nally.e2e.cjs --visual"
  }
}
```

No new npm dependency is required.

## 8. Migration

The initial split must be mechanical:

- Extract the current `<style>` contents into `dev/css/file-nally.css`.
- Extract the current application `<script>` contents into `dev/js/file-nally.js`.
- Copy the remaining document into `dev/file-nally.html` and replace the extracted blocks with the development references and build markers.
- Run `npm run build` to regenerate the root artifact.
- Review the generated diff to confirm that changes are limited to deterministic formatting and the generated notice.

After migration, all product edits begin in `dev/`. Editing `file-nally.html` directly is a workflow error and will be overwritten by the next build.

## 9. Verification Strategy

### Build verification

- `npm run build` succeeds from the repository root and from another working directory.
- A second build produces no diff.
- `npm run build:check` passes immediately after a build.
- Changing a development source causes `build:check` to fail without rewriting the production file.
- Missing, duplicated, or reordered markers fail with a clear message.
- Unsafe closing tag sequences fail before any output is replaced.

### Runtime verification

- Existing Chrome regression tests continue to exercise the generated root file.
- The existing test server gains routes for the development HTML, CSS, and JavaScript.
- A development-source smoke test confirms external CSS and JavaScript load with no page errors.
- The generated root file continues to pass the direct `file://` smoke flow.
- `npm run test:visual` continues to capture mobile, tablet, and desktop states.

### Documentation verification

- All relative Markdown links resolve.
- The English manual contains only its Korean language-link label in Korean.
- Both manuals link to `docs/BUILD.md` with the correct relative path.
- The repository layout in both manuals matches the real file tree.

## 10. Build Guide

`docs/BUILD.md` must cover:

1. Prerequisites: Node.js for development and Chrome for browser tests.
2. Source-of-truth rule and directory map.
3. Initial dependency installation.
4. Editing workflow.
5. `npm run build`, `npm run build:check`, `npm test`, and `npm run test:visual`.
6. Common build errors and how to fix them.
7. Release checklist: build, check, tests, clean diff, then publish the root HTML.
8. Warning that the root HTML is generated and must not be edited directly.

## 11. Compatibility and Limitation Documentation

The limitation section appears in both `README.md` and `docs/README_ko.md`. It distinguishes API availability from project-tested support instead of claiming that every Chromium platform is verified.

### Environment classification

- **Project-supported target:** current desktop Chrome or Edge on Windows, macOS, Linux, and ChromeOS.
- **Project-verified environment:** the current macOS Chrome regression environment, plus mocked Chrome flows for application behavior.
- **Experimental and not project-supported:** Android Chromium. Chrome documents File System Access API availability on Android, but this project does not verify mobile providers, large directory behavior, or the complete read/write synchronization flow.
- **Unsupported:** Safari, Firefox, iOS/iPadOS browsers, and Brave without the required feature flag. Safari's published File System implementation is origin-private storage rather than File-nally's arbitrary local directory picker workflow.

References:

- [Chrome File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [File System Access specification](https://wicg.github.io/file-system-access/)
- [MDN `showDirectoryPicker()` compatibility notice](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
- [WebKit origin-private File System explanation](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/)

### Required limitation topics

- Folder pickers require a secure/top-level context and a user gesture; permissions can return to `prompt` and require renewed approval.
- Browsers may reject protected operating-system directories.
- File-nally supports Korean and English UI only; other locales default to English.
- Browser and operating-system error messages may remain untranslated.
- Unicode filenames are displayed and copied, but File-nally performs no Unicode normalization or locale-aware path comparison.
- Windows is normally case-insensitive, Linux normally case-sensitive, and macOS APFS can be configured either way. Names differing only by case can collide across filesystems.
- APFS preserves Unicode filename normalization while using normalization-insensitive lookup; visually identical names with different code-point sequences can behave differently when moved between filesystems.
- OS-reserved names, path-length limits, trailing spaces or periods, removable media, network shares, and cloud-backed providers remain subject to the selected filesystem and browser.
- File identity uses size and modification time, not a content hash.
- Only file content and directory structure are copied. Original timestamps, ownership, permissions, ACLs, extended attributes, resource forks, and symbolic-link identity are not preserved.
- Synchronization is checkpointed per action, not transactional across the complete plan.
- `.trash` recovery is manual.
- There is no scheduler, background watcher, or automatic synchronization.
- Very large files and very large directory trees depend on browser memory, provider latency, and disk performance.
- Browser data clearing and private/incognito modes can remove settings, history, manifests, and stored handles.

Filesystem references:

- [Microsoft case-sensitivity guidance](https://learn.microsoft.com/en-us/windows/wsl/case-sensitivity)
- [Apple APFS filename behavior](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html)

## 12. Error Handling

- Build failures never modify the existing production file.
- All build errors identify the affected source path or marker and return a nonzero status.
- Check-mode drift explains that `npm run build` is the remedy.
- Runtime behavior remains controlled by the existing page status and history mechanisms.
- Documentation must not imply guaranteed recovery, cross-filesystem metadata fidelity, or support for an untested platform.

## 13. Completion Criteria

- The three development source files exist in the approved directory layout.
- `scripts/build.cjs` composes them into one standalone root HTML.
- The generated root contains no external runtime CSS, JavaScript, font, image, or CDN dependency.
- Build output is deterministic and checkable.
- The development page and generated page both load successfully in Chrome.
- All existing functional and visual tests pass with build freshness enforced.
- `docs/BUILD.md` is complete and linked from both language manuals.
- English and Korean manuals contain matching, explicit limitation sections.
- The unrelated `README 2.md` remains untouched and uncommitted.
