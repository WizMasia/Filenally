# File-nally Development Build Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split File-nally into three editable browser source files and deterministically build the existing standalone `file-nally.html`, with freshness checks, development-page coverage, a build guide, and explicit compatibility limitations in both manuals.

**Architecture:** `dev/file-nally.html`, `dev/css/file-nally.css`, and `dev/js/file-nally.js` become the only editable application sources. A dependency-free CommonJS builder validates exact marker blocks and safely composes those sources into the committed root `file-nally.html`; tests reject stale output before exercising both the generated and development pages.

**Tech Stack:** HTML5, CSS, browser JavaScript, Node.js standard library, npm scripts, Playwright 1.61.1 with installed Chrome.

## Global Constraints

- The root `file-nally.html` remains the only production artifact and must run without a server or external runtime dependency.
- Exactly three browser source files are added under `dev/`: one HTML, one CSS, and one JavaScript file.
- `dev/` is the source of truth; the root HTML is generated and must not be edited directly.
- The builder uses only `node:fs` and `node:path`; no new npm dependency, framework, bundler, minifier, or transpiler.
- Existing synchronization behavior, JSON schema version 2, storage key `smart_sync_state`, version `Beta v0.7.0`, UI, and test semantics remain unchanged.
- Build failures and check mode must never modify the existing root HTML.
- The English manual stays at `README.md`; the Korean manual stays at `docs/README_ko.md`; both link to each other.
- `docs/BUILD.md` is the single bilingual build guide.
- Both manuals contain matching environment and product limitation sections.
- The deleted duplicate `README 2.md` must not be recreated.
- Do not push or publish a release unless the user explicitly requests it after implementation.

## File Map

- Create `dev/file-nally.html`: runnable development template with external relative CSS/JavaScript references and exact build markers.
- Create `dev/css/file-nally.css`: extracted application styles with one trailing newline.
- Create `dev/js/file-nally.js`: extracted application behavior with one trailing newline.
- Create `scripts/build.cjs`: pure composition API, repository build/check operation, and CLI.
- Create `tests/build-pipeline.cjs`: deterministic build, validation, drift, and no-write regression tests.
- Create `docs/BUILD.md`: bilingual development, build, troubleshooting, and release guide.
- Modify `file-nally.html`: generated output containing one inline style and one inline script plus a generated-file notice.
- Modify `package.json`: build commands and build freshness gates.
- Modify `tests/file-nally.e2e.cjs`: static development routes and development-page smoke coverage.
- Modify `README.md`: English build workflow, repository layout, environment matrix, and limitations.
- Modify `docs/README_ko.md`: Korean build workflow, repository layout, environment matrix, and limitations.
- Modify `DESIGN.md`: replace the single-physical-source accepted debt with generated-single-artifact guidance.

---

### Task 1: Implement and test the deterministic builder

**Files:**
- Create: `tests/build-pipeline.cjs`
- Create: `scripts/build.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `normalizeText(value: string): string`.
- Produces: `compose(template: string, css: string, js: string): string`.
- Produces: `build(options?: { rootDir?: string, check?: boolean }): { changed: boolean, outputPath: string }`.
- CLI: `node scripts/build.cjs` writes the root artifact; `node scripts/build.cjs --check` validates without writing.

- [ ] **Step 1: Create a failing builder regression test**

Create `tests/build-pipeline.cjs` with these fixture helpers and assertions:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { build, compose, normalizeText } = require('../scripts/build.cjs');

const TEMPLATE = `<!DOCTYPE html>
<html>
<head>
    <!-- file-nally:css:start -->
    <link rel="stylesheet" href="./css/file-nally.css">
    <!-- file-nally:css:end -->
</head>
<body>
<!-- file-nally:js:start -->
<script src="./js/file-nally.js"></script>
<!-- file-nally:js:end -->
</body>
</html>
`;

const createFixture = () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-nally-build-'));
  fs.mkdirSync(path.join(rootDir, 'dev', 'css'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'dev', 'js'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'dev', 'file-nally.html'), TEMPLATE);
  fs.writeFileSync(path.join(rootDir, 'dev', 'css', 'file-nally.css'), 'body { color: #000; }\n');
  fs.writeFileSync(path.join(rootDir, 'dev', 'js', 'file-nally.js'), 'window.ready = true;\n');
  return rootDir;
};

assert.equal(normalizeText('a\r\n\r\n'), 'a\n');

const composed = compose(TEMPLATE, 'body { color: #000; }\n', 'window.ready = true;\n');
assert.match(composed, /Generated by npm run build from dev\//);
assert.match(composed, /<style>\n {8}body \{ color: #000; \}\n {4}<\/style>/);
assert.match(composed, /<script>\nwindow\.ready = true;\n<\/script>/);
assert.doesNotMatch(composed, /file-nally:(css|js):/);
assert.doesNotMatch(composed, /(?:href|src)="\.\/(?:css|js)\//);
assert.equal(compose(TEMPLATE, 'body { color: #000; }\n', 'window.ready = true;\n'), composed);

assert.throws(() => compose(TEMPLATE.replace('<!-- file-nally:css:end -->', ''), 'a{}', 'a()'), /CSS build markers/);
assert.throws(() => compose(TEMPLATE.replace('</head>', '<!-- file-nally:css:start -->\n</head>'), 'a{}', 'a()'), /CSS build markers/);
assert.throws(() => compose(TEMPLATE, 'body::after { content: "</style>"; }', 'a()'), /CSS contains <\/style/i);
assert.throws(() => compose(TEMPLATE, 'a{}', 'const value = "</script>";'), /JavaScript contains <\/script/i);

const rootDir = createFixture();
try {
  const first = build({ rootDir });
  assert.equal(first.changed, true);
  const outputPath = path.join(rootDir, 'file-nally.html');
  const initialOutput = fs.readFileSync(outputPath, 'utf8');
  assert.equal(build({ rootDir, check: true }).changed, false);
  assert.equal(build({ rootDir }).changed, false);

  fs.writeFileSync(path.join(rootDir, 'dev', 'css', 'file-nally.css'), 'body { color: #111; }\n');
  assert.throws(() => build({ rootDir, check: true }), /npm run build/);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), initialOutput);

  fs.writeFileSync(path.join(rootDir, 'dev', 'js', 'file-nally.js'), 'const bad = "</script>";\n');
  assert.throws(() => build({ rootDir }), /JavaScript contains <\/script/i);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), initialOutput);
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}

process.stdout.write('build pipeline tests: PASS\n');
```

- [ ] **Step 2: Run the builder test and verify RED**

Run: `node tests/build-pipeline.cjs`

Expected: FAIL with `Cannot find module '../scripts/build.cjs'`.

- [ ] **Step 3: Implement the minimal builder**

Create `scripts/build.cjs`:

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const NOTICE = '<!-- Generated by npm run build from dev/. Do not edit directly. -->';
const MARKERS = Object.freeze({
  css: ['<!-- file-nally:css:start -->', '<!-- file-nally:css:end -->'],
  js: ['<!-- file-nally:js:start -->', '<!-- file-nally:js:end -->'],
});

const normalizeText = (value) => String(value).replace(/\r\n?/g, '\n').replace(/\n*$/, '') + '\n';
const occurrenceCount = (value, needle) => value.split(needle).length - 1;
const indentBlock = (value, spaces) => {
  const prefix = ' '.repeat(spaces);
  return value.split('\n').map((line) => line ? `${prefix}${line}` : '').join('\n');
};

const replaceMarkedBlock = (template, markers, replacement, label) => {
  const [startMarker, endMarker] = markers;
  if (occurrenceCount(template, startMarker) !== 1 || occurrenceCount(template, endMarker) !== 1) {
    throw new Error(`${label} build markers must each appear exactly once`);
  }
  const start = template.indexOf(startMarker);
  const end = template.indexOf(endMarker);
  if (end <= start) throw new Error(`${label} build markers are out of order`);

  const lineStart = template.lastIndexOf('\n', start) + 1;
  const markerLineEnd = template.indexOf('\n', end + endMarker.length);
  const lineEnd = markerLineEnd === -1 ? template.length : markerLineEnd + 1;
  if (template.slice(lineStart, start).trim() || template.slice(end + endMarker.length, lineEnd).trim()) {
    throw new Error(`${label} build markers must be on their own lines`);
  }
  return template.slice(0, lineStart) + replacement + template.slice(lineEnd);
};

const compose = (templateValue, cssValue, jsValue) => {
  let template = normalizeText(templateValue);
  const css = normalizeText(cssValue).slice(0, -1);
  const js = normalizeText(jsValue).slice(0, -1);
  if (/<\/style/i.test(css)) throw new Error('CSS contains </style and cannot be safely inlined');
  if (/<\/script/i.test(js)) throw new Error('JavaScript contains </script and cannot be safely inlined');
  if (!/^<!DOCTYPE html>\n/i.test(template)) throw new Error('Development HTML must start with <!DOCTYPE html>');

  template = replaceMarkedBlock(template, MARKERS.css, `    <style>\n${indentBlock(css, 8)}\n    </style>\n`, 'CSS');
  template = replaceMarkedBlock(template, MARKERS.js, `<script>\n${js}\n</script>\n`, 'JavaScript');
  template = template.replace(/^<!DOCTYPE html>\n/i, (doctype) => `${doctype}${NOTICE}\n`);
  return normalizeText(template);
};

const build = ({ rootDir = DEFAULT_ROOT, check = false } = {}) => {
  const source = {
    template: path.join(rootDir, 'dev', 'file-nally.html'),
    css: path.join(rootDir, 'dev', 'css', 'file-nally.css'),
    js: path.join(rootDir, 'dev', 'js', 'file-nally.js'),
  };
  const outputPath = path.join(rootDir, 'file-nally.html');
  const generated = compose(
    fs.readFileSync(source.template, 'utf8'),
    fs.readFileSync(source.css, 'utf8'),
    fs.readFileSync(source.js, 'utf8'),
  );
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;

  if (check) {
    if (current !== generated) throw new Error('file-nally.html is stale; run npm run build');
    return { changed: false, outputPath };
  }
  if (current === generated) return { changed: false, outputPath };

  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporaryPath, generated, 'utf8');
    fs.renameSync(temporaryPath, outputPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return { changed: true, outputPath };
};

const main = () => {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check') || args.filter((arg) => arg === '--check').length > 1) {
    throw new Error('Usage: node scripts/build.cjs [--check]');
  }
  const check = args.includes('--check');
  const result = build({ check });
  process.stdout.write(check ? 'file-nally.html is up to date\n' : result.changed ? 'file-nally.html built\n' : 'file-nally.html already up to date\n');
};

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`Build failed: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = Object.freeze({ build, compose, normalizeText });
```

- [ ] **Step 4: Add focused npm scripts**

Modify only the `scripts` object in `package.json`:

```json
"scripts": {
  "build": "node scripts/build.cjs",
  "build:check": "node scripts/build.cjs --check",
  "build:test": "node tests/build-pipeline.cjs",
  "test": "node tests/file-nally.e2e.cjs",
  "test:visual": "node tests/file-nally.e2e.cjs --visual"
}
```

Do not update the full test chain yet because the `dev/` sources do not exist until Task 2.

- [ ] **Step 5: Run the builder test and verify GREEN**

Run: `npm run build:test && git diff --check`

Expected: `build pipeline tests: PASS`; no whitespace errors.

- [ ] **Step 6: Commit the isolated builder**

```bash
git add scripts/build.cjs tests/build-pipeline.cjs package.json
git diff --staged --check
git commit -m "Add deterministic single-HTML builder"
```

Expected: one commit containing only the builder, its direct tests, and npm entry points.

---

### Task 2: Split the application sources and generate the production artifact

**Files:**
- Create: `dev/file-nally.html`
- Create: `dev/css/file-nally.css`
- Create: `dev/js/file-nally.js`
- Modify: `file-nally.html`
- Modify: `package.json`

**Interfaces:**
- Consumes: `scripts/build.cjs` marker contract and `npm run build`.
- Produces: three editable sources and a generated root artifact that passes `npm run build:check`.

- [ ] **Step 1: Record the pre-split behavioral baseline**

Run: `npm test`

Expected: all 18 existing Chrome regression tests pass before extraction.

- [ ] **Step 2: Mechanically extract the three development sources**

Run this one-time Node transformation from the repository root. It extracts exact tagged regions, removes the HTML-only CSS indentation, and writes no other file:

```bash
node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const htmlPath = path.join(root, 'file-nally.html');
const html = fs.readFileSync(htmlPath, 'utf8').replace(/\r\n?/g, '\n');
const styleMatch = html.match(/    <style>\n([\s\S]*?)\n    <\/style>/);
const scriptMatch = html.match(/\n<script>\n([\s\S]*?)\n<\/script>\n<\/body>/);
if (!styleMatch || !scriptMatch) throw new Error('Expected one inline style and one final inline script');

const css = styleMatch[1].split('\n').map((line) => {
  if (!line) return '';
  if (!line.startsWith('        ')) throw new Error(`Unexpected CSS indentation: ${line}`);
  return line.slice(8);
}).join('\n') + '\n';
const js = scriptMatch[1].replace(/\n*$/, '') + '\n';
const cssReference = `    <!-- file-nally:css:start -->
    <link rel="stylesheet" href="./css/file-nally.css">
    <!-- file-nally:css:end -->`;
const jsReference = `<!-- file-nally:js:start -->
<script src="./js/file-nally.js"></script>
<!-- file-nally:js:end -->`;
const template = html
  .replace(styleMatch[0], cssReference)
  .replace(`\n<script>\n${scriptMatch[1]}\n</script>\n</body>`, `\n${jsReference}\n</body>`)
  .replace(/\n*$/, '') + '\n';

fs.mkdirSync(path.join(root, 'dev', 'css'), { recursive: true });
fs.mkdirSync(path.join(root, 'dev', 'js'), { recursive: true });
fs.writeFileSync(path.join(root, 'dev', 'file-nally.html'), template);
fs.writeFileSync(path.join(root, 'dev', 'css', 'file-nally.css'), css);
fs.writeFileSync(path.join(root, 'dev', 'js', 'file-nally.js'), js);
NODE
```

Expected: exactly `dev/file-nally.html`, `dev/css/file-nally.css`, and `dev/js/file-nally.js` are created.

- [ ] **Step 3: Verify development source boundaries before building**

Run:

```bash
test "$(rg -c 'file-nally:css:start' dev/file-nally.html)" = 1
test "$(rg -c 'file-nally:js:start' dev/file-nally.html)" = 1
! rg -n '<style>|^<script>$' dev/file-nally.html
! rg -n '<style>|</style>' dev/css/file-nally.css
! rg -n '<script>|</script>' dev/js/file-nally.js
```

Expected: all shell assertions exit 0.

- [ ] **Step 4: Generate and inspect the root artifact**

Run:

```bash
npm run build
npm run build:check
git diff --check
git diff -- file-nally.html | sed -n '1,220p'
```

Expected: build and check pass; the production diff is limited to the generated notice and deterministic whitespace, with the application markup, CSS declarations, and JavaScript statements otherwise unchanged.

- [ ] **Step 5: Make build freshness part of every test command**

Change the `package.json` scripts to:

```json
"scripts": {
  "build": "node scripts/build.cjs",
  "build:check": "node scripts/build.cjs --check",
  "build:test": "node tests/build-pipeline.cjs",
  "test": "npm run build:test && npm run build:check && node tests/file-nally.e2e.cjs",
  "test:visual": "npm run build:test && npm run build:check && node tests/file-nally.e2e.cjs --visual"
}
```

- [ ] **Step 6: Verify the generated application**

Run: `npm test`

Expected: builder tests pass, build check passes, and all 18 existing Chrome tests pass.

- [ ] **Step 7: Verify deterministic rebuilding**

Run:

```bash
shasum -a 256 file-nally.html > /tmp/file-nally-before.sha
npm run build
shasum -a 256 file-nally.html > /tmp/file-nally-after.sha
diff -u /tmp/file-nally-before.sha /tmp/file-nally-after.sha
git diff --check
```

Expected: the checksum files are identical and `npm run build` reports the artifact is already current.

- [ ] **Step 8: Commit the source split and generated artifact**

```bash
git add dev/file-nally.html dev/css/file-nally.css dev/js/file-nally.js file-nally.html package.json
git diff --staged --check
git commit -m "Split development sources from release HTML"
```

---

### Task 3: Exercise the external development page in Chrome

**Files:**
- Modify: `tests/file-nally.e2e.cjs`

**Interfaces:**
- Extends: `startServer()` return value with `devUrl: string`.
- Adds: a Chrome test named `development sources load with external CSS and JavaScript`.

- [ ] **Step 1: Add the failing development-page test**

In `tests/file-nally.e2e.cjs`, add this test before the existing behavior cases:

```js
add('development sources load with external CSS and JavaScript', async ({ page, devUrl }) => {
  await page.goto(devUrl);
  await page.waitForFunction(() => Boolean(window.FileNallyTest));
  const result = await page.evaluate(() => ({
    version: document.querySelector('.version')?.textContent,
    background: getComputedStyle(document.body).backgroundColor,
    errors: window.__testUnhandledErrors || [],
  }));
  assert.equal(result.version, 'Beta v0.7.0');
  assert.equal(result.background, 'rgb(244, 246, 250)');
  assert.deepEqual(result.errors, []);
});
```

Pass `devUrl` into every test invocation:

```js
await test.run({ page, context, url, devUrl });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --grep "development sources"`

Expected: FAIL because `devUrl` is undefined or the server returns 404 for development assets.

- [ ] **Step 3: Extend the test server with an allowlisted static map**

Replace `startServer()` with an implementation that serves only these files:

```js
async function startServer() {
  const routes = new Map([
    ['/', { file: path.join(ROOT, 'file-nally.html'), type: 'text/html; charset=utf-8' }],
    ['/file-nally.html', { file: path.join(ROOT, 'file-nally.html'), type: 'text/html; charset=utf-8' }],
    ['/dev/file-nally.html', { file: path.join(ROOT, 'dev', 'file-nally.html'), type: 'text/html; charset=utf-8' }],
    ['/dev/css/file-nally.css', { file: path.join(ROOT, 'dev', 'css', 'file-nally.css'), type: 'text/css; charset=utf-8' }],
    ['/dev/js/file-nally.js', { file: path.join(ROOT, 'dev', 'js', 'file-nally.js'), type: 'text/javascript; charset=utf-8' }],
  ]);
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const route = routes.get(pathname);
    if (!route) { response.writeHead(404).end('Not found'); return; }
    try {
      const content = await fs.readFile(route.file);
      response.writeHead(200, { 'content-type': route.type });
      response.end(content);
    } catch (error) {
      response.writeHead(500).end(error.message);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, url: `${origin}/file-nally.html`, devUrl: `${origin}/dev/file-nally.html` };
}
```

Destructure `devUrl` in `main()`:

```js
const { server, url, devUrl } = await startServer();
```

- [ ] **Step 4: Verify development and generated pages**

Run:

```bash
npm test -- --grep "development sources"
npm test
```

Expected: the focused test passes; the full suite reports 19/19 passing.

- [ ] **Step 5: Commit the development runtime coverage**

```bash
git add tests/file-nally.e2e.cjs
git diff --staged --check
git commit -m "Test external development sources"
```

---

### Task 4: Document the build workflow and product limitations

**Files:**
- Create: `docs/BUILD.md`
- Modify: `README.md`
- Modify: `docs/README_ko.md`
- Modify: `DESIGN.md`

**Interfaces:**
- Produces: reciprocal language navigation, one bilingual build guide, identical support classifications, and working relative links.

- [ ] **Step 1: Create the bilingual build guide**

Create `docs/BUILD.md` with this exact section structure:

```markdown
# File-nally Build Guide

[한국어](#한국어) · [English](#english)

## 한국어
### 원본과 결과물
### 준비
### 개발 순서
### 빌드 명령
### 오류 해결
### 릴리즈 체크리스트

## English
### Sources and artifact
### Prerequisites
### Development workflow
### Build commands
### Troubleshooting
### Release checklist
```

Both language sections must state:

- Edit only the three files below `dev/`.
- Never edit root `file-nally.html` directly.
- Install with `npm install`.
- Run `npm run build` after source edits.
- Run `npm run build:check`, `npm test`, and `npm run test:visual` before release.
- `build:check` never writes and stale output is fixed with `npm run build`.
- Marker or unsafe closing-tag errors must be fixed in the named development source.
- Release only the root `file-nally.html`, not the `dev/` directory.

- [ ] **Step 2: Add the exact support classification to both manuals**

Add `## Supported environments and limitations` to `README.md` and `## 지원 환경과 한계` to `docs/README_ko.md`. Both sections must contain equivalent tables with these rows:

| Classification | Environment |
|---|---|
| Supported target | Current desktop Chrome or Edge on Windows, macOS, Linux, and ChromeOS |
| Verified in this project | Current macOS Chrome plus mocked Chrome filesystem flows |
| Experimental / not supported | Android Chromium |
| Unsupported | Safari, Firefox, iOS/iPadOS browsers, and Brave without its feature flag |

Under the table, include equivalent English/Korean subsections for:

- permissions and protected system directories;
- Korean/English-only UI and untranslated browser/OS errors;
- Unicode normalization and case-sensitivity differences;
- OS-reserved names and path/provider restrictions;
- size-plus-modification-time comparison without hashes;
- non-preserved timestamps, ownership, permissions, ACLs, extended attributes, resource forks, and symbolic links;
- per-action checkpoints without whole-plan transactions;
- manual `.trash` recovery;
- no background monitor or scheduler;
- large-folder, removable-media, network-drive, cloud-provider, private-mode, and browser-data-clearing limits.

Use these direct references in both manuals:

```markdown
- [Chrome File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [File System Access specification](https://wicg.github.io/file-system-access/)
- [MDN `showDirectoryPicker()` compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
- [WebKit origin-private filesystem](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/)
- [Microsoft case-sensitivity guidance](https://learn.microsoft.com/en-us/windows/wsl/case-sensitivity)
- [Apple APFS filename behavior](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html)
```

- [ ] **Step 3: Update development instructions and repository maps**

In both manuals:

- Link `docs/BUILD.md` from the development section using `docs/BUILD.md` in English and `BUILD.md` in Korean.
- Add `npm run build` and `npm run build:check` before the test commands.
- Replace the repository tree with `dev/`, `scripts/build.cjs`, `docs/BUILD.md`, generated `file-nally.html`, and tests.
- Keep the reciprocal `README.md` ↔ `docs/README_ko.md` language links.

- [ ] **Step 4: Update the design-system source rule**

Replace the accepted-debt row in `DESIGN.md` with:

```markdown
| Product delivery remains one generated physical file | `file-nally.html` | Explicit product requirement: runtime HTML, CSS, and JavaScript ship together | Edit `dev/` sources and regenerate with `npm run build`; split the artifact only if the product constraint changes |
```

Add this sentence immediately above the table:

```markdown
The editable design source is `dev/css/file-nally.css`; the root HTML is generated and must not be edited directly.
```

- [ ] **Step 5: Validate documentation links and language separation**

Run:

```bash
node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const files = ['README.md', 'docs/README_ko.md', 'docs/BUILD.md'];
const missing = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) missing.push(`${file} -> ${target}`);
  }
}
if (missing.length) throw new Error(`Missing links:\n${missing.join('\n')}`);
console.log('documentation links: PASS');
NODE
test "$(rg -n '[가-힣]' README.md | wc -l | tr -d ' ')" -eq 1
git diff --check
```

Expected: all relative links exist; the only Korean line in the English manual is its Korean language link; no whitespace errors.

- [ ] **Step 6: Commit the documentation**

```bash
git add README.md docs/README_ko.md docs/BUILD.md DESIGN.md
git diff --staged --check
git commit -m "Document build workflow and platform limits"
```

Expected: the previously prepared README language split is included here; no unrelated file is staged.

---

### Task 5: Run end-to-end build and release-artifact verification

**Files:**
- Verify: `dev/file-nally.html`
- Verify: `dev/css/file-nally.css`
- Verify: `dev/js/file-nally.js`
- Verify: `scripts/build.cjs`
- Verify: `file-nally.html`
- Verify: `README.md`
- Verify: `docs/README_ko.md`
- Verify: `docs/BUILD.md`

**Interfaces:**
- Confirms: the generated artifact is current, standalone, directly runnable, and behaviorally equivalent to the development page.

- [ ] **Step 1: Run all automated checks**

Run:

```bash
npm run build
npm run build:check
npm test
npm run test:visual
```

Expected: builder tests pass; build output is current; 19 Chrome tests pass; six empty/planned responsive screenshots are created.

- [ ] **Step 2: Verify the production artifact has no external runtime dependency**

Run:

```bash
test "$(rg -c '<style>' file-nally.html)" = 1
test "$(rg -c '^<script>$' file-nally.html)" = 1
if rg -n '<script[^>]+src=|<link[^>]+rel="(stylesheet|preload)"' file-nally.html; then exit 1; fi
if rg -n 'file-nally:(css|js):' file-nally.html; then exit 1; fi
```

Expected: one inline style, one inline application script, and no external stylesheet/script or build marker.

- [ ] **Step 3: Run a direct `file://` synchronization smoke test**

Run:

```bash
node - <<'NODE'
const path = require('node:path');
const { chromium } = require('playwright');
const {
  installMockFileSystem,
  configureMockPair,
  snapshotMockPair,
} = require('./tests/support/mock-file-system.cjs');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await installMockFileSystem(page);
  await page.goto(`file://${path.resolve('file-nally.html')}`);
  await configureMockPair(page, {
    source: { 'direct.txt': { content: 'file protocol', lastModified: 2 } },
    target: {},
  });
  await page.click('#btnSrc');
  await page.click('#btnTgt');
  await page.click('#btnCompare');
  await page.click('#btnSync');
  await page.waitForFunction(() => window.FileNallyTest?.getModel().phase === 'success');
  const snapshot = await snapshotMockPair(page);
  const errors = await page.evaluate(() => window.__testUnhandledErrors || []);
  if (snapshot.target['direct.txt']?.content !== 'file protocol') throw new Error('file:// synchronization failed');
  if (errors.length) throw new Error(`file:// page errors: ${errors.join(', ')}`);
  await browser.close();
  process.stdout.write('file:// smoke test: PASS\n');
})().catch((error) => { console.error(error); process.exit(1); });
NODE
```

Expected: `file:// smoke test: PASS`.

- [ ] **Step 4: Inspect final source/artifact relationships**

Run:

```bash
git status --short
git diff --check
git log --oneline origin/main..HEAD
find dev scripts docs -maxdepth 3 -type f | sort
```

Expected: only intended branch commits appear; `README 2.md` does not exist; no unstaged product changes remain; the three `dev/` browser source files are present.

- [ ] **Step 5: Prepare the handoff without publishing**

Report:

- build/check/test/visual/file protocol results;
- commit hashes and messages;
- generated artifact path and SHA-256;
- supported/experimental/unsupported environment summary;
- branch name and clean/dirty state;
- that no push or release was performed.
