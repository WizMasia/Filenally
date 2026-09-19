const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const {
  configureMockPair,
  installMockFileSystem,
  snapshotMockPair,
} = require('./support/mock-file-system.cjs');

const ROOT = path.resolve(__dirname, '..');
const VISUAL = process.argv.includes('--visual');
const grepIndex = process.argv.indexOf('--grep');
const NAME_FILTER = grepIndex >= 0 ? new RegExp(process.argv[grepIndex + 1], 'i') : null;

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
    if (pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    const route = routes.get(pathname);
    if (!route) {
      response.writeHead(404).end('Not found');
      return;
    }
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

async function resetBrowserState(page) {
  await page.evaluate(async () => {
    localStorage.clear();
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      await Promise.all(databases.map((database) => new Promise((resolve) => {
        if (!database.name) return resolve();
        const request = indexedDB.deleteDatabase(database.name);
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
      })));
    }
  });
}

async function mountPair(page, options) {
  await configureMockPair(page, options);
  await page.locator('#btnSrc').click();
  await page.locator('#btnTgt').click();
  await page.waitForFunction(() => !window.FileNallyTest.getModel().appOperation);
}

async function compare(page) {
  await page.locator('#btnCompare').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('#syncStatus')?.textContent || '';
    return text.includes('비교 완료') || text.includes('Compare Complete');
  });
}

async function selectExactComparison(page) {
  const control = page.getByLabel('비교 모드');
  assert.equal(await control.count(), 1);
  await control.selectOption('exact');
}

async function executeCurrentPlan(page) {
  await page.evaluate(async () => {
    if (window.FileNallyTest?.executeCurrentPlan) {
      await window.FileNallyTest.executeCurrentPlan();
      return;
    }
    await window.executeSync();
  });
}

async function downloadText(download) {
  const filePath = await download.path();
  return fs.readFile(filePath, 'utf8');
}

function versionFixture(originalPath = 'report.txt', content = 'old') {
  return { record: {
    id: 'saved-1', capturedAt: '2026-09-13T00:00:00.000Z', originalPath,
    storedPath: `versions/saved-1/${originalPath}`, size: Buffer.byteLength(content),
    type: 'text/plain', lastModified: 100, reason: 'before-overwrite', runId: 'old-run',
    direction: 'unidirectional', fromSide: 'source', toSide: 'target',
  }, content };
}

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

async function captureVersionAsyncClickCompletions(page) {
  await page.addInitScript(() => {
    window.__versionAsyncClickCompletions = [];
    const addEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const tracked = type === 'click' && typeof listener === 'function'
        && (this.id === 'btnPrepareCleanup' || this.dataset?.inspectSide);
      if (!tracked) return addEventListener.call(this, type, listener, options);
      return addEventListener.call(this, type, function (...args) {
        const result = listener.apply(this, args);
        if (result && typeof result.then === 'function') {
          const completion = { target: this.id || `inspect:${this.dataset.inspectSide}`, done: false, status: 'pending' };
          window.__versionAsyncClickCompletions.push(completion);
          Promise.resolve(result).then(
            () => Object.assign(completion, { done: true, status: 'fulfilled' }),
            () => Object.assign(completion, { done: true, status: 'rejected' }),
          );
        }
        return result;
      }, options);
    };
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.FileNallyTest));
}

async function inspectVersionUsage(page, side = 'target', options = {}) {
  return page.evaluate(({ side, options }) => window.FileNallyTest.VersionStore
    .inspectUsage(window.__mockPair[side], options), { side, options });
}

async function installCleanupObservation(page) {
  await installComparisonMutationSpies(page);
  await page.evaluate(() => {
    window.__cleanupRemovals = [];
    const root = window.__mockPair.target;
    const visit = (directory, path) => {
      const remove = directory.removeEntry.bind(directory);
      directory.removeEntry = async (name, ...options) => {
        window.__cleanupRemovals.push({ path: `${path}/${name}`, options });
        await window.__beforeCleanupRemove?.(directory, name);
        if (!window.__skipCleanupRemove) await remove(name, ...options);
      };
      for (const entry of directory.entries.values()) {
        if (entry.kind === 'directory') visit(entry, `${path}/${entry.name}`);
      }
    };
    visit(root, '');
  });
}

async function mountVersion(page, options = {}) {
  const fixture = versionFixture(options.path, options.content);
  await mountPair(page, { source: {}, target: options.missing ? {} : { 'report.txt': { content: 'current', lastModified: 200 } } });
  await page.evaluate(({ record, content }) => {
    window.__versionRecord = record;
    window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [record] }) });
    window.__setMockFile('target', `.filenally/${record.storedPath}`, { content, lastModified: 100 });
  }, fixture);
  return fixture;
}

async function comparisonState(page) {
  return page.evaluate(() => ({
    storage: Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])),
    plan: window.FileNallyTest.getModel().plan,
    sourceRows: document.querySelector('#srcFileBody').innerHTML,
    targetRows: document.querySelector('#tgtFileBody').innerHTML,
    permissionCalls: window.__getPermissionCalls(),
  }));
}

async function installComparisonMutationSpies(page) {
  await page.evaluate(() => {
    window.__comparisonMutationAttempts = [];
    const visit = (directory) => {
      const getDirectoryHandle = directory.getDirectoryHandle.bind(directory);
      directory.getDirectoryHandle = async (name, options = {}) => {
        if (options.create) window.__comparisonMutationAttempts.push(`getDirectoryHandle:${name}`);
        return getDirectoryHandle(name, options);
      };
      const getFileHandle = directory.getFileHandle.bind(directory);
      directory.getFileHandle = async (name, options = {}) => {
        if (options.create) window.__comparisonMutationAttempts.push(`getFileHandle:${name}`);
        return getFileHandle(name, options);
      };
      const removeEntry = directory.removeEntry.bind(directory);
      directory.removeEntry = async (name, options = {}) => {
        window.__comparisonMutationAttempts.push(`removeEntry:${name}`);
        return removeEntry(name, options);
      };
      const requestPermission = directory.requestPermission.bind(directory);
      directory.requestPermission = async (...args) => {
        window.__comparisonMutationAttempts.push(`requestPermission:${directory.name}`);
        return requestPermission(...args);
      };
      for (const entry of directory.entries.values()) {
        if (entry.kind === 'directory') visit(entry);
        else {
          const createWritable = entry.createWritable.bind(entry);
          entry.createWritable = async (...args) => {
            window.__comparisonMutationAttempts.push(`createWritable:${entry.name}`);
            return createWritable(...args);
          };
        }
      }
    };
    visit(window.__mockPair.source);
    if (window.__mockPair.target !== window.__mockPair.source) visit(window.__mockPair.target);
  });
}

async function assertComparisonReadOnly(page, files, state) {
  assert.deepEqual(await snapshotMockPair(page), files);
  assert.deepEqual(await comparisonState(page), state);
  assert.deepEqual(await page.evaluate(() => window.__comparisonMutationAttempts), []);
}

async function openVersionComparison(page) {
  await page.locator('#btnVersions').click();
  await page.waitForFunction(() => document.querySelector('#versionBody [data-version-action="compare"]'));
  await page.locator('#versionBody [data-version-action="compare"]').first().click();
  await page.locator('#comparisonDialog').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#comparisonTarget').disabled);
}

async function runVersionComparison(page) {
  await page.locator('#btnRunComparison').click();
  await page.waitForFunction(() => {
    const button = document.querySelector('#btnRunComparison');
    return !button.disabled && /다시|again/i.test(button.textContent);
  });
}

async function planRename(page, { control = '#dirBoth', owner = 'target', nativeMove = false } = {}) {
  await page.locator(control).click();
  await mountPair(page, {
    source: { 'original.txt': { content: 'same', lastModified: 100 } },
    target: { 'original.txt': { content: 'same', lastModified: 100 } },
  });
  await compare(page);
  await executeCurrentPlan(page);
  await page.evaluate(({ owner, nativeMove }) => {
    const changedSide = owner === 'target' ? 'source' : 'target';
    window.__deleteMockEntry(changedSide, 'original.txt');
    window.__setMockFile(changedSide, 'renamed.txt', { content: 'same' });
    if (nativeMove) {
      const root = window.__mockPair[owner];
      const original = root.entries.get('original.txt');
      original.move = async (directory, name) => {
        root.entries.delete(original.name);
        original.name = name;
        directory.entries.set(name, original);
      };
    }
  }, { owner, nativeMove });
  await compare(page);
  const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'rename');
  assert.equal(actions[0].toSide, owner);
}

async function main() {
  const { server, url, devUrl } = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const tests = [];
  const add = (name, run) => {
    if (!NAME_FILTER || NAME_FILTER.test(name)) tests.push({ name, run });
  };

  add('version comparison UI is explicit and preserves files and sync state', async ({ page }) => {
    await mountVersion(page);
    await compare(page);
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page);
    const state = await comparisonState(page);
    await page.locator('#btnVersions').click();
    await page.locator('#versionBody [data-version-action="compare"]').first().click();
    await page.locator('#comparisonDialog').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#comparisonTarget').disabled);
    assert.equal(await page.locator('#comparisonTarget').inputValue(), 'current');
    assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
    assert.match(await page.locator('#comparisonSummary').innerText(), /report\.txt/);
    await page.locator('#btnRunComparison').click();
    await page.waitForFunction(() => document.querySelector('#comparisonBody [data-diff-kind]'));
    assert.match(await page.locator('#comparisonSummary').innerText(), /report\.txt/);
    assert.equal(await page.locator('#restoreDialog').evaluate((dialog) => dialog.open), false);
    await page.locator('#btnCloseComparison').click();
    assert.equal(await page.locator('#versionDialog').evaluate((dialog) => dialog.open), true);
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, files, state);
  });

  for (const direction of [
    { control: '#dirBoth', expected: /양방향|Bidirectional/ },
    { control: '#dirOne', expected: /단방향|One-way/ },
    { control: '#dirReverse', expected: /역방향|Reverse/ },
  ]) {
    for (const swapped of [false, true]) {
      add(`version comparison operands stay on the selected physical root for ${direction.control} ${swapped ? 'after swap' : 'before swap'}`, async ({ page }) => {
        await page.locator(direction.control).click();
        await mountVersion(page, { content: 'stored-left' });
        if (swapped) {
          await page.locator('#btnSwapFolders').click();
          await page.waitForFunction(() => !window.FileNallyTest.getModel().appOperation);
        }
        await page.evaluate(() => {
          const record = window.__versionRecord;
          const historical = { ...record, id: 'historic-right', storedPath: 'versions/historic-right/report.txt',
            size: 16, lastModified: 150, capturedAt: '2026-09-12T00:00:00.000Z', fromSide: 'target', toSide: 'source' };
          window.__setMockFile('target', '.filenally/versions/historic-right/report.txt', { content: 'historical-right', lastModified: 150 });
          window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [record, historical] }) });
        });
        const config = await page.evaluate(() => JSON.parse(localStorage.getItem('smart_sync_state')).config.direction);
        await installComparisonMutationSpies(page);
        const files = await snapshotMockPair(page), state = await comparisonState(page);
        await openVersionComparison(page);
        await runVersionComparison(page);
        assert.match(await page.locator('#comparisonSummary').innerText(), direction.expected);
        assert.equal(await page.locator('#comparisonBody [data-diff-kind="remove"] code').first().innerText(), 'stored-left');
        assert.equal(await page.locator('#comparisonBody [data-diff-kind="add"] code').first().innerText(), 'current');
        await page.locator('#comparisonTarget').selectOption('version:historic-right');
        assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
        await runVersionComparison(page);
        assert.equal(await page.locator('#comparisonBody [data-diff-kind="remove"] code').first().innerText(), 'stored-left');
        assert.equal(await page.locator('#comparisonBody [data-diff-kind="add"] code').first().innerText(), 'historical-right');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('smart_sync_state')).config.direction), config);
        await page.locator('#btnCloseComparison').click();
        await page.locator('#btnCloseVersions').click();
        await assertComparisonReadOnly(page, files, state);
      });
    }
  }

  add('version comparison pages 102 historical choices without silently restoring current', async ({ page }) => {
    await mountVersion(page);
    await page.evaluate(() => {
      const base = window.__versionRecord;
      const versions = [base];
      for (let index = 0; index < 102; index += 1) {
        const id = `history-${String(index).padStart(3, '0')}`;
        const content = `history ${index}`;
        const record = { ...base, id, storedPath: `versions/${id}/report.txt`, size: content.length,
          lastModified: 300 + index, capturedAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString() };
        versions.push(record);
        window.__setMockFile('target', `.filenally/${record.storedPath}`, { content, lastModified: record.lastModified });
      }
      window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions }) });
    });
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    await openVersionComparison(page);
    assert.equal(await page.locator('#comparisonTarget option').count(), 102);
    assert.equal(await page.locator('#comparisonTarget').inputValue(), 'current');
    await page.locator('#btnComparisonTargetNext').click();
    assert.equal(await page.locator('#comparisonTarget option').count(), 4);
    assert.equal(await page.locator('#comparisonTarget').inputValue(), 'current');
    const historicValue = await page.locator('#comparisonTarget option').last().getAttribute('value');
    assert.equal(historicValue, 'version:history-000');
    await page.locator('#comparisonTarget').selectOption(historicValue);
    assert.equal(await page.locator('#btnRunComparison').isEnabled(), true);
    await runVersionComparison(page);
    assert.match(await page.locator('#comparisonSummary').innerText(), /history-000/);
    assert.equal(await page.locator('#comparisonBody [data-diff-kind="add"] code').first().innerText(), 'history 0');
    await page.locator('#btnComparisonTargetPrevious').click();
    assert.equal(await page.locator('#comparisonTarget').inputValue(), '');
    assert.equal(await page.locator('#btnRunComparison').isDisabled(), true);
    assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
    await page.locator('#btnCloseComparison').click();
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, files, state);
  });

  add('version comparison pages 300 changed rows with complete totals and original line numbers', async ({ page }) => {
    const left = Array.from({ length: 150 }, (_, index) => `left-${index + 1}`).join('\n');
    const right = Array.from({ length: 150 }, (_, index) => `right-${index + 1}`).join('\n');
    await mountVersion(page, { content: left });
    await page.evaluate((content) => window.__setMockFile('target', 'report.txt', { content, lastModified: 200 }), right);
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    await openVersionComparison(page);
    await runVersionComparison(page);
    assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 200);
    assert.match(await page.locator('#comparisonSummary').innerText(), /150.*150/);
    await page.locator('#btnComparisonNext').click();
    await page.waitForFunction(() => document.querySelector('#comparisonPageStatus').textContent === '2 / 2');
    assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 100);
    assert.equal(await page.locator('#comparisonBody li').first().locator('span').nth(1).innerText(), '51');
    assert.equal(await page.locator('#comparisonBody li').last().locator('span').nth(1).innerText(), '150');
    await page.locator('#btnCloseComparison').click();
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, files, state);
  });

  for (const outcome of ['missing current', 'empty current', 'binary', 'too-large text', 'work fallback']) {
    add(`version comparison UI reports ${outcome} distinctly without mutation`, async ({ page }) => {
      if (outcome === 'missing current') {
        await mountVersion(page, { missing: true });
        await page.evaluate(() => {
          const base = window.__versionRecord;
          const historical = { ...base, id: 'missing-current-history', storedPath: 'versions/missing-current-history/report.txt',
            size: 7, lastModified: 90, capturedAt: '2026-09-12T00:00:00.000Z' };
          window.__setMockFile('target', '.filenally/versions/missing-current-history/report.txt', { content: 'history', lastModified: 90 });
          window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [base, historical] }) });
        });
      }
      else if (outcome === 'empty current') {
        await mountVersion(page);
        await page.evaluate(() => window.__setMockFile('target', 'report.txt', { content: '', lastModified: 200 }));
      } else if (outcome === 'binary') {
        await mountVersion(page);
        await page.evaluate(() => {
          const record = { ...window.__versionRecord, size: 2, type: 'application/octet-stream' };
          window.__versionRecord = record;
          window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [record] }) });
          const stored = window.__mockPair.target.entries.get('.filenally').entries.get('versions').entries.get('saved-1').entries.get('report.txt');
          stored.getFile = async () => new File([new Uint8Array([0, 255])], 'report.txt', { type: record.type, lastModified: 100 });
          const current = window.__mockPair.target.entries.get('report.txt');
          current.getFile = async () => new File([new Uint8Array([1, 254])], 'report.txt', { type: record.type, lastModified: 200 });
        });
      } else if (outcome === 'too-large text') {
        await mountVersion(page);
        await page.evaluate(() => {
          const left = 'a'.repeat(524289), right = 'b'.repeat(524290);
          const record = { ...window.__versionRecord, size: left.length };
          window.__versionRecord = record;
          window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [record] }) });
          window.__setMockFile('target', `.filenally/${record.storedPath}`, { content: left, lastModified: 100 });
          window.__setMockFile('target', 'report.txt', { content: right, lastModified: 200 });
        });
      } else {
        await mountVersion(page);
        await page.evaluate(() => {
          const left = Array.from({ length: 1414 }, (_, index) => `left-${index}`).join('\n');
          const right = Array.from({ length: 1414 }, (_, index) => `right-${index}`).join('\n');
          const record = { ...window.__versionRecord, size: new Blob([left]).size };
          window.__versionRecord = record;
          window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [record] }) });
          window.__setMockFile('target', `.filenally/${record.storedPath}`, { content: left, lastModified: 100 });
          window.__setMockFile('target', 'report.txt', { content: right, lastModified: 200 });
        });
      }
      await installComparisonMutationSpies(page);
      const files = await snapshotMockPair(page), state = await comparisonState(page);
      await openVersionComparison(page);
      await runVersionComparison(page);
      const summary = await page.locator('#comparisonSummary').innerText();
      const status = await page.locator('#comparisonStatus').innerText();
      if (outcome === 'missing current') {
        assert.match(status, /없어 비교하지|missing; not compared/i);
        assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
        await page.locator('#comparisonTarget').selectOption('version:missing-current-history');
        await runVersionComparison(page);
        assert.match(await page.locator('#comparisonStatus').innerText(), /다릅니다|different/i);
        assert.ok(await page.locator('#comparisonBody [data-diff-kind]').count());
      }
      if (outcome === 'empty current') {
        assert.doesNotMatch(status, /없어 비교하지|missing; not compared/i);
        assert.equal(await page.locator('#comparisonBody [data-diff-kind="remove"]').count(), 1);
      }
      if (outcome === 'binary') assert.match(summary, /UTF-8/);
      if (outcome === 'too-large text') assert.match(summary, /512 KiB/);
      if (outcome === 'work fallback') assert.match(summary, /2,000,000/);
      if (!['empty current', 'missing current'].includes(outcome)) assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
      await page.locator('#btnCloseComparison').click();
      await page.locator('#btnCloseVersions').click();
      await assertComparisonReadOnly(page, files, state);
    });
  }

  for (const fallback of ['control', 'line-count', 'line-length', 'line-format-only']) {
    add(`version comparison UI maps ${fallback} text metadata without partial diff`, async ({ page }) => {
      let left;
      let right;
      if (fallback === 'control') { left = 'left\u0000'; right = 'right\u0000'; }
      if (fallback === 'line-count') { left = `${'left\n'.repeat(5001)}`; right = `${'right\n'.repeat(5001)}`; }
      if (fallback === 'line-length') { left = 'a'.repeat(8193); right = 'b'.repeat(8193); }
      if (fallback === 'line-format-only') { left = '\uFEFFsame\r\n'; right = 'same\n'; }
      await mountVersion(page, { content: left });
      await page.evaluate((content) => window.__setMockFile('target', 'report.txt', { content, lastModified: 200 }), right);
      await installComparisonMutationSpies(page);
      const files = await snapshotMockPair(page), state = await comparisonState(page);
      await openVersionComparison(page);
      await runVersionComparison(page);
      const summary = await page.locator('#comparisonSummary').innerText();
      if (fallback === 'control') assert.match(summary, /제어 문자|control characters/i);
      if (fallback === 'line-count') assert.match(summary, /5,000/);
      if (fallback === 'line-length') assert.match(summary, /8,192/);
      if (fallback === 'line-format-only') {
        assert.match(summary, /줄 내용은 같습니다|Line content is equal/);
        assert.match(summary, /BOM: .*CRLF 1 .* LF 0/);
      }
      assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
      assert.equal(await page.locator('#restoreDialog').evaluate((dialog) => dialog.open), false);
      await page.locator('#btnCloseComparison').click();
      await page.locator('#btnCloseVersions').click();
      await assertComparisonReadOnly(page, files, state);
    });
  }

  add('version comparison handler guards ignore programmatic manager actions while child is open', async ({ page }) => {
    await mountVersion(page);
    await page.evaluate(() => {
      const base = window.__versionRecord;
      const versions = [base, ...Array.from({ length: 100 }, (_, index) => ({ ...base, id: `manager-${index}`,
        originalPath: `archive/${index}.txt`, storedPath: `versions/manager-${index}/archive/${index}.txt`,
        capturedAt: '2026-09-12T00:00:00.000Z' }))];
      window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions }) });
    });
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    await openVersionComparison(page);
    await page.evaluate(() => {
      window.__comparisonManagerReads = 0;
      const visit = (directory) => {
        for (const entry of directory.entries.values()) {
          if (entry.kind === 'directory') visit(entry);
          else {
            const getFile = entry.getFile.bind(entry);
            entry.getFile = async (...args) => { window.__comparisonManagerReads += 1; return getFile(...args); };
          }
        }
      };
      visit(window.__mockPair.source); visit(window.__mockPair.target);
      const ids = ['btnVersionRefresh', 'btnVersionPrevious', 'btnVersionNext'];
      for (const id of ids) document.querySelector(`#${id}`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      for (const action of ['download', 'restore']) {
        document.querySelector(`[data-version-action="${action}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => window.__comparisonManagerReads), 0);
    assert.equal(await page.locator('#comparisonDialog').evaluate((dialog) => dialog.open), true);
    assert.equal(await page.locator('#restoreDialog').evaluate((dialog) => dialog.open), false);
    assert.equal(await page.locator('#versionPageStatus').innerText(), '1 / 2');
    for (const selector of ['#btnVersionRefresh', '[data-version-action="download"]', '[data-version-action="restore"]', '#btnConfirmRestore']) {
      assert.equal(await page.locator(selector).first().isDisabled(), true);
    }
    await page.locator('#btnCloseComparison').click();
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, files, state);
  });

  add('version comparison Confirm guard blocks a prepared restore while the child opens', async ({ page }) => {
    await mountVersion(page);
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    await page.locator('#btnVersions').click();
    await page.waitForFunction(() => document.querySelector('[data-version-action="restore"]'));
    await page.locator('[data-version-action="restore"]').first().click();
    await page.locator('#restoreDialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#restoreSummary').innerText(), /saved-1/);
    await page.evaluate(() => {
      const restore = document.querySelector('#restoreDialog');
      restore.close();
      document.querySelector('[data-version-action="compare"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      restore.showModal();
      document.querySelector('#btnConfirmRestore').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.locator('#comparisonDialog').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#comparisonTarget').disabled);
    assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), []);
    assert.deepEqual(await page.evaluate(() => window.__comparisonMutationAttempts), []);
    assert.equal(await page.locator('#restoreDialog').evaluate((dialog) => dialog.open), true);
    await page.evaluate(() => document.querySelector('#restoreDialog').close());
    await page.locator('#btnCloseComparison').click();
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, files, state);
  });

  add('version comparison choice failure keeps selected identity and disables analysis', async ({ page }) => {
    await mountVersion(page);
    await page.locator('#btnVersions').click();
    await page.waitForFunction(() => document.querySelector('[data-version-action="compare"]'));
    await page.evaluate(() => { window.__mockPair.target.entries.get('.filenally').entries.get('index.json').content = '{'; });
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    await page.locator('[data-version-action="compare"]').first().click();
    await page.locator('#comparisonDialog').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#comparisonTarget').disabled);
    assert.match(await page.locator('#comparisonStatus').innerText(), /비교 실패|Comparison failed/);
    assert.match(await page.locator('#comparisonSummary').innerText(), /report\.txt.*saved-1/s);
    assert.equal(await page.locator('#btnRunComparison').isDisabled(), true);
    assert.equal(await page.locator('#btnStopComparison').isDisabled(), true);
    assert.equal(await page.locator('#restoreDialog').evaluate((dialog) => dialog.open), false);
    await page.locator('#btnCloseComparison').click();
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, files, state);
  });

  add('version comparison UI labels unavailable SHA-256 without changing byte truth', async ({ page }) => {
    await mountVersion(page, { content: 'left' });
    await page.evaluate(() => window.__setMockFile('target', 'report.txt', { content: 'right', lastModified: 200 }));
    await openVersionComparison(page);
    await page.evaluate(() => {
      const subtle = crypto.subtle;
      window.__originalDigest = subtle.digest;
      Object.defineProperty(subtle, 'digest', { configurable: true, value: undefined });
    });
    await runVersionComparison(page);
    assert.match(await page.locator('#comparisonStatus').innerText(), /다릅니다|different/i);
    const summary = await page.locator('#comparisonSummary').innerText();
    assert.match(summary, /Web Crypto/);
    assert.equal((summary.match(/Web Crypto/g) || []).length, 2);
    await page.evaluate(() => Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: window.__originalDigest }));
  });

  for (const failure of ['corrupt index', 'stale index', 'missing stored bytes', 'stored path directory', 'revoked read', 'unreadable pinned file']) {
    add(`version comparison UI clears prior output after ${failure}`, async ({ page }) => {
      await mountVersion(page);
      await openVersionComparison(page);
      await runVersionComparison(page);
      assert.ok(await page.locator('#comparisonSummary').getByText('SHA-256', { exact: true }).count());
      await page.evaluate((failure) => {
        const root = window.__mockPair.target;
        const filenally = root.entries.get('.filenally');
        const index = filenally.entries.get('index.json');
        const storedDirectory = filenally.entries.get('versions').entries.get('saved-1');
        const stored = storedDirectory.entries.get('report.txt');
        if (failure === 'corrupt index') index.content = '{';
        if (failure === 'stale index') {
          const changed = { ...window.__versionRecord, capturedAt: '2026-09-12T00:00:00.000Z' };
          index.content = JSON.stringify({ schemaVersion: 1, versions: [changed] });
        }
        if (failure === 'missing stored bytes') storedDirectory.entries.delete('report.txt');
        if (failure === 'stored path directory') storedDirectory.entries.set('report.txt', window.__mockPair.source);
        if (failure === 'revoked read') root.getDirectoryHandle = async () => { throw new DOMException('Read permission revoked', 'NotAllowedError'); };
        if (failure === 'unreadable pinned file') {
          const getFile = stored.getFile.bind(stored);
          stored.getFile = async () => {
            const file = await getFile(), slice = file.slice.bind(file);
            file.arrayBuffer = async () => { throw new Error('Pinned file unreadable'); };
            file.slice = (...args) => { const chunk = slice(...args); chunk.arrayBuffer = async () => { throw new Error('Pinned file unreadable'); }; return chunk; };
            return file;
          };
        }
      }, failure);
      await installComparisonMutationSpies(page);
      const files = await snapshotMockPair(page), state = await comparisonState(page);
      await runVersionComparison(page);
      assert.match(await page.locator('#comparisonStatus').innerText(), /비교 실패|Comparison failed/);
      assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
      assert.equal(await page.locator('#comparisonSummary').getByText('SHA-256', { exact: true }).count(), 0);
      assert.equal(await page.locator('#restoreDialog').evaluate((dialog) => dialog.open), false);
      await page.locator('#btnCloseComparison').click();
      await page.locator('#btnCloseVersions').click();
      await assertComparisonReadOnly(page, files, state);
    });
  }

  add('version comparison Stop keeps native byte read busy through settlement and ignores duplicate input', async ({ page }) => {
    await mountVersion(page, { content: 'old' });
    await page.evaluate(() => window.__setMockFile('target', 'report.txt', { content: 'new', lastModified: 200 }));
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    await openVersionComparison(page);
    await page.evaluate(() => {
      const stored = window.__mockPair.target.entries.get('.filenally').entries.get('versions').entries.get('saved-1').entries.get('report.txt');
      const getFile = stored.getFile.bind(stored);
      let first = true;
      stored.getFile = async () => {
        const file = await getFile();
        if (!first) return file;
        first = false;
        const slice = file.slice.bind(file);
        file.slice = (...args) => {
          const chunk = slice(...args), arrayBuffer = chunk.arrayBuffer.bind(chunk);
          chunk.arrayBuffer = async () => {
            window.__comparisonReadStarted = (window.__comparisonReadStarted || 0) + 1;
            await new Promise((resolve) => { window.__releaseComparisonRead = resolve; });
            const bytes = await arrayBuffer();
            window.__comparisonReadSettled = true;
            return bytes;
          };
          return chunk;
        };
        return file;
      };
    });
    await page.locator('#btnRunComparison').click();
    await page.waitForFunction(() => window.__comparisonReadStarted === 1);
    await page.evaluate(() => {
      document.querySelector('#btnRunComparison').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.querySelector('#comparisonTarget').value = '';
      document.querySelector('#comparisonTarget').dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#btnComparisonTargetNext').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.locator('#btnStopComparison').click();
    assert.match(await page.locator('#comparisonStatus').innerText(), /중지 중|Stopping/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseComparison');
    assert.equal(await page.locator('#comparisonTarget').isDisabled(), true);
    assert.equal(await page.locator('#btnRunComparison').isDisabled(), true);
    assert.equal(await page.locator('#btnCloseComparison').isEnabled(), true);
    assert.equal(await page.locator('#comparisonTarget').inputValue(), 'current');
    await page.evaluate(() => window.__releaseComparisonRead());
    await page.waitForFunction(() => window.__comparisonReadSettled && !document.querySelector('#comparisonTarget').disabled);
    assert.equal(await page.evaluate(() => window.__comparisonReadStarted), 1);
    assert.match(await page.locator('#comparisonStatus').innerText(), /중지했습니다|stopped/i);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseComparison');
    assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
    await page.locator('#btnCloseComparison').click();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.versionAction), 'compare');
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, files, state);
  });

  add('version comparison Close and reopen discard a delayed native read without unlocking the new child', async ({ page }) => {
    await mountVersion(page, { content: 'old' });
    await page.evaluate(() => window.__setMockFile('target', 'report.txt', { content: 'new', lastModified: 200 }));
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    await openVersionComparison(page);
    await page.evaluate(() => {
      const stored = window.__mockPair.target.entries.get('.filenally').entries.get('versions').entries.get('saved-1').entries.get('report.txt');
      const getFile = stored.getFile.bind(stored);
      let readNumber = 0;
      stored.getFile = async () => {
        const file = await getFile();
        readNumber += 1;
        if (readNumber > 2) return file;
        const label = readNumber === 1 ? 'Old' : 'New';
        const slice = file.slice.bind(file);
        file.slice = (...args) => {
          const chunk = slice(...args), read = chunk.arrayBuffer.bind(chunk);
          chunk.arrayBuffer = async () => {
            window[`__${label.toLowerCase()}ReadStarted`] = true;
            await new Promise((resolve) => { window[`__release${label}Read`] = resolve; });
            const bytes = await read(); window[`__${label.toLowerCase()}ReadSettled`] = true; return bytes;
          };
          return chunk;
        };
        return file;
      };
    });
    await page.locator('#btnRunComparison').click();
    await page.waitForFunction(() => window.__oldReadStarted);
    await page.locator('#btnCloseComparison').click();
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().versionBusy), true);
    await page.locator('[data-version-action="compare"]').first().click();
    await page.waitForFunction(() => !document.querySelector('#comparisonTarget').disabled);
    await page.locator('#btnRunComparison').click();
    await page.waitForFunction(() => window.__newReadStarted);
    assert.equal(await page.locator('#comparisonTarget').isDisabled(), true);
    await page.evaluate(() => window.__releaseOldRead());
    await page.waitForFunction(() => window.__oldReadSettled);
    assert.equal(await page.locator('#comparisonDialog').evaluate((dialog) => dialog.open), true);
    assert.equal(await page.locator('#comparisonTarget').isDisabled(), true);
    assert.equal(await page.locator('#btnRunComparison').isDisabled(), true);
    assert.equal(await page.locator('#btnStopComparison').isEnabled(), true);
    assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
    await page.evaluate(() => window.__releaseNewRead());
    await page.waitForFunction(() => window.__newReadSettled && !document.querySelector('#comparisonTarget').disabled);
    assert.ok(await page.locator('#comparisonBody [data-diff-kind]').count());
    await page.locator('#btnCloseComparison').click();
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, files, state);
  });

  add('version comparison choice loading can close and reopen without stale unlock or Stop', async ({ page }) => {
    await mountVersion(page);
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    await page.locator('#btnVersions').click();
    await page.waitForFunction(() => document.querySelector('[data-version-action="compare"]'));
    await page.evaluate(() => {
      const index = window.__mockPair.target.entries.get('.filenally').entries.get('index.json');
      const getFile = index.getFile.bind(index);
      let readNumber = 0;
      index.getFile = async () => {
        const file = await getFile();
        readNumber += 1;
        if (readNumber > 2) return file;
        const label = readNumber === 1 ? 'OldChoice' : 'NewChoice';
        const text = file.text.bind(file);
        file.text = async () => { window[`__${label[0].toLowerCase()}${label.slice(1)}ReadStarted`] = true;
          await new Promise((resolve) => { window[`__release${label}Read`] = resolve; });
          const value = await text(); window[`__${label[0].toLowerCase()}${label.slice(1)}ReadSettled`] = true; return value; };
        return file;
      };
    });
    await page.locator('[data-version-action="compare"]').first().click();
    await page.waitForFunction(() => window.__oldChoiceReadStarted);
    assert.equal(await page.locator('#btnStopComparison').isDisabled(), true);
    assert.equal(await page.locator('#btnCloseComparison').isEnabled(), true);
    assert.equal(await page.locator('#comparisonTarget').isDisabled(), true);
    await page.locator('#btnCloseComparison').click();
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().versionBusy), true);
    await page.locator('[data-version-action="compare"]').first().click();
    await page.waitForFunction(() => window.__newChoiceReadStarted);
    await page.evaluate(() => window.__releaseOldChoiceRead());
    await page.waitForFunction(() => window.__oldChoiceReadSettled);
    assert.equal(await page.locator('#comparisonTarget').isDisabled(), true);
    assert.equal(await page.locator('#btnRunComparison').isDisabled(), true);
    assert.equal(await page.locator('#btnStopComparison').isDisabled(), true);
    await page.evaluate(() => window.__releaseNewChoiceRead());
    await page.waitForFunction(() => window.__newChoiceReadSettled && !document.querySelector('#comparisonTarget').disabled);
    assert.equal(await page.locator('#comparisonTarget').inputValue(), 'current');
    assert.equal(await page.locator('#comparisonTarget').isEnabled(), true);
    await page.locator('#btnCloseComparison').click();
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, files, state);
  });

  add('version comparison Stop during LCS and delayed digest publishes no stale rows or hashes', async ({ page }) => {
    const left = Array.from({ length: 999 }, (_, index) => `left-${index}`).join('\n');
    const right = Array.from({ length: 999 }, (_, index) => `right-${index}`).join('\n');
    await mountVersion(page, { content: left });
    await page.evaluate((content) => window.__setMockFile('target', 'report.txt', { content, lastModified: 200 }), right);
    await openVersionComparison(page);
    await page.locator('#btnRunComparison').click();
    await page.waitForFunction(() => /텍스트|Text/.test(document.querySelector('#comparisonStatus').textContent));
    await page.locator('#btnStopComparison').click();
    await page.waitForFunction(() => !document.querySelector('#comparisonTarget').disabled);
    assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
    await page.evaluate((content) => window.__setMockFile('target', 'report.txt', { content, lastModified: 200 }), left);
    await page.locator('#comparisonTarget').selectOption('current');
    await page.evaluate(() => {
      const subtle = crypto.subtle, original = subtle.digest.bind(subtle);
      window.__restoreDigest = () => Object.defineProperty(subtle, 'digest', { configurable: true, value: original });
      Object.defineProperty(subtle, 'digest', { configurable: true, value: async (...args) => {
        window.__digestStarted = true;
        await new Promise((resolve) => { window.__releaseDigest = resolve; });
        const value = await original(...args); window.__digestSettled = true; return value;
      } });
    });
    await page.locator('#btnRunComparison').click();
    await page.waitForFunction(() => window.__digestStarted);
    await page.locator('#btnStopComparison').click();
    await page.evaluate(() => window.__releaseDigest());
    await page.waitForFunction(() => window.__digestSettled && !document.querySelector('#comparisonTarget').disabled);
    await page.evaluate(() => window.__restoreDigest());
    assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
    assert.equal(await page.locator('#comparisonSummary').getByText('SHA-256', { exact: true }).count(), 0);
  });

  add('version comparison Close and reopen discard delayed digest without unlocking replacement analysis', async ({ page }) => {
    await mountVersion(page, { content: 'same' });
    await page.evaluate(() => window.__setMockFile('target', 'report.txt', { content: 'same', lastModified: 200 }));
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    await openVersionComparison(page);
    await page.evaluate(() => {
      const subtle = crypto.subtle, original = subtle.digest.bind(subtle);
      window.__digestCalls = 0;
      window.__restoreDigest = () => Object.defineProperty(subtle, 'digest', { configurable: true, value: original });
      Object.defineProperty(subtle, 'digest', { configurable: true, value: async (...args) => {
        window.__digestCalls += 1;
        const call = window.__digestCalls;
        const label = call === 1 ? 'OldDigest' : 'NewDigest';
        if (call <= 2) {
          window[`__${label[0].toLowerCase()}${label.slice(1)}Started`] = true;
          await new Promise((resolve) => { window[`__release${label}`] = resolve; });
        }
        const value = await original(...args);
        if (call <= 2) window[`__${label[0].toLowerCase()}${label.slice(1)}Settled`] = true;
        return value;
      } });
    });
    await page.locator('#btnRunComparison').click();
    await page.waitForFunction(() => window.__oldDigestStarted);
    await page.locator('#btnCloseComparison').click();
    await page.locator('[data-version-action="compare"]').first().click();
    await page.waitForFunction(() => !document.querySelector('#comparisonTarget').disabled);
    await page.locator('#btnRunComparison').click();
    await page.waitForFunction(() => window.__newDigestStarted);
    await page.evaluate(() => window.__releaseOldDigest());
    await page.waitForFunction(() => window.__oldDigestSettled);
    assert.equal(await page.locator('#comparisonTarget').isDisabled(), true);
    assert.equal(await page.locator('#btnRunComparison').isDisabled(), true);
    assert.equal(await page.locator('#btnStopComparison').isEnabled(), true);
    assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
    assert.equal(await page.locator('#comparisonSummary').getByText('SHA-256', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__digestCalls), 2);
    await page.evaluate(() => window.__releaseNewDigest());
    await page.waitForFunction(() => window.__newDigestSettled && !document.querySelector('#comparisonTarget').disabled);
    await page.evaluate(() => window.__restoreDigest());
    assert.equal(await page.evaluate(() => window.__digestCalls), 2);
    assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
    assert.equal(await page.locator('#comparisonSummary').getByText('SHA-256', { exact: true }).count(), 2);
    assert.equal(await page.locator('#comparisonTarget').isEnabled(), true);
    await page.locator('#btnCloseComparison').click();
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, files, state);
  });

  add('version comparison parent close invalidates delayed work and prevents late publication', async ({ page }) => {
    await mountVersion(page, { content: 'old' });
    await page.evaluate(() => window.__setMockFile('target', 'report.txt', { content: 'new', lastModified: 200 }));
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    await openVersionComparison(page);
    await page.evaluate(() => {
      const stored = window.__mockPair.target.entries.get('.filenally').entries.get('versions').entries.get('saved-1').entries.get('report.txt');
      const getFile = stored.getFile.bind(stored);
      stored.getFile = async () => {
        const file = await getFile(), slice = file.slice.bind(file);
        file.slice = (...args) => {
          const chunk = slice(...args), read = chunk.arrayBuffer.bind(chunk);
          chunk.arrayBuffer = async () => { window.__parentReadStarted = true;
            await new Promise((resolve) => { window.__releaseParentRead = resolve; });
            const bytes = await read(); window.__parentReadSettled = true; return bytes; };
          return chunk;
        };
        return file;
      };
    });
    await page.locator('#btnRunComparison').click();
    await page.waitForFunction(() => window.__parentReadStarted);
    await page.evaluate(() => document.querySelector('#btnCloseVersions').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForFunction(() => !window.FileNallyTest.getModel().versionBusy);
    assert.equal(await page.locator('#versionDialog').evaluate((dialog) => dialog.open), false);
    assert.equal(await page.locator('#comparisonDialog').evaluate((dialog) => dialog.open), false);
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().versionBusy), false);
    await page.evaluate(() => window.__releaseParentRead());
    await page.waitForFunction(() => window.__parentReadSettled);
    assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 0);
    await assertComparisonReadOnly(page, files, state);
  });

  add('version comparison error completion preserves deliberate Close focus and returns to trigger', async ({ page }) => {
    await mountVersion(page, { content: 'old' });
    await page.evaluate(() => window.__setMockFile('target', 'report.txt', { content: 'new', lastModified: 200 }));
    await openVersionComparison(page);
    await page.evaluate(() => {
      const stored = window.__mockPair.target.entries.get('.filenally').entries.get('versions').entries.get('saved-1').entries.get('report.txt');
      const getFile = stored.getFile.bind(stored);
      stored.getFile = async () => {
        const file = await getFile();
        file.arrayBuffer = async () => { window.__errorReadStarted = true;
          await new Promise((resolve) => { window.__releaseErrorRead = resolve; });
          throw new Error('Delayed read failure'); };
        return file;
      };
    });
    await page.locator('#btnRunComparison').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__errorReadStarted);
    await page.locator('#btnCloseComparison').focus();
    await page.evaluate(() => window.__releaseErrorRead());
    await page.waitForFunction(() => /비교 실패|Comparison failed/.test(document.querySelector('#comparisonStatus').textContent));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseComparison');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.versionAction), 'compare');
  });

  for (const lang of ['ko', 'en']) {
    add(`version comparison ${lang} keyboard flow renders hostile path and content as literal text`, async ({ page }) => {
      const hostile = '<img src=x onerror=alert(1)>.txt';
      await mountVersion(page, { path: hostile, content: '<script>left</script>' });
      await page.evaluate((filePath) => window.__setMockFile('target', filePath, { content: '<script>right</script>', lastModified: 200 }), hostile);
      await page.locator(lang === 'ko' ? '#btnLangKo' : '#btnLangEn').click();
      await installComparisonMutationSpies(page);
      const files = await snapshotMockPair(page), state = await comparisonState(page);
      await openVersionComparison(page);
      assert.equal(await page.getByRole('dialog', { name: lang === 'ko' ? '버전 비교' : 'Version comparison', exact: true }).count(), 1);
      assert.equal(await page.locator('#comparisonDialog img, #comparisonDialog script').count(), 0);
      assert.match(await page.locator('#comparisonSummary').innerText(), /<img src=x onerror=alert\(1\)>/);
      await page.locator('#btnRunComparison').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('#btnRunComparison').disabled);
      assert.equal(await page.locator('#comparisonDialog img, #comparisonDialog script').count(), 0);
      assert.equal(await page.locator('#comparisonBody [data-diff-kind="remove"] code').innerText(), '<script>left</script>');
      assert.equal(await page.locator('#comparisonBody [data-diff-kind="add"] code').innerText(), '<script>right</script>');
      assert.match(await page.locator('#comparisonLegend').innerText(), lang === 'ko' ? /왼쪽 줄/ : /Left line/);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement.dataset.versionAction === 'compare');
      await page.keyboard.press('Escape');
      await assertComparisonReadOnly(page, files, state);
    });
  }

  add('version storage UI usage and cancelled preview preserve files permissions settings and plan', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    await compare(page);
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    await page.locator('#btnVersions').click();
    await page.waitForFunction(() => document.querySelectorAll('#versionBody tr').length === 2);
    assert.equal(await page.locator('#versionUsage').count(), 1);
    assert.match(await page.locator('[data-usage-side="target"]').innerText(), /2.*6 B/);
    await page.locator('[data-cleanup-id="saved-1"][data-cleanup-side="target"]').check();
    await page.locator('#btnPrepareCleanup').click();
    await page.locator('#cleanupDialog').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
    assert.equal(await page.locator('#cleanupRecords li').count(), 1);
    assert.match(await page.locator('#cleanupSummary').innerText(), /1.*3 B/);
    await page.locator('#btnCancelCleanup').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btnPrepareCleanup');
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, files, state);
  });

  for (const direction of ['#dirBoth', '#dirOne', '#dirReverse']) {
    for (const swapped of [false, true]) {
      add(`version storage UI confirmed cleanup keeps physical ownership ${direction} swapped ${swapped}`, async ({ page }) => {
        await page.locator(direction).click();
        await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
        await page.evaluate(() => { window.__mockPair.source.name = 'same-name'; window.__mockPair.target.name = 'same-name'; });
        if (swapped) await page.locator('#btnSwapFolders').click();
        await compare(page);
        const state = (await comparisonState(page)).storage;
        const before = await snapshotMockPair(page);
        const side = swapped ? 'source' : 'target';
        await page.locator('#btnVersions').click();
        await page.locator(`[data-cleanup-id="saved-1"][data-cleanup-side="${side}"]`).check();
        await page.locator('#btnPrepareCleanup').click();
        await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
        assert.match(await page.locator('#cleanupSummary').innerText(), /same-name/);
        assert.match(await page.locator('#cleanupSummary').innerText(), /v0\.14/);
        await page.locator('#btnConfirmCleanup').click();
        await page.waitForFunction(() => /확인된 완료 1|Confirmed completed 1/.test(document.querySelector('#cleanupStatus').textContent), null, { timeout: 2000 });
        const after = await snapshotMockPair(page);
        assert.deepEqual(after.source, before.source);
        assert.equal(after.target['report.txt'].content, 'target-current');
        assert.equal(after.target['.filenally'].versions['saved-1']['report.txt'], undefined);
        assert.equal(after.target['.filenally'].versions['saved-2']['report.txt'].content, 'old');
        assert.equal(JSON.parse(after.target['.filenally']['index.json'].content).schemaVersion, 2);
        assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().plan), null);
        assert.deepEqual((await comparisonState(page)).storage, state);
        assert.match(await page.locator('#cleanupStatus').innerText(), /3 B/);
        await page.locator('#btnCancelCleanup').click();
        assert.equal(await page.evaluate(() => document.activeElement.id), 'btnVersionRefresh');
        assert.match(await page.locator('[data-usage-side="' + side + '"]').innerText(), /1.*3 B/);
      });
    }
  }

  add('version storage UI permission denial consumes preview without changing plan or files', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    await compare(page);
    const before = await snapshotMockPair(page), state = await comparisonState(page);
    await page.locator('#btnVersions').click();
    await page.locator('[data-cleanup-id="saved-1"]').check();
    await page.locator('#btnPrepareCleanup').click();
    await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
    await page.evaluate(() => window.__setMockPermission('target', { state: 'denied' }));
    await page.locator('#btnConfirmCleanup').click();
    await page.waitForFunction(() => /실패|failed/.test(document.querySelector('#cleanupStatus').textContent), null, { timeout: 2000 });
    await page.locator('#btnConfirmCleanup').dispatchEvent('click');
    assert.equal(await page.locator('#btnConfirmCleanup').isDisabled(), true);
    assert.deepEqual(await snapshotMockPair(page), before);
    assert.deepEqual((await comparisonState(page)).storage, state.storage);
    assert.deepEqual((await comparisonState(page)).plan, state.plan);
  });

  add('version storage UI inspection labels observed categories literal errors and preserves plan', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    await compare(page);
    await page.evaluate(() => {
      window.__deleteMockEntry('target', '.filenally/versions/saved-2/report.txt');
      window.__setMockFile('target', '.filenally/versions/orphan.txt', { content: 'extra' });
      window.__setMockFile('target', '.filenally/note.txt', { content: 'other' });
      window.__setMockFile('target', '.filenally/bad.txt', { content: 'bad' });
      window.__mockPair.target.entries.get('.filenally').entries.get('bad.txt').getFile = async () => { throw new Error('<img src=x onerror=alert(1)>'); };
    });
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    await page.locator('#btnVersions').click();
    await page.locator('[data-inspect-side="target"]').click();
    await page.locator('#cleanupDialog').waitFor({ state: 'visible', timeout: 2000 });
    await page.waitForFunction(() => document.querySelector('#btnStopCleanup').hidden);
    await page.locator('#btnCancelCleanup').click();
    const usage = await page.locator('[data-usage-side="target"]').innerText();
    assert.match(usage, /부분|Partial/); assert.match(usage, /미등록|Unregistered/);
    // Partial traversal cannot establish absence; the store intentionally withholds missing IDs.
    assert.match(usage, /누락 0|0 missing/); assert.match(usage, /<img src=x onerror=alert\(1\)>/);
    assert.equal(await page.locator('#versionUsage img').count(), 0);
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, files, state);
  });

  add('version storage UI index-only recovery leaves pending files and other root operable', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')], { schemaVersion: 2,
      cleanup: cleanupIntent({ remainingIds: ['saved-1', 'saved-2'] }) });
    await page.evaluate(({ record, content }) => {
      window.__deleteMockEntry('target', '.filenally/versions/saved-1/report.txt');
      window.__setMockFile('source', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [record] }) });
      window.__setMockFile('source', `.filenally/${record.storedPath}`, { content, lastModified: 100 });
    }, cleanupFixture('other-1'));
    await compare(page);
    await installCleanupObservation(page);
    const before = await snapshotMockPair(page), state = (await comparisonState(page)).storage;
    await page.locator('#btnVersions').click();
    await page.locator('[data-recover-side="target"]').waitFor();
    assert.equal(await page.locator('[data-cleanup-side="source"]').count(), 1);
    assert.equal(await page.locator('[data-version-action="restore"]').isEnabled(), true);
    assert.match(await page.locator('#versionStatus').innerText(), /requires recovery/i);
    await page.locator('[data-recover-side="target"]').click();
    await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
    assert.equal(await page.locator('#cleanupLastWarning').isVisible(), false);
    assert.match(await page.locator('#cleanupSummary').innerText(), /1/);
    assert.match(await page.locator('#cleanupSummary').innerText(), /작업 cleanup-1/);
    await page.locator('#btnConfirmCleanup').click();
    await page.waitForFunction(() => /복구 완료|recovery complete/.test(document.querySelector('#cleanupStatus').textContent), null, { timeout: 2000 });
    const after = await snapshotMockPair(page);
    assert.deepEqual(after.source, before.source);
    assert.deepEqual(after.target['.filenally'].versions, before.target['.filenally'].versions);
    assert.deepEqual(await page.evaluate(() => window.__cleanupRemovals), []);
    const index = JSON.parse(after.target['.filenally']['index.json'].content);
    assert.equal(index.cleanup, null); assert.deepEqual(index.versions.map(r => r.id), ['saved-2']);
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().plan), null);
    assert.deepEqual((await comparisonState(page)).storage, state);
  });

  add('version storage UI selection persists across 100 row pages rejects mixed roots and caps at 100', async ({ page }) => {
    await mountCleanup(page, Array.from({ length: 102 }, (_, i) => cleanupFixture(`saved-${String(i).padStart(3, '0')}`, `path-${i}.txt`)));
    await page.evaluate(({ record, content }) => {
      window.__setMockFile('source', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [record] }) });
      window.__setMockFile('source', `.filenally/${record.storedPath}`, { content, lastModified: 100 });
    }, cleanupFixture('source-1', 'source.txt', 'old', '2026-09-12T00:00:00.000Z'));
    await page.locator('#btnVersions').click();
    await page.locator('[data-cleanup-id="saved-000"]').check();
    await page.locator('#btnVersionNext').click();
    assert.equal(await page.locator('[data-cleanup-id]').count(), 3);
    await page.locator('#btnSelectVersionPage').click();
    assert.match(await page.locator('#versionCleanupSelection').innerText(), /3\/100.*9 B/);
    await page.locator('[data-cleanup-side="source"]').evaluate(input => { input.checked = true; input.dispatchEvent(new Event('change')); });
    assert.equal(await page.locator('[data-cleanup-side="source"]').isChecked(), false);
    assert.equal(await page.locator('[data-cleanup-side="source"]').isDisabled(), true);
    await page.locator('#btnVersionPrevious').click();
    assert.equal(await page.locator('[data-cleanup-id="saved-000"]').isChecked(), true);
    await page.locator('#btnSelectVersionPage').click();
    assert.match(await page.locator('#versionCleanupSelection').innerText(), /100\/100.*300 B/);
    assert.equal(await page.locator('[data-cleanup-id="saved-098"]').isChecked(), false);
    assert.equal(await page.locator('[data-cleanup-id="saved-099"]').isChecked(), false);
    await page.locator('[data-cleanup-id="saved-000"]').uncheck();
    assert.match(await page.locator('#versionCleanupSelection').innerText(), /99\/100/);
    assert.equal(await page.locator('[data-usage-side="target"] .version-usage-paths li').count(), 100);
    await page.locator('[data-usage-page-side="target"][data-page-delta="1"]').click();
    assert.equal(await page.locator('[data-usage-side="target"] .version-usage-paths li').count(), 2);
    assert.deepEqual(await page.evaluate(() => ({ side: document.activeElement.dataset.usagePageSide, delta: document.activeElement.dataset.pageDelta })), { side: 'target', delta: '-1' });
    assert.equal(await page.locator('#versionBody tr').count(), 100);
    await page.locator('#btnVersionRefresh').click();
    await page.waitForFunction(() => !document.querySelector('#btnVersionRefresh').disabled);
    assert.match(await page.locator('#versionCleanupSelection').innerText(), /0\/100.*0 B/);
    assert.equal(await page.locator('[data-usage-side="target"] .version-usage-paths li').count(), 100);
  });

  for (const [name, size] of [['fractional', 0.5], ['unsafe integer', Number.MAX_SAFE_INTEGER + 1]]) {
    add(`version storage UI ${name} legacy sizes stay listable without poisoning cleanup or healthy row actions`, async ({ page }) => {
      const invalid = cleanupFixture('saved-1');
      invalid.record.size = size;
      await mountCleanup(page, [invalid, cleanupFixture('saved-2')]);
      await page.locator('#btnVersions').click();
      await page.waitForFunction(() => document.querySelectorAll('#versionBody tr').length === 2);
      assert.match(await page.locator('#versionBody').innerText(), new RegExp(`${size} B`));

      const invalidCheckbox = page.locator('[data-cleanup-id="saved-1"]');
      await invalidCheckbox.evaluate(input => {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.evaluate(() => Promise.resolve());
      assert.deepEqual(await page.evaluate(() => window.__testUnhandledErrors), []);
      assert.equal(await invalidCheckbox.isChecked(), false);
      assert.equal(await invalidCheckbox.isDisabled(), true);
      assert.match(await invalidCheckbox.getAttribute('aria-label'), /unavailable|사용할 수 없|정리.*불가/i);
      assert.match(await page.locator('#versionCleanupSelection').innerText(), /0\/100.*0 B/);
      await page.locator('#btnPrepareCleanup').dispatchEvent('click');
      assert.equal(await page.locator('#cleanupDialog').isVisible(), false);

      await page.locator('#btnSelectVersionPage').click();
      assert.equal(await invalidCheckbox.isChecked(), false);
      assert.equal(await page.locator('[data-cleanup-id="saved-2"]').isChecked(), true);
      assert.match(await page.locator('#versionCleanupSelection').innerText(), /1\/100.*3 B/);
      await page.locator('#btnClearVersionSelection').click();

      await page.locator('[data-cleanup-id="saved-2"] + .version-row-actions [data-version-action="compare"]').click();
      await page.locator('#comparisonDialog').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('#comparisonTarget').disabled);
      await page.locator('#btnCloseComparison').click();
      assert.equal(await page.locator('#btnVersionRefresh').isEnabled(), true);
      assert.equal(await page.locator('[data-version-action]').first().isEnabled(), true);
      await page.locator('#btnCloseVersions').click();
      await page.waitForFunction(() => !window.FileNallyTest.getModel().versionBusy);
    });
  }

  for (const lang of ['ko', 'en']) {
    add(`version storage UI ${lang} unknown summary and last valid version acknowledgment are explicit`, async ({ page }) => {
      await page.locator(lang === 'ko' ? '#btnLangKo' : '#btnLangEn').click();
      await mountCleanup(page, [cleanupFixture('saved-1', '<b>long-path</b>.txt'), cleanupFixture('saved-2', '<b>long-path</b>.txt')]);
      await page.evaluate(() => {
        window.__setMockFile('source', '.filenally/index.json', { content: '{' });
        window.__deleteMockEntry('target', '.filenally/versions/saved-2/<b>long-path</b>.txt');
      });
      await page.locator('#btnVersions').click();
      await page.waitForFunction(() => document.querySelectorAll('#versionBody tr').length === 2);
      assert.match(await page.locator('#versionUsageTitle').innerText(), lang === 'ko' ? /등록된 버전 용량/ : /Registered version usage/);
      assert.match(await page.locator('[data-usage-side="source"]').innerText(), lang === 'ko' ? /알 수 없음/ : /unknown/);
      assert.equal(await page.locator('[data-usage-total]').count(), 0);
      await page.locator('[data-cleanup-id="saved-1"]').check();
      await page.locator('#btnPrepareCleanup').click();
      await page.locator('#cleanupLastWarning').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#btnConfirmCleanup').isDisabled(), true);
      assert.match(await page.locator('#cleanupSummary').innerText(), lang === 'ko' ? /누락·불일치/ : /missing or mismatched/);
      assert.equal(await page.locator('#cleanupRecords b').count(), 0);
      const calls = await page.evaluate(() => window.__getPermissionCalls());
      await page.locator('#btnConfirmCleanup').dispatchEvent('click');
      assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), calls);
      await page.locator('#cleanupLastAcknowledged').check();
      assert.equal(await page.locator('#btnConfirmCleanup').isEnabled(), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#cleanupDialog').isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnPrepareCleanup');
    });
  }

  for (const mode of ['preparation', 'inspection']) {
    add(`version storage UI late ${mode} cannot alter replacement child locks or results`, async ({ page }) => {
      await captureVersionAsyncClickCompletions(page);
      await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
      await compare(page);
      await installComparisonMutationSpies(page);
      const before = await snapshotMockPair(page), state = await comparisonState(page);
      await page.locator('#btnVersions').click();
      await page.locator('[data-cleanup-id="saved-1"]').check();
      await page.evaluate(mode => {
        const folder = window.__mockPair.target.entries.get('.filenally');
        if (mode === 'preparation') {
          const file = folder.entries.get('versions').entries.get('saved-1').entries.get('report.txt'), read = file.getFile.bind(file);
          let held = false;
          file.getFile = async () => { if (!held) { held = true; await new Promise(resolve => window.__releaseOldRead = resolve); } return read(); };
        } else {
          const values = folder.values.bind(folder); let held = false;
          folder.values = async function* () { if (!held) { held = true; await new Promise(resolve => window.__releaseOldRead = resolve); } yield* values(); };
        }
      }, mode);
      await page.locator(mode === 'preparation' ? '#btnPrepareCleanup' : '[data-inspect-side="target"]').click();
      await page.waitForFunction(() => !!window.__releaseOldRead);
      await page.locator('#btnCancelCleanup').click();
      await page.locator('#btnCloseVersions').click();
      await page.waitForFunction(() => !window.FileNallyTest.getModel().versionBusy);
      await page.locator('#btnVersions').click();
      await page.locator('[data-cleanup-id="saved-2"]').check();
      await page.locator('#btnPrepareCleanup').click();
      await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
      await page.evaluate(() => window.__releaseOldRead());
      await page.waitForFunction(() => window.__versionAsyncClickCompletions[0]?.done);
      assert.equal(await page.evaluate(() => window.__versionAsyncClickCompletions[0].status), 'fulfilled');
      assert.equal(await page.locator('#btnConfirmCleanup').isEnabled(), true);
      assert.match(await page.locator('#cleanupRecords').innerText(), /saved-2/);
      assert.doesNotMatch(await page.locator('#cleanupRecords').innerText(), /saved-1/);
      assert.equal(await page.locator('#btnVersionRefresh').isDisabled(), true);
      await page.locator('#btnCancelCleanup').click();
      await page.locator('#btnCloseVersions').click();
      await assertComparisonReadOnly(page, before, state);
    });
  }

  add('version storage UI stop inspection reports cancelled observation without clearing plan', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    await compare(page);
    await installComparisonMutationSpies(page);
    const before = await snapshotMockPair(page), state = await comparisonState(page);
    await page.locator('#btnVersions').click();
    await page.waitForFunction(() => !document.querySelector('#btnVersionRefresh').disabled);
    await page.evaluate(() => {
      const folder = window.__mockPair.target.entries.get('.filenally'), values = folder.values.bind(folder);
      folder.values = async function* () { await new Promise(resolve => window.__releaseInspection = resolve); yield* values(); };
    });
    await page.locator('[data-inspect-side="target"]').click();
    await page.waitForFunction(() => !!window.__releaseInspection);
    await page.locator('#btnStopCleanup').click();
    await page.evaluate(() => window.__releaseInspection());
    await page.waitForFunction(() => document.querySelector('#btnStopCleanup').hidden);
    assert.match(await page.locator('#cleanupStatus').innerText(), /검사 중지|cancelled/);
    await page.locator('#btnCancelCleanup').click();
    assert.match(await page.locator('[data-usage-side="target"]').innerText(), /검사 중지|cancelled/);
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, before, state);
  });

  add('version storage UI held permission blocks duplicates close Escape and competing operations', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    await compare(page);
    await page.locator('#btnVersions').click();
    await page.locator('[data-cleanup-id="saved-1"]').check();
    await page.locator('#btnPrepareCleanup').click();
    await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
    await page.evaluate(() => {
      window.__permissionCount = 0;
      window.__mockPair.target.requestPermission = () => {
        window.__permissionCount++;
        return new Promise(resolve => window.__releasePermission = resolve);
      };
      document.querySelector('#btnConfirmCleanup').dispatchEvent(new Event('click'));
      window.__permissionSynchronous = window.__permissionCount === 1;
      document.querySelector('#btnConfirmCleanup').dispatchEvent(new Event('click'));
    });
    assert.equal(await page.evaluate(() => window.__permissionSynchronous), true);
    await page.keyboard.press('Escape');
    await page.locator('#btnCancelCleanup').dispatchEvent('click');
    await page.locator('#btnCloseVersions').dispatchEvent('click');
    await page.locator('#btnVersionRefresh').dispatchEvent('click');
    for (const action of ['compare', 'restore']) await page.locator(`[data-version-action="${action}"]`).first().dispatchEvent('click');
    await page.locator('#btnConfirmRestore').dispatchEvent('click');
    await page.evaluate(() => { document.querySelector('#cleanupDialog').close(); document.querySelector('#versionDialog').close(); });
    await page.waitForFunction(() => document.querySelector('#cleanupDialog').open && document.querySelector('#versionDialog').open);
    await page.locator('#btnStopCleanup').evaluate(button => button.focus());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btnStopCleanup');
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().versionBusy), true);
    assert.equal(await page.locator('#comparisonDialog').isVisible(), false);
    assert.equal(await page.locator('#restoreDialog').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__permissionCount), 1);
    await page.evaluate(() => window.__releasePermission('granted'));
    await page.waitForFunction(() => /확인된 완료 1|Confirmed completed 1/.test(document.querySelector('#cleanupStatus').textContent));
    assert.equal(await page.evaluate(() => window.__permissionCount), 1);
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().plan), null);
  });

  for (const failure of [false, true]) {
    add(`version storage UI ${failure ? 'failed deletion reports recovery' : 'safe stop finishes one item'} and invalidates plan`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2'), cleanupFixture('saved-3')]);
      await compare(page);
      await installCleanupObservation(page);
      const state = (await comparisonState(page)).storage;
      await page.locator('#btnVersions').click();
      await page.locator('[data-cleanup-id="saved-1"]').check();
      await page.locator('[data-cleanup-id="saved-2"]').check();
      await page.locator('#btnPrepareCleanup').click();
      await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
      await page.evaluate(failure => {
        window.__beforeCleanupRemove = async () => {
          await new Promise(resolve => window.__releaseDeletion = resolve);
          if (failure) throw new Error('<img src=x> blocked deletion');
        };
      }, failure);
      await page.locator('#btnConfirmCleanup').click();
      await page.waitForFunction(() => !!window.__releaseDeletion);
      assert.equal(await page.locator('#btnCancelCleanup').isDisabled(), true);
      if (!failure) await page.locator('#btnStopCleanup').click();
      await page.evaluate(() => window.__releaseDeletion());
      await page.waitForFunction(() => !document.querySelector('#btnCancelCleanup').disabled);
      const result = await page.locator('#cleanupStatus').innerText();
      assert.match(result, failure ? /실패|failed/ : /정리 중지|Cleanup stopped/);
      assert.match(result, failure ? /saved-1/ : /3 B/);
      if (failure) {
        assert.match(result, /<img src=x> blocked deletion/);
        assert.match(result, /복구 필요: 있음|Recovery required: Yes/);
        assert.equal(await page.locator('#cleanupStatus img').count(), 0);
      }
      const after = await snapshotMockPair(page);
      assert.equal(after.target['.filenally'].versions['saved-2']['report.txt'].content, 'old');
      assert.equal(after.target['.filenally'].versions['saved-3']['report.txt'].content, 'old');
      assert.equal(after.target['report.txt'].content, 'target-current');
      assert.equal(await page.evaluate(() => window.__cleanupRemovals.length), 1);
      assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().plan), null);
      assert.deepEqual((await comparisonState(page)).storage, state);
    });
  }

  add('version storage UI large logical sums stay exact and inspection identifies mismatches', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    await page.evaluate(() => {
      const versions = window.__cleanupRecords.map((record, i) => ({ ...record, size: i === 0 ? Number.MAX_SAFE_INTEGER : 2 }));
      window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions }) });
    });
    await page.locator('#btnVersions').click();
    await page.waitForFunction(() => !document.querySelector('#btnVersionRefresh').disabled);
    assert.match(await page.locator('[data-usage-side="target"]').innerText(), /9007199254740993 B/);
    assert.match(await page.locator('[data-usage-total]').innerText(), /9007199254740993 B/);
    assert.match(await page.locator('[data-usage-side="source"]').innerText(), /0.*0 B/);
    await page.locator('#btnSelectVersionPage').click();
    assert.match(await page.locator('#versionCleanupSelection').innerText(), /2\/100.*9007199254740993 B/);
    await page.locator('[data-inspect-side="target"]').click();
    await page.waitForFunction(() => document.querySelector('#btnStopCleanup').hidden);
    await page.locator('#btnCancelCleanup').click();
    assert.match(await page.locator('[data-usage-side="target"]').innerText(), /크기 불일치 2|2 size mismatches/);
  });

  add('version storage UI progress callback failure reports committed bytes and invalidates plan', async ({ page }) => {
    await page.locator('#btnLangEn').click();
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2'), cleanupFixture('saved-3')]);
    await compare(page);
    await page.locator('#btnVersions').click();
    await page.locator('[data-cleanup-id="saved-1"]').check();
    await page.locator('[data-cleanup-id="saved-2"]').check();
    await page.locator('#btnPrepareCleanup').click();
    await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
    await page.evaluate(() => {
      const status = document.querySelector('#cleanupStatus'), descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
      Object.defineProperty(status, 'textContent', { configurable: true, get() { return descriptor.get.call(this); }, set(value) {
        if (/^Operation .* · completed/.test(value)) { delete this.textContent; throw new Error('progress display failed'); }
        descriptor.set.call(this, value);
      } });
    });
    await page.locator('#btnConfirmCleanup').click();
    await page.waitForFunction(() => /Cleanup failed/.test(document.querySelector('#cleanupStatus').textContent));
    assert.match(await page.locator('#cleanupStatus').innerText(), /Confirmed completed 1 · 3 B/);
    assert.match(await page.locator('#cleanupStatus').innerText(), /progress display failed/);
    const after = await snapshotMockPair(page);
    assert.equal(after.target['.filenally'].versions['saved-1']['report.txt'], undefined);
    assert.equal(after.target['.filenally'].versions['saved-2']['report.txt'].content, 'old');
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().plan), null);
  });

  add('version storage UI stale cleanup attempt clears plan even before deletion is accepted', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    await compare(page);
    const settings = (await comparisonState(page)).storage;
    await page.locator('#btnVersions').click();
    await page.locator('[data-cleanup-id="saved-1"]').check();
    await page.locator('#btnPrepareCleanup').click();
    await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
    await page.evaluate(() => window.__mockPair.target.entries.get('.filenally').entries.get('index.json').content += ' ');
    const before = await snapshotMockPair(page);
    await page.locator('#btnConfirmCleanup').click();
    await page.waitForFunction(() => /실패|failed/.test(document.querySelector('#cleanupStatus').textContent));
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().plan), null);
    assert.deepEqual(await snapshotMockPair(page), before);
    assert.deepEqual((await comparisonState(page)).storage, settings);
  });

  add('version storage UI recovery writing has no stop and preserves pending files', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')], { schemaVersion: 2, cleanup: cleanupIntent() });
    await page.locator('#btnVersions').click();
    await page.locator('[data-recover-side="target"]').click();
    await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
    await page.evaluate(() => {
      const file = window.__mockPair.target.entries.get('.filenally').entries.get('index.json'), write = file.createWritable.bind(file);
      file.createWritable = async () => { await new Promise(resolve => window.__releaseRecovery = resolve); return write(); };
    });
    await page.locator('#btnConfirmCleanup').click();
    await page.waitForFunction(() => !!window.__releaseRecovery);
    assert.equal(await page.locator('#btnStopCleanup').isVisible(), false);
    await page.locator('#btnStopCleanup').dispatchEvent('click');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cleanupDialog').isVisible(), true);
    assert.equal(await page.locator('#btnCancelCleanup').isDisabled(), true);
    await page.evaluate(() => window.__releaseRecovery());
    await page.waitForFunction(() => !document.querySelector('#btnCancelCleanup').disabled);
    const after = await snapshotMockPair(page);
    assert.equal(after.target['.filenally'].versions['saved-1']['report.txt'].content, 'old');
    assert.equal(JSON.parse(after.target['.filenally']['index.json'].content).cleanup, null);
  });

  add('version storage UI unsupported identity leaves cleanup read-only with visible error', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    await compare(page);
    await page.evaluate(() => { window.__mockPair.target.entries.get('.filenally').isSameEntry = undefined; });
    await installComparisonMutationSpies(page);
    const before = await snapshotMockPair(page), state = await comparisonState(page);
    await page.locator('#btnVersions').click();
    await page.locator('[data-cleanup-id="saved-1"]').check();
    await page.locator('#btnPrepareCleanup').click();
    await page.waitForFunction(() => /실패|failed/.test(document.querySelector('#cleanupStatus').textContent));
    assert.match(await page.locator('#cleanupStatus').innerText(), /identity|isSameEntry/i);
    assert.equal(await page.locator('#btnConfirmCleanup').isDisabled(), true);
    await page.locator('#btnConfirmCleanup').dispatchEvent('click');
    await page.locator('#btnCancelCleanup').click();
    await page.locator('#btnCloseVersions').click();
    await assertComparisonReadOnly(page, before, state);
  });

  add('version storage UI replacement physical roots discard late old inspection', async ({ page }) => {
    await captureVersionAsyncClickCompletions(page);
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    await page.locator('#btnVersions').click();
    await page.waitForFunction(() => !document.querySelector('#btnVersionRefresh').disabled);
    await page.evaluate(() => {
      const folder = window.__mockPair.target.entries.get('.filenally'), values = folder.values.bind(folder);
      folder.values = async function* () { await new Promise(resolve => window.__releaseOldRoot = resolve); yield* values(); };
    });
    await page.locator('[data-inspect-side="target"]').click();
    await page.waitForFunction(() => !!window.__releaseOldRoot);
    await page.evaluate(() => document.querySelector('#versionDialog').close());
    await page.waitForFunction(() => !window.FileNallyTest.getModel().versionBusy);
    await mountCleanup(page, [cleanupFixture('replacement-1', 'replacement.txt', 'new root')]);
    await page.locator('#btnVersions').click();
    await page.locator('[data-cleanup-id="replacement-1"]').waitFor();
    await page.evaluate(() => window.__releaseOldRoot());
    await page.waitForFunction(() => window.__versionAsyncClickCompletions[0]?.done);
    assert.equal(await page.evaluate(() => window.__versionAsyncClickCompletions[0].status), 'fulfilled');
    assert.match(await page.locator('[data-usage-side="target"]').innerText(), /1.*8 B/);
    assert.doesNotMatch(await page.locator('#versionBody').innerText(), /saved-1/);
    assert.equal(await page.locator('#btnVersionRefresh').isEnabled(), true);
    assert.equal(await page.locator('#cleanupDialog').isVisible(), false);
  });

  add('version storage UI comparison excludes programmatic maintenance requests', async ({ page }) => {
    await mountVersion(page);
    await openVersionComparison(page);
    await page.locator('[data-inspect-side="target"]').dispatchEvent('click');
    await page.locator('#btnSelectVersionPage').dispatchEvent('click');
    await page.locator('#btnPrepareCleanup').dispatchEvent('click');
    await page.locator('#btnConfirmCleanup').dispatchEvent('click');
    assert.equal(await page.locator('#cleanupDialog').isVisible(), false);
    assert.equal(await page.locator('#comparisonDialog').isVisible(), true);
    await runVersionComparison(page);
    assert.match(await page.locator('#comparisonStatus').innerText(), /다릅니다|different/);
  });

  add('version storage UI dismissing write result preserves the pending parent refresh lock', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    await page.locator('#btnVersions').click();
    await page.locator('[data-cleanup-id="saved-1"]').check();
    await page.locator('#btnPrepareCleanup').click();
    await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
    await page.evaluate(() => {
      const root = window.__mockPair.source, read = root.getDirectoryHandle.bind(root); let held = false;
      root.getDirectoryHandle = async (...args) => {
        if (!held) { held = true; await new Promise(resolve => window.__releaseRefresh = resolve); }
        return read(...args);
      };
    });
    await page.locator('#btnConfirmCleanup').click();
    await page.waitForFunction(() => !!window.__releaseRefresh);
    await page.locator('#btnCancelCleanup').click();
    assert.equal(await page.locator('#btnVersionRefresh').isDisabled(), true);
    await page.locator('[data-inspect-side="target"]').dispatchEvent('click');
    assert.equal(await page.locator('#cleanupDialog').isVisible(), false);
    await page.evaluate(() => window.__releaseRefresh());
    await page.waitForFunction(() => !document.querySelector('#btnVersionRefresh').disabled);
    assert.match(await page.locator('[data-usage-side="target"]').innerText(), /1.*3 B/);
  });

  add('version storage UI recovery failure reports operation root and preserves files', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')], { schemaVersion: 2, cleanup: cleanupIntent() });
    await compare(page);
    await page.locator('#btnVersions').click();
    await page.locator('[data-recover-side="target"]').click();
    await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
    await page.evaluate(() => window.__setMockFailure({ operation: 'write', name: 'index.json' }));
    const before = await snapshotMockPair(page);
    await page.locator('#btnConfirmCleanup').click();
    await page.waitForFunction(() => /실패|failed/.test(document.querySelector('#cleanupStatus').textContent));
    const result = await page.locator('#cleanupStatus').innerText();
    assert.match(result, /cleanup-1/); assert.match(result, /target/);
    assert.deepEqual(await snapshotMockPair(page), before);
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().plan), null);
  });

  add('version storage UI acknowledged last deletion removes only the selected stored file', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    await page.locator('#btnVersions').click();
    await page.locator('[data-cleanup-id="saved-1"]').check();
    await page.locator('#btnPrepareCleanup').click();
    await page.locator('#cleanupLastWarning').waitFor({ state: 'visible' });
    await page.locator('#cleanupLastAcknowledged').check();
    await page.locator('#btnConfirmCleanup').click();
    await page.waitForFunction(() => /확인된 완료 1|Confirmed completed 1/.test(document.querySelector('#cleanupStatus').textContent));
    const after = await snapshotMockPair(page);
    assert.equal(await page.locator('#cleanupLastWarning').isVisible(), false);
    assert.deepEqual(after.target['.filenally'].versions['saved-1'], {});
    assert.equal(after.target['report.txt'].content, 'target-current');
    assert.deepEqual(JSON.parse(after.target['.filenally']['index.json'].content).versions, []);
  });

  add('version storage UI reopened scrolling manager shows its full heading', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1000 });
    await page.locator('#btnLangEn').click();
    await mountCleanup(page, Array.from({ length: 101 }, (_, i) => cleanupFixture(`saved-${i}`, `long-path-${i}.txt`)));
    await page.locator('#btnVersions').click();
    await page.waitForFunction(() => !document.querySelector('#btnVersionRefresh').disabled);
    await page.locator('#versionDialog > .run-detail-surface').evaluate(el => { el.scrollTop = 200; });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.FileNallyTest.getModel().versionBusy);
    await page.locator('#btnVersions').click();
    await page.waitForFunction(() => !document.querySelector('#btnVersionRefresh').disabled);
    assert.equal(await page.locator('#versionTitle').evaluate(el => el.getBoundingClientRect().top >= document.querySelector('#versionDialog').getBoundingClientRect().top), true);
  });

  add('version storage UI restore keeps its own confirm enabled and excludes maintenance', async ({ page }) => {
    await mountVersion(page);
    await page.locator('#btnVersions').click();
    await page.locator('[data-version-action="restore"]').click();
    await page.locator('#restoreDialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#btnConfirmRestore').isEnabled(), true);
    await page.locator('[data-inspect-side="target"]').dispatchEvent('click');
    await page.locator('#btnSelectVersionPage').dispatchEvent('click');
    await page.locator('#btnPrepareCleanup').dispatchEvent('click');
    assert.equal(await page.locator('#cleanupDialog').isVisible(), false);
    await page.locator('#btnCancelRestore').click();
  });

  add('version manager cancel is read-only and confirmed restore invalidates comparison', async ({ page }) => {
    await mountVersion(page);
    await compare(page);
    assert.equal(await page.locator('#tgtFileBody .file-name').count(), 1);
    const before = await snapshotMockPair(page);
    await page.locator('#btnVersions').click();
    await page.locator('[data-version-action="restore"]').first().click();
    await page.locator('#restoreDialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#restoreSummary').innerText(), /report\.txt/);
    assert.match(await page.locator('#restoreSummary').innerText(), /7 B/);
    await page.locator('#btnCancelRestore').click();
    assert.deepEqual(await snapshotMockPair(page), before);
    await page.locator('[data-version-action="restore"]').first().click();
    await page.locator('#btnConfirmRestore').click();
    await page.waitForFunction(() => !document.querySelector('#restoreDialog').open);
    const after = await snapshotMockPair(page);
    assert.equal(after.target['report.txt'].content, 'old');
    const index = JSON.parse(after.target['.filenally']['index.json'].content);
    assert.equal(index.versions.length, 2);
    assert.equal(index.versions[1].reason, 'before-restore');
    assert.match(await page.locator('#versionStatus').innerText(), new RegExp(index.versions[1].id));
    await page.locator('#btnCloseVersions').click();
    await page.waitForFunction(() => document.activeElement.id === 'btnVersions');
    assert.equal(await page.locator('#btnSync').isDisabled(), true);
    assert.equal(await page.locator('#srcFileBody .file-name, #tgtFileBody .file-name').count(), 0);
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().plan), null);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btnVersions');
  });

  add('version manager merges physical roots newest first with 100-row paging and partial errors', async ({ page }) => {
    await mountVersion(page);
    await page.evaluate(() => {
      const versions = Array.from({ length: 100 }, (_, i) => ({ ...window.__versionRecord,
        id: `source-${i}`, storedPath: `versions/source-${i}/report.txt`, capturedAt: new Date(Date.UTC(2026, 8, 14, 0, 0, i)).toISOString() }));
      window.__setMockFile('source', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions }) });
    });
    await page.locator('#btnVersions').click();
    await page.waitForFunction(() => document.querySelectorAll('#versionBody tr').length === 100);
    assert.match(await page.locator('#versionBody tr').first().innerText(), /source-99/);
    assert.match(await page.locator('#versionBody tr').first().innerText(), /원본|Source/);
    await page.locator('#btnVersionNext').click();
    assert.equal(await page.locator('#versionBody tr').count(), 1);
    assert.match(await page.locator('#versionBody').innerText(), /대상|Target/);
    await page.evaluate(() => window.__setMockFile('source', '.filenally/index.json', { content: '{' }));
    await page.locator('#btnVersionRefresh').click();
    await page.waitForFunction(() => /source|원본/i.test(document.querySelector('#versionStatus').textContent));
    assert.equal(await page.locator('#versionBody tr').count(), 1);
  });

  for (const content of ['한글\u0000é\r\n', 'binary']) {
    add(`version manager download preserves exact ${content === 'binary' ? 'binary' : 'UTF-8'} bytes`, async ({ page }) => {
      await mountVersion(page, { content });
      if (content === 'binary') await page.evaluate(() => {
        const entry = window.__mockPair.target.entries.get('.filenally').entries.get('versions').entries.get('saved-1').entries.get('report.txt');
        entry.getFile = async () => new File([new Uint8Array([0, 255, 128, 13, 10, 1])], 'report.txt', { lastModified: 100 });
      });
      await page.locator('#btnVersions').click();
      const pending = page.waitForEvent('download');
      await page.locator('[data-version-action="download"]').first().click();
      const download = await pending;
      assert.equal(download.suggestedFilename(), 'report.txt');
      const bytes = await fs.readFile(await download.path());
      assert.deepEqual(bytes, content === 'binary' ? Buffer.from([0, 255, 128, 13, 10, 1]) : Buffer.from(content));
    });
  }

  add('version manager restores missing files only after confirmation and follows root after swap', async ({ page }) => {
    await mountVersion(page, { missing: true });
    await page.locator('#btnSwapFolders').click();
    await page.locator('#btnVersions').click();
    await page.locator('[data-version-action="restore"]').first().click();
    await page.locator('#restoreDialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#restoreSummary').innerText(), /원본|Source/);
    assert.match(await page.locator('#restoreSummary').innerText(), /새 파일|new file/i);
    assert.equal((await snapshotMockPair(page)).target['report.txt'], undefined);
    await page.locator('#btnConfirmRestore').click();
    await page.waitForFunction(() => !document.querySelector('#restoreDialog').open);
    const after = await snapshotMockPair(page);
    assert.equal(after.target['report.txt'].content, 'old');
    assert.equal(after.source['report.txt'], undefined);
  });

  for (const failure of ['stale', 'permission', 'backup', 'write']) {
    add(`version manager ${failure} failure clears confirmation and permits fresh retry`, async ({ page }) => {
      await mountVersion(page);
      await page.locator('#btnVersions').click();
      await page.locator('[data-version-action="restore"]').first().click();
      await page.locator('#restoreDialog').waitFor({ state: 'visible' });
      await page.evaluate((failure) => {
        if (failure === 'stale') window.__mockPair.target.entries.get('report.txt').content = 'changed';
        if (failure === 'permission') window.__setMockPermission('target', { state: 'denied', requestResult: 'denied' });
        if (failure === 'backup') window.__setMockFailure({ operation: 'close', name: 'index.json' });
        if (failure === 'write') window.__setMockFailure({ operation: 'write', name: 'report.txt', occurrence: 2 });
      }, failure);
      await page.locator('#btnConfirmRestore').click();
      await page.waitForFunction(() => !document.querySelector('#restoreDialog').open);
      assert.match(await page.locator('#versionStatus').innerText(), /실패|failed/i);
      if (failure === 'write') assert.match(await page.locator('#versionStatus').innerText(), /\.filenally\/versions\//);
      await page.evaluate(() => { window.__mockFailure = null; window.__setMockPermission('target', { state: 'granted' }); });
      await page.locator('#versionBody tr').filter({ hasText: 'saved-1' }).locator('[data-version-action="restore"]').click();
      await page.locator('#btnConfirmRestore').click();
      await page.waitForFunction(() => !document.querySelector('#restoreDialog').open);
      assert.equal((await snapshotMockPair(page)).target['report.txt'].content, 'old');
    });
  }

  add('version manager busy restore excludes controller operations and duplicate confirmation', async ({ page }) => {
    await mountVersion(page);
    await compare(page);
    await page.locator('#btnVersions').click();
    await page.locator('[data-version-action="restore"]').first().click();
    await page.locator('#restoreDialog').waitFor({ state: 'visible' });
    await page.evaluate(() => { window.__mockPair.target.entries.get('report.txt').writeDelay = 200; });
    await page.locator('#btnConfirmRestore').click();
    await page.evaluate(async () => {
      document.querySelector('#btnConfirmRestore').click();
      const controller = window.FileNallyTest.Controller;
      window.__configBeforeRestore = JSON.parse(localStorage.getItem('smart_sync_state')).config;
      document.querySelector('#syncDirection').value = 'reverse';
      document.querySelector('#syncDirection').dispatchEvent(new Event('change'));
      document.querySelector('#excludeDirs').value = 'different';
      document.querySelector('#excludeDirs').dispatchEvent(new Event('input'));
      await Promise.all([controller.pick('source'), controller.swapFolders(), controller.compare(), controller.sync(),
        controller.importState(new File(['{}'], 'state.json')), controller.selectProfile(window.FileNallyTest.getModel().profileId)]);
    });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#btnCancelRestore').isDisabled(), true);
    await page.waitForFunction(() => !document.querySelector('#restoreDialog').open);
    const after = await snapshotMockPair(page);
    assert.equal(after.target['report.txt'].content, 'old');
    assert.equal(JSON.parse(after.target['.filenally']['index.json'].content).versions.length, 2);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('smart_sync_state')).config), await page.evaluate(() => window.__configBeforeRestore));
    assert.equal(await page.locator('#btnVersionRefresh').isEnabled(), true);
  });

  for (const action of ['download', 'restore']) {
    for (const moveFocus of [false, true]) {
      add(`version manager keyboard ${action === 'download' ? 'download' : 'failed preparation'} ${moveFocus ? 'preserves intentional focus elsewhere' : 'returns focus to its trigger'}`, async ({ page }) => {
        await mountVersion(page);
        await page.evaluate(action => {
          const root = window.__mockPair.target;
          const file = action === 'download'
            ? root.entries.get('.filenally').entries.get('versions').entries.get('saved-1').entries.get('report.txt')
            : root.entries.get('report.txt');
          const getFile = file.getFile.bind(file);
          file.getFile = async () => {
            await new Promise(resolve => { window.__releaseKeyboardRead = resolve; });
            if (action === 'restore') throw new DOMException('Current file is unreadable', 'NotAllowedError');
            return getFile();
          };
        }, action);
        await page.locator('#btnVersions').click();
        const trigger = page.locator(`[data-version-action="${action}"]`).first();
        await trigger.focus();
        const download = action === 'download' ? page.waitForEvent('download') : null;
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => typeof window.__releaseKeyboardRead === 'function');
        if (moveFocus) await page.locator('#btnCloseVersions').focus();
        await page.evaluate(() => window.__releaseKeyboardRead());
        if (download) await download;
        await page.waitForFunction(() => !document.querySelector('#btnVersionRefresh').disabled);
        assert.equal(await page.locator('#restoreDialog').isVisible(), false);
        assert.equal(await page.evaluate(({ action, moveFocus }) => document.activeElement === document.querySelector(moveFocus ? '#btnCloseVersions' : `[data-version-action="${action}"]`), { action, moveFocus }), true);
        if (action === 'restore') assert.match(await page.locator('#versionStatus').innerText(), /Current file is unreadable/);
      });
    }
  }

  add('version manager close and reopen discard delayed preparation and preserve keyboard focus', async ({ page }) => {
    await mountVersion(page);
    await page.evaluate(() => {
      const file = window.__mockPair.target.entries.get('report.txt');
      const getFile = file.getFile.bind(file);
      file.getFile = async () => { await new Promise(resolve => { window.__releaseVersionRead = resolve; }); return getFile(); };
    });
    const before = await snapshotMockPair(page);
    await page.locator('#btnVersions').click();
    await page.locator('[data-version-action="restore"]').first().click();
    await page.waitForFunction(() => typeof window.__releaseVersionRead === 'function');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement.id === 'btnVersions');
    await page.locator('#btnVersions').click();
    await page.waitForFunction(() => !document.querySelector('#btnVersionRefresh').disabled);
    await page.evaluate(() => window.__releaseVersionRead());
    await page.waitForTimeout(30);
    assert.equal(await page.locator('#restoreDialog').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseVersions');
    assert.deepEqual(await snapshotMockPair(page), before);
  });

  for (const operation of ['pick', 'import', 'profile']) {
    add(`version manager cannot open during pending ${operation}`, async ({ page }) => {
      await mountVersion(page);
      await page.evaluate(operation => {
        const controller = window.FileNallyTest.Controller;
        const pending = () => new Promise(resolve => { window.__releaseAppOperation = resolve; });
        if (operation === 'pick') { window.showDirectoryPicker = pending; window.__pendingOperation = controller.pick('source'); }
        if (operation === 'import') window.__pendingOperation = controller.importState({ size: 2, text: pending });
        if (operation === 'profile') {
          window.__setMockPermission('source', { state: 'prompt' });
          window.__mockPair.source.requestPermission = pending;
          window.__pendingOperation = controller.selectProfile(window.FileNallyTest.getModel().profileId);
        }
      }, operation);
      assert.equal(await page.locator('#btnVersions').isDisabled(), true);
      await page.evaluate(() => document.querySelector('#btnVersions').click());
      assert.equal(await page.locator('#versionDialog').isVisible(), false);
      await page.evaluate(async operation => {
        window.__releaseAppOperation(operation === 'pick' ? window.__mockPair.source : operation === 'profile' ? 'granted' : '{}');
        await window.__pendingOperation;
      }, operation);
    });
  }

  for (const lang of ['ko', 'en']) {
    add(`version manager ${lang} labels and hostile filenames remain text with Escape cancellation`, async ({ page }) => {
      await mountVersion(page, { path: '<img src=x onerror=alert(1)>.txt', missing: true });
      await page.locator(lang === 'ko' ? '#btnLangKo' : '#btnLangEn').click();
      const before = await snapshotMockPair(page);
      await page.locator('#btnVersions').click();
      assert.equal(await page.getByRole('dialog', { name: lang === 'ko' ? '버전 관리' : 'Version manager', exact: true }).count(), 1);
      assert.equal(await page.locator('#versionBody img').count(), 0);
      await page.locator('[data-version-action="restore"]').first().click();
      await page.locator('#restoreDialog').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement.dataset.versionAction === 'restore');
      assert.equal(await page.locator('#restoreDialog').isVisible(), false);
      assert.equal(await page.locator('#versionDialog').isVisible(), true);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.versionAction), 'restore');
      await page.keyboard.press('Escape');
      assert.deepEqual(await snapshotMockPair(page), before);
    });
  }

  for (const missing of ['store', 'index']) {
    add(`version reader missing ${missing} is empty without writes`, async ({ page }) => {
      await mountPair(page, { source: {}, target: missing === 'index' ? { '.filenally': { type: 'directory' } } : {} });
      const before = await snapshotMockPair(page);
      assert.deepEqual(await page.evaluate(() => window.FileNallyTest.VersionStore.list(window.__mockPair.target)), []);
      assert.deepEqual(await snapshotMockPair(page), before);
    });
  }

  add('version reader returns exact stored bytes without writes', async ({ page }) => {
    await mountVersion(page, { content: '\u0000é\r\n' });
    const before = await snapshotMockPair(page);
    const result = await page.evaluate(async () => {
      const store = window.FileNallyTest.VersionStore;
      const records = await store.list(window.__mockPair.target);
      return [...new Uint8Array(await (await store.read(window.__mockPair.target, records[0])).arrayBuffer())];
    });
    assert.deepEqual(result, [0, 195, 169, 13, 10]);
    assert.deepEqual(await snapshotMockPair(page), before);
  });

  add('version comparison store pins current snapshots without writes', async ({ page }) => {
    await mountVersion(page);
    const before = await snapshotMockPair(page);
    const result = await page.evaluate(async () => {
      const calls = window.__getPermissionCalls();
      const store = window.FileNallyTest.VersionStore;
      const snapshot = await store.prepareComparison(window.__mockPair.target, window.__versionRecord);
      await store.validateComparison(snapshot);
      return { left: await snapshot.left.file.text(), right: await snapshot.right.file.text(),
        path: snapshot.path, kinds: [snapshot.left.kind, snapshot.right.kind],
        frozen: Object.isFrozen(snapshot) && Object.isFrozen(snapshot.left),
        times: [snapshot.left.readAt, snapshot.right.readAt],
        callsBefore: calls, callsAfter: window.__getPermissionCalls() };
    });
    assert.equal(result.left, 'old'); assert.equal(result.right, 'current');
    assert.equal(result.path, 'report.txt'); assert.equal(result.frozen, true);
    assert.deepEqual(result.kinds, ['version', 'current']);
    assert.ok(result.times.every((value) => Number.isFinite(Date.parse(value))));
    assert.deepEqual(result.callsAfter, result.callsBefore);
    assert.deepEqual(await snapshotMockPair(page), before);
  });

  add('version comparison store rejects observed replacement without rereading bytes', async ({ page }) => {
    await mountVersion(page);
    const error = await page.evaluate(async () => {
      const store = window.FileNallyTest.VersionStore;
      const snapshot = await store.prepareComparison(window.__mockPair.target, window.__versionRecord);
      for (const side of [snapshot.left, snapshot.right]) {
        side.file.arrayBuffer = () => { throw new Error('Unexpected byte reread'); };
        side.file.slice = () => { throw new Error('Unexpected byte reread'); };
      }
      await store.validateComparison(snapshot);
      window.__setMockFile('target', 'report.txt', { content: 'changed', lastModified: 201 });
      try { await store.validateComparison(snapshot); return ''; }
      catch (error) { return error.message; }
    });
    assert.match(error, /changed/);
  });

  for (const missing of [false, true]) {
    add(`version comparison store distinguishes empty and absent current: ${missing}`, async ({ page }) => {
      await mountVersion(page, { missing });
      if (!missing) await page.evaluate(() => window.__setMockFile('target', 'report.txt', { content: '' }));
      const before = await snapshotMockPair(page);
      const result = await page.evaluate(async () => {
        const store = window.FileNallyTest.VersionStore;
        const value = await store.prepareComparison(window.__mockPair.target, window.__versionRecord);
        await store.validateComparison(value);
        return value.right.file ? value.right.file.size : null;
      });
      assert.equal(result, missing ? null : 0);
      assert.deepEqual(await snapshotMockPair(page), before);
    });
  }

  add('version comparison store choices keep same-root path and deterministic order', async ({ page }) => {
    await mountVersion(page);
    await page.evaluate(() => {
      const selected = window.__versionRecord;
      const make = (id, capturedAt, originalPath = selected.originalPath) => ({ ...selected, id, capturedAt,
        originalPath, storedPath: `versions/${id}/${originalPath}` });
      const local = [make('same-z', '2026-09-12T00:00:00.000Z'), make('same-a', '2026-09-12T00:00:00.000Z'),
        make('newer', '2026-09-14T00:00:00.000Z'), make('other-path', '2026-09-15T00:00:00.000Z', 'other.txt')];
      window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [selected, ...local] }) });
      window.__setMockFile('source', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [make('wrong-root', '2026-09-16T00:00:00.000Z')] }) });
    });
    const before = await snapshotMockPair(page);
    const callsBefore = await page.evaluate(() => window.__getPermissionCalls());
    const result = await page.evaluate(() => window.FileNallyTest.VersionStore.comparisonChoices(window.__mockPair.target, window.__versionRecord)
      .then((choices) => choices.map((record) => record.id)));
    assert.deepEqual(result, ['newer', 'same-a', 'same-z']);
    assert.deepEqual(await snapshotMockPair(page), before);
    assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), callsBefore);
  });

  add('version comparison store returns every historical counterpart deterministically', async ({ page }) => {
    await mountVersion(page);
    await page.evaluate(() => {
      const selected = window.__versionRecord;
      const records = Array.from({ length: 101 }, (_, index) => ({ ...selected, id: `older-${String(index).padStart(3, '0')}`,
        capturedAt: new Date(Date.UTC(2026, 8, 12, 0, 0, 0) - index * 1000).toISOString(),
        storedPath: `versions/older-${String(index).padStart(3, '0')}/${selected.originalPath}` }));
      window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [selected, ...records] }) });
    });
    const before = await snapshotMockPair(page);
    const callsBefore = await page.evaluate(() => window.__getPermissionCalls());
    const result = await page.evaluate(() => window.FileNallyTest.VersionStore.comparisonChoices(window.__mockPair.target, window.__versionRecord)
      .then((choices) => ({ count: choices.length, first: choices[0].id, last: choices.at(-1).id })));
    assert.equal(result.count, 101);
    assert.equal(result.first, 'older-000');
    assert.equal(result.last, 'older-100');
    assert.deepEqual(await snapshotMockPair(page), before);
    assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), callsBefore);
  });

  for (const counterpart of ['same', 'other-path', 'wrong-root', 'changed-record']) {
    add(`version comparison store rejects ${counterpart} counterpart`, async ({ page }) => {
      await mountVersion(page);
      const result = await page.evaluate(async (counterpart) => {
        const store = window.FileNallyTest.VersionStore;
        const selected = window.__versionRecord;
        const other = { ...selected, id: 'other-1', storedPath: `versions/other-1/${selected.originalPath}` };
        if (counterpart === 'other-path') { other.originalPath = 'other.txt'; other.storedPath = 'versions/other-1/other.txt'; }
        if (counterpart === 'changed-record') { other.runId = 'changed'; }
        const indexedOther = counterpart === 'changed-record' ? { ...other, runId: selected.runId } : other;
        if (counterpart === 'wrong-root') {
          window.__setMockFile('source', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [indexedOther] }) });
          window.__setMockFile('source', `.filenally/${indexedOther.storedPath}`, { content: 'other' });
        } else {
          window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [selected, indexedOther] }) });
          window.__setMockFile('target', `.filenally/${indexedOther.storedPath}`, { content: 'other' });
        }
        const before = await window.__snapshotMockPair();
        const callsBefore = window.__getPermissionCalls();
        try {
          await store.prepareComparison(window.__mockPair.target, selected, counterpart === 'same' ? selected : other);
          return { message: 'accepted', before, after: await window.__snapshotMockPair(), callsBefore, callsAfter: window.__getPermissionCalls() };
        } catch (error) {
          return { message: error.message, before, after: await window.__snapshotMockPair(), callsBefore, callsAfter: window.__getPermissionCalls() };
        }
      }, counterpart);
      if (counterpart === 'changed-record' || counterpart === 'wrong-root') assert.equal(result.message, 'Selected version record changed');
      else assert.notEqual(result.message, 'accepted');
      assert.deepEqual(result.after, result.before);
      assert.deepEqual(result.callsAfter, result.callsBefore);
    });
  }

  add('version comparison store cancellation aborts after a pending read', async ({ page }) => {
    await mountVersion(page);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target;
      const original = root.getDirectoryHandle.bind(root);
      let cancelled = false;
      let calls = 0;
      root.getDirectoryHandle = async (...args) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return original(...args);
      };
      const before = await window.__snapshotMockPair();
      const callsBefore = window.__getPermissionCalls();
      const pending = window.FileNallyTest.VersionStore.comparisonChoices(root, window.__versionRecord, { isCancelled: () => cancelled });
      await new Promise((resolve) => setTimeout(resolve, 0));
      cancelled = true;
      try { await pending; return { name: '', calls, before, after: await window.__snapshotMockPair(), callsBefore, callsAfter: window.__getPermissionCalls() }; }
      catch (error) { return { name: error.name, message: error.message, calls, before, after: await window.__snapshotMockPair(), callsBefore, callsAfter: window.__getPermissionCalls() }; }
    });
    assert.equal(result.name, 'AbortError');
    assert.equal(result.message, 'Comparison stopped');
    assert.equal(result.calls, 1);
    assert.deepEqual(result.after, result.before);
    assert.deepEqual(result.callsAfter, result.callsBefore);
  });

  add('version comparison store historical snapshots stay on the owning root', async ({ page }) => {
    await mountVersion(page);
    await page.evaluate(() => {
      const selected = window.__versionRecord;
      const counterpart = { ...selected, id: 'other-root', storedPath: `versions/other-root/${selected.originalPath}` };
      window.__setMockFile('source', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [counterpart] }) });
      window.__setMockFile('source', `.filenally/${counterpart.storedPath}`, { content: 'bad', lastModified: 100 });
      window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [selected, counterpart] }) });
      window.__setMockFile('target', `.filenally/${counterpart.storedPath}`, { content: 'yes', lastModified: 100 });
    });
    const before = await snapshotMockPair(page);
    const callsBefore = await page.evaluate(() => window.__getPermissionCalls());
    const result = await page.evaluate(async () => {
      const snapshot = await window.FileNallyTest.VersionStore.prepareComparison(window.__mockPair.target,
        window.__versionRecord, { ...window.__versionRecord, id: 'other-root', storedPath: `versions/other-root/${window.__versionRecord.originalPath}` });
      return { text: await snapshot.right.file.text(), path: snapshot.path };
    });
    assert.deepEqual(result, { text: 'yes', path: 'report.txt' });
    assert.deepEqual(await snapshotMockPair(page), before);
    assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), callsBefore);
  });

  for (const fixture of ['missing store', 'missing index', 'unsupported schema', 'invalid JSON', 'duplicate IDs']) {
    add(`version comparison store rejects ${fixture}`, async ({ page }) => {
      if (fixture === 'missing store') {
        await mountPair(page, { source: {}, target: { 'report.txt': { content: 'current' } } });
        await page.evaluate((record) => { window.__versionRecord = record; }, versionFixture().record);
      } else await mountVersion(page);
      await page.evaluate((fixture) => {
        if (fixture === 'missing index') window.__deleteMockEntry('target', '.filenally/index.json');
        if (fixture === 'unsupported schema') window.__setMockFile('target', '.filenally/index.json', { content: '{"schemaVersion":2,"versions":[]}' });
        if (fixture === 'invalid JSON') window.__setMockFile('target', '.filenally/index.json', { content: '{' });
        if (fixture === 'duplicate IDs') window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [window.__versionRecord, window.__versionRecord] }) });
      }, fixture);
      const before = await snapshotMockPair(page);
      const callsBefore = await page.evaluate(() => window.__getPermissionCalls());
      const result = await page.evaluate(async () => {
        try { await window.FileNallyTest.VersionStore.comparisonChoices(window.__mockPair.target, window.__versionRecord); return ''; }
        catch (error) { return error.message; }
      });
      if (fixture === 'missing store') assert.equal(result, 'Selected version record changed');
      if (fixture === 'missing index') assert.equal(result, 'Selected version record changed');
      if (fixture === 'unsupported schema') assert.equal(result, 'Unsupported version index');
      if (fixture === 'duplicate IDs') assert.equal(result, 'Duplicate version IDs');
      if (fixture === 'invalid JSON') assert.match(result, /JSON|token|end/i);
      assert.deepEqual(await snapshotMockPair(page), before);
      assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), callsBefore);
    });
  }

  for (const unsafePath of ['.FILENALLY/index.json', 'nested/.Trash/x', 'nested/../report.txt', 'nested\\report.txt', 'nested\0report.txt']) {
    add(`version comparison store rejects unsafe path ${JSON.stringify(unsafePath)}`, async ({ page }) => {
      await mountVersion(page, { path: unsafePath });
      const before = await snapshotMockPair(page);
      const callsBefore = await page.evaluate(() => window.__getPermissionCalls());
      const result = await page.evaluate(async () => {
        try { await window.FileNallyTest.VersionStore.prepareComparison(window.__mockPair.target, window.__versionRecord); return ''; }
        catch (error) { return error.message; }
      });
      assert.match(result, /Unsafe/);
      assert.deepEqual(await snapshotMockPair(page), before);
      assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), callsBefore);
    });
  }

  for (const failure of ['missing stored file', 'stored size changed', 'stored directory', 'denied getFile']) {
    add(`version comparison store rejects ${failure}`, async ({ page }) => {
      await mountVersion(page);
      await page.evaluate((failure) => {
        const record = window.__versionRecord;
        const path = `.filenally/${record.storedPath}`;
        if (failure === 'missing stored file') window.__deleteMockEntry('target', path);
        if (failure === 'stored size changed') window.__setMockFile('target', path, { content: 'larger', lastModified: 100 });
        if (failure === 'stored directory') {
          window.__deleteMockEntry('target', path);
          const parts = path.split('/');
          const name = parts.pop();
          let directory = window.__mockPair.target;
          for (const part of parts) directory = directory.entries.get(part);
          directory.entries.set(name, { kind: 'directory', name, entries: new Map(), isSameEntry: async function (other) { return this === other; } });
        }
        if (failure === 'denied getFile') {
          const parts = path.split('/');
          const name = parts.pop();
          let directory = window.__mockPair.target;
          for (const part of parts) directory = directory.entries.get(part);
          directory.entries.get(name).getFile = async () => { throw new DOMException('Denied stored read', 'NotAllowedError'); };
        }
      }, failure);
      const before = await snapshotMockPair(page);
      const callsBefore = await page.evaluate(() => window.__getPermissionCalls());
      const result = await page.evaluate(async () => {
        try { await window.FileNallyTest.VersionStore.prepareComparison(window.__mockPair.target, window.__versionRecord); return ''; }
        catch (error) { return { name: error.name, message: error.message }; }
      });
      if (failure === 'stored size changed') assert.equal(result.message, 'Stored version size changed');
      if (failure === 'denied getFile') assert.deepEqual(result, { name: 'NotAllowedError', message: 'Denied stored read' });
      if (failure === 'missing stored file') assert.equal(result.name, 'NotFoundError');
      if (failure === 'stored directory') assert.equal(result.name, 'TypeMismatchError');
      assert.deepEqual(await snapshotMockPair(page), before);
      assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), callsBefore);
    });
  }

  for (const mutation of ['appears', 'disappears', 'replaced handle', 'size changes', 'type changes', 'mtime changes']) {
    add(`version comparison store validates current ${mutation}`, async ({ page }) => {
      await mountVersion(page, { missing: mutation === 'appears' });
      const snapshotReady = await page.evaluate(async () => {
        window.__comparisonSnapshot = await window.FileNallyTest.VersionStore.prepareComparison(window.__mockPair.target, window.__versionRecord);
        return { rightHasFile: Boolean(window.__comparisonSnapshot.right.file) };
      });
      assert.equal(snapshotReady.rightHasFile, mutation !== 'appears');
      await page.evaluate((mutation) => {
        const root = window.__mockPair.target;
        if (mutation === 'appears') window.__setMockFile('target', 'report.txt', { content: 'current', lastModified: 200 });
        if (mutation === 'disappears') window.__deleteMockEntry('target', 'report.txt');
        if (mutation === 'replaced handle') window.__setMockFile('target', 'report.txt', { content: 'current', lastModified: 200 });
        if (mutation === 'size changes') root.entries.get('report.txt').content = 'different-size';
        if (mutation === 'type changes') root.entries.get('report.txt').getFile = async () => new File([root.entries.get('report.txt').content], 'report.txt', { type: 'application/custom', lastModified: 200 });
        if (mutation === 'mtime changes') root.entries.get('report.txt').lastModified = 201;
      }, mutation);
      const before = await snapshotMockPair(page);
      const callsBefore = await page.evaluate(() => window.__getPermissionCalls());
      const result = await page.evaluate(async () => {
        try { await window.FileNallyTest.VersionStore.validateComparison(window.__comparisonSnapshot); return ''; }
        catch (error) { return { name: error.name, message: error.message }; }
      });
      assert.equal(result.message, mutation === 'replaced handle' ? 'Comparison file identity changed' : 'Comparison file changed');
      assert.deepEqual(await snapshotMockPair(page), before);
      assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), callsBefore);
    });
  }

  add('version comparison store validates current replacement identity', async ({ page }) => {
    await mountVersion(page);
    await page.evaluate(async () => { window.__comparisonSnapshot = await window.FileNallyTest.VersionStore.prepareComparison(window.__mockPair.target, window.__versionRecord); });
    await page.evaluate(() => window.__setMockFile('target', 'report.txt', { content: 'current', lastModified: 200 }));
    const before = await snapshotMockPair(page);
    const callsBefore = await page.evaluate(() => window.__getPermissionCalls());
    const result = await page.evaluate(async () => {
      try { await window.FileNallyTest.VersionStore.validateComparison(window.__comparisonSnapshot); return ''; }
      catch (error) { return error.message; }
    });
    assert.equal(result, 'Comparison file identity changed');
    assert.deepEqual(await snapshotMockPair(page), before);
    assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), callsBefore);
  });

  for (const mutation of ['disappears', 'replaced handle', 'size changes', 'type changes', 'mtime changes', 'read denied']) {
    add(`version comparison store validates stored version ${mutation}`, async ({ page }) => {
      await mountVersion(page);
      await page.evaluate(async () => { window.__comparisonSnapshot = await window.FileNallyTest.VersionStore.prepareComparison(window.__mockPair.target, window.__versionRecord); });
      await page.evaluate((mutation) => {
        const root = window.__mockPair.target;
        const path = `.filenally/${window.__versionRecord.storedPath}`;
        const parts = path.split('/');
        const name = parts.pop();
        let directory = root;
        for (const part of parts) directory = directory.entries.get(part);
        const stored = directory.entries.get(name);
        if (mutation === 'disappears') directory.entries.delete(name);
        if (mutation === 'replaced handle') window.__setMockFile('target', path, { content: 'old', lastModified: 100 });
        if (mutation === 'size changes') stored.content = 'changed-size';
        if (mutation === 'type changes') stored.getFile = async () => new File([stored.content], 'report.txt', { type: 'application/custom', lastModified: stored.lastModified });
        if (mutation === 'mtime changes') stored.lastModified = 101;
        if (mutation === 'read denied') stored.getFile = async () => { throw new DOMException('Denied stored read', 'NotAllowedError'); };
      }, mutation);
      const before = await snapshotMockPair(page);
      const callsBefore = await page.evaluate(() => window.__getPermissionCalls());
      const result = await page.evaluate(async () => {
        try { await window.FileNallyTest.VersionStore.validateComparison(window.__comparisonSnapshot); return ''; }
        catch (error) { return { name: error.name, message: error.message }; }
      });
      if (mutation === 'disappears') assert.equal(result.name, 'NotFoundError');
      else if (mutation === 'replaced handle') assert.equal(result.message, 'Comparison file identity changed');
      else if (mutation === 'read denied') assert.deepEqual(result, { name: 'NotAllowedError', message: 'Denied stored read' });
      else if (mutation === 'size changes') assert.equal(result.message, 'Stored version size changed');
      else assert.equal(result.message, 'Comparison file changed');
      assert.deepEqual(await snapshotMockPair(page), before);
      assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), callsBefore);
    });
  }

  add('version comparison store rejects a selected index record changed during analysis', async ({ page }) => {
    await mountVersion(page);
    await page.evaluate(async () => { window.__comparisonSnapshot = await window.FileNallyTest.VersionStore.prepareComparison(window.__mockPair.target, window.__versionRecord); });
    await page.evaluate(() => {
      window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [{ ...window.__versionRecord, runId: 'changed-in-index' }] }) });
    });
    const before = await snapshotMockPair(page);
    const callsBefore = await page.evaluate(() => window.__getPermissionCalls());
    const result = await page.evaluate(async () => {
      try { await window.FileNallyTest.VersionStore.validateComparison(window.__comparisonSnapshot); return ''; }
      catch (error) { return error.message; }
    });
    assert.equal(result, 'Selected version record changed');
    assert.deepEqual(await snapshotMockPair(page), before);
    assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), callsBefore);
  });

  add('version comparison store cancellation stops during delayed index read before stored read', async ({ page }) => {
    await mountVersion(page);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target;
      const index = root.entries.get('.filenally').entries.get('index.json');
      const stored = root.entries.get('.filenally').entries.get('versions').entries.get('saved-1').entries.get('report.txt');
      let cancelled = false, indexReads = 0, storedReads = 0;
      const originalIndexGetFile = index.getFile.bind(index), originalStoredGetFile = stored.getFile.bind(stored);
      index.getFile = async () => { indexReads += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return originalIndexGetFile(); };
      stored.getFile = async () => { storedReads += 1; return originalStoredGetFile(); };
      const before = await window.__snapshotMockPair();
      const callsBefore = window.__getPermissionCalls();
      const pending = window.FileNallyTest.VersionStore.prepareComparison(root, window.__versionRecord, null, { isCancelled: () => cancelled });
      await new Promise((resolve) => setTimeout(resolve, 0)); cancelled = true;
      try { await pending; return { name: '', message: '', indexReads, storedReads, before, after: await window.__snapshotMockPair(), callsBefore, callsAfter: window.__getPermissionCalls() }; }
      catch (error) { return { name: error.name, message: error.message, indexReads, storedReads, before, after: await window.__snapshotMockPair(), callsBefore, callsAfter: window.__getPermissionCalls() }; }
    });
    assert.equal(result.name, 'AbortError');
    assert.equal(result.message, 'Comparison stopped');
    assert.equal(result.indexReads, 1);
    assert.equal(result.storedReads, 0);
    assert.deepEqual(result.after, result.before);
    assert.deepEqual(result.callsAfter, result.callsBefore);
  });

  add('version comparison store cancellation stops during delayed current getFile', async ({ page }) => {
    await mountVersion(page);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target;
      const current = root.entries.get('report.txt');
      const original = current.getFile.bind(current);
      let cancelled = false, reads = 0;
      current.getFile = async () => { reads += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return original(); };
      const before = await window.__snapshotMockPair();
      const callsBefore = window.__getPermissionCalls();
      const pending = window.FileNallyTest.VersionStore.prepareComparison(root, window.__versionRecord, null, { isCancelled: () => cancelled });
      await new Promise((resolve) => setTimeout(resolve, 5)); cancelled = true;
      try { await pending; return { name: '', message: '', reads, before, after: await window.__snapshotMockPair(), callsBefore, callsAfter: window.__getPermissionCalls() }; }
      catch (error) { return { name: error.name, message: error.message, reads, before, after: await window.__snapshotMockPair(), callsBefore, callsAfter: window.__getPermissionCalls() }; }
    });
    assert.equal(result.name, 'AbortError');
    assert.equal(result.message, 'Comparison stopped');
    assert.equal(result.reads, 1);
    assert.deepEqual(result.after, result.before);
    assert.deepEqual(result.callsAfter, result.callsBefore);
  });

  add('version comparison store keeps pinned bytes across an unobservable same-metadata edit', async ({ page }) => {
    await mountVersion(page);
    await page.evaluate(async () => { window.__comparisonSnapshot = await window.FileNallyTest.VersionStore.prepareComparison(window.__mockPair.target, window.__versionRecord); });
    await page.evaluate(() => {
      const current = window.__mockPair.target.entries.get('report.txt');
      current.content = 'currenX';
      current.lastModified = 200;
    });
    const before = await snapshotMockPair(page);
    const callsBefore = await page.evaluate(() => window.__getPermissionCalls());
    const result = await page.evaluate(async () => {
      await window.FileNallyTest.VersionStore.validateComparison(window.__comparisonSnapshot);
      return await window.__comparisonSnapshot.right.file.text();
    });
    assert.equal(result, 'current');
    assert.deepEqual(await snapshotMockPair(page), before);
    assert.deepEqual(await page.evaluate(() => window.__getPermissionCalls()), callsBefore);
  });

  add('version comparison engine keeps byte truth and deterministic changed rows', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const analyze = window.FileNallyTest.VersionComparison.analyze;
      return {
        changed: await analyze(new File(['a\nb\nc\n'], 'a'), new File(['a\nx\nc\n'], 'b')),
        format: await analyze(new File(['\uFEFF가😀\r\n'], 'a'), new File(['가😀\n'], 'b')),
        missing: await analyze(new File([''], 'a'), null),
        equal: await analyze(new File(['same'], 'a', { lastModified: 1 }), new File(['same'], 'b', { lastModified: 2 })),
      };
    });
    assert.equal(result.changed.equal, false);
    assert.deepEqual(result.changed.rows.map((row) => [row.kind, row.leftLine, row.rightLine, row.text]),
      [['context', 1, 1, 'a'], ['remove', 2, null, 'b'], ['add', null, 2, 'x'], ['context', 3, 3, 'c']]);
    assert.deepEqual([result.changed.added, result.changed.removed], [1, 1]);
    assert.equal(result.format.equal, false); assert.equal(result.format.lineContentEqual, true);
    assert.equal(result.format.formats.left.bom, true); assert.equal(result.format.formats.left.crlf, 1);
    assert.equal(result.missing.kind, 'missing'); assert.equal(result.missing.equal, null);
    assert.equal(result.equal.kind, 'identical'); assert.equal(result.equal.equal, true);
  });

  add('version comparison engine hashes known complete snapshots', async ({ page }) => {
    const result = await page.evaluate(() => window.FileNallyTest.VersionComparison.analyze(
      new File(['abc'], 'a'), new File(['abd'], 'b')));
    const { createHash } = require('node:crypto');
    assert.equal(result.hashes.left.value, createHash('sha256').update('abc').digest('hex'));
    assert.equal(result.hashes.right.value, createHash('sha256').update('abd').digest('hex'));
  });

  add('version comparison engine distinguishes empty, inserted, deleted, metadata-only and same-metadata changes', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const analyze = window.FileNallyTest.VersionComparison.analyze;
      const changedLeft = new File(['left'], 'a', { lastModified: 7 });
      const changedRight = new File(['rift'], 'b', { lastModified: 7 });
      return {
        empty: await analyze(new File([], 'a'), new File([], 'b')),
        insert: await analyze(new File([], 'a'), new File(['line'], 'b')),
        remove: await analyze(new File(['line'], 'a'), new File([], 'b')),
        metadata: await analyze(new File(['same'], 'a', { lastModified: 1 }), new File(['same'], 'b', { lastModified: 2 })),
        changedMetadata: [changedLeft.size, changedRight.size, changedLeft.lastModified, changedRight.lastModified],
        changed: await analyze(changedLeft, changedRight),
        missing: await analyze(new File([], 'a'), null),
      };
    });
    assert.deepEqual([result.empty.kind, result.empty.equal], ['identical', true]);
    assert.deepEqual(result.insert.rows.map((row) => [row.kind, row.leftLine, row.rightLine, row.text]),
      [['add', null, 1, 'line']]);
    assert.deepEqual([result.insert.added, result.insert.removed], [1, 0]);
    assert.deepEqual(result.remove.rows.map((row) => [row.kind, row.leftLine, row.rightLine, row.text]),
      [['remove', 1, null, 'line']]);
    assert.deepEqual([result.remove.added, result.remove.removed], [0, 1]);
    assert.deepEqual([result.metadata.kind, result.metadata.equal], ['identical', true]);
    assert.deepEqual(result.changedMetadata, [4, 4, 7, 7]);
    assert.equal(result.changed.equal, false);
    assert.deepEqual([result.changed.kind, result.changed.added, result.changed.removed], ['text', 1, 1]);
    assert.deepEqual([result.missing.kind, result.missing.equal, result.missing.hashes.right.status], ['missing', null, 'missing']);
  });

  add('version comparison engine deletes before insert on repeated ambiguous LCS runs', async ({ page }) => {
    const runs = await page.evaluate(async () => {
      const analyze = window.FileNallyTest.VersionComparison.analyze;
      const results = [];
      for (let index = 0; index < 3; index += 1) {
        const result = await analyze(new File(['a\nb'], 'a'), new File(['b\na'], 'b'));
        results.push(result.rows.map((row) => [row.kind, row.leftLine, row.rightLine, row.text]));
      }
      return results;
    });
    const expected = [['remove', 1, null, 'a'], ['context', 2, 1, 'b'], ['add', null, 2, 'a']];
    assert.deepEqual(runs, [expected, expected, expected]);
  });

  add('version comparison engine preserves one BOM removal, Unicode and whitespace exactly', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const analyze = window.FileNallyTest.VersionComparison.analyze;
      return {
        bom: await analyze(new File(['\uFEFF\uFEFFx'], 'a'), new File(['\uFEFFx'], 'b')),
        unicode: await analyze(new File(['가😀\n끝'], 'a'), new File(['가😀\n다름'], 'b')),
        whitespace: await analyze(new File(['\ta '], 'a'), new File([' \ta'], 'b')),
        canonical: await analyze(new File(['\u00e9'], 'a'), new File(['e\u0301'], 'b')),
      };
    });
    assert.deepEqual([result.bom.formats.left.bom, result.bom.formats.right.bom], [true, true]);
    assert.deepEqual(result.bom.rows.map((row) => [row.kind, row.text]), [['remove', '\uFEFFx'], ['add', 'x']]);
    assert.deepEqual(result.unicode.rows.map((row) => [row.kind, row.text]),
      [['context', '가😀'], ['remove', '끝'], ['add', '다름']]);
    assert.deepEqual(result.whitespace.rows.map((row) => [row.kind, row.text]), [['remove', '\ta '], ['add', ' \ta']]);
    assert.deepEqual(result.canonical.rows.map((row) => [row.kind, row.text]), [['remove', 'é'], ['add', 'e\u0301']]);
  });

  add('version comparison engine reports exact line terminator formats without changing byte truth', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const analyze = window.FileNallyTest.VersionComparison.analyze;
      return {
        mixed: await analyze(new File(['a\nb\rc\r\n'], 'a'), new File(['a\r\nb\nc\r'], 'b')),
        final: await analyze(new File(['a\n'], 'a'), new File(['a'], 'b')),
        positions: await analyze(new File(['a\nb\r'], 'a'), new File(['a\rb\n'], 'b')),
      };
    });
    const counts = (format) => [format.crlf, format.lf, format.cr, format.finalNewline];
    assert.deepEqual(counts(result.mixed.formats.left), [1, 1, 1, true]);
    assert.deepEqual(counts(result.mixed.formats.right), [1, 1, 1, true]);
    for (const value of Object.values(result)) {
      assert.equal(value.equal, false);
      assert.equal(value.lineContentEqual, true);
      assert.deepEqual(value.rows, []);
    }
    assert.deepEqual(counts(result.final.formats.left), [0, 1, 0, true]);
    assert.deepEqual(counts(result.final.formats.right), [0, 0, 0, false]);
  });

  add('version comparison engine merges six-line context and gaps seven-line context precisely', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const make = (between) => {
        const left = ['head-1', 'head-2', 'head-3', 'head-4', 'left-1'];
        const right = ['head-1', 'head-2', 'head-3', 'head-4', 'right-1'];
        for (let index = 1; index <= between; index += 1) { left.push(`same-${index}`); right.push(`same-${index}`); }
        left.push('left-2', 'tail-1', 'tail-2', 'tail-3', 'tail-4');
        right.push('right-2', 'tail-1', 'tail-2', 'tail-3', 'tail-4');
        return [left.join('\n'), right.join('\n')];
      };
      const analyze = window.FileNallyTest.VersionComparison.analyze;
      const six = make(6), seven = make(7);
      return {
        six: await analyze(new File([six[0]], 'a'), new File([six[1]], 'b')),
        seven: await analyze(new File([seven[0]], 'a'), new File([seven[1]], 'b')),
      };
    });
    assert.deepEqual(result.six.rows.filter((row) => row.kind === 'gap').map((row) => [row.leftLine, row.rightLine, row.count]),
      [[1, 1, 1], [16, 16, 1]]);
    assert.deepEqual(result.seven.rows.filter((row) => row.kind === 'gap').map((row) => [row.leftLine, row.rightLine, row.count]),
      [[1, 1, 1], [9, 9, 1], [17, 17, 1]]);
    assert.deepEqual([result.six.added, result.six.removed, result.seven.added, result.seven.removed], [2, 2, 2, 2]);
  });

  for (const [name, leftBytes, expected] of [
    ['invalid UTF-8', [0xc3, 0x28], 'encoding'],
    ['NUL', [65, 0], 'control'],
    ['DEL', [65, 127], 'control'],
    ['UTF-16 LE', [65, 0, 66, 0], 'control'],
  ]) {
    add(`version comparison engine fallback: ${name}`, async ({ page }) => {
      const result = await page.evaluate(async ({ leftBytes }) => window.FileNallyTest.VersionComparison.analyze(
        new File([new Uint8Array(leftBytes)], 'a.txt'), new File(['xyz'], 'b.bin')), { leftBytes });
      assert.equal(result.kind, 'summary'); assert.equal(result.reason, expected);
      assert.equal(result.equal, false); assert.deepEqual(result.rows, []);
      assert.deepEqual([result.added, result.removed], [0, 0]);
    });
  }

  add('version comparison engine enforces inclusive byte, line and UTF-16 line limits', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const analyze = window.FileNallyTest.VersionComparison.analyze;
      const atBytes = `${'a'.repeat(8191)}\n`.repeat(64);
      const changedAtBytes = `b${atBytes.slice(1)}`;
      const overBytes = new File(['a'.repeat(524289)], 'over');
      let overByteReads = 0;
      const originalOverRead = overBytes.arrayBuffer.bind(overBytes);
      overBytes.arrayBuffer = async () => { overByteReads += 1; return originalOverRead(); };
      const atLines = `${'x\n'.repeat(4999)}x\n`;
      const changedAtLines = `y\n${'x\n'.repeat(4999)}`;
      const overLines = `${'x\n'.repeat(5000)}x\n`;
      return {
        atBytes: await analyze(new File([atBytes], 'a'), new File([changedAtBytes], 'b')),
        overBytes: await analyze(overBytes, new File(['b'], 'b')),
        overByteReads,
        atLines: await analyze(new File([atLines], 'a'), new File([changedAtLines], 'b')),
        overLines: await analyze(new File([overLines], 'a'), new File([`y\n${'x\n'.repeat(5000)}`], 'b')),
        atUnits: await analyze(new File(['😀'.repeat(4096)], 'a'), new File([`😃${'😀'.repeat(4095)}`], 'b')),
        overUnits: await analyze(new File([`😀${'a'.repeat(8191)}`], 'a'), new File([`😃${'a'.repeat(8191)}`], 'b')),
      };
    });
    assert.deepEqual([result.atBytes.kind, result.atBytes.reason, result.atBytes.removed, result.atBytes.added], ['text', null, 1, 1]);
    assert.deepEqual([result.overBytes.kind, result.overBytes.reason, result.overBytes.hashes.left.status, result.overByteReads],
      ['summary', 'size', 'ok', 1]);
    assert.deepEqual([result.atLines.kind, result.atLines.reason, result.atLines.removed, result.atLines.added], ['text', null, 1, 1]);
    assert.deepEqual([result.overLines.kind, result.overLines.reason, result.overLines.rows.length], ['summary', 'line-count', 0]);
    assert.deepEqual([result.atUnits.kind, result.atUnits.reason, result.atUnits.removed, result.atUnits.added], ['text', null, 1, 1]);
    assert.deepEqual([result.overUnits.kind, result.overUnits.reason, result.overUnits.rows.length], ['summary', 'line-length', 0]);
  });

  add('version comparison engine accepts inclusive matrix cells and refuses allocation just over', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const Native = Uint32Array;
      const allocations = [];
      globalThis.Uint32Array = class extends Native {
        constructor(length) { super(length); allocations.push(length); }
      };
      const lines = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}${index}`).join('\n');
      try {
        const progress = [];
        const inclusive = await window.FileNallyTest.VersionComparison.analyze(
          new File([lines('L', 999)], 'a'), new File([lines('R', 1999)], 'b'), { onProgress: (value) => progress.push(value) });
        const afterInclusive = allocations.slice();
        const over = await window.FileNallyTest.VersionComparison.analyze(
          new File([lines('L', 1000)], 'a'), new File([lines('R', 1999)], 'b'));
        return { inclusive: { kind: inclusive.kind, reason: inclusive.reason, added: inclusive.added, removed: inclusive.removed },
          over: { kind: over.kind, reason: over.reason, rows: over.rows.length, added: over.added, removed: over.removed },
          afterInclusive, allocations, textProgress: progress.filter((value) => value.stage === 'text').at(-1) };
      } finally { globalThis.Uint32Array = Native; }
    });
    assert.deepEqual(result.inclusive, { kind: 'text', reason: null, added: 1999, removed: 999 });
    assert.deepEqual(result.over, { kind: 'summary', reason: 'work-limit', rows: 0, added: 0, removed: 0 });
    assert.deepEqual(result.afterInclusive, [2000000]);
    assert.deepEqual(result.allocations, [2000000]);
    assert.deepEqual(result.textProgress, { stage: 'text', done: 1997001, total: 1997001 });
  });

  add('version comparison engine trims huge common edges and skips matrices for one empty unmatched side', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const Native = Uint32Array;
      const allocations = [];
      globalThis.Uint32Array = class extends Native {
        constructor(length) { super(length); allocations.push(length); }
      };
      try {
        const prefix = Array.from({ length: 2000 }, (_, index) => `p${index}`);
        const suffix = Array.from({ length: 2000 }, (_, index) => `s${index}`);
        const centered = await window.FileNallyTest.VersionComparison.analyze(
          new File([[...prefix, 'left', ...suffix].join('\n')], 'a'),
          new File([[...prefix, 'right', ...suffix].join('\n')], 'b'));
        const afterCentered = allocations.slice();
        const deletionOnly = await window.FileNallyTest.VersionComparison.analyze(
          new File([Array.from({ length: 1000 }, (_, index) => `L${index}`).join('\n')], 'a'), new File([], 'b'));
        return { centered: [centered.removed, centered.added], deletionOnly: [deletionOnly.removed, deletionOnly.added],
          afterCentered, allocations };
      } finally { globalThis.Uint32Array = Native; }
    });
    assert.deepEqual(result.centered, [1, 1]);
    assert.deepEqual(result.deletionOnly, [1000, 0]);
    assert.deepEqual(result.afterCentered, [4]);
    assert.deepEqual(result.allocations, [4]);
  });

  add('version comparison engine fingerprints the inclusive cap and avoids over-cap whole-file reads', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const analyze = window.FileNallyTest.VersionComparison.analyze;
      const at = new File([new Uint8Array(16777216)], 'at');
      const over = new File([new Uint8Array(16777217)], 'over');
      let atReads = 0, overReads = 0;
      const atRead = at.arrayBuffer.bind(at);
      at.arrayBuffer = async () => { atReads += 1; return atRead(); };
      over.arrayBuffer = async () => { overReads += 1; throw new Error('over-cap read'); };
      const atResult = await analyze(at, new File(['x'], 'right'));
      const overResult = await analyze(over, new File(['x'], 'right'));
      return { at: atResult.hashes.left, over: overResult.hashes.left, atReads, overReads };
    });
    assert.deepEqual(result.at, { status: 'ok', value: '080acf35a507ac9849cfcba47dc2ad83e01b75663a516279c8b9d243b719643e' });
    assert.deepEqual(result.over, { status: 'too-large', value: '' });
    assert.deepEqual([result.atReads, result.overReads], [1, 0]);
  });

  add('version comparison engine labels absent and unsupported crypto and hashes sequentially', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
      const analyze = window.FileNallyTest.VersionComparison.analyze;
      let subtle = null, originalDigest = null;
      try {
        Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
        const absent = await analyze(new File(['a'], 'a'), new File(['b'], 'b'));
        Object.defineProperty(globalThis, 'crypto', descriptor);
        subtle = crypto.subtle;
        originalDigest = subtle.digest;
        Object.defineProperty(subtle, 'digest', { configurable: true, value: async () => { throw new Error('unsupported'); } });
        const unsupported = await analyze(new File(['a'], 'a'), new File(['b'], 'b'));
        let active = 0, maximum = 0, calls = 0;
        Object.defineProperty(subtle, 'digest', { configurable: true, value: async (...args) => {
          calls += 1; active += 1; maximum = Math.max(maximum, active);
          await new Promise((resolve) => setTimeout(resolve, 0));
          try { return await originalDigest.apply(subtle, args); } finally { active -= 1; }
        } });
        const progress = [];
        const sequential = await analyze(new File(['abc'], 'a'), new File(['abd'], 'b'), { onProgress: (value) => progress.push(value) });
        return { absent: absent.hashes, unsupported: unsupported.hashes, sequential: sequential.hashes, calls, maximum,
          hashProgress: progress.filter((value) => value.stage === 'hash') };
      } finally {
        if (subtle && originalDigest) Object.defineProperty(subtle, 'digest', { configurable: true, value: originalDigest });
        Object.defineProperty(globalThis, 'crypto', descriptor);
      }
    });
    assert.deepEqual(result.absent, { left: { status: 'unavailable', value: '' }, right: { status: 'unavailable', value: '' } });
    assert.deepEqual(result.unsupported, result.absent);
    assert.equal(result.calls, 2); assert.equal(result.maximum, 1);
    assert.equal(result.sequential.left.status, 'ok'); assert.equal(result.sequential.right.status, 'ok');
    assert.deepEqual(result.hashProgress, [{ stage: 'hash', done: 1, total: 2 }, { stage: 'hash', done: 2, total: 2 }]);
  });

  add('version comparison engine reuses an exact-equal fingerprint without retaining Files', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const left = new File(['same'], 'left'), right = new File(['same'], 'right');
      let leftReads = 0, rightReads = 0;
      const leftRead = left.arrayBuffer.bind(left), rightRead = right.arrayBuffer.bind(right);
      left.arrayBuffer = async () => { leftReads += 1; return leftRead(); };
      right.arrayBuffer = async () => { rightReads += 1; return rightRead(); };
      const value = await window.FileNallyTest.VersionComparison.analyze(left, right);
      const containsFile = (item, seen = new Set()) => {
        if (item instanceof File) return true;
        if (!item || typeof item !== 'object' || seen.has(item)) return false;
        seen.add(item);
        return Object.values(item).some((child) => containsFile(child, seen));
      };
      return { leftReads, rightReads, sameHash: value.hashes.left.value === value.hashes.right.value,
        containsFile: containsFile(value), keys: Object.keys(window.FileNallyTest.VersionComparison) };
    });
    assert.deepEqual(result, { leftReads: 1, rightReads: 0, sameHash: true, containsFile: false, keys: ['analyze'] });
  });

  add('version comparison engine aborts when final progress cancels publication', async ({ page }) => {
    const result = await page.evaluate(async () => {
      let cancelled = false;
      try {
        await window.FileNallyTest.VersionComparison.analyze(new File(['a'], 'a'), new File(['b'], 'b'), {
          isCancelled: () => cancelled,
          onProgress: (value) => { if (value.stage === 'hash' && value.done === value.total) cancelled = true; },
        });
        return '';
      } catch (error) { return error.name; }
    });
    assert.equal(result, 'AbortError');
  });

  add('version comparison engine completes large exact passes and exits early for unequal sizes and first bytes', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const analyze = window.FileNallyTest.VersionComparison.analyze;
      const size = 16777217;
      const bytes = new Uint8Array(size);
      const equalLeft = new File([bytes], 'a'), equalRight = new File([bytes], 'b');
      const equalSlices = [0, 0], equalWhole = [0, 0], progress = [];
      for (const [index, file] of [equalLeft, equalRight].entries()) {
        const slice = file.slice.bind(file);
        file.slice = (...args) => { equalSlices[index] += 1; return slice(...args); };
        file.arrayBuffer = async () => { equalWhole[index] += 1; throw new Error('over-cap whole read'); };
      }
      const equal = await analyze(equalLeft, equalRight, { onProgress: (value) => progress.push(value) });
      const short = new File(['x'], 'short'), long = new File(['yz'], 'long');
      let unequalSlices = 0;
      short.slice = long.slice = () => { unequalSlices += 1; throw new Error('unequal-size slice'); };
      const unequal = await analyze(short, long);
      const firstLeftBytes = new Uint8Array(size), firstRightBytes = new Uint8Array(size);
      firstRightBytes[0] = 1;
      const firstLeft = new File([firstLeftBytes], 'a'), firstRight = new File([firstRightBytes], 'b');
      const firstSlices = [0, 0], firstProgress = [];
      for (const [index, file] of [firstLeft, firstRight].entries()) {
        const slice = file.slice.bind(file);
        file.slice = (...args) => { firstSlices[index] += 1; return slice(...args); };
      }
      const first = await analyze(firstLeft, firstRight, { onProgress: (value) => firstProgress.push(value) });
      return { equal: [equal.equal, equal.hashes.left.status, equal.hashes.right.status], equalSlices, equalWhole,
        equalByteProgress: progress.filter((value) => value.stage === 'bytes').at(-1),
        unequal: [unequal.equal, unequalSlices], first: [first.equal, first.hashes.left.status], firstSlices,
        firstByteProgress: firstProgress.filter((value) => value.stage === 'bytes') };
    });
    assert.deepEqual(result.equal, [true, 'too-large', 'too-large']);
    assert.deepEqual(result.equalSlices, [5, 5]); assert.deepEqual(result.equalWhole, [0, 0]);
    assert.deepEqual(result.equalByteProgress, { stage: 'bytes', done: 33554434, total: 33554434 });
    assert.deepEqual(result.unequal, [false, 0]);
    assert.deepEqual(result.first, [false, 'too-large']); assert.deepEqual(result.firstSlices, [1, 1]);
    assert.deepEqual(result.firstByteProgress, []);
  });

  add('version comparison engine propagates empty, decode and hash read failures', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const analyze = window.FileNallyTest.VersionComparison.analyze;
      const capture = async (left, right) => {
        try { await analyze(left, right); return ''; } catch (error) { return error.message; }
      };
      const empty = new File([], 'empty');
      const emptySlice = empty.slice.bind(empty);
      empty.slice = (...args) => { const blob = emptySlice(...args); blob.arrayBuffer = async () => { throw new Error('empty unreadable'); }; return blob; };
      const decode = new File(['a'], 'decode');
      decode.arrayBuffer = async () => { throw new Error('decode unreadable'); };
      const hash = new File(['same'], 'hash');
      hash.arrayBuffer = async () => { throw new Error('hash unreadable'); };
      return {
        empty: await capture(empty, new File([], 'other')),
        decode: await capture(decode, new File(['b'], 'other')),
        hash: await capture(hash, new File(['same'], 'other')),
      };
    });
    assert.deepEqual(result, { empty: 'empty unreadable', decode: 'decode unreadable', hash: 'hash unreadable' });
  });

  add('version comparison engine yields and stops during matrix work', async ({ page }) => {
    const result = await page.evaluate(async () => {
      let stopped = false, timerFired = false;
      const lines = (prefix) => Array.from({ length: 999 }, (_, index) => `${prefix}${index}`).join('\n');
      try {
        await window.FileNallyTest.VersionComparison.analyze(new File([lines('L')], 'a'), new File([lines('R')], 'b'), {
          isCancelled: () => stopped,
          onProgress: (progress) => {
            if (progress.stage === 'text' && !timerFired) setTimeout(() => { timerFired = true; stopped = true; }, 0);
          },
        });
        return { name: '', timerFired };
      } catch (error) { return { name: error.name, timerFired }; }
    });
    assert.deepEqual(result, { name: 'AbortError', timerFired: true });
  });

  for (const pendingStage of ['slice', 'decode', 'hash-read', 'digest', 'digest-reject']) {
    add(`version comparison engine cancellation after delayed ${pendingStage} prevents the next read`, async ({ page }) => {
      const result = await page.evaluate(async (pendingStage) => {
        const analyze = window.FileNallyTest.VersionComparison.analyze;
        let cancelled = false, rightWholeReads = 0, digestCalls = 0;
        const left = pendingStage === 'hash-read' ? new File(['a'.repeat(524289)], 'a') : new File(['a'], 'a');
        const right = pendingStage === 'hash-read' ? new File(['b'], 'b') : new File(['b'], 'b');
        const rightRead = right.arrayBuffer.bind(right);
        right.arrayBuffer = async () => { rightWholeReads += 1; return rightRead(); };
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
        let restoreDigest = null;
        if (pendingStage === 'slice') {
          const slice = left.slice.bind(left);
          left.slice = (...args) => {
            const blob = slice(...args), read = blob.arrayBuffer.bind(blob);
            blob.arrayBuffer = async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return read(); };
            return blob;
          };
        } else if (pendingStage === 'decode' || pendingStage === 'hash-read') {
          const read = left.arrayBuffer.bind(left);
          left.arrayBuffer = async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return read(); };
        } else {
          const subtle = crypto.subtle, originalDigest = subtle.digest;
          restoreDigest = () => Object.defineProperty(subtle, 'digest', { configurable: true, value: originalDigest });
          Object.defineProperty(subtle, 'digest', { configurable: true, value: async (...args) => {
            digestCalls += 1; setTimeout(() => { cancelled = true; }, 0);
            await new Promise((resolve) => setTimeout(resolve, 20));
            if (pendingStage === 'digest-reject') throw new Error('delayed unsupported');
            return originalDigest.apply(subtle, args);
          } });
        }
        if (!pendingStage.startsWith('digest')) setTimeout(() => { cancelled = true; }, 0);
        try {
          await analyze(left, right, { isCancelled: () => cancelled });
          return { name: '', rightWholeReads, digestCalls };
        } catch (error) { return { name: error.name, rightWholeReads, digestCalls }; }
        finally { restoreDigest?.(); Object.defineProperty(globalThis, 'crypto', descriptor); }
      }, pendingStage);
      assert.equal(result.name, 'AbortError');
      if (pendingStage === 'slice') assert.equal(result.rightWholeReads, 0);
      if (pendingStage === 'decode' || pendingStage === 'hash-read') assert.equal(result.rightWholeReads, 0);
      if (pendingStage.startsWith('digest')) assert.deepEqual([result.digestCalls, result.rightWholeReads], [1, 1]);
    });
  }

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

  add('version usage quick summary does not enumerate or read stored payloads', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1', 'report.txt', 'old')]);
    await page.evaluate(() => {
      const versionRoot = window.__mockPair.target.entries.get('.filenally').entries.get('versions');
      versionRoot.values = () => { throw new Error('payload enumeration attempted'); };
      versionRoot.entries.get('saved-1').entries.get('report.txt').getFile = async () => {
        throw new Error('payload metadata attempted');
      };
    });
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    const result = await page.evaluate(() => window.FileNallyTest.VersionStore
      .inspectUsage(window.__mockPair.target, { scan: false }));
    assert.deepEqual(result.registered, {
      count: 1, pathCount: 1, bytes: '3', paths: [{ path: 'report.txt', count: 1, bytes: '3' }],
    });
    assert.equal(result.observed, null);
    assert.equal(result.inspection, 'not-run');
    assert.equal(result.visited, 0);
    await assertComparisonReadOnly(page, files, state);
  });

  add('version usage aggregates exact paths, zero bytes, and large totals without rounding', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    const records = [
      { ...cleanupFixture('zero', 'z.txt').record, size: 0, storedPath: 'versions/zero/z.txt' },
      { ...cleanupFixture('max', 'a.txt').record, size: Number.MAX_SAFE_INTEGER, storedPath: 'versions/max/a.txt' },
      { ...cleanupFixture('two', 'a.txt').record, size: 2, storedPath: 'versions/two/a.txt' },
    ];
    await page.evaluate((versions) => window.__setMockFile('target', '.filenally/index.json', {
      content: JSON.stringify({ schemaVersion: 1, versions }),
    }), records);
    const result = await inspectVersionUsage(page, 'target', { scan: false });
    assert.deepEqual(result.registered, {
      count: 3, pathCount: 2, bytes: '9007199254740993',
      paths: [
        { path: 'a.txt', count: 2, bytes: '9007199254740993' },
        { path: 'z.txt', count: 1, bytes: '0' },
      ],
    });
    assert.equal(result.indexStatus, 'valid');
  });

  for (const [name, size] of [
    ['negative', -1], ['fractional', 0.5], ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ]) {
    add(`version usage reports ${name} recorded sizes as unknown`, async ({ page }) => {
      await mountPair(page, { source: {}, target: {} });
      const record = { ...cleanupFixture('invalid').record, size };
      await page.evaluate((versions) => window.__setMockFile('target', '.filenally/index.json', {
        content: JSON.stringify({ schemaVersion: 1, versions }),
      }), [record]);
      const result = await inspectVersionUsage(page, 'target', { scan: false });
      assert.equal(result.indexStatus, 'error');
      assert.equal(result.registered, null);
      assert.match(result.indexError, /size/i);
      assert.equal(result.inspection, 'not-run');
    });
  }

  add('version usage keeps missing and corrupt indexes distinct from empty valid indexes', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    await page.evaluate(() => {
      window.__setMockFile('source', '.filenally/versions/loose/a.txt', { content: 'abc' });
      window.__setMockFile('target', '.filenally/index.json', { content: '{broken' });
      window.__setMockFile('target', '.filenally/versions/loose/b.txt', { content: '12345' });
    });
    const missing = await inspectVersionUsage(page, 'source');
    const corrupt = await inspectVersionUsage(page, 'target');
    assert.deepEqual(missing.registered, { count: 0, pathCount: 0, bytes: '0', paths: [] });
    assert.equal(missing.indexStatus, 'missing');
    assert.deepEqual({ registeredCount: missing.observed.registeredCount,
      registeredBytes: missing.observed.registeredBytes,
      unregisteredCount: missing.observed.unregisteredCount,
      unregisteredBytes: missing.observed.unregisteredBytes,
      unknownCount: missing.observed.unknownCount }, {
      registeredCount: null, registeredBytes: null, unregisteredCount: null,
      unregisteredBytes: null, unknownCount: 1,
    });
    assert.equal(missing.inspection, 'complete');
    assert.equal(corrupt.indexStatus, 'error');
    assert.equal(corrupt.registered, null);
    assert.equal(corrupt.observed.unknownCount, 1);
    assert.equal(corrupt.inspection, 'complete');
  });

  add('version usage reports duplicate indexes as invalid without classifying payload ownership', async ({ page }) => {
    const fixture = cleanupFixture('duplicate');
    await mountCleanup(page, [fixture]);
    await page.evaluate((record) => {
      window.__setMockFile('target', '.filenally/index.json', {
        content: JSON.stringify({ schemaVersion: 1, versions: [record, record] }),
      });
    }, fixture.record);
    const result = await inspectVersionUsage(page);
    assert.equal(result.indexStatus, 'error');
    assert.equal(result.registered, null);
    assert.equal(result.observed.registeredCount, null);
    assert.equal(result.observed.unregisteredCount, null);
    assert.equal(result.observed.unknownCount, 1);
  });

  add('version usage exposes validated pending cleanup metadata without blocking inspection', async ({ page }) => {
    const pending = {
      id: 'cleanup-1', startedAt: '2026-09-13T00:00:00.000Z', remainingIds: ['saved-1'],
      completedCount: 0, completedBytes: '0',
    };
    await mountCleanup(page, [cleanupFixture('saved-1')], { schemaVersion: 2, cleanup: pending });
    const result = await inspectVersionUsage(page);
    assert.deepEqual(result.cleanup, pending);
    assert.equal(result.indexStatus, 'valid');
    assert.equal(result.inspection, 'complete');
    assert.equal(result.observed.registeredCount, 1);
    const frozen = await page.evaluate(async () => {
      const report = await window.FileNallyTest.VersionStore.inspectUsage(window.__mockPair.target, { scan: false });
      return [Object.isFrozen(report.cleanup), Object.isFrozen(report.cleanup.remainingIds)];
    });
    assert.deepEqual(frozen, [true, true]);
  });

  add('version usage distinguishes missing, mismatched, unregistered, index, and sibling bytes', async ({ page }) => {
    const fixtures = [
      cleanupFixture('good', 'good.txt', 'old'),
      cleanupFixture('missing', 'missing.txt', 'gone'),
      cleanupFixture('wrong', 'wrong.txt', 'old'),
      cleanupFixture('directory', 'dir.txt', 'old'),
    ];
    await mountCleanup(page, fixtures);
    await page.evaluate(() => {
      window.__deleteMockEntry('target', '.filenally/versions/missing/missing.txt');
      window.__setMockFile('target', '.filenally/versions/wrong/wrong.txt', { content: 'longer' });
      window.__deleteMockEntry('target', '.filenally/versions/directory/dir.txt');
      window.__setMockFile('target', '.filenally/versions/directory/dir.txt/child.txt', { content: 'x' });
      window.__setMockFile('target', '.filenally/versions/orphan/left.txt', { content: 'spare' });
      window.__setMockFile('target', '.filenally/note.txt', { content: 'xy' });
    });
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    const result = await inspectVersionUsage(page);
    const indexBytes = String(Buffer.byteLength(files.target['.filenally']['index.json'].content));
    assert.equal(result.observed.indexBytes, indexBytes);
    assert.equal(result.observed.registeredCount, 2);
    assert.equal(result.observed.registeredBytes, '9');
    assert.equal(result.observed.unregisteredCount, 2);
    assert.equal(result.observed.unregisteredBytes, '6');
    assert.equal(result.observed.otherCount, 1);
    assert.equal(result.observed.otherBytes, '2');
    assert.equal(result.observed.bytes, (BigInt(indexBytes) + 17n).toString());
    assert.deepEqual(result.observed.missingIds, ['missing']);
    assert.deepEqual(result.observed.mismatchedIds, ['directory', 'wrong']);
    await assertComparisonReadOnly(page, files, state);
  });

  add('version usage stays pinned to both physical roots after labels are swapped', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    await page.evaluate(() => {
      const source = {
        id: 'source-1', capturedAt: '2026-09-13T00:00:00.000Z', originalPath: 'same.txt',
        storedPath: 'versions/source-1/same.txt', size: 3, type: 'text/plain', lastModified: 100,
        reason: 'before-overwrite', runId: 'source-run', direction: 'unidirectional',
        fromSide: 'source', toSide: 'target',
      };
      const target = { ...source, id: 'target-1', storedPath: 'versions/target-1/same.txt', size: 5 };
      window.__setMockFile('source', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [source] }) });
      window.__setMockFile('source', '.filenally/versions/source-1/same.txt', { content: 'abc' });
      window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions: [target] }) });
      window.__setMockFile('target', '.filenally/versions/target-1/same.txt', { content: '12345' });
    });
    const before = [await inspectVersionUsage(page, 'source'), await inspectVersionUsage(page, 'target')];
    await page.locator('#btnSwapFolders').click();
    await page.waitForFunction(() => !window.FileNallyTest.getModel().appOperation);
    const after = [await inspectVersionUsage(page, 'source'), await inspectVersionUsage(page, 'target')];
    assert.deepEqual(before.map(result => result.registered.bytes), ['3', '5']);
    assert.deepEqual(after.map(result => result.registered.bytes), ['3', '5']);
    assert.deepEqual(after.map(result => result.observed.registeredBytes), ['3', '5']);
  });

  add('version usage reports a stable absent store as complete zero without creating it', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    const result = await inspectVersionUsage(page);
    assert.deepEqual(result.registered, { count: 0, pathCount: 0, bytes: '0', paths: [] });
    assert.deepEqual(result.observed, {
      count: 0, bytes: '0', indexBytes: '0', registeredCount: null, registeredBytes: null,
      unregisteredCount: null, unregisteredBytes: null, otherCount: 0, otherBytes: '0',
      missingIds: [], mismatchedIds: [], unknownCount: 0,
    });
    assert.equal(result.inspection, 'complete');
    assert.equal(result.visited, 0);
    await assertComparisonReadOnly(page, files, state);
  });

  add('version usage isolates an inaccessible root from another root report', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')], { owner: 'target' });
    await page.evaluate(() => {
      const original = window.__mockPair.source.getDirectoryHandle.bind(window.__mockPair.source);
      window.__mockPair.source.getDirectoryHandle = async (name, options) => {
        if (name === '.filenally') throw new DOMException('root denied', 'NotAllowedError');
        return original(name, options);
      };
    });
    const inaccessible = await inspectVersionUsage(page, 'source');
    const available = await inspectVersionUsage(page, 'target');
    assert.equal(inaccessible.indexStatus, 'error');
    assert.equal(inaccessible.registered, null);
    assert.equal(inaccessible.inspection, 'partial');
    assert.ok(inaccessible.errorCount >= 1);
    assert.equal(inaccessible.errors[0].path, '.filenally');
    assert.equal(available.indexStatus, 'valid');
    assert.equal(available.registered.bytes, '3');
    assert.equal(available.inspection, 'complete');
  });

  add('version usage records an enumeration failure and continues with accessible siblings', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    await page.evaluate(() => {
      const store = window.__mockPair.target.entries.get('.filenally');
      store.entries.get('versions').values = async function* () {
        throw new DOMException('directory denied', 'NotAllowedError');
      };
      window.__setMockFile('target', '.filenally/note.txt', { content: 'xy' });
    });
    const result = await inspectVersionUsage(page);
    assert.equal(result.inspection, 'partial');
    assert.equal(result.observed.otherBytes, '2');
    assert.deepEqual(result.observed.missingIds, []);
    assert.equal(result.errorCount, 1);
    assert.equal(result.errors[0].path, 'versions');
    assert.match(result.errors[0].message, /directory denied/);
  });

  add('version usage records a payload metadata failure without inventing missing versions', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    await page.evaluate(() => {
      const file = window.__mockPair.target.entries.get('.filenally').entries.get('versions')
        .entries.get('saved-1').entries.get('report.txt');
      file.getFile = async () => { throw new DOMException('metadata denied', 'NotAllowedError'); };
    });
    const result = await inspectVersionUsage(page);
    assert.equal(result.inspection, 'partial');
    assert.equal(result.observed.registeredCount, 0);
    assert.deepEqual(result.observed.missingIds, []);
    assert.equal(result.errorCount, 1);
    assert.equal(result.errors[0].path, 'versions/saved-1/report.txt');
  });

  add('version usage scans physical files when index metadata cannot be read', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    await page.evaluate(() => {
      const store = window.__mockPair.target.entries.get('.filenally');
      store.entries.get('index.json').getFile = async () => {
        throw new DOMException('index metadata denied', 'NotAllowedError');
      };
      window.__setMockFile('target', '.filenally/note.txt', { content: 'xy' });
    });
    const result = await inspectVersionUsage(page);
    assert.equal(result.indexStatus, 'error');
    assert.equal(result.registered, null);
    assert.equal(result.inspection, 'partial');
    assert.equal(result.observed.unknownCount, 1);
    assert.equal(result.observed.otherBytes, '2');
    assert.deepEqual(result.observed.missingIds, []);
  });

  for (const scan of [false, true]) {
    add(`version usage ${scan ? 'physical scan' : 'quick summary'} never reads oversized index text`, async ({ page }) => {
      await mountPair(page, { source: {}, target: {} });
      const result = await page.evaluate(async ({ scan, size }) => {
        window.__setMockFile('target', '.filenally/index.json', { contentSize: size });
        window.__setMockFile('target', '.filenally/versions/loose/a.txt', { content: 'abc' });
        const index = window.__mockPair.target.entries.get('.filenally').entries.get('index.json');
        const getFile = index.getFile.bind(index);
        let textReads = 0;
        index.getFile = async () => {
          const file = await getFile();
          const text = file.text.bind(file);
          Object.defineProperty(file, 'text', { value: async () => {
            textReads += 1;
            return text();
          } });
          return file;
        };
        const report = await window.FileNallyTest.VersionStore.inspectUsage(
          window.__mockPair.target, { scan },
        );
        return { report, textReads };
      }, { scan, size: (5 * 1024 * 1024) + 1 });
      assert.equal(result.textReads, 0);
      assert.equal(result.report.indexStatus, 'error');
      assert.equal(result.report.registered, null);
      assert.match(result.report.indexError, /exceeds 5MB/);
      if (!scan) {
        assert.equal(result.report.inspection, 'not-run');
        assert.equal(result.report.observed, null);
      } else {
        assert.equal(result.report.inspection, 'partial');
        assert.equal(result.report.observed.indexBytes, '5242881');
        assert.equal(result.report.observed.unknownCount, 1);
        assert.deepEqual(result.report.observed.missingIds, []);
      }
    });
  }

  add('version usage attributes distinct fallback failures to the failing index stage', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target;
      const getDirectoryHandle = root.getDirectoryHandle.bind(root);
      let rootReads = 0;
      root.getDirectoryHandle = async (name, options) => {
        if (name === '.filenally' && rootReads++ === 0) {
          throw new DOMException('initial root failure', 'NotReadableError');
        }
        return getDirectoryHandle(name, options);
      };
      const index = root.entries.get('.filenally').entries.get('index.json');
      const getFile = index.getFile.bind(index);
      let indexReads = 0;
      index.getFile = async () => {
        const file = await getFile();
        if (indexReads++ === 0) Object.defineProperty(file, 'text', { value: async () => {
          throw new DOMException('fallback index text failure', 'NotReadableError');
        } });
        return file;
      };
      return window.FileNallyTest.VersionStore.inspectUsage(root);
    });
    assert.equal(result.indexStatus, 'error');
    assert.match(result.indexError, /initial root failure/);
    assert.equal(result.inspection, 'partial');
    assert.equal(result.errorCount, 1);
    assert.equal(result.errors[0].path, 'index.json');
    assert.match(result.errors[0].message, /fallback index text failure/);
    assert.equal(result.observed.unknownCount, 1);
    assert.deepEqual(result.observed.missingIds, []);
  });

  add('version usage keeps a transient index read failure explicitly partial', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    await page.evaluate(() => {
      const index = window.__mockPair.target.entries.get('.filenally').entries.get('index.json');
      const getFile = index.getFile.bind(index);
      let reads = 0;
      index.getFile = async () => {
        reads += 1;
        if (reads === 1) throw new DOMException('transient index failure', 'NotReadableError');
        return getFile();
      };
    });
    const result = await inspectVersionUsage(page);
    assert.equal(result.indexStatus, 'error');
    assert.equal(result.registered, null);
    assert.equal(result.inspection, 'partial');
    assert.equal(result.errorCount, 1);
    assert.equal(result.errors[0].path, 'index.json');
    assert.match(result.errors[0].message, /transient index failure/);
  });

  add('version usage caps error details while retaining the total failure count', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    await page.evaluate(() => {
      for (let index = 0; index < 101; index += 1) {
        const path = `.filenally/errors/file-${index}.txt`;
        window.__setMockFile('target', path, { content: 'x' });
        const file = window.__mockPair.target.entries.get('.filenally').entries.get('errors')
          .entries.get(`file-${index}.txt`);
        file.getFile = async () => { throw new DOMException('metadata denied', 'NotAllowedError'); };
      }
    });
    const result = await inspectVersionUsage(page);
    assert.equal(result.inspection, 'partial');
    assert.equal(result.errorCount, 101);
    assert.equal(result.errors.length, 100);
  });

  add('version usage stops at the 100000-entry ceiling', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    await page.evaluate(() => {
      window.__setMockFile('target', '.filenally/index.json', {
        content: JSON.stringify({ schemaVersion: 1, versions: [] }),
      });
      const root = window.__mockPair.target.entries.get('.filenally');
      root.values = () => {
        let index = 0;
        return {
          [Symbol.asyncIterator]() { return this; },
          async next() {
            if (index > 100000) return { done: true };
            const name = `file-${index++}`;
            return { done: false, value: { kind: 'file', name,
              getFile: async () => new File([], name) } };
          },
          async return() { return { done: true }; },
        };
      };
    });
    const result = await inspectVersionUsage(page);
    assert.equal(result.inspection, 'partial');
    assert.equal(result.visited, 100000);
    assert.equal(result.observed.count, 100000);
    assert.deepEqual(result.observed.missingIds, []);
    assert.match(result.errors[0].message, /100000/);
  });

  add('version usage stops before traversing beyond depth 256', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    await page.evaluate(() => {
      window.__setMockFile('target', '.filenally/index.json', {
        content: JSON.stringify({ schemaVersion: 1, versions: [] }),
      });
      const makeDirectory = (depth) => ({
        kind: 'directory', name: 'd',
        values: () => {
          let yielded = false;
          return {
            [Symbol.asyncIterator]() { return this; },
            async next() {
              if (yielded) return { done: true };
              yielded = true;
              return depth <= 256 ? { done: false, value: makeDirectory(depth + 1) } : { done: true };
            },
            async return() { return { done: true }; },
          };
        },
      });
      window.__mockPair.target.entries.get('.filenally').values = () => {
        let yielded = false;
        return {
          [Symbol.asyncIterator]() { return this; },
          async next() {
            if (yielded) return { done: true };
            yielded = true;
            return { done: false, value: makeDirectory(1) };
          },
          async return() { return { done: true }; },
        };
      };
    });
    const result = await inspectVersionUsage(page);
    assert.equal(result.inspection, 'partial');
    assert.equal(result.visited, 257);
    assert.deepEqual(result.observed.missingIds, []);
    assert.match(result.errors[0].message, /256/);
  });

  add('version usage stops before resolving a path beyond 8192 code units', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    await page.evaluate(() => {
      window.__setMockFile('target', '.filenally/index.json', {
        content: JSON.stringify({ schemaVersion: 1, versions: [] }),
      });
      const name = 'x'.repeat(8193);
      window.__mockPair.target.entries.get('.filenally').values = () => {
        let yielded = false;
        return {
          [Symbol.asyncIterator]() { return this; },
          async next() {
            if (yielded) return { done: true };
            yielded = true;
            return { done: false, value: { kind: 'file', name,
              getFile: async () => { throw new Error('overlong path was resolved'); } } };
          },
          async return() { return { done: true }; },
        };
      };
    });
    const result = await inspectVersionUsage(page);
    assert.equal(result.inspection, 'partial');
    assert.equal(result.visited, 1);
    assert.equal(result.observed.count, 0);
    assert.match(result.errors[0].message, /8192/);
  });

  add('version usage cancellation before reads returns an honest empty cancelled report', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    const result = await page.evaluate(() => window.FileNallyTest.VersionStore.inspectUsage(
      window.__mockPair.target, { isCancelled: () => true },
    ));
    assert.equal(result.indexStatus, 'error');
    assert.equal(result.registered, null);
    assert.equal(result.inspection, 'cancelled');
    assert.equal(result.visited, 0);
    assert.deepEqual(result.observed.missingIds, []);
    await assertComparisonReadOnly(page, files, state);
  });

  add('version usage cancellation after an awaited metadata read excludes the late file', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    const result = await page.evaluate(async () => {
      let cancelled = false;
      const file = window.__mockPair.target.entries.get('.filenally').entries.get('versions')
        .entries.get('saved-1').entries.get('report.txt');
      const getFile = file.getFile.bind(file);
      file.getFile = async () => {
        const value = await getFile();
        cancelled = true;
        return value;
      };
      return window.FileNallyTest.VersionStore.inspectUsage(window.__mockPair.target,
        { isCancelled: () => cancelled });
    });
    assert.equal(result.inspection, 'cancelled');
    assert.equal(result.observed.registeredCount, 0);
    assert.deepEqual(result.observed.missingIds, []);
  });

  add('version usage cancellation after iterator next excludes the late entry', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    const result = await page.evaluate(async () => {
      let cancelled = false;
      const root = await window.__mockPair.target.getDirectoryHandle('.filenally', { create: true });
      root.values = () => ({
        [Symbol.asyncIterator]() { return this; },
        async next() {
          cancelled = true;
          return { done: false, value: { kind: 'file', name: 'late.txt',
            getFile: async () => new File(['late'], 'late.txt') } };
        },
        async return() { return { done: true }; },
      });
      return window.FileNallyTest.VersionStore.inspectUsage(window.__mockPair.target,
        { isCancelled: () => cancelled });
    });
    assert.equal(result.inspection, 'cancelled');
    assert.equal(result.visited, 0);
    assert.equal(result.observed.count, 0);
  });

  add('version usage converts a cancellation callback failure into a partial report', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    const result = await page.evaluate(() => window.FileNallyTest.VersionStore.inspectUsage(
      window.__mockPair.target, { isCancelled: () => { throw new Error('cancel callback failed'); } },
    ));
    assert.equal(result.inspection, 'partial');
    assert.equal(result.errorCount, 1);
    assert.match(result.errors[0].message, /cancel callback failed/);
  });

  add('version usage yields and reports progress every 128 visited entries', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    const result = await page.evaluate(async () => {
      for (let index = 0; index < 129; index += 1) {
        window.__setMockFile('target', `.filenally/file-${index}.txt`, { content: '' });
      }
      let cancelled = false;
      const progress = [];
      const report = await window.FileNallyTest.VersionStore.inspectUsage(window.__mockPair.target, {
        isCancelled: () => cancelled,
        onProgress: (value) => { progress.push(value); cancelled = true; },
      });
      return { report, progress };
    });
    assert.equal(result.report.inspection, 'cancelled');
    assert.equal(result.report.visited, 128);
    assert.deepEqual(result.progress, [{ visited: 128 }]);
  });

  add('version usage converts a progress callback failure into a partial report', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    await page.evaluate(() => {
      for (let index = 0; index < 128; index += 1) {
        window.__setMockFile('target', `.filenally/file-${index}.txt`, { content: '' });
      }
    });
    const result = await page.evaluate(() => window.FileNallyTest.VersionStore.inspectUsage(
      window.__mockPair.target, { onProgress: () => { throw new Error('progress failed'); } },
    ));
    assert.equal(result.inspection, 'partial');
    assert.equal(result.visited, 128);
    assert.equal(result.errorCount, 1);
    assert.match(result.errors[0].message, /progress failed/);
  });

  add('version usage marks an index replacement stale and withholds missing IDs', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    const result = await page.evaluate(async () => {
      const store = window.__mockPair.target.entries.get('.filenally');
      const index = store.entries.get('index.json');
      const getFile = index.getFile.bind(index);
      let reads = 0;
      index.getFile = async () => {
        const file = await getFile();
        reads += 1;
        if (reads === 2) window.__setMockFile('target', '.filenally/index.json', { content: index.content });
        return file;
      };
      window.__deleteMockEntry('target', '.filenally/versions/saved-1/report.txt');
      return window.FileNallyTest.VersionStore.inspectUsage(window.__mockPair.target);
    });
    assert.equal(result.inspection, 'stale');
    assert.deepEqual(result.observed.missingIds, []);
  });

  add('version usage marks an index arriving in an initially indexless store stale', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    const result = await page.evaluate(async () => {
      window.__setMockFile('target', '.filenally/versions/loose.txt', { content: 'x' });
      const store = window.__mockPair.target.entries.get('.filenally');
      const values = store.values.bind(store);
      store.values = () => {
        const iterator = values()[Symbol.asyncIterator]();
        return {
          [Symbol.asyncIterator]() { return this; },
          async next() {
            const next = await iterator.next();
            if (next.done) window.__setMockFile('target', '.filenally/index.json', {
              content: JSON.stringify({ schemaVersion: 1, versions: [] }),
            });
            return next;
          },
          async return() { return iterator.return ? iterator.return() : { done: true }; },
        };
      };
      return window.FileNallyTest.VersionStore.inspectUsage(window.__mockPair.target);
    });
    assert.equal(result.indexStatus, 'missing');
    assert.equal(result.inspection, 'stale');
    assert.deepEqual(result.observed.missingIds, []);
  });

  add('version usage marks a version-root replacement stale', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    const result = await page.evaluate(async () => {
      const target = window.__mockPair.target;
      const oldRoot = target.entries.get('.filenally');
      const replacement = await target.getDirectoryHandle('.replacement', { create: true });
      window.__setMockFile('target', '.replacement/index.json', { content: oldRoot.entries.get('index.json').content });
      const values = oldRoot.values.bind(oldRoot);
      oldRoot.values = () => {
        const iterator = values()[Symbol.asyncIterator]();
        return {
          [Symbol.asyncIterator]() { return this; },
          async next() {
            const next = await iterator.next();
            if (next.done) {
              target.entries.set('.filenally', replacement);
              target.entries.delete('.replacement');
            }
            return next;
          },
          async return() { return iterator.return ? iterator.return() : { done: true }; },
        };
      };
      return window.FileNallyTest.VersionStore.inspectUsage(target);
    });
    assert.equal(result.inspection, 'stale');
    assert.deepEqual(result.observed.missingIds, []);
  });

  add('version cleanup removes only a confirmed selected stored file', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
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

  for (const mutation of ['empty', 'duplicate', 'unknown', 'changed-record', '101',
    'unsafe-unselected-id', 'case-alias', 'root-identity', 'index-identity', 'parent-identity',
    'file-identity', 'missing', 'directory', 'size', 'unsafe-size', 'read-error', 'cancel']) {
    add(`version cleanup rejects preparation ${mutation} without mutations`, async ({ page }) => {
      await mountCleanup(page, mutation === '101' ? Array.from({ length: 101 }, (_, i) => cleanupFixture(`saved-${i}`))
        : [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
      await installCleanupObservation(page);
      const result = await page.evaluate(async mutation => {
        const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
        const folder = root.entries.get('.filenally'), index = folder.entries.get('index.json');
        const capture = folder.entries.get('versions').entries.get('saved-1');
        const file = capture.entries.get('report.txt');
        let records = [window.__cleanupRecords[0]], cancelled = false;
        if (mutation === 'empty') records = [];
        if (mutation === 'duplicate') records.push(records[0]);
        if (mutation === 'unknown') records = [{ ...records[0], id: 'unknown', storedPath: 'versions/unknown/report.txt' }];
        if (mutation === 'changed-record') records = [{ ...records[0], runId: 'other' }];
        if (mutation === '101') records = [...window.__cleanupRecords];
        if (mutation === 'unsafe-unselected-id') {
          const value = JSON.parse(index.content);
          value.versions[1].id = 'SAVED-2'; value.versions[1].storedPath = 'versions/SAVED-2/report.txt';
          index.content = JSON.stringify(value);
        }
        if (mutation === 'case-alias') capture.name = 'SAVED-1';
        if (mutation === 'root-identity') root.isSameEntry = undefined;
        if (mutation === 'index-identity') index.isSameEntry = undefined;
        if (mutation === 'parent-identity') capture.isSameEntry = undefined;
        if (mutation === 'file-identity') file.isSameEntry = undefined;
        if (mutation === 'missing') capture.entries.delete('report.txt');
        if (mutation === 'directory') {
          capture.entries.delete('report.txt'); await capture.getDirectoryHandle('report.txt', { create: true });
        }
        if (mutation === 'size') file.content = 'changed';
        if (mutation === 'unsafe-size') {
          const value = JSON.parse(index.content); value.versions[0].size = -1; index.content = JSON.stringify(value);
        }
        if (mutation === 'read-error') file.getFile = async () => { throw new DOMException('read denied', 'NotAllowedError'); };
        if (mutation === 'cancel') cancelled = true;
        window.__comparisonMutationAttempts.length = 0;
        const before = await window.__snapshotMockPair();
        let rejected = false;
        try { await store.prepareCleanup(root, records, { isCancelled: () => cancelled }); }
        catch (error) { if (error instanceof TypeError) throw error; rejected = true; }
        return { rejected, before, after: await window.__snapshotMockPair(), attempts: window.__comparisonMutationAttempts,
          requests: window.__getPermissionCalls().filter(v => v.method === 'request') };
      }, mutation);
      assert.equal(result.rejected, true);
      assert.deepEqual(result.after, result.before);
      assert.deepEqual(result.requests, []);
      assert.deepEqual(result.attempts, []);
    });
  }

  add('version cleanup pins opaque immutable summaries and requires last-copy acknowledgment', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    await installCleanupObservation(page);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
      window.__deleteMockEntry('target', '.filenally/versions/saved-2/report.txt');
      const prepared = await store.prepareCleanup(root, [window.__cleanupRecords[0]]);
      const frozen = [prepared, prepared.summary, prepared.summary.records, prepared.summary.records[0], prepared.summary.lastPaths].every(Object.isFrozen);
      const before = await window.__snapshotMockPair();
      let failure;
      try { await store.cleanup(prepared); } catch (error) { failure = error.cleanupResult; }
      let reused = false, forged = false;
      try { await store.cleanup(prepared, { acknowledgeLastVersions: true }); } catch { reused = true; }
      try { await store.cleanup({ summary: prepared.summary }, { acknowledgeLastVersions: true }); } catch { forged = true; }
      return { frozen, keys: Object.keys(prepared), summary: prepared.summary, failure, reused, forged,
        before, after: await window.__snapshotMockPair(), attempts: window.__comparisonMutationAttempts };
    });
    assert.equal(result.frozen, true);
    assert.deepEqual(result.keys, ['summary']);
    assert.deepEqual(result.summary.lastPaths, ['report.txt']);
    assert.equal(result.summary.bytes, '3');
    assert.equal(result.summary.upgradesIndex, true);
    assert.equal(result.failure.status, 'failed');
    assert.equal(result.failure.recoveryRequired, false);
    assert.equal(result.reused && result.forged, true);
    assert.deepEqual(result.after, result.before);
    assert.deepEqual(result.attempts, []);
  });

  for (const mutation of ['denied', 'cancel', 'bytes', 'mtime', 'index-bytes', 'index-replacement',
    'root-identity', 'version-root', 'parent-replacement', 'file-replacement', 'witness-missing', 'witness-metadata']) {
    add(`version cleanup refuses changed confirmation ${mutation} before intent`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
      await installCleanupObservation(page);
      const result = await page.evaluate(async mutation => {
        const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
        const prepared = await store.prepareCleanup(root, [window.__cleanupRecords[0]]);
        const folder = root.entries.get('.filenally'), captures = folder.entries.get('versions');
        const parent = captures.entries.get('saved-1'), file = parent.entries.get('report.txt');
        if (mutation === 'denied') root.permission = 'denied';
        if (mutation === 'bytes') file.content = 'NEW';
        if (mutation === 'mtime') file.lastModified++;
        if (mutation === 'index-bytes') folder.entries.get('index.json').content += ' ';
        if (mutation === 'index-replacement') window.__setMockFile('target', '.filenally/index.json', { content: folder.entries.get('index.json').content });
        if (mutation === 'root-identity') root.isSameEntry = async () => false;
        if (mutation === 'version-root') {
          const replacement = await root.getDirectoryHandle('swap', { create: true });
          replacement.entries = new Map(folder.entries); root.entries.set('.filenally', replacement); root.entries.delete('swap');
        }
        if (mutation === 'parent-replacement') {
          const replacement = await captures.getDirectoryHandle('swap', { create: true });
          replacement.name = 'saved-1'; replacement.entries = new Map(parent.entries);
          captures.entries.set('saved-1', replacement); captures.entries.delete('swap');
        }
        if (mutation === 'file-replacement') window.__setMockFile('target', '.filenally/versions/saved-1/report.txt', { content: 'old', lastModified: 100 });
        if (mutation === 'witness-missing') captures.entries.get('saved-2').entries.delete('report.txt');
        if (mutation === 'witness-metadata') captures.entries.get('saved-2').entries.get('report.txt').lastModified++;
        window.__comparisonMutationAttempts.length = 0;
        const before = await window.__snapshotMockPair();
        let completed;
        try { completed = await store.cleanup(prepared, { isCancelled: () => mutation === 'cancel' }); }
        catch (error) { completed = error.cleanupResult; }
        return { completed, before, after: await window.__snapshotMockPair(), attempts: window.__comparisonMutationAttempts };
      }, mutation);
      assert.equal(result.completed.status, mutation === 'cancel' ? 'stopped' : 'failed');
      assert.deepEqual(result.completed.completedIds, []);
      assert.equal(result.completed.recoveryRequired, false);
      assert.deepEqual(result.after, result.before);
      assert.deepEqual(result.attempts, []);
    });
  }

  for (const boundary of ['intent-open', 'intent-write', 'intent-close', 'intent-readback', 'intent-read-error', 'first-remove', 'second-remove',
    'remove-no-absence', 'remove-directory', 'commit-open', 'commit-write', 'commit-close', 'commit-readback', 'commit-read-error', 'commit-index-change']) {
    add(`version cleanup stops conservatively at ${boundary}`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2'), cleanupFixture('saved-3')]);
      await installCleanupObservation(page);
      const result = await page.evaluate(async boundary => {
        const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
        const prepared = await store.prepareCleanup(root, window.__cleanupRecords.slice(0, 2));
        const stage = boundary.startsWith('intent') ? 1 : 2;
        const index = root.entries.get('.filenally').entries.get('index.json');
        const open = index.createWritable.bind(index);
        let opens = 0;
        index.createWritable = async () => {
          if (++opens === stage && boundary.endsWith('open')) throw new DOMException('open denied', 'NotAllowedError');
          return open();
        };
        if (boundary.endsWith('write') || boundary.endsWith('close')) window.__setMockFailure({ operation: boundary.split('-')[1], name: 'index.json', occurrence: stage });
        let closes = 0;
        window.__mockAfterClose = async handle => {
          if (handle.name === 'index.json' && ++closes === stage) {
            if (boundary.endsWith('readback')) handle.content += ' ';
            if (boundary.endsWith('read-error')) handle.getFile = async () => { throw new DOMException('readback failed', 'NotReadableError'); };
          }
        };
        window.__beforeCleanupRemove = async (parent, name) => {
          if (boundary === 'first-remove' || (boundary === 'second-remove' && window.__cleanupRemovals.length === 2)) throw new DOMException('remove denied', 'NotAllowedError');
          if (boundary === 'commit-index-change') index.content += ' ';
          if (boundary === 'remove-directory') { parent.entries.delete(name); await parent.getDirectoryHandle(name, { create: true }); }
        };
        window.__skipCleanupRemove = ['remove-no-absence', 'remove-directory'].includes(boundary);
        let failure;
        try { await store.cleanup(prepared); } catch (error) { failure = error.cleanupResult; }
        const snapshot = await window.__snapshotMockPair();
        return { failure, snapshot, removals: window.__cleanupRemovals };
      }, boundary);
      assert.equal(result.failure.status, 'failed');
      assert.equal(result.failure.recoveryRequired, true);
      assert.deepEqual(result.failure.completedIds, boundary === 'second-remove' ? ['saved-1'] : []);
      assert.equal(result.failure.completedBytes, boundary === 'second-remove' ? '3' : '0');
      assert.equal(result.removals.length, boundary.startsWith('intent') ? 0 : boundary === 'second-remove' ? 2 : 1);
      for (const removal of result.removals) assert.deepEqual(removal.options, []);
      const versions = result.snapshot.target['.filenally'].versions;
      assert.equal(versions['saved-3']['report.txt'].content, 'old');
      assert.equal(versions['saved-2']['report.txt'].content, 'old');
      const deletedFirst = boundary.startsWith('commit') || boundary === 'second-remove';
      assert.equal(Object.hasOwn(versions['saved-1'], 'report.txt'), !deletedFirst);
      if (boundary === 'remove-directory') assert.deepEqual(versions['saved-1']['report.txt'], {});
      assert.equal(result.snapshot.target['report.txt'].content, 'target-current');
      assert.equal(result.snapshot.source['report.txt'].content, 'source-current');
    });
  }

  for (const scenario of ['intent-only', 'deleted-before-commit', 'committed-before-next']) {
    add(`version recovery reconciles persisted ${scenario} without touching payloads`, async ({ page }) => {
      const fixtures = [cleanupFixture('saved-1'), cleanupFixture('saved-2'), cleanupFixture('unrelated')];
      const cleanup = cleanupIntent({ remainingIds: scenario === 'committed-before-next' ? ['saved-2'] : ['saved-1', 'saved-2'],
        completedCount: scenario === 'committed-before-next' ? 1 : 0, completedBytes: scenario === 'committed-before-next' ? '3' : '0' });
      if (scenario === 'committed-before-next') fixtures.shift();
      await page.reload();
      await mountCleanup(page, fixtures, { schemaVersion: 2, cleanup });
      await page.evaluate(scenario => {
        if (scenario === 'deleted-before-commit') window.__deleteMockEntry('target', '.filenally/versions/saved-1/report.txt');
        window.__deleteMockEntry('target', '.filenally/versions/unrelated/report.txt');
      }, scenario);
      await installCleanupObservation(page);
      const result = await page.evaluate(async () => {
        const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
        const before = await window.__snapshotMockPair();
        const prepared = await store.prepareCleanupRecovery(root);
        const frozen = [prepared, prepared.summary, prepared.summary.missingRecords, prepared.summary.preservedRecords,
          ...prepared.summary.missingRecords, ...prepared.summary.preservedRecords].every(Object.isFrozen);
        const preparedState = await window.__snapshotMockPair();
        const completed = await store.recoverCleanup(prepared);
        let reused = false, forged = false;
        try { await store.recoverCleanup(prepared); } catch { reused = true; }
        try { await store.recoverCleanup({ summary: prepared.summary }); } catch { forged = true; }
        return { before, preparedState, after: await window.__snapshotMockPair(), frozen, summary: prepared.summary,
          completed, reused, forged, attempts: window.__comparisonMutationAttempts, removals: window.__cleanupRemovals };
      });
      assert.equal(result.frozen && result.reused && result.forged, true);
      assert.deepEqual(result.before, result.preparedState);
      const missing = scenario === 'deleted-before-commit' ? ['saved-1'] : [];
      const preserved = scenario === 'intent-only' ? ['saved-1', 'saved-2'] : ['saved-2'];
      assert.deepEqual(result.summary.missingRecords.map(r => r.id), missing);
      assert.deepEqual(result.summary.preservedRecords.map(r => r.id), preserved);
      assert.equal(result.summary.completedCount, scenario === 'committed-before-next' ? 1 : 0);
      assert.equal(result.summary.completedBytes, scenario === 'committed-before-next' ? '3' : '0');
      assert.deepEqual(result.completed.removedIds, missing);
      assert.deepEqual(result.completed.preservedIds, preserved);
      const index = JSON.parse(result.after.target['.filenally']['index.json'].content);
      assert.equal(index.schemaVersion, 2);
      assert.equal(index.cleanup, null);
      assert.deepEqual(index.versions.map(r => r.id), [...preserved, 'unrelated']);
      assert.deepEqual(result.after.target['.filenally'].versions, result.before.target['.filenally'].versions);
      assert.deepEqual(result.removals, []);
      assert.deepEqual(result.attempts, ['createWritable:index.json']);
    });
  }

  for (const mutation of ['missing-present', 'present-missing', 'file-replacement', 'parent-replacement',
    'missing-parent-arrival', 'missing-parent-replacement', 'index-swap', 'denied', 'metadata']) {
    add(`version recovery rejects changed confirmation ${mutation} without writing`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')], {
        schemaVersion: 2, cleanup: cleanupIntent({ remainingIds: ['saved-1', 'saved-2'] }) });
      const result = await page.evaluate(async mutation => {
        const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
        const folder = root.entries.get('.filenally'), captures = folder.entries.get('versions');
        if (mutation.startsWith('missing-parent')) captures.entries.delete('saved-1');
        else captures.entries.get('saved-1').entries.delete('report.txt');
        const prepared = await store.prepareCleanupRecovery(root);
        if (mutation === 'missing-present') window.__setMockFile('target', '.filenally/versions/saved-1/report.txt', { content: 'old', lastModified: 100 });
        if (mutation === 'present-missing') captures.entries.get('saved-2').entries.delete('report.txt');
        if (mutation === 'file-replacement') window.__setMockFile('target', '.filenally/versions/saved-2/report.txt', { content: 'old', lastModified: 100 });
        if (mutation === 'parent-replacement') {
          const replacement = await captures.getDirectoryHandle('swap', { create: true });
          replacement.name = 'saved-2'; replacement.entries = new Map(captures.entries.get('saved-2').entries);
          captures.entries.set('saved-2', replacement); captures.entries.delete('swap');
        }
        if (mutation === 'missing-parent-arrival') await captures.getDirectoryHandle('saved-1', { create: true });
        if (mutation === 'missing-parent-replacement') {
          const replacement = await folder.getDirectoryHandle('swap', { create: true });
          replacement.name = 'versions'; replacement.entries = new Map(captures.entries);
          folder.entries.set('versions', replacement); folder.entries.delete('swap');
        }
        if (mutation === 'index-swap') window.__setMockFile('target', '.filenally/index.json', { content: folder.entries.get('index.json').content });
        if (mutation === 'denied') root.permission = 'denied';
        if (mutation === 'metadata') captures.entries.get('saved-2').entries.get('report.txt').lastModified++;
        const before = await window.__snapshotMockPair();
        let rejected = false, reused = false;
        try { await store.recoverCleanup(prepared); } catch { rejected = true; }
        try { await store.recoverCleanup(prepared); } catch { reused = true; }
        return { rejected, reused, before, after: await window.__snapshotMockPair() };
      }, mutation);
      assert.equal(result.rejected && result.reused, true);
      assert.deepEqual(result.after, result.before);
    });
  }

  for (const mutation of ['no-intent', 'malformed-intent', 'size', 'directory', 'read-error', 'identity', 'unsafe-id', 'cancel']) {
    add(`version recovery rejects preparation ${mutation}`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1')], { schemaVersion: 2, cleanup: cleanupIntent() });
      const result = await page.evaluate(async mutation => {
        const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
        const folder = root.entries.get('.filenally'), index = folder.entries.get('index.json');
        const capture = folder.entries.get('versions').entries.get('saved-1'), file = capture.entries.get('report.txt');
        if (mutation === 'no-intent') { const v = JSON.parse(index.content); v.cleanup = null; index.content = JSON.stringify(v); }
        if (mutation === 'malformed-intent') { const v = JSON.parse(index.content); v.cleanup.remainingIds = []; index.content = JSON.stringify(v); }
        if (mutation === 'size') file.content = 'wrong size';
        if (mutation === 'directory') { capture.entries.delete('report.txt'); await capture.getDirectoryHandle('report.txt', { create: true }); }
        if (mutation === 'read-error') file.getFile = async () => { throw new DOMException('read failed', 'NotReadableError'); };
        if (mutation === 'identity') capture.isSameEntry = undefined;
        if (mutation === 'unsafe-id') {
          const v = JSON.parse(index.content); v.versions[0].id = 'SAVED-1'; v.versions[0].storedPath = 'versions/SAVED-1/report.txt';
          v.cleanup.remainingIds = ['SAVED-1']; index.content = JSON.stringify(v);
        }
        const before = await window.__snapshotMockPair();
        let rejected = false;
        try { await store.prepareCleanupRecovery(root, { isCancelled: () => mutation === 'cancel' }); }
        catch (error) { if (error instanceof TypeError) throw error; rejected = true; }
        return { rejected, before, after: await window.__snapshotMockPair() };
      }, mutation);
      assert.equal(result.rejected, true);
      assert.deepEqual(result.after, result.before);
    });
  }

  for (const boundary of ['write', 'close', 'readback']) {
    add(`version recovery ${boundary} failure consumes token and preserves version payloads`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')], { schemaVersion: 2,
        cleanup: cleanupIntent({ remainingIds: ['saved-1', 'saved-2'] }) });
      await installCleanupObservation(page);
      const result = await page.evaluate(async boundary => {
        window.__deleteMockEntry('target', '.filenally/versions/saved-1/report.txt');
        const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
        const before = await window.__snapshotMockPair();
        const prepared = await store.prepareCleanupRecovery(root);
        if (boundary === 'readback') window.__mockAfterClose = async h => { h.content += ' '; };
        else window.__setMockFailure({ operation: boundary, name: 'index.json' });
        let rejected = false, reused = false;
        try { await store.recoverCleanup(prepared); } catch { rejected = true; }
        try { await store.recoverCleanup(prepared); } catch { reused = true; }
        return { rejected, reused, before, after: await window.__snapshotMockPair(), removals: window.__cleanupRemovals };
      }, boundary);
      assert.equal(result.rejected && result.reused, true);
      assert.deepEqual(result.removals, []);
      assert.deepEqual(result.after.target['.filenally'].versions, result.before.target['.filenally'].versions);
    });
  }

  add('version cleanup publishes only frozen committed progress summaries', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-b'), cleanupFixture('saved-a'), cleanupFixture('saved-c', 'report.txt', 'old', '2026-09-12T00:00:00.000Z')]);
    await installCleanupObservation(page);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore, progress = [];
      const prepared = await store.prepareCleanup(root, window.__cleanupRecords);
      const complete = await store.cleanup(prepared, { acknowledgeLastVersions: true, onProgress: value => {
        progress.push({ value, frozen: [value, value.completedIds, value.remainingIds].every(Object.isFrozen),
          index: JSON.parse(root.entries.get('.filenally').entries.get('index.json').content) });
      } });
      return { complete, progress, removals: window.__cleanupRemovals };
    });
    assert.deepEqual(result.complete.completedIds, ['saved-c', 'saved-a', 'saved-b']);
    assert.equal(result.complete.completedBytes, '9');
    assert.equal(result.complete.recoveryRequired, false);
    assert.equal(result.progress.length, 3);
    for (const [i, progress] of result.progress.entries()) {
      assert.deepEqual(Object.keys(progress.value).sort(), ['completedBytes', 'completedIds', 'operationId', 'remainingIds']);
      assert.equal(progress.frozen, true);
      assert.equal(progress.value.completedIds.length, i + 1);
      assert.equal(progress.index.versions.length, 2 - i);
    }
  });

  for (const boundary of ['byte-read', 'remove', 'commit']) {
    add(`version cleanup cancellation during held ${boundary} respects the commit unit`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2'), cleanupFixture('saved-3')]);
      await installCleanupObservation(page);
      const result = await page.evaluate(async boundary => {
        const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
        const prepared = await store.prepareCleanup(root, window.__cleanupRecords.slice(0, 2));
        let release, reached, cancelled = false, inUnit = false, callsInsideUnit = 0;
        const hold = new Promise(resolve => { release = resolve; });
        const entered = new Promise(resolve => { reached = resolve; });
        if (boundary === 'byte-read') {
          const h = root.entries.get('.filenally').entries.get('versions').entries.get('saved-1').entries.get('report.txt');
          const getFile = h.getFile.bind(h);
          h.getFile = async () => {
            const file = await getFile(), slice = file.slice.bind(file);
            file.slice = (...args) => {
              const chunk = slice(...args), read = chunk.arrayBuffer.bind(chunk);
              chunk.arrayBuffer = async () => { reached(); await hold; return read(); };
              return chunk;
            };
            return file;
          };
        }
        window.__beforeCleanupRemove = async () => {
          inUnit = true;
          if (boundary === 'remove') { reached(); await hold; }
        };
        let closes = 0;
        window.__mockAfterClose = async handle => {
          if (handle.name === 'index.json' && ++closes === 2 && boundary === 'commit') { reached(); await hold; }
        };
        const progress = [];
        const running = store.cleanup(prepared, { isCancelled: () => {
          if (inUnit) callsInsideUnit++;
          return cancelled;
        }, onProgress: value => { inUnit = false; progress.push(value); } });
        await entered;
        cancelled = true;
        release();
        const completed = await running;
        return { completed, callsInsideUnit, progress, snapshot: await window.__snapshotMockPair(), removals: window.__cleanupRemovals };
      }, boundary);
      assert.equal(result.completed.status, 'stopped');
      assert.equal(result.callsInsideUnit, 0);
      assert.deepEqual(result.completed.completedIds, boundary === 'byte-read' ? [] : ['saved-1']);
      assert.equal(result.completed.completedBytes, boundary === 'byte-read' ? '0' : '3');
      assert.equal(result.completed.recoveryRequired, boundary !== 'byte-read');
      assert.equal(result.progress.length, boundary === 'byte-read' ? 0 : 1);
      assert.equal(result.removals.length, boundary === 'byte-read' ? 0 : 1);
      assert.equal(result.snapshot.target['.filenally'].versions['saved-2']['report.txt'].content, 'old');
    });
  }

  for (const scenario of ['first-callback', 'last-callback', 'retained-witness']) {
    add(`version cleanup ${scenario} ends safely and releases the writer`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2'), cleanupFixture('saved-3')]);
      await installCleanupObservation(page);
      const result = await page.evaluate(async scenario => {
        const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
        const count = scenario === 'last-callback' ? 1 : 2;
        const prepared = await store.prepareCleanup(root, window.__cleanupRecords.slice(0, count));
        let failure;
        try { await store.cleanup(prepared, { onProgress: () => {
          if (scenario === 'retained-witness') window.__deleteMockEntry('target', '.filenally/versions/saved-3/report.txt');
          else throw new Error('UI callback closed');
        } }); } catch (error) { failure = error.cleanupResult; }
        const beforeRecovery = await window.__snapshotMockPair();
        const resultFrozen = [failure, failure.completedIds, failure.remainingIds].every(Object.isFrozen);
        let unlocked;
        if (failure.recoveryRequired) unlocked = await store.recoverCleanup(await store.prepareCleanupRecovery(root));
        else unlocked = await store.capture({ action: { path: 'report.txt', fromSide: 'source', toSide: 'target' },
          handles: window.__mockPair, direction: 'unidirectional', runId: 'lock-test' });
        return { failure, resultFrozen, unlocked: !!unlocked, beforeRecovery, removals: window.__cleanupRemovals };
      }, scenario);
      assert.equal(result.failure.status, 'failed');
      assert.deepEqual(result.failure.completedIds, ['saved-1']);
      assert.equal(result.failure.completedBytes, '3');
      assert.equal(result.failure.recoveryRequired, scenario !== 'last-callback');
      assert.equal(result.resultFrozen && result.unlocked, true);
      assert.equal(result.removals.length, 1);
      assert.equal(result.beforeRecovery.target['.filenally'].versions['saved-2']['report.txt'].content, 'old');
      const index = JSON.parse(result.beforeRecovery.target['.filenally']['index.json'].content);
      assert.equal(index.cleanup === null, scenario === 'last-callback');
    });
  }

  add('version cleanup preserves physical owner originals and every unselected sibling with MIME differences', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1', 'nested/report.txt'), cleanupFixture('saved-2', 'nested/report.txt')]);
    await page.evaluate(() => {
      window.__setMockFile('target', 'nested/report.txt', { content: 'original nested' });
      window.__setMockFile('source', '.filenally/versions/saved-1/nested/report.txt', { content: 'other root body' });
      window.__setMockFile('target', '.trash/precious.txt', { content: 'trash untouched' });
      window.__setMockFile('target', '.filenally/versions/saved-1/nested/sibling.txt', { content: 'unexpected sibling' });
      window.__setMockFile('target', '.filenally/versions/unregistered/precious.txt', { content: 'orphan untouched' });
      window.__mockPair.source.name = window.__mockPair.target.name;
    });
    await installCleanupObservation(page);
    const before = await snapshotMockPair(page);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
      const prepared = await store.prepareCleanup(root, [window.__cleanupRecords[0]]);
      const h = root.entries.get('.filenally').entries.get('versions').entries.get('saved-1').entries.get('nested').entries.get('report.txt');
      h.getFile = async () => new File(['old'], 'report.txt', { type: 'application/octet-stream', lastModified: 100 });
      const completed = await store.cleanup(prepared);
      return { completed, after: await window.__snapshotMockPair(), attempts: window.__comparisonMutationAttempts, removals: window.__cleanupRemovals };
    });
    assert.equal(result.completed.status, 'complete');
    const expected = structuredClone(before);
    delete expected.target['.filenally'].versions['saved-1'].nested['report.txt'];
    expected.target['.filenally']['index.json'] = result.after.target['.filenally']['index.json'];
    assert.deepEqual(result.after, expected);
    assert.deepEqual(result.removals, [{ path: '/.filenally/versions/saved-1/nested/report.txt', options: [] }]);
    assert.deepEqual(result.attempts, ['createWritable:index.json', 'removeEntry:report.txt', 'createWritable:index.json']);
  });

  add('version cleanup rejects an intent exceeding 5 MiB before any write', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
      const index = root.entries.get('.filenally').entries.get('index.json');
      const value = JSON.parse(index.content);
      value.versions[1].runId = 'x'.repeat(5 * 1024 * 1024 - index.content.length - 20);
      index.content = JSON.stringify(value);
      const prepared = await store.prepareCleanup(root, [window.__cleanupRecords[0]]);
      let writes = 0;
      const write = index.createWritable.bind(index); index.createWritable = async () => { writes++; return write(); };
      const before = await window.__snapshotMockPair();
      let failure;
      try { await store.cleanup(prepared); } catch (error) { failure = error.cleanupResult; }
      return { failure, writes, before, after: await window.__snapshotMockPair() };
    });
    assert.equal(result.failure.status, 'failed');
    assert.equal(result.failure.recoveryRequired, false);
    assert.equal(result.writes, 0);
    assert.deepEqual(result.after, result.before);
  });

  for (const owner of ['cleanup', 'recovery']) {
    add(`version cleanup shared writer excludes all public writers during ${owner}`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
      const result = await page.evaluate(async ({ owner, intent }) => {
        const root = window.__mockPair.target, other = window.__mockPair.source, store = window.FileNallyTest.VersionStore;
        window.__setMockFile('source', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 2, versions: window.__cleanupRecords, cleanup: intent }) });
        for (const record of window.__cleanupRecords) window.__setMockFile('source', `.filenally/${record.storedPath}`, { content: 'old', lastModified: 100 });
        const cleanup = await store.prepareCleanup(root, [window.__cleanupRecords[0]]);
        const cleanup2 = await store.prepareCleanup(root, [window.__cleanupRecords[0]]);
        const recovery = await store.prepareCleanupRecovery(other);
        const recovery2 = await store.prepareCleanupRecovery(other);
        const restore = await store.prepareRestore(root, window.__cleanupRecords[0]);
        const index = (owner === 'cleanup' ? root : other).entries.get('.filenally').entries.get('index.json');
        const create = index.createWritable.bind(index);
        let release, reached;
        const hold = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { reached = resolve; });
        index.createWritable = async () => { reached(); await hold; return create(); };
        const running = owner === 'cleanup' ? store.cleanup(cleanup) : store.recoverCleanup(recovery);
        await entered;
        const outcomes = await Promise.allSettled([
          store.cleanup(cleanup2), store.recoverCleanup(recovery2),
          store.capture({ action: { path: 'report.txt', fromSide: 'source', toSide: 'target' }, handles: window.__mockPair, direction: 'unidirectional', runId: 'blocked' }),
          store.restore(restore, { side: 'target', direction: 'unidirectional', runId: 'blocked' }),
        ]);
        release(); await running;
        return outcomes.map(value => ({ status: value.status, error: value.reason?.message }));
      }, { owner, intent: cleanupIntent() });
      assert.equal(result.length, 4);
      for (const value of result) { assert.equal(value.status, 'rejected'); assert.match(value.error, /already running/); }
    });
  }

  add('version cleanup native OPFS selected deletion and restart recovery preserve siblings', async ({ page }) => {
    const directoryName = `filenally-cleanup-test-${require('node:crypto').randomUUID()}`;
    assert.match(directoryName, /^filenally-cleanup-test-[a-f0-9-]+$/);
    try {
      const first = await page.evaluate(async ({ directoryName, fixtures }) => {
        const bucket = await navigator.storage.getDirectory();
        const root = await bucket.getDirectoryHandle(directoryName, { create: true });
        if (typeof root.queryPermission !== 'function') root.queryPermission = async () => 'granted';
        const folder = await root.getDirectoryHandle('.filenally', { create: true });
        const versions = await folder.getDirectoryHandle('versions', { create: true });
        const write = async (parent, name, value) => {
          const handle = await parent.getFileHandle(name, { create: true }), stream = await handle.createWritable();
          await stream.write(value); await stream.close(); return handle;
        };
        for (const fixture of fixtures) {
          const parent = await versions.getDirectoryHandle(fixture.record.id, { create: true });
          await write(parent, 'report.txt', fixture.content);
        }
        await write(root, 'report.txt', 'native original');
        await write(versions, 'sibling.txt', 'native sibling');
        const index = await write(folder, 'index.json', JSON.stringify({ schemaVersion: 1, versions: fixtures.map(v => v.record) }));
        const store = window.FileNallyTest.VersionStore;
        const completed = await store.cleanup(await store.prepareCleanup(root, [fixtures[0].record]));
        let missing = false;
        try { await (await versions.getDirectoryHandle('saved-1')).getFileHandle('report.txt'); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; missing = true; }
        const finalIndex = JSON.parse(await (await index.getFile()).text());
        // Persist a crash boundary with real native writes, then reload before recovery.
        const pending = { ...finalIndex, cleanup: { id: 'native-restart', startedAt: '2026-09-13T00:00:00.000Z',
          remainingIds: ['saved-2', 'saved-3'], completedCount: 0, completedBytes: '0' } };
        const stream = await index.createWritable(); await stream.write(JSON.stringify(pending)); await stream.close();
        await (await versions.getDirectoryHandle('saved-2')).removeEntry('report.txt');
        return { completed, missing, finalIndex, nativeIdentity: typeof root.isSameEntry === 'function' };
      }, { directoryName, fixtures: [cleanupFixture('saved-1'), cleanupFixture('saved-2'), cleanupFixture('saved-3')] });
      assert.equal(first.completed.status, 'complete');
      assert.equal(first.missing && first.nativeIdentity, true);
      assert.equal(first.finalIndex.schemaVersion, 2);
      assert.equal(first.finalIndex.cleanup, null);
      assert.deepEqual(first.finalIndex.versions.map(v => v.id), ['saved-2', 'saved-3']);
      await page.reload();
      const recovered = await page.evaluate(async directoryName => {
        const bucket = await navigator.storage.getDirectory(), root = await bucket.getDirectoryHandle(directoryName);
        if (typeof root.queryPermission !== 'function') root.queryPermission = async () => 'granted';
        const store = window.FileNallyTest.VersionStore, prepared = await store.prepareCleanupRecovery(root);
        const result = await store.recoverCleanup(prepared);
        const folder = await root.getDirectoryHandle('.filenally'), versions = await folder.getDirectoryHandle('versions');
        const text = async (parent, name) => (await (await parent.getFileHandle(name)).getFile()).text();
        return { summary: prepared.summary, result, index: JSON.parse(await text(folder, 'index.json')),
          original: await text(root, 'report.txt'), sibling: await text(versions, 'sibling.txt'),
          preserved: await text(await versions.getDirectoryHandle('saved-3'), 'report.txt') };
      }, directoryName);
      assert.deepEqual(recovered.result.removedIds, ['saved-2']);
      assert.deepEqual(recovered.result.preservedIds, ['saved-3']);
      assert.equal(recovered.index.cleanup, null);
      assert.deepEqual(recovered.index.versions.map(v => v.id), ['saved-3']);
      assert.equal(recovered.original, 'native original');
      assert.equal(recovered.sibling, 'native sibling');
      assert.equal(recovered.preserved, 'old');
    } finally {
      await page.evaluate(async name => {
        if (!/^filenally-cleanup-test-[a-f0-9-]+$/.test(name)) throw new Error('Unsafe test cleanup target');
        const bucket = await navigator.storage.getDirectory();
        try { await bucket.removeEntry(name, { recursive: true }); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
      }, directoryName);
    }
  });

  for (const operation of ['cleanup', 'recovery']) {
    add(`version ${operation} rejects lost pinned identity during index close`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')], operation === 'recovery'
        ? { schemaVersion: 2, cleanup: cleanupIntent() } : {});
      await installCleanupObservation(page);
      const result = await page.evaluate(async operation => {
        const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
        const prepared = operation === 'cleanup' ? await store.prepareCleanup(root, [window.__cleanupRecords[0]]) : await store.prepareCleanupRecovery(root);
        window.__mockAfterClose = async handle => {
          handle.isSameEntry = undefined;
          window.__setMockFile('target', '.filenally/index.json', { content: handle.content, lastModified: handle.lastModified });
        };
        let rejected = false;
        try { if (operation === 'cleanup') await store.cleanup(prepared); else await store.recoverCleanup(prepared); }
        catch { rejected = true; }
        return { rejected, removals: window.__cleanupRemovals, snapshot: await window.__snapshotMockPair() };
      }, operation);
      assert.equal(result.rejected, true);
      assert.deepEqual(result.removals, []);
      assert.equal(result.snapshot.target['.filenally'].versions['saved-1']['report.txt'].content, 'old');
    });
  }

  add('version cleanup preparation propagates a one-shot cancellation callback error while pinning retained witness', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
      const witness = root.entries.get('.filenally').entries.get('versions').entries.get('saved-2').entries.get('report.txt');
      const getFile = witness.getFile.bind(witness);
      let throwNext = false, rejected = false, message;
      witness.getFile = async () => { const file = await getFile(); throwNext = true; return file; };
      const before = await window.__snapshotMockPair();
      try { await store.prepareCleanup(root, [window.__cleanupRecords[0]], { isCancelled: () => {
        if (throwNext) { throwNext = false; throw new Error('Callback owner expired'); }
        return false;
      } }); } catch (error) { rejected = true; message = error.message; }
      return { rejected, message, before, after: await window.__snapshotMockPair() };
    });
    assert.equal(result.rejected, true);
    assert.match(result.message, /Callback owner expired/);
    assert.deepEqual(result.after, result.before);
  });

  add('version cleanup rejects parent replacement during removal before committing the record', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    await installCleanupObservation(page);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
      const prepared = await store.prepareCleanup(root, [window.__cleanupRecords[0]]);
      window.__beforeCleanupRemove = async parent => {
        const captures = root.entries.get('.filenally').entries.get('versions');
        const replacement = await captures.getDirectoryHandle('swap', { create: true });
        replacement.name = 'saved-1'; replacement.entries = new Map(parent.entries);
        captures.entries.set('saved-1', replacement); captures.entries.delete('swap');
      };
      let failure;
      try { await store.cleanup(prepared); } catch (error) { failure = error.cleanupResult; }
      return { failure, snapshot: await window.__snapshotMockPair(), removals: window.__cleanupRemovals };
    });
    assert.equal(result.failure?.status, 'failed');
    assert.deepEqual(result.failure.completedIds, []);
    assert.equal(result.failure.recoveryRequired, true);
    const index = JSON.parse(result.snapshot.target['.filenally']['index.json'].content);
    assert.deepEqual(index.versions.map(v => v.id), ['saved-1', 'saved-2']);
    assert.equal(result.snapshot.target['.filenally'].versions['saved-1']['report.txt'].content, 'old');
    assert.equal(result.removals.length, 1);
  });

  for (const mutation of ['bytes', 'file-replacement', 'index-change', 'cancel', 'callback-error']) {
    add(`version cleanup revalidates next item after ${mutation} at a committed boundary`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2'), cleanupFixture('saved-3')]);
      await installCleanupObservation(page);
      const result = await page.evaluate(async mutation => {
        const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
        const prepared = await store.prepareCleanup(root, window.__cleanupRecords.slice(0, 2));
        let stopped = false, result;
        try { result = await store.cleanup(prepared, { isCancelled: () => {
          if (stopped && mutation === 'callback-error') throw new Error('owner gone');
          return stopped && mutation === 'cancel';
        }, onProgress: () => {
          const folder = root.entries.get('.filenally');
          stopped = true;
          if (mutation === 'bytes') folder.entries.get('versions').entries.get('saved-2').entries.get('report.txt').content = 'NEW';
          if (mutation === 'file-replacement') window.__setMockFile('target', '.filenally/versions/saved-2/report.txt', { content: 'old', lastModified: 100 });
          if (mutation === 'index-change') folder.entries.get('index.json').content += ' ';
        } }); } catch (error) { result = error.cleanupResult; }
        return { result, snapshot: await window.__snapshotMockPair(), removals: window.__cleanupRemovals };
      }, mutation);
      assert.equal(result.result.status, mutation === 'cancel' ? 'stopped' : 'failed');
      assert.deepEqual(result.result.completedIds, ['saved-1']);
      assert.deepEqual(result.result.remainingIds, ['saved-2']);
      assert.equal(result.result.completedBytes, '3');
      assert.equal(result.result.recoveryRequired, true);
      assert.equal(result.removals.length, 1);
      assert.equal(result.snapshot.target['.filenally'].versions['saved-2']['report.txt'].content, mutation === 'bytes' ? 'NEW' : 'old');
    });
  }

  add('version cleanup stops after verified intent without deleting a payload', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
    await installCleanupObservation(page);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
      const prepared = await store.prepareCleanup(root, [window.__cleanupRecords[0]]);
      let cancelled = false;
      window.__mockAfterClose = async () => { cancelled = true; };
      const completed = await store.cleanup(prepared, { isCancelled: () => cancelled });
      return { completed, removals: window.__cleanupRemovals, snapshot: await window.__snapshotMockPair() };
    });
    assert.equal(result.completed.status, 'stopped');
    assert.deepEqual(result.completed.completedIds, []);
    assert.equal(result.completed.recoveryRequired, true);
    assert.deepEqual(result.removals, []);
    assert.equal(JSON.parse(result.snapshot.target['.filenally']['index.json'].content).cleanup.remainingIds[0], 'saved-1');
  });

  add('version cleanup accepts exactly 100 distinct selected versions including zero-byte bodies', async ({ page }) => {
    await mountCleanup(page, Array.from({ length: 100 }, (_, i) => cleanupFixture(`saved-${String(i).padStart(3, '0')}`, 'report.txt', '')));
    await installCleanupObservation(page);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
      const completed = await store.cleanup(await store.prepareCleanup(root, window.__cleanupRecords), { acknowledgeLastVersions: true });
      return { completed, snapshot: await window.__snapshotMockPair(), removals: window.__cleanupRemovals };
    });
    assert.equal(result.completed.status, 'complete');
    assert.equal(result.completed.completedIds.length, 100);
    assert.equal(result.completed.completedBytes, '0');
    assert.equal(result.completed.recoveryRequired, false);
    assert.deepEqual(JSON.parse(result.snapshot.target['.filenally']['index.json'].content), { schemaVersion: 2, versions: [], cleanup: null });
    assert.equal(result.removals.length, 100);
    for (const removal of result.removals) assert.deepEqual(removal.options, []);
  });

  for (const defect of ['size', 'directory', 'read-error', 'identity']) {
    add(`version cleanup requires last-copy acknowledgment for a retained witness with ${defect}`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1'), cleanupFixture('saved-2')]);
      const result = await page.evaluate(async defect => {
        const root = window.__mockPair.target, store = window.FileNallyTest.VersionStore;
        const parent = root.entries.get('.filenally').entries.get('versions').entries.get('saved-2'), file = parent.entries.get('report.txt');
        if (defect === 'size') file.content = 'wrong size';
        if (defect === 'directory') { parent.entries.delete('report.txt'); await parent.getDirectoryHandle('report.txt', { create: true }); }
        if (defect === 'read-error') file.getFile = async () => { throw new DOMException('read denied', 'NotAllowedError'); };
        if (defect === 'identity') file.isSameEntry = undefined;
        const prepared = await store.prepareCleanup(root, [window.__cleanupRecords[0]]);
        const completed = await store.cleanup(prepared, { acknowledgeLastVersions: true });
        return { summary: prepared.summary, completed, snapshot: await window.__snapshotMockPair() };
      }, defect);
      assert.deepEqual(result.summary.lastPaths, ['report.txt']);
      assert.equal(result.completed.status, 'complete');
      assert.deepEqual(JSON.parse(result.snapshot.target['.filenally']['index.json'].content).versions.map(v => v.id), ['saved-2']);
    });
  }

  add('version maintenance lists an idle v2 index without rewriting it', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')], { schemaVersion: 2 });
    await installComparisonMutationSpies(page);
    const files = await snapshotMockPair(page), state = await comparisonState(page);
    const ids = await page.evaluate(async () => (await window.FileNallyTest.VersionStore
      .list(window.__mockPair.target)).map(record => record.id));
    assert.deepEqual(ids, ['saved-1']);
    await assertComparisonReadOnly(page, files, state);
  });

  const cleanupIntent = (overrides = {}) => ({
    id: 'cleanup-1', startedAt: '2026-09-13T00:00:00.000Z', remainingIds: ['saved-1'],
    completedCount: 0, completedBytes: '0', ...overrides,
  });
  const maintenanceInvalidIndexes = [
    ['missing cleanup field', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record] })],
    ['extra top-level field', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: null, extra: true })],
    ['extra cleanup field', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ extra: true }) })],
    ['unknown schema', () => ({ schemaVersion: 3, versions: [cleanupFixture('saved-1').record] })],
    ['duplicate records', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record, cleanupFixture('saved-1').record], cleanup: null })],
    ['unknown remaining ID', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ remainingIds: ['missing'] }) })],
    ['duplicate remaining IDs', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ remainingIds: ['saved-1', 'saved-1'] }) })],
    ['empty remaining IDs', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ remainingIds: [] }) })],
    ['more than 100 remaining IDs', () => {
      const fixtures = Array.from({ length: 101 }, (_, index) => cleanupFixture(`saved-${index}`));
      return { schemaVersion: 2, versions: fixtures.map(item => item.record),
        cleanup: cleanupIntent({ remainingIds: fixtures.map(item => item.record.id) }) };
    }],
    ['noncanonical startedAt', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ startedAt: '2026-09-13' }) })],
    ['unsafe cleanup ID', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ id: 'bad/id' }) })],
    ['negative completed count', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ completedCount: -1 }) })],
    ['fractional completed count', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ completedCount: 0.5 }) })],
    ['completed count above 100', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ completedCount: 101 }) })],
    ['count plus remaining above 100', () => {
      const fixtures = Array.from({ length: 100 }, (_, index) => cleanupFixture(`saved-${index}`));
      return { schemaVersion: 2, versions: fixtures.map(item => item.record), cleanup: cleanupIntent({
        remainingIds: fixtures.map(item => item.record.id), completedCount: 1, completedBytes: '1',
      }) };
    }],
    ['leading-zero completed bytes', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ completedCount: 1, completedBytes: '01' }) })],
    ['negative completed bytes', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ completedCount: 1, completedBytes: '-1' }) })],
    ['non-string completed bytes', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ completedCount: 1, completedBytes: 1 }) })],
    ['more than 18 completed-byte digits', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ completedCount: 1, completedBytes: '1000000000000000000' }) })],
    ['completed bytes above maximum', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ completedCount: 1, completedBytes: '900719925474099101' }) })],
    ['zero count with nonzero bytes', () => ({ schemaVersion: 2, versions: [cleanupFixture('saved-1').record], cleanup: cleanupIntent({ completedBytes: '1' }) })],
    ['negative v2 record size', () => ({ schemaVersion: 2, versions: [{ ...cleanupFixture('saved-1').record, size: -1 }], cleanup: null })],
    ['fractional v2 record size', () => ({ schemaVersion: 2, versions: [{ ...cleanupFixture('saved-1').record, size: 0.5 }], cleanup: null })],
    ['unsafe v2 record size', () => ({ schemaVersion: 2, versions: [{ ...cleanupFixture('saved-1').record, size: Number.MAX_SAFE_INTEGER + 1 }], cleanup: null })],
  ];
  for (const [name, makeIndex] of maintenanceInvalidIndexes) {
    add(`version maintenance rejects ${name} without rewriting it`, async ({ page }) => {
      const index = makeIndex();
      const fixtures = index.versions.map((record) => ({ record,
        content: 'x'.repeat(Number.isSafeInteger(record.size) && record.size >= 0 && record.size < 1024 ? record.size : 1) }));
      await mountCleanup(page, fixtures, { schemaVersion: 2 });
      await page.evaluate((value) => {
        window.__mockPair.target.entries.get('.filenally').entries.get('index.json').content = JSON.stringify(value);
      }, index);
      await installComparisonMutationSpies(page);
      const files = await snapshotMockPair(page), state = await comparisonState(page);
      const result = await page.evaluate((text) => {
        try { window.FileNallyTest.VersionStore.parseIndexText(text); return { rejected: false }; }
        catch (error) { return { rejected: true, code: error.code || '', message: error.message }; }
      }, JSON.stringify(index));
      assert.equal(result.rejected, true);
      assert.notEqual(result.code, 'VERSION_CLEANUP_PENDING');
      assert.ok(result.message); assert.doesNotMatch(result.message, /is not a function/);
      await assertComparisonReadOnly(page, files, state);
    });
  }

  for (const schemaVersion of [1, 2]) {
    add(`version maintenance capture preserves schema v${schemaVersion}`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1')], { schemaVersion });
      const result = await page.evaluate(async () => {
        const store = window.FileNallyTest.VersionStore;
        const record = await store.capture({ action: { path: 'report.txt', fromSide: 'source', toSide: 'target' },
          handles: { target: window.__mockPair.target }, runId: 'capture-1', direction: 'unidirectional' });
        const snapshot = await window.__snapshotMockPair();
        return { record, index: JSON.parse(snapshot.target['.filenally']['index.json'].content),
          indexText: snapshot.target['.filenally']['index.json'].content };
      });
      assert.equal(result.index.schemaVersion, schemaVersion);
      assert.equal(result.index.versions.length, 2);
      assert.equal(result.index.versions[1].id, result.record.id);
      if (schemaVersion === 2) {
        assert.equal(result.index.cleanup, null);
        assert.equal(result.indexText, JSON.stringify(result.index));
      }
    });
  }

  add('version maintenance restore backup uses the owning writer without self-deadlock', async ({ page }) => {
    await mountVersion(page);
    const result = await page.evaluate(async () => {
      const store = window.FileNallyTest.VersionStore, root = window.__mockPair.target;
      return store.restore(await store.prepareRestore(root, window.__versionRecord), {
        side: 'target', direction: 'unidirectional', runId: 'restore-1',
      });
    });
    assert.ok(result.backup);
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target['report.txt'].content, 'old');
    assert.equal(snapshot.target['.filenally'].versions[result.backup.id]['report.txt'].content, 'current');
  });

  add('version maintenance rejects a second concurrent public capture', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    const statuses = await page.evaluate(async () => {
      window.__mockPair.target.entries.get('.filenally').entries.get('index.json').writeDelay = 30;
      const options = { action: { path: 'report.txt', fromSide: 'source', toSide: 'target' },
        handles: { target: window.__mockPair.target }, runId: 'capture-1', direction: 'unidirectional' };
      return (await Promise.allSettled([
        window.FileNallyTest.VersionStore.capture(options),
        window.FileNallyTest.VersionStore.capture({ ...options, runId: 'capture-2' }),
      ])).map(result => result.status);
    });
    assert.deepEqual(statuses, ['fulfilled', 'rejected']);
  });

  add('version maintenance writer rejects a generated duplicate ID before changing stored bytes', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    const before = await snapshotMockPair(page);
    const result = await page.evaluate(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'saved-1' });
      try {
        await window.FileNallyTest.VersionStore.capture({
          action: { path: 'report.txt', fromSide: 'source', toSide: 'target' },
          handles: { target: window.__mockPair.target }, runId: 'capture-1', direction: 'unidirectional',
        });
        return { rejected: false };
      } catch (error) { return { rejected: true, message: error.message }; }
      finally {
        if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor);
        else delete crypto.randomUUID;
      }
    });
    assert.equal(result.rejected, true); assert.match(result.message, /Duplicate version IDs/);
    assert.deepEqual(await snapshotMockPair(page), before);
  });

  add('version maintenance pending cleanup blocks capture before creating version bytes', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')], { schemaVersion: 2, cleanup: cleanupIntent() });
    const before = await snapshotMockPair(page);
    const result = await page.evaluate(async () => {
      try {
        await window.FileNallyTest.VersionStore.capture({
          action: { path: 'report.txt', fromSide: 'source', toSide: 'target' },
          handles: { target: window.__mockPair.target }, runId: 'capture-1', direction: 'unidirectional',
        });
        return { rejected: false };
      } catch (error) { return { rejected: true, code: error.code, cleanup: error.cleanup }; }
    });
    assert.equal(result.rejected, true);
    assert.equal(result.code, 'VERSION_CLEANUP_PENDING');
    assert.deepEqual(result.cleanup, cleanupIntent());
    assert.deepEqual(await snapshotMockPair(page), before);
  });

  for (const operation of ['list', 'read', 'prepareRestore', 'comparisonChoices', 'prepareComparison']) {
    add(`version maintenance pending cleanup blocks ${operation} without writes`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1')], { schemaVersion: 2, cleanup: cleanupIntent() });
      const before = await snapshotMockPair(page);
      const result = await page.evaluate(async (operation) => {
        const store = window.FileNallyTest.VersionStore, root = window.__mockPair.target;
        const record = window.__cleanupRecords[0];
        try {
          if (operation === 'list') await store.list(root);
          if (operation === 'read') await store.read(root, record);
          if (operation === 'prepareRestore') await store.prepareRestore(root, record);
          if (operation === 'comparisonChoices') await store.comparisonChoices(root, record);
          if (operation === 'prepareComparison') await store.prepareComparison(root, record);
          return { rejected: false };
        } catch (error) { return { rejected: true, code: error.code, cleanup: error.cleanup }; }
      }, operation);
      assert.equal(result.rejected, true);
      assert.equal(result.code, 'VERSION_CLEANUP_PENDING');
      assert.deepEqual(result.cleanup, cleanupIntent());
      assert.deepEqual(await snapshotMockPair(page), before);
    });
  }

  add('version maintenance pending cleanup blocks a prepared restore before backup bytes', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')], { schemaVersion: 2 });
    await page.evaluate(async () => {
      window.__preparedRestore = await window.FileNallyTest.VersionStore
        .prepareRestore(window.__mockPair.target, window.__cleanupRecords[0]);
    });
    await page.evaluate((cleanup) => {
      const indexHandle = window.__mockPair.target.entries.get('.filenally').entries.get('index.json');
      const index = JSON.parse(indexHandle.content); index.cleanup = cleanup;
      indexHandle.content = JSON.stringify(index);
    }, cleanupIntent());
    const before = await snapshotMockPair(page);
    const result = await page.evaluate(async () => {
      try {
        await window.FileNallyTest.VersionStore.restore(window.__preparedRestore, {
          side: 'target', direction: 'unidirectional', runId: 'restore-1',
        });
        return { rejected: false };
      } catch (error) { return { rejected: true, code: error.code }; }
    });
    assert.deepEqual(result, { rejected: true, code: 'VERSION_CLEANUP_PENDING' });
    assert.deepEqual(await snapshotMockPair(page), before);
  });

  add('version maintenance missing destination ignores an unrelated pending store', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')], { schemaVersion: 2, cleanup: cleanupIntent() });
    await page.evaluate(() => window.__deleteMockEntry('target', 'report.txt'));
    const before = await snapshotMockPair(page);
    const result = await page.evaluate(async () => window.FileNallyTest.VersionStore.capture({
      action: { path: 'missing.txt', fromSide: 'source', toSide: 'target' },
      handles: { target: window.__mockPair.target }, runId: 'capture-1', direction: 'unidirectional',
    }));
    assert.equal(result, null);
    assert.deepEqual(await snapshotMockPair(page), before);
  });

  for (const mutation of ['index content', 'index handle', 'version root']) {
    add(`version maintenance capture preserves destination and external ${mutation}`, async ({ page }) => {
      await mountCleanup(page, [cleanupFixture('saved-1')]);
      await page.locator('#dirOne').click();
      await compare(page);
      const result = await page.evaluate(async (mutation) => {
        const root = window.__mockPair.target;
        const versionRoot = root.entries.get('.filenally');
        const originalIndex = versionRoot.entries.get('index.json');
        const external = JSON.stringify({ schemaVersion: 1, versions: [{
          ...window.__cleanupRecords[0], id: 'external-1', storedPath: 'versions/external-1/report.txt', runId: 'external',
        }] });
        window.__mockAfterClose = async (handle) => {
          if (handle.name !== 'report.txt') return;
          if (mutation === 'index content') originalIndex.content = external;
          if (mutation === 'index handle') window.__setMockFile('target', '.filenally/index.json', { content: originalIndex.content });
          if (mutation === 'version root') {
            const oldRoot = root.entries.get('.filenally');
            root.entries.delete('.filenally');
            const replacement = await root.getDirectoryHandle('.filenally', { create: true });
            const index = await replacement.getFileHandle('index.json', { create: true });
            index.content = originalIndex.content;
            window.__orphanedVersionRoot = oldRoot;
          }
          window.__mockAfterClose = null;
        };
        await window.FileNallyTest.executeCurrentPlan();
        const currentRoot = root.entries.get('.filenally');
        return { destination: root.entries.get('report.txt').content,
          index: currentRoot?.entries.get('index.json')?.content || '', external };
      }, mutation);
      assert.equal(result.destination, 'target-current');
      if (mutation === 'index content') assert.equal(result.index, result.external);
      else assert.equal(JSON.parse(result.index).versions.length, 1);
    });
  }

  add('version maintenance capture rejects an index that arrives after its absent snapshot', async ({ page }) => {
    await mountPair(page, { source: {}, target: { 'report.txt': { content: 'current' } } });
    await page.evaluate(() => window.__setMockFile('target', '.filenally/marker', { content: '' }));
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target, versionRoot = root.entries.get('.filenally');
      const external = JSON.stringify({ schemaVersion: 1, versions: [] });
      window.__mockAfterClose = async (handle) => {
        if (handle.name !== 'report.txt') return;
        const index = await versionRoot.getFileHandle('index.json', { create: true });
        index.content = external; window.__mockAfterClose = null;
      };
      try {
        await window.FileNallyTest.VersionStore.capture({
          action: { path: 'report.txt', fromSide: 'source', toSide: 'target' }, handles: { target: root },
          runId: 'capture-1', direction: 'unidirectional',
        });
        return { rejected: false };
      } catch (error) {
        return { rejected: true, destination: root.entries.get('report.txt').content,
          index: versionRoot.entries.get('index.json').content, external };
      }
    });
    assert.deepEqual(result, { rejected: true, destination: 'current', index: result.external, external: result.external });
  });

  add('version maintenance capture rejects a populated version root arriving during first initialization', async ({ page }) => {
    await mountPair(page, { source: {}, target: { 'report.txt': { content: 'current' } } });
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target, getDirectoryHandle = root.getDirectoryHandle.bind(root);
      const external = JSON.stringify({ schemaVersion: 1, versions: [] });
      let injected = false;
      root.getDirectoryHandle = async (name, options = {}) => {
        if (name === '.filenally' && options.create && !injected) {
          injected = true;
          const directory = await getDirectoryHandle(name, options);
          const index = await directory.getFileHandle('index.json', { create: true });
          index.content = external;
          return directory;
        }
        return getDirectoryHandle(name, options);
      };
      try {
        await window.FileNallyTest.VersionStore.capture({
          action: { path: 'report.txt', fromSide: 'source', toSide: 'target' }, handles: { target: root },
          runId: 'capture-1', direction: 'unidirectional',
        });
        return { rejected: false };
      } catch (error) {
        const versionRoot = root.entries.get('.filenally');
        return { rejected: true, destination: root.entries.get('report.txt').content,
          index: versionRoot.entries.get('index.json').content,
          versionsCreated: versionRoot.entries.has('versions'), external };
      }
    });
    assert.deepEqual(result, { rejected: true, destination: 'current', index: result.external,
      versionsCreated: false, external: result.external });
  });

  add('version maintenance capture rejects an index changed after close during readback', async ({ page }) => {
    await mountCleanup(page, [cleanupFixture('saved-1')]);
    const result = await page.evaluate(async () => {
      const root = window.__mockPair.target;
      window.__mockAfterClose = async (handle) => {
        if (handle.name !== 'index.json') return;
        const index = JSON.parse(handle.content);
        index.versions.at(-1).runId = 'external';
        handle.content = JSON.stringify(index);
        window.__mockAfterClose = null;
      };
      try {
        await window.FileNallyTest.VersionStore.capture({
          action: { path: 'report.txt', fromSide: 'source', toSide: 'target' }, handles: { target: root },
          runId: 'capture-1', direction: 'unidirectional',
        });
        return { rejected: false };
      } catch (error) {
        return { rejected: true, destination: root.entries.get('report.txt').content,
          runId: JSON.parse(root.entries.get('.filenally').entries.get('index.json').content).versions.at(-1).runId };
      }
    });
    assert.deepEqual(result, { rejected: true, destination: 'target-current', runId: 'external' });
  });

  add('version maintenance first capture initializes an empty v1 store', async ({ page }) => {
    await mountPair(page, { source: {}, target: { 'report.txt': { content: 'current' } } });
    const result = await page.evaluate(async () => {
      const record = await window.FileNallyTest.VersionStore.capture({
        action: { path: 'report.txt', fromSide: 'source', toSide: 'target' },
        handles: { target: window.__mockPair.target }, runId: 'capture-1', direction: 'unidirectional',
      });
      const snapshot = await window.__snapshotMockPair();
      return { record, index: JSON.parse(snapshot.target['.filenally']['index.json'].content) };
    });
    assert.equal(result.index.schemaVersion, 1);
    assert.deepEqual(result.index.versions, [result.record]);
  });

  for (const mutation of ['unsupported', 'corrupt', 'duplicate', 'forbidden', 'oversized', 'missing bytes', 'size mismatch', 'changed record', 'store collision', 'index collision', 'destination directory', 'parent file']) {
    add(`version reader rejects ${mutation} without writes`, async ({ page }) => {
      await mountVersion(page);
      const result = await page.evaluate(async (mutation) => {
        const root = window.__mockPair.target;
        const record = window.__versionRecord;
        const index = root.entries.get('.filenally').entries.get('index.json');
        if (mutation === 'unsupported') index.content = '{"schemaVersion":2,"versions":[]}';
        if (mutation === 'corrupt') index.content = '{';
        if (mutation === 'duplicate') index.content = JSON.stringify({ schemaVersion: 1, versions: [record, record] });
        if (mutation === 'forbidden') index.content = '{"schemaVersion":1,"versions":[],"__proto__":{}}';
        if (mutation === 'oversized') index.content = ' '.repeat(5 * 1024 * 1024 + 1);
        if (mutation === 'missing bytes') window.__deleteMockEntry('target', `.filenally/${record.storedPath}`);
        if (mutation === 'size mismatch') window.__setMockFile('target', `.filenally/${record.storedPath}`, { content: 'longer' });
        if (mutation === 'changed record') index.content = JSON.stringify({ schemaVersion: 1, versions: [{ ...record, runId: 'changed' }] });
        if (mutation === 'store collision') window.__setMockFile('target', '.filenally', { content: '' });
        if (mutation === 'index collision') {
          window.__deleteMockEntry('target', '.filenally/index.json');
          await root.entries.get('.filenally').getDirectoryHandle('index.json', { create: true });
        }
        if (mutation === 'destination directory') {
          window.__deleteMockEntry('target', 'report.txt');
          await root.getDirectoryHandle('report.txt', { create: true });
        }
        if (mutation === 'parent file') {
          record.originalPath = 'parent/report.txt'; record.storedPath = 'versions/saved-1/parent/report.txt';
          index.content = JSON.stringify({ schemaVersion: 1, versions: [record] });
          window.__setMockFile('target', `.filenally/${record.storedPath}`, { content: 'old' });
          window.__setMockFile('target', 'parent', { content: '' });
        }
        const before = await window.__snapshotMockPair();
        try { await window.FileNallyTest.VersionStore.prepareRestore(root, record); return { rejected: false }; }
        catch (error) { return { rejected: true, message: error.message, before, after: await window.__snapshotMockPair() }; }
      }, mutation);
      assert.equal(result.rejected, true);
      assert.doesNotMatch(result.message, /is not a function/);
      assert.deepEqual(result.after, result.before);
    });
  }

  for (const path of ['.filenally/index.json', 'nested/.trash/file', '.FILENALLY/index.json', 'nested/.Trash/file', '../report.txt']) {
    add(`version reader rejects reserved or unsafe original ${path}`, async ({ page }) => {
      await mountVersion(page, { path });
      const before = await snapshotMockPair(page);
      const error = await page.evaluate(async () => {
        try { await window.FileNallyTest.VersionStore.prepareRestore(window.__mockPair.target, window.__versionRecord); return ''; }
        catch (error) { return error.message; }
      });
      assert.ok(error); assert.doesNotMatch(error, /is not a function/);
      assert.deepEqual(await snapshotMockPair(page), before);
    });
  }

  for (const side of ['source', 'target']) for (const direction of ['bidirectional', 'unidirectional', 'reverse']) {
    add(`version restore backs up inside owning ${side} root in ${direction}`, async ({ page }) => {
      await mountVersion(page);
      const result = await page.evaluate(async ({ side, direction }) => {
        if (side === 'source') [window.__mockPair.source, window.__mockPair.target] = [window.__mockPair.target, window.__mockPair.source];
        const store = window.FileNallyTest.VersionStore;
        return store.restore(await store.prepareRestore(window.__mockPair[side], window.__versionRecord), { side, direction, runId: 'restore-1' });
      }, { side, direction });
      const snapshot = await snapshotMockPair(page);
      assert.equal(snapshot[side]['report.txt'].content, 'old');
      assert.equal(snapshot[side]['.filenally'].versions[result.backup.id]['report.txt'].content, 'current');
      assert.equal(result.backup.reason, 'before-restore');
      assert.equal(result.backup.fromSide, side); assert.equal(result.backup.toSide, side);
      assert.equal(result.backup.direction, direction); assert.equal(result.backup.runId, 'restore-1');
      assert.equal(snapshot[side === 'source' ? 'target' : 'source']['.filenally'], undefined);
    });
  }

  add('version restore creates missing original without backup', async ({ page }) => {
    await mountVersion(page, { missing: true, path: 'nested/report.txt' });
    const result = await page.evaluate(async () => {
      const store = window.FileNallyTest.VersionStore;
      return store.restore(await store.prepareRestore(window.__mockPair.target, window.__versionRecord), { side: 'target', direction: 'reverse', runId: 'restore-1' });
    });
    assert.equal(result.backup, null);
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target.nested['report.txt'].content, 'old');
    assert.equal(JSON.parse(snapshot.target['.filenally']['index.json'].content).versions.length, 1);
  });

  for (const mutation of ['same metadata bytes', 'disappeared', 'appeared', 'replaced handle', 'version bytes', 'version handle', 'record', 'permission', 'unreadable snapshot', 'unreadable empty snapshot']) {
    add(`version restore rejects stale ${mutation} before any writes`, async ({ page }) => {
      await mountVersion(page, { missing: mutation === 'appeared' });
      const result = await page.evaluate(async (mutation) => {
        const store = window.FileNallyTest.VersionStore, root = window.__mockPair.target, record = window.__versionRecord;
        if (mutation === 'unreadable empty snapshot') root.entries.get('report.txt').content = '';
        const prepared = await store.prepareRestore(root, record);
        if (mutation === 'same metadata bytes') root.entries.get('report.txt').content = 'changed';
        if (mutation === 'disappeared') root.entries.delete('report.txt');
        if (mutation === 'appeared' || mutation === 'replaced handle') window.__setMockFile('target', 'report.txt', { content: 'current', lastModified: 200 });
        const version = await (await (await root.getDirectoryHandle('.filenally')).getDirectoryHandle('versions')).getDirectoryHandle('saved-1');
        if (mutation === 'version bytes') version.entries.get('report.txt').content = 'new';
        if (mutation === 'version handle') window.__setMockFile('target', `.filenally/${record.storedPath}`, { content: 'old', lastModified: 100 });
        if (mutation === 'record') root.entries.get('.filenally').entries.get('index.json').content = JSON.stringify({ schemaVersion: 1, versions: [{ ...record, runId: 'changed' }] });
        if (mutation === 'permission') root.permission = 'denied';
        if (mutation.startsWith('unreadable')) prepared.currentFile.slice = () => { throw new DOMException('Snapshot expired', 'NotReadableError'); };
        const before = await window.__snapshotMockPair();
        try { await store.restore(prepared, { side: 'target', direction: 'unidirectional', runId: 'restore-1' }); return { rejected: false }; }
        catch (error) { return { rejected: true, before, after: await window.__snapshotMockPair() }; }
      }, mutation);
      assert.equal(result.rejected, true); assert.deepEqual(result.after, result.before);
    });
  }

  for (const failure of ['version write', 'index close', 'destination write', 'destination changed during backup', 'version changed during backup', 'record changed during backup']) {
    add(`version restore preserves current bytes on ${failure}`, async ({ page }) => {
      await mountVersion(page);
      const result = await page.evaluate(async (failure) => {
        const store = window.FileNallyTest.VersionStore, root = window.__mockPair.target, record = window.__versionRecord;
        const prepared = await store.prepareRestore(root, record);
        if (failure === 'version write') window.__setMockFailure({ operation: 'write', name: 'report.txt' });
        if (failure === 'index close') window.__setMockFailure({ operation: 'close', name: 'index.json' });
        if (failure === 'destination write') window.__setMockFailure({ operation: 'write', name: 'report.txt', occurrence: 2 });
        window.__mockAfterClose = async (handle) => {
          if (handle.name !== 'index.json') return;
          if (failure === 'destination changed during backup') root.entries.get('report.txt').content = 'changed';
          if (failure === 'version changed during backup') window.__setMockFile('target', `.filenally/${record.storedPath}`, { content: 'new', lastModified: 100 });
          if (failure === 'record changed during backup') {
            const index = JSON.parse(handle.content); index.versions[0].runId = 'changed'; handle.content = JSON.stringify(index);
          }
        };
        try { await store.restore(prepared, { side: 'target', direction: 'unidirectional', runId: 'restore-1' }); return { rejected: false }; }
        catch (error) { return { rejected: true, backup: error.backup || null }; }
      }, failure);
      assert.equal(result.rejected, true);
      const snapshot = await snapshotMockPair(page);
      assert.equal(snapshot.target['report.txt'].content, failure === 'destination changed during backup' ? 'changed' : 'current');
      if (['version write', 'index close'].includes(failure)) {
        assert.equal(result.backup, null);
        assert.equal(JSON.parse(snapshot.target['.filenally']['index.json'].content).versions.length, 1);
      } else if (failure === 'record changed during backup') {
        assert.equal(result.backup, null);
        const versions = JSON.parse(snapshot.target['.filenally']['index.json'].content).versions;
        assert.equal(versions.length, 2); assert.equal(versions[0].runId, 'changed');
      } else {
        assert.ok(result.backup);
        assert.equal(snapshot.target['.filenally'].versions[result.backup.id]['report.txt'].content, 'current');
        assert.equal(JSON.parse(snapshot.target['.filenally']['index.json'].content).versions.length, 2);
      }
    });
  }

  add('version restore commits bytes and backup using real browser private filesystem', async ({ page }) => {
    const result = await page.evaluate(async ({ record }) => {
      const storage = await navigator.storage.getDirectory();
      const name = `version-test-${crypto.randomUUID()}`;
      const root = await storage.getDirectoryHandle(name, { create: true });
      try {
        const metadata = await root.getDirectoryHandle('.filenally', { create: true });
        const versions = await metadata.getDirectoryHandle('versions', { create: true });
        const selected = await versions.getDirectoryHandle('saved-1', { create: true });
        const write = async (directory, name, value) => {
          const stream = await (await directory.getFileHandle(name, { create: true })).createWritable();
          await stream.write(value); await stream.close();
        };
        await write(root, 'report.txt', 'current');
        await write(selected, 'report.txt', 'old');
        await write(metadata, 'index.json', JSON.stringify({ schemaVersion: 1, versions: [record] }));
        const store = window.FileNallyTest.VersionStore;
        const { backup } = await store.restore(await store.prepareRestore(root, record), { side: 'target', direction: 'unidirectional', runId: 'real-restore' });
        return {
          current: await (await (await root.getFileHandle('report.txt')).getFile()).text(),
          backup: await (await (await (await versions.getDirectoryHandle(backup.id)).getFileHandle('report.txt')).getFile()).text(),
          count: JSON.parse(await (await (await metadata.getFileHandle('index.json')).getFile()).text()).versions.length,
        };
      } finally { await storage.removeEntry(name, { recursive: true }); }
    }, versionFixture());
    assert.deepEqual(result, { current: 'old', backup: 'current', count: 2 });
  });

  add('version restore excludes concurrent operations and consumed confirmations', async ({ page }) => {
    await mountVersion(page);
    const result = await page.evaluate(async () => {
      const store = window.FileNallyTest.VersionStore, root = window.__mockPair.target;
      const prepared = await store.prepareRestore(root, window.__versionRecord);
      const other = await store.prepareRestore(root, window.__versionRecord);
      const options = { side: 'target', direction: 'unidirectional', runId: 'restore-1' };
      const settled = await Promise.allSettled([store.restore(prepared, options), store.restore(other, options)]);
      const after = await window.__snapshotMockPair();
      let repeated = false;
      try { await store.restore(prepared, options); } catch { repeated = true; }
      return { statuses: settled.map((result) => result.status), repeated, after, final: await window.__snapshotMockPair() };
    });
    assert.deepEqual(result.statuses, ['fulfilled', 'rejected']); assert.equal(result.repeated, true);
    assert.deepEqual(result.final, result.after);
  });

  add('development sources load with external CSS and JavaScript', async ({ page, devUrl }) => {
    await page.goto(devUrl);
    await page.waitForFunction(() => Boolean(window.FileNallyTest));
    const result = await page.evaluate(() => ({
      version: document.querySelector('.version')?.textContent,
      background: getComputedStyle(document.body).backgroundColor,
      errors: window.__testUnhandledErrors || [],
    }));
    assert.equal(result.version, 'Beta v0.15.0');
    assert.equal(result.background, 'rgb(244, 246, 250)');
    assert.deepEqual(result.errors, []);
  });

  add('comparison re-enables synchronization when work is queued', async ({ page }) => {
    await mountPair(page, {
      source: { 'new.txt': { content: 'source', lastModified: 200 } },
      target: {},
    });
    await compare(page);
    assert.equal(await page.locator('#btnSync').isEnabled(), true);
  });

  add('exact comparison detects different content with equal metadata', async ({ page }) => {
    await selectExactComparison(page);
    await mountPair(page, {
      source: { 'same.txt': { content: 'AAAA', lastModified: 100 } },
      target: { 'same.txt': { content: 'BBBB', lastModified: 100 } },
    });
    await compare(page);
    const result = await page.evaluate(() => window.FileNallyTest.getModel().plan);
    assert.deepEqual(result.actions, []);
    assert.equal(result.summary.conflicts, 1);
    assert.match(await page.locator('#srcFileBody').innerText(), /충돌|Conflict/);
    assert.match(await page.locator('#tgtFileBody').innerText(), /충돌|Conflict/);
  });

  add('exact comparison avoids copying equal content with different modification times', async ({ page }) => {
    await selectExactComparison(page);
    await mountPair(page, {
      source: { 'same.txt': { content: 'SAME', lastModified: 200 } },
      target: { 'same.txt': { content: 'SAME', lastModified: 100 } },
    });
    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.deepEqual(actions, [{ type: 'baseline', path: 'same.txt' }]);
  });

  add('quick comparison preserves metadata-based equality by default', async ({ page }) => {
    await mountPair(page, {
      source: { 'same.txt': { content: 'AAAA', lastModified: 100 } },
      target: { 'same.txt': { content: 'BBBB', lastModified: 100 } },
    });
    await compare(page);
    const result = await page.evaluate(() => ({
      mode: JSON.parse(localStorage.getItem('smart_sync_state')).config.comparisonMode,
      actions: window.FileNallyTest.getModel().plan.actions,
    }));
    assert.equal(result.mode, 'quick');
    assert.deepEqual(result.actions, [{ type: 'baseline', path: 'same.txt' }]);
  });

  add('safe stop cancels an exact comparison without creating a plan', async ({ page }) => {
    await selectExactComparison(page);
    const contentSize = (4 * 1024 * 1024) + 1;
    await mountPair(page, {
      source: { 'large.bin': { contentSize, lastModified: 100, readDelay: 100 } },
      target: { 'large.bin': { contentSize, lastModified: 100, readDelay: 100 } },
    });
    await page.locator('#btnCompare').click();
    await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'comparing');
    assert.equal(await page.locator('#btnAbort').isEnabled(), true);
    await page.locator('#btnAbort').click();
    await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'ready');
    const result = await page.evaluate(() => ({
      plan: window.FileNallyTest.getModel().plan,
      status: document.querySelector('#syncStatusText').textContent,
    }));
    assert.equal(result.plan, null);
    assert.match(result.status, /비교가 중지|comparison stopped/i);
  });

  add('changed-only filter hides stable files and persists for the tab session', async ({ page }) => {
    await mountPair(page, {
      source: {
        'changed.txt': { content: 'before', lastModified: 100 },
        'stable.txt': { content: 'stable', lastModified: 100 },
      },
      target: {
        'changed.txt': { content: 'before', lastModified: 100 },
        'stable.txt': { content: 'stable', lastModified: 100 },
      },
    });
    await compare(page);
    await page.locator('#btnSync').click();
    await page.waitForFunction(() => window.FileNallyTest?.getModel().phase === 'success');
    await page.evaluate(() => window.__setMockFile('source', 'changed.txt', { content: 'after', lastModified: 300 }));
    await compare(page);

    const filter = page.getByLabel('변경된 항목만 보기', { exact: true });
    assert.equal(await filter.count(), 1);
    assert.match(await page.locator('#srcFileBody').innerText(), /changed\.txt[\s\S]*stable\.txt/);
    assert.match(await page.locator('#tgtFileBody').innerText(), /changed\.txt[\s\S]*stable\.txt/);

    await filter.press('Space');

    assert.equal(await filter.isChecked(), true);
    assert.match(await page.locator('#srcFileBody').innerText(), /changed\.txt/);
    assert.doesNotMatch(await page.locator('#srcFileBody').innerText(), /stable\.txt/);
    assert.match(await page.locator('#tgtFileBody').innerText(), /changed\.txt/);
    assert.doesNotMatch(await page.locator('#tgtFileBody').innerText(), /stable\.txt/);
    assert.equal(await page.locator('#srcCount').innerText(), '1');
    assert.equal(await page.locator('#tgtCount').innerText(), '1');

    await page.reload();
    assert.equal(await page.getByLabel('변경된 항목만 보기', { exact: true }).isChecked(), true);
  });

  add('changed-only filter hides mixed file and folder baselines', async ({ page }) => {
    const baseline = {
      'stable.txt': { content: 'stable', lastModified: 100 },
      'stable-folder': { type: 'directory', entries: {} },
    };
    await mountPair(page, { source: baseline, target: baseline });
    await compare(page);
    assert.deepEqual((await page.evaluate(() => window.FileNallyTest.getModel().plan.actions))
      .map(({ type, path }) => ({ type, path })), [
      { type: 'baseline-directory', path: 'stable-folder' },
      { type: 'baseline', path: 'stable.txt' },
    ]);
    for (const side of ['src', 'tgt']) {
      assert.match(await page.locator(`#${side}FileBody`).innerText(), /stable\.txt/);
      assert.match(await page.locator(`#${side}FileBody`).innerText(), /stable-folder\//);
    }
    await page.getByLabel('변경된 항목만 보기', { exact: true }).check();
    for (const side of ['src', 'tgt']) {
      assert.doesNotMatch(await page.locator(`#${side}FileBody`).innerText(), /stable/);
      assert.equal(await page.locator(`#${side}Count`).innerText(), '0');
    }
  });

  add('skip policy never overwrites an existing destination', async ({ page }) => {
    await page.locator('#conflictPolicy').selectOption('skip');
    await mountPair(page, {
      source: { 'shared.txt': { content: 'new source', lastModified: 200 } },
      target: { 'shared.txt': { content: 'existing target', lastModified: 100 } },
    });
    await compare(page);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target['shared.txt'].content, 'existing target');
  });

  add('untrusted filenames render as text', async ({ page }) => {
    const name = '<img src=x onerror="window.__filenameXss = true">.txt';
    await mountPair(page, {
      source: { [name]: { content: 'unsafe', lastModified: 200 } },
      target: {},
    });
    await compare(page);
    await page.waitForTimeout(50);
    assert.notEqual(await page.evaluate(() => window.__filenameXss), true);
    assert.equal(await page.locator('#srcFileBody img').count(), 0);
  });

  add('an unrelated manifest cannot schedule deletion', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('smart_sync_state', JSON.stringify({
        config: {
          direction: 'bidirectional',
          conflictPolicy: 'latest',
          excludeDirs: 'node_modules, .git, dist, temp, .trash',
          lang: 'ko',
        },
        history: [],
        manifest: { 'orphan.txt': { srcTime: 10, tgtTime: 10, size: 4 } },
      }));
    });
    await page.reload();
    await mountPair(page, {
      source: { 'orphan.txt': { content: 'keep', lastModified: 300 } },
      target: {},
    });
    await compare(page);
    const rowText = await page.locator('#srcFileBody').innerText();
    assert.doesNotMatch(rowText, /격리|Isolation/);
  });

  add('375px viewport has no document-level horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.reload();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert.equal(dimensions.scrollWidth, dimensions.clientWidth);
  });

  add('state migration upgrades legacy JSON without trusting its manifest', async ({ page }) => {
    const migrated = await page.evaluate(() => window.FileNallyTest.StateStore.migrate({
      config: {
        direction: 'bidirectional',
        conflictPolicy: 'overwrite',
        excludeDirs: 'node_modules, .git, .trash',
        lang: 'ko',
      },
      history: [{ time: 'legacy', direction: 'bidirectional', filesCount: 1, status: '성공' }],
      manifest: { 'legacy.txt': { srcTime: 1, tgtTime: 1, size: 1 } },
    }));
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.config.conflictPolicy, 'source-overwrite');
    const profiles = Object.values(migrated.profiles);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].bindingStatus, 'unverified');
  });

  add('state normalizes safe directory history and rejects malformed entries', async ({ page }) => {
    const profile = (await page.evaluate(() => window.FileNallyTest.StateStore.sanitize({
      schemaVersion: 2, config: {}, activeProfileId: 'pair',
      profiles: { pair: {
        id: 'pair', bindingStatus: 'verified', manifest: {}, history: [],
        directoryManifest: {
          'reports/archive': { source: true, target: false },
          '../escape': { source: true, target: true },
          invalid: { source: 'yes', target: 1 },
        },
      } },
    }))).profiles.pair;
    assert.deepEqual(profile.directoryManifest, {
      'reports/archive': { source: true, target: false },
    });
  });

  add('state import rejects forbidden keys and oversized JSON', async ({ page }) => {
    const result = await page.evaluate(() => {
      const messages = [];
      for (const text of [
        '{"schemaVersion":2,"__proto__":{"polluted":true}}',
        `{"padding":"${'x'.repeat((5 * 1024 * 1024) + 1)}"}`,
      ]) {
        try {
          window.FileNallyTest.StateStore.importText(text);
          messages.push('accepted');
        } catch (error) {
          messages.push(error.message);
        }
      }
      return messages;
    });
    assert.match(result[0], /Forbidden JSON key/);
    assert.match(result[1], /exceeds 5MB/);
  });

  add('reserved exclusions preserve all 100 user exclusions across save and scan', async ({ page }) => {
    const custom = Array.from({ length: 100 }, (_, index) => `custom-${index}`);
    await page.locator('#excludeDirs').fill([...custom, '.trash', '.filenally', 'overflow'].join(','));
    await page.reload();
    const excludes = await page.evaluate(() => JSON.parse(localStorage.getItem('smart_sync_state')).config.excludeDirs);
    assert.deepEqual(excludes, [...custom, '.trash', '.filenally']);
    await mountPair(page, {
      source: {
        ...Object.fromEntries([...custom, '.trash', '.filenally'].map((name) => [name, {
          type: 'directory', entries: { 'hidden.txt': { content: name } },
        }])),
        'visible.txt': { content: 'visible' },
      },
      target: {},
    });
    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.deepEqual(actions.map((action) => action.path), ['visible.txt']);
  });

  add('version index accepts schema v1 and reconstructs allowlisted records', async ({ page }) => {
    const parsed = await page.evaluate(() => window.FileNallyTest.VersionStore.parseIndexText(JSON.stringify({
      schemaVersion: 1,
      versions: [{
        id: 'version-1',
        capturedAt: '2026-09-13T00:00:00.000Z',
        originalPath: 'docs/report.txt',
        storedPath: 'versions/version-1/docs/report.txt',
        size: 4,
        type: 'text/plain',
        lastModified: 100,
        reason: 'before-overwrite',
        runId: 'run-1',
        direction: 'unidirectional',
        fromSide: 'source',
        toSide: 'target',
        ignored: 'drop-me',
      }],
    })));
    assert.deepEqual(parsed, {
      schemaVersion: 1,
      versions: [{
        id: 'version-1',
        capturedAt: '2026-09-13T00:00:00.000Z',
        originalPath: 'docs/report.txt',
        storedPath: 'versions/version-1/docs/report.txt',
        size: 4,
        type: 'text/plain',
        lastModified: 100,
        reason: 'before-overwrite',
        runId: 'run-1',
        direction: 'unidirectional',
        fromSide: 'source',
        toSide: 'target',
      }],
    });
  });

  add('version index rejects unsafe or unsupported input without resetting it', async ({ page }) => {
    const results = await page.evaluate(() => {
      const parse = window.FileNallyTest.VersionStore.parseIndexText;
      const inputs = [
        '{"schemaVersion":2,"versions":[]}',
        '{"schemaVersion":1,"versions":[{"id":"v","originalPath":"../escape"}]}',
        '{"schemaVersion":1,"versions":{"not":"an array"}}',
        '{"schemaVersion":1,"versions":[],"constructor":{}}',
      ];
      return inputs.map((text) => {
        try { parse(text); return 'accepted'; } catch (error) { return error.message; }
      });
    });
    assert.deepEqual(results.map((value) => value === 'accepted'), [false, false, false, false]);
  });

  add('version index rejects capture id traversal', async ({ page }) => {
    const result = await page.evaluate(() => {
      const text = JSON.stringify({
        schemaVersion: 1,
        versions: [{
          id: '../..',
          capturedAt: '2026-09-13T00:00:00.000Z',
          originalPath: 'escape/file',
          storedPath: 'versions/../../escape/file',
          size: 4,
          lastModified: 100,
          reason: 'before-overwrite',
          direction: 'unidirectional',
          fromSide: 'source',
          toSide: 'target',
        }],
      });
      try { window.FileNallyTest.VersionStore.parseIndexText(text); return 'accepted'; }
      catch (error) { return error.message; }
    });
    assert.notEqual(result, 'accepted');
  });

  add('version index rejects forbidden keys inside state-shaped paths', async ({ page }) => {
    const result = await page.evaluate(() => {
      const text = '{"schemaVersion":1,"versions":[],"profiles":{"pair":{"directoryManifest":{"constructor":{}}}}}';
      try { window.FileNallyTest.VersionStore.parseIndexText(text); return 'accepted'; }
      catch (error) { return error.message; }
    });
    assert.match(result, /Forbidden JSON key/);
  });

  add('version index rejects text over 5 MiB', async ({ page }) => {
    const result = await page.evaluate(() => {
      const text = `{"padding":"${'x'.repeat((5 * 1024 * 1024) + 1)}"}`;
      try { window.FileNallyTest.VersionStore.parseIndexText(text); return 'accepted'; }
      catch (error) { return error.message; }
    });
    assert.match(result, /Version index exceeds 5MB/);
  });

  add('version index rejects more than 100000 records before record validation', async ({ page }) => {
    const result = await page.evaluate(() => {
      const text = JSON.stringify({ schemaVersion: 1, versions: Array(100001).fill(null) });
      let message;
      try { window.FileNallyTest.VersionStore.parseIndexText(text); message = 'accepted'; }
      catch (error) { message = error.message; }
      return { bytes: text.length, message };
    });
    assert.ok(result.bytes < 5 * 1024 * 1024);
    assert.match(result.message, /Version index has too many records/);
  });

  add('an over-limit version index is rejected by the parser', async ({ page }) => {
    const message = await page.evaluate(() => {
      const record = {
        id: 'v', capturedAt: '2026-09-13T00:00:00.000Z',
        originalPath: 'a', storedPath: 'versions/v/a',
        size: 0, type: '', lastModified: 0, reason: 'before-overwrite',
        runId: 'r', direction: 'bidirectional', fromSide: 'source', toSide: 'target',
      };
      try {
        window.FileNallyTest.VersionStore.parseIndexText(JSON.stringify({
          schemaVersion: 1,
          versions: Array.from({ length: 100001 }, () => record),
        }));
        return 'accepted';
      } catch (error) {
        return error.message;
      }
    });
    assert.notEqual(message, 'accepted');
  });

  add('directory path exceptions do not bypass configuration or entry key protection', async ({ page }) => {
    const messages = await page.evaluate(() => {
      const results = [];
      for (const key of ['constructor', 'prototype', '__proto__']) {
        for (const raw of [
          { schemaVersion: 2, config: { [key]: { polluted: true } } },
          { schemaVersion: 2, profiles: { pair: { directoryManifest: { safe: { source: true, [key]: { polluted: true } } } } } },
          { schemaVersion: 2, config: { directoryManifest: { [key]: { source: true } } } },
        ]) {
          try { window.FileNallyTest.StateStore.importText(JSON.stringify(raw)); results.push('accepted'); }
          catch (error) { results.push(error.message); }
        }
      }
      return results;
    });
    assert.equal(messages.length, 9);
    for (const message of messages) assert.match(message, /Forbidden JSON key/);
  });

  add('restored v2 profiles require folder-pair verification', async ({ page }) => {
    const imported = await page.evaluate(() => window.FileNallyTest.StateStore.importText(JSON.stringify({
      schemaVersion: 2,
      config: { direction: 'bidirectional', conflictPolicy: 'latest', excludeDirs: ['.trash'], lang: 'ko' },
      activeProfileId: 'profile-a',
      profiles: {
        'profile-a': {
          id: 'profile-a', sourceName: 'source', targetName: 'target', bindingStatus: 'verified',
          manifest: { 'gone.txt': { source: { size: 1, lastModified: 1 }, target: { size: 1, lastModified: 1 } } },
          history: [],
        },
      },
      globalHistory: [],
    })));
    assert.equal(imported.profiles['profile-a'].bindingStatus, 'unverified');
    assert.equal(imported.profiles['profile-a'].manifest['gone.txt'].source.size, 1);
  });

  add('legacy settings default to quick comparison', async ({ page }) => {
    const comparisonMode = await page.evaluate(() => window.FileNallyTest.StateStore.importText(JSON.stringify({
      schemaVersion: 2,
      config: { direction: 'bidirectional', conflictPolicy: 'latest', excludeDirs: ['.trash'], lang: 'ko' },
      profiles: {},
      globalHistory: [],
    })).config.comparisonMode);
    assert.equal(comparisonMode, 'quick');
  });

  add('planner handles verified deletion, modification conflict, and rename preservation', async ({ page }) => {
    const result = await page.evaluate(() => {
      const file = (path, size, lastModified) => ({ name: path.split('/').pop(), path, size, lastModified });
      const previous = { source: { size: 4, lastModified: 100 }, target: { size: 4, lastModified: 100 } };
      const deletion = window.FileNallyTest.SyncPlanner.plan({
        source: { 'gone.txt': file('gone.txt', 4, 100) },
        target: {},
        manifest: { 'gone.txt': previous },
        trustedManifest: true,
      });
      const modified = window.FileNallyTest.SyncPlanner.plan({
        source: { 'gone.txt': file('gone.txt', 8, 200) },
        target: {},
        manifest: { 'gone.txt': previous },
        trustedManifest: true,
      });
      const rename = window.FileNallyTest.SyncPlanner.plan({
        source: { 'shared.txt': file('shared.txt', 8, 200) },
        target: { 'shared.txt': file('shared.txt', 9, 300) },
        manifest: { 'shared.txt': previous },
        trustedManifest: true,
        conflictPolicy: 'rename',
        stamp: 'RUN',
      });
      return {
        deletion: deletion.actions,
        modified: { actions: modified.actions, conflicts: modified.summary.conflicts },
        rename: rename.actions,
      };
    });
    assert.deepEqual(result.deletion, [{ type: 'trash', path: 'gone.txt', side: 'source' }]);
    assert.equal(result.modified.actions.length, 0);
    assert.equal(result.modified.conflicts, 1);
    assert.deepEqual(result.rename.map((action) => [action.fromSide, action.toSide, action.destinationPath]), [
      ['source', 'target', 'shared.conflict-source-RUN.txt'],
      ['target', 'source', 'shared.conflict-target-RUN.txt'],
    ]);
  });

  add('directory planner follows authority and safe structural ordering', async ({ page }) => {
    const result = await page.evaluate(() => window.FileNallyTest.SyncPlanner.plan({
      source: {}, target: {},
      sourceDirectories: ['new/child', 'new'],
      targetDirectories: ['removed', 'protected'],
      directoryManifest: { removed: { source: true, target: true } },
      trustedManifest: true, direction: 'unidirectional',
    }));
    assert.deepEqual(result.actions.map(({ type, path, side }) => ({ type, path, side })), [
      { type: 'create-directory', path: 'new', side: 'target' },
      { type: 'create-directory', path: 'new/child', side: 'target' },
      { type: 'trash-directory', path: 'removed', side: 'target' },
    ]);
    assert.equal(result.rows.find((row) => row.path === 'protected').targetStatus, 'protected');
  });

  add('directory planner baselines unknown pairs and propagates verified bidirectional deletion', async ({ page }) => {
    const result = await page.evaluate(() => ({
      baseline: window.FileNallyTest.SyncPlanner.plan({
        source: {}, target: {}, sourceDirectories: ['empty'], targetDirectories: ['empty'],
      }).actions,
      deletion: window.FileNallyTest.SyncPlanner.plan({
        source: {}, target: {}, sourceDirectories: [], targetDirectories: ['empty'],
        directoryManifest: { empty: { source: true, target: true } },
        trustedManifest: true, direction: 'bidirectional',
      }).actions,
    }));
    assert.deepEqual(result.baseline, [{ type: 'baseline-directory', path: 'empty' }]);
    assert.deepEqual(result.deletion, [{ type: 'trash-directory', path: 'empty', side: 'target' }]);
  });

  add('directory planner baselines special names without inherited history', async ({ page }) => {
    const actions = await page.evaluate(() => window.FileNallyTest.SyncPlanner.plan({
      source: {}, target: {}, trustedManifest: true,
      sourceDirectories: ['constructor', 'prototype', '__proto__'],
      targetDirectories: ['constructor', 'prototype', '__proto__'],
      directoryManifest: {},
    }).actions);
    assert.deepEqual(actions, [
      { type: 'baseline-directory', path: 'constructor' },
      { type: 'baseline-directory', path: 'prototype' },
      { type: 'baseline-directory', path: '__proto__' },
    ]);
  });

  for (const name of ['constructor', 'prototype', '__proto__']) {
    add(`special folder name ${name} survives creation persistence and deletion`, async ({ page }) => {
      await mountPair(page, { source: {}, target: {} });
      await page.evaluate((path) => window.__mockPair.source.getDirectoryHandle(path, { create: true }).then(() => {}), name);
      await compare(page);
      assert.deepEqual(await page.evaluate(() => window.FileNallyTest.getModel().plan.actions), [
        { type: 'create-directory', path: name, side: 'target' },
      ]);
      await executeCurrentPlan(page);
      assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().phase), 'success');
      assert.deepEqual(JSON.parse(await page.evaluate(async () => JSON.stringify(await window.__snapshotMockPair()))).target[name], {});
      const profileId = await page.evaluate(() => window.FileNallyTest.getModel().profileId);
      const saved = await page.evaluate(({ profileId, name }) => {
        const store = window.FileNallyTest.StateStore;
        const state = store.load();
        const manifest = state.profiles[profileId].directoryManifest;
        const exported = store.export(state);
        const imported = store.importText(JSON.stringify(exported));
        return {
          own: Object.hasOwn(manifest, name), entry: manifest[name],
          exported: exported.profiles[profileId].directoryManifest[name],
          imported: imported.profiles[profileId].directoryManifest[name],
          importedBinding: imported.profiles[profileId].bindingStatus,
        };
      }, { profileId, name });
      assert.deepEqual(saved, {
        own: true, entry: { source: true, target: true },
        exported: { source: true, target: true }, imported: { source: true, target: true },
        importedBinding: 'unverified',
      });
      const reloadedPage = await page.context().newPage();
      await installMockFileSystem(reloadedPage);
      await reloadedPage.goto(page.url());
      assert.deepEqual(await reloadedPage.evaluate(({ profileId, name }) => {
        const state = window.FileNallyTest.StateStore.load();
        return window.FileNallyTest.SyncPlanner.plan({
          source: {}, target: {}, sourceDirectories: [], targetDirectories: [name],
          directoryManifest: state.profiles[profileId].directoryManifest, trustedManifest: true,
        }).actions;
      }, { profileId, name }), [{ type: 'trash-directory', path: name, side: 'target' }]);
      await reloadedPage.close();
      await page.evaluate((path) => window.__deleteMockEntry('source', path), name);
      await compare(page);
      assert.deepEqual(await page.evaluate(() => window.FileNallyTest.getModel().plan.actions), [
        { type: 'trash-directory', path: name, side: 'target' },
      ]);
      await executeCurrentPlan(page);
      assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().phase), 'success');
      const snapshot = JSON.parse(await page.evaluate(async () => JSON.stringify(await window.__snapshotMockPair())));
      assert.equal(Object.hasOwn(snapshot.target, name), false);
      assert.deepEqual(Object.values(snapshot.target['.trash'])[0][name], {});
      await page.reload();
      assert.deepEqual(await page.evaluate((id) => window.FileNallyTest.StateStore.load().profiles[id].directoryManifest, profileId), {});
    });
  }

  add('one-way sync creates a source empty folder and protects an untracked target folder', async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: { 'source-empty': { type: 'directory', entries: {} } },
      target: { 'target-only': { type: 'directory', entries: {} } },
    });
    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.deepEqual(actions.map(({ type, path, side }) => ({ type, path, side })), [
      { type: 'create-directory', path: 'source-empty', side: 'target' },
    ]);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.deepEqual(snapshot.target['source-empty'], {});
    assert.deepEqual(snapshot.target['target-only'], {});
  });

  add('one-way sync recreates an authoritative empty folder deleted from target', async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: { empty: { type: 'directory', entries: {} } },
      target: { empty: { type: 'directory', entries: {} } },
    });
    await compare(page);
    await executeCurrentPlan(page);
    await page.evaluate(() => window.__deleteMockEntry('target', 'empty'));
    await compare(page);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.deepEqual(snapshot.source.empty, {});
    assert.deepEqual(snapshot.target.empty, {});
  });

  add('reverse sync recreates an authoritative empty folder deleted from source', async ({ page }) => {
    await page.locator('#dirReverse').click();
    const pair = { empty: { type: 'directory', entries: {} } };
    await mountPair(page, { source: pair, target: pair });
    await compare(page);
    await executeCurrentPlan(page);
    await page.evaluate(() => window.__deleteMockEntry('source', 'empty'));
    await compare(page);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.deepEqual(snapshot.source.empty, {});
    assert.deepEqual(snapshot.target.empty, {});
  });

  add('one-way deletion preserves a synchronized empty tree in target trash', async ({ page }) => {
    await page.locator('#dirOne').click();
    const tree = { a: { type: 'directory', entries: { b: { type: 'directory', entries: { c: { type: 'directory', entries: {} } } } } } };
    await mountPair(page, { source: tree, target: tree });
    await compare(page);
    await executeCurrentPlan(page);
    await page.evaluate(() => window.__deleteMockEntry('source', 'a'));
    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.deepEqual(actions.map(({ type, path }) => ({ type, path })), [
      { type: 'trash-directory', path: 'a/b/c' },
      { type: 'trash-directory', path: 'a/b' },
      { type: 'trash-directory', path: 'a' },
    ]);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target.a, undefined);
    assert.deepEqual(Object.values(snapshot.target['.trash'])[0].a.b.c, {});
  });

  add('directory trash refuses a folder that becomes non-empty after comparison', async ({ page }) => {
    await page.locator('#dirOne').click();
    const pair = { empty: { type: 'directory', entries: {} } };
    await mountPair(page, { source: pair, target: pair });
    await compare(page);
    await executeCurrentPlan(page);
    await page.evaluate(() => window.__deleteMockEntry('source', 'empty'));
    await compare(page);
    await page.evaluate(() => window.__setMockFile('target', 'empty/late.txt', { content: 'late' }));
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target.empty['late.txt'].content, 'late');
    assert.equal(snapshot.target['.trash'], undefined);
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().phase), 'error');
  });

  add('excluded directory trees never enter the plan or result tables', async ({ page }) => {
    await mountPair(page, {
      source: {
        '.git': { type: 'directory', entries: { empty: { type: 'directory', entries: {} } } },
        'included-empty': { type: 'directory', entries: {} },
      },
      target: {},
    });
    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.deepEqual(actions.map(({ type, path, side }) => ({ type, path, side })), [
      { type: 'create-directory', path: 'included-empty', side: 'target' },
    ]);
    assert.match(await page.locator('#srcFileBody').innerText(), /included-empty\//);
    assert.doesNotMatch(await page.locator('#srcFileBody').innerText(), /\.git/);
    assert.doesNotMatch(await page.locator('#tgtFileBody').innerText(), /\.git/);
  });

  add('reserved version directories never enter scans or plans', async ({ page }) => {
    await mountPair(page, {
      source: {
        '.filenally': { type: 'directory', entries: {
          'index.json': { content: '{"schemaVersion":1,"versions":[]}' },
          versions: { type: 'directory', entries: { secret: { type: 'directory', entries: {
            'old.txt': { content: 'old' },
          } } } },
        } },
        'visible.txt': { content: 'new' },
      },
      target: {},
    });
    await page.locator('#excludeDirs').fill('');
    await compare(page);
    const plan = await page.evaluate(() => window.FileNallyTest.getModel().plan);
    assert.deepEqual(plan.actions.map(({ type, path }) => ({ type, path })), [
      { type: 'copy', path: 'visible.txt' },
    ]);
    assert.doesNotMatch(await page.locator('#srcFileBody').innerText(), /\.filenally|old\.txt/);
  });

  add('one-way source recreates a target file deleted on the non-authoritative side', async ({ page }) => {
    const actions = await page.evaluate(() => {
      const file = { name: 'kept.txt', path: 'kept.txt', size: 4, lastModified: 100 };
      const previous = { source: { size: 4, lastModified: 100 }, target: { size: 4, lastModified: 100 } };
      return window.FileNallyTest.SyncPlanner.plan({
        source: { 'kept.txt': file }, target: {}, manifest: { 'kept.txt': previous },
        trustedManifest: true, direction: 'unidirectional',
      }).actions;
    });
    assert.deepEqual(actions, [{
      type: 'copy', path: 'kept.txt', sourcePath: 'kept.txt', destinationPath: 'kept.txt',
      fromSide: 'source', toSide: 'target',
    }]);
  });

  add('reverse sync recreates a source file deleted on the non-authoritative side', async ({ page }) => {
    const actions = await page.evaluate(() => {
      const file = { name: 'kept.txt', path: 'kept.txt', size: 4, lastModified: 100 };
      const previous = { source: { size: 4, lastModified: 100 }, target: { size: 4, lastModified: 100 } };
      return window.FileNallyTest.SyncPlanner.plan({
        source: {}, target: { 'kept.txt': file }, manifest: { 'kept.txt': previous },
        trustedManifest: true, direction: 'reverse',
      }).actions;
    });
    assert.deepEqual(actions, [{
      type: 'copy', path: 'kept.txt', sourcePath: 'kept.txt', destinationPath: 'kept.txt',
      fromSide: 'target', toSide: 'source',
    }]);
  });

  add('planner treats unequal exact content with equal metadata as a conflict', async ({ page }) => {
    const result = await page.evaluate(() => {
      const file = { name: 'same.txt', path: 'same.txt', size: 4, lastModified: 100 };
      const plan = window.FileNallyTest.SyncPlanner.plan({
        source: { 'same.txt': file },
        target: { 'same.txt': file },
        contentEquality: new Map([['same.txt', false]]),
      });
      return { actions: plan.actions, rows: plan.rows, conflicts: plan.summary.conflicts };
    });
    assert.deepEqual(result.actions, []);
    assert.equal(result.rows[0].sourceStatus, 'conflict');
    assert.equal(result.rows[0].targetStatus, 'conflict');
    assert.equal(result.conflicts, 1);
  });

  add('planner does not trust unchanged manifest metadata over unequal exact content', async ({ page }) => {
    const result = await page.evaluate(() => {
      const file = { name: 'same.txt', path: 'same.txt', size: 4, lastModified: 100 };
      const snapshot = { size: 4, lastModified: 100 };
      const plan = window.FileNallyTest.SyncPlanner.plan({
        source: { 'same.txt': file },
        target: { 'same.txt': file },
        manifest: { 'same.txt': { source: snapshot, target: snapshot } },
        trustedManifest: true,
        contentEquality: new Map([['same.txt', false]]),
      });
      return { actions: plan.actions, rows: plan.rows, conflicts: plan.summary.conflicts };
    });
    assert.deepEqual(result.actions, []);
    assert.equal(result.rows[0].sourceStatus, 'conflict');
    assert.equal(result.rows[0].targetStatus, 'conflict');
    assert.equal(result.conflicts, 1);
  });

  add('planner treats equal exact content with different modification times as baseline', async ({ page }) => {
    const result = await page.evaluate(() => {
      const plan = window.FileNallyTest.SyncPlanner.plan({
        source: { 'same.txt': { name: 'same.txt', path: 'same.txt', size: 4, lastModified: 200 } },
        target: { 'same.txt': { name: 'same.txt', path: 'same.txt', size: 4, lastModified: 100 } },
        contentEquality: new Map([['same.txt', true]]),
      });
      return { actions: plan.actions, rows: plan.rows, conflicts: plan.summary.conflicts };
    });
    assert.deepEqual(result.actions, [{ type: 'baseline', path: 'same.txt' }]);
    assert.equal(result.rows[0].sourceStatus, 'baseline');
    assert.equal(result.rows[0].targetStatus, 'baseline');
    assert.equal(result.conflicts, 0);
  });

  add('same source and target folder are rejected', async ({ page }) => {
    await configureMockPair(page, {
      sameEntry: true,
      source: { 'same.txt': { content: 'same', lastModified: 100 } },
    });
    await page.locator('#btnSrc').click();
    await page.locator('#btnTgt').click();
    await page.waitForFunction(() => /같은 폴더|same folder/i.test(document.querySelector('#syncStatus')?.textContent || ''));
    assert.equal(await page.locator('#btnCompare').isEnabled(), false);
  });

  add('advanced controls use a responsive default and persist an explicit choice', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.reload();

    const toggle = page.locator('#btnAdvancedToggle');
    const controls = page.locator('#advancedControls');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await controls.isHidden(), true);
    assert.match(await page.locator('#advancedSummary').innerText(), /양방향.*최신 파일 유지.*빠른 비교/);

    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await controls.isVisible(), true);
    await page.reload();
    assert.equal(await page.locator('#btnAdvancedToggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#advancedControls').isVisible(), true);

    await page.evaluate(() => localStorage.clear());
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    assert.equal(await page.locator('#btnAdvancedToggle').getAttribute('aria-expanded'), 'true');
  });

  add('folder swap exchanges handles, preserves direction, and restores the ordered profile', async ({ page }) => {
    await mountPair(page, {
      sourceName: 'source-a',
      targetName: 'target-b',
      source: { 'left.txt': { content: 'left', lastModified: 200 } },
      target: { 'right.txt': { content: 'right', lastModified: 300 } },
    });
    await page.locator('#dirReverse').click();
    await compare(page);
    const originalProfileId = await page.evaluate(() => window.FileNallyTest.getModel().profileId);

    const swap = page.locator('#btnSwapFolders');
    assert.equal(await swap.isEnabled(), true);
    await swap.click();
    await page.waitForFunction(() => Boolean(window.FileNallyTest.getModel().profileId));

    assert.equal(await page.locator('#pathSrc').innerText(), 'target-b');
    assert.equal(await page.locator('#pathTgt').innerText(), 'source-a');
    assert.equal(await page.locator('#syncDirection').inputValue(), 'reverse');
    const swapped = await page.evaluate(() => window.FileNallyTest.getModel());
    assert.equal(swapped.plan, null);
    assert.notEqual(swapped.profileId, originalProfileId);

    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.deepEqual(actions.map(({ type, path, fromSide, toSide }) => ({ type, path, fromSide, toSide })), [
      { type: 'copy', path: 'left.txt', fromSide: 'target', toSide: 'source' },
    ]);

    await swap.click();
    await page.waitForFunction((profileId) => window.FileNallyTest.getModel().profileId === profileId, originalProfileId);
    assert.equal(await page.locator('#pathSrc').innerText(), 'source-a');
    assert.equal(await page.locator('#pathTgt').innerText(), 'target-b');
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().profileId), originalProfileId);
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().plan), null);
  });

  add('folder swap is disabled until a verified pair is idle', async ({ page }) => {
    const swap = page.locator('#btnSwapFolders');
    assert.equal(await swap.isDisabled(), true);
    await mountPair(page, {
      source: { 'large.bin': { contentSize: (4 * 1024 * 1024) + 1, lastModified: 100, readDelay: 100 } },
      target: { 'large.bin': { contentSize: (4 * 1024 * 1024) + 1, lastModified: 100, readDelay: 100 } },
    });
    await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'ready');
    assert.equal(await swap.isEnabled(), true);
    await selectExactComparison(page);
    await page.locator('#btnCompare').click();
    await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'comparing');
    assert.equal(await swap.isDisabled(), true);
    await page.locator('#btnAbort').click();
    await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'ready');
    assert.equal(await swap.isEnabled(), true);
  });

  add('nested source and target folders are rejected', async ({ page }) => {
    await configureMockPair(page, {
      targetInsideSource: true,
      source: { 'source.txt': { content: 'source', lastModified: 100 } },
      target: { 'target.txt': { content: 'target', lastModified: 100 } },
    });
    await page.locator('#btnSrc').click();
    await page.locator('#btnTgt').click();
    await page.waitForFunction(() => /중첩|inside|nested/i.test(document.querySelector('#syncStatus')?.textContent || ''));
    assert.equal(await page.locator('#btnCompare').isEnabled(), false);
  });

  add('new source file copies through the normal UI flow', async ({ page }) => {
    await mountPair(page, {
      source: { 'new.txt': { content: 'source data', lastModified: 200 } },
      target: {},
    });
    await compare(page);
    await page.locator('#btnSync').click();
    await page.waitForFunction(() => /완료|Complete/i.test(document.querySelector('#syncStatus')?.textContent || ''));
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target['new.txt'].content, 'source data');
  });

  add('one-way overwrite captures the live target before writing', async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: { 'report.txt': { content: 'new', lastModified: 200 } },
      target: { 'report.txt': { content: 'old', lastModified: 100 } },
    });
    await compare(page);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target['report.txt'].content, 'new');
    const index = JSON.parse(snapshot.target['.filenally']['index.json'].content);
    assert.equal(index.versions.length, 1);
    const version = index.versions[0];
    assert.equal(version.originalPath, 'report.txt');
    assert.equal(version.toSide, 'target');
    assert.equal(snapshot.target['.filenally'].versions[version.id]['report.txt'].content, 'old');
  });

  add('new-file copy does not create the version store', async ({ page }) => {
    await mountPair(page, { source: { 'new.txt': { content: 'new' } }, target: {} });
    await compare(page);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target['new.txt'].content, 'new');
    assert.equal(snapshot.target['.filenally'], undefined);
  });

  add('version capture follows each copy destination', async ({ page }) => {
    const scenarios = [
      {
        control: '#dirBoth', owner: 'target',
        source: { content: 'incoming', lastModified: 200 },
        target: { content: 'existing', lastModified: 100 },
      },
      {
        control: '#dirOne', owner: 'target',
        source: { content: 'incoming', lastModified: 200 },
        target: { content: 'existing', lastModified: 100 },
      },
      {
        control: '#dirReverse', owner: 'source',
        source: { content: 'existing', lastModified: 100 },
        target: { content: 'incoming', lastModified: 200 },
      },
    ];
    for (const scenario of scenarios) {
      await page.locator(scenario.control).click();
      await mountPair(page, {
        source: { 'report.txt': scenario.source },
        target: { 'report.txt': scenario.target },
      });
      await compare(page);
      await executeCurrentPlan(page);
      const snapshot = await snapshotMockPair(page);
      const index = JSON.parse(snapshot[scenario.owner]['.filenally']['index.json'].content);
      assert.equal(index.versions.length, 1);
      assert.equal(snapshot[scenario.owner]['.filenally'].versions[index.versions[0].id]['report.txt'].content, 'existing');
      await page.reload();
    }
  });

  add('repeated overwrites retain distinct versions', async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: { 'report.txt': { content: 'one', lastModified: 200 } },
      target: { 'report.txt': { content: 'zero', lastModified: 100 } },
    });
    await compare(page);
    await executeCurrentPlan(page);
    await page.evaluate(() => window.__setMockFile('source', 'report.txt', {
      content: 'two', lastModified: 300,
    }));
    await compare(page);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    const index = JSON.parse(snapshot.target['.filenally']['index.json'].content);
    assert.equal(index.versions.length, 2);
    assert.notEqual(index.versions[0].id, index.versions[1].id);
    assert.deepEqual(index.versions.map((version) =>
      snapshot.target['.filenally'].versions[version.id]['report.txt'].content), ['zero', 'one']);
  });

  add('a destination created after comparison is versioned before overwrite', async ({ page }) => {
    await mountPair(page, { source: { 'late.txt': { content: 'planned' } }, target: {} });
    await compare(page);
    await page.evaluate(() => window.__setMockFile('target', 'late.txt', { content: 'appeared' }));
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    const index = JSON.parse(snapshot.target['.filenally']['index.json'].content);
    assert.equal(snapshot.target['late.txt'].content, 'planned');
    assert.equal(snapshot.target['.filenally'].versions[index.versions[0].id]['late.txt'].content, 'appeared');
  });

  for (const nativeMove of [false, true]) {
    for (const scenario of [
      { control: '#dirBoth', owner: 'target', direction: 'bidirectional' },
      { control: '#dirOne', owner: 'target', direction: 'unidirectional' },
      { control: '#dirReverse', owner: 'source', direction: 'reverse' },
    ]) {
      add(`late rename destination is versioned: ${scenario.direction}, ${nativeMove ? 'native' : 'fallback'}`, async ({ page }) => {
        await planRename(page, { ...scenario, nativeMove });
        await page.evaluate((owner) => window.__setMockFile(owner, 'renamed.txt', { content: 'appeared' }), scenario.owner);
        await executeCurrentPlan(page);
        const snapshot = await snapshotMockPair(page);
        const root = snapshot[scenario.owner];
        assert.ok(root['.filenally'], 'rename overwrite must capture the late destination');
        const index = JSON.parse(root['.filenally']['index.json'].content);
        assert.equal(index.versions.length, 1);
        const version = index.versions[0];
        assert.equal(root['.filenally'].versions[version.id]['renamed.txt'].content, 'appeared');
        assert.equal(root['renamed.txt'].content, 'same');
        assert.equal(root['original.txt'], undefined);
        assert.equal(version.originalPath, 'renamed.txt');
        assert.equal(version.direction, scenario.direction);
        assert.equal(version.toSide, scenario.owner);
        assert.equal(version.fromSide, scenario.owner === 'target' ? 'source' : 'target');
        assert.equal(snapshot[version.fromSide]['.filenally'], undefined);
        const run = await page.evaluate(async () => {
          const state = JSON.parse(localStorage.getItem('smart_sync_state'));
          return window.FileNallyTest.RunLogStore.get(state.globalHistory[0].logId);
        });
        assert.equal(run.status, 'success');
        assert.equal(version.runId, run.id);
        assert.equal(run.entries[0].versionId, version.id);
        assert.equal(run.entries[0].versionPath, version.storedPath);
      });
    }

    add(`rename without destination creates no version: ${nativeMove ? 'native' : 'fallback'}`, async ({ page }) => {
      await planRename(page, { nativeMove });
      await executeCurrentPlan(page);
      const snapshot = await snapshotMockPair(page);
      assert.equal(snapshot.target['renamed.txt'].content, 'same');
      assert.equal(snapshot.target['original.txt'], undefined);
      assert.equal(snapshot.target['.filenally'], undefined);
    });

    add(`rename capture failure stops native or fallback mutation: ${nativeMove ? 'native' : 'fallback'}`, async ({ page }) => {
      await planRename(page, { nativeMove });
      await page.evaluate(async () => {
        await window.__mockPair.source.getDirectoryHandle('created', { create: true });
        window.__setMockFile('source', 'zzz.txt', { content: 'later' });
      });
      await compare(page);
      await page.evaluate(() => {
        window.__setMockFile('target', 'renamed.txt', { content: 'appeared' });
        window.__setMockFailure({ operation: 'close', name: 'index.json' });
      });
      await executeCurrentPlan(page);
      const snapshot = await snapshotMockPair(page);
      assert.equal(snapshot.target['renamed.txt'].content, 'appeared');
      assert.equal(snapshot.target['original.txt'].content, 'same');
      assert.deepEqual(snapshot.target.created, {});
      assert.equal(snapshot.target['zzz.txt'], undefined);
      const result = await page.evaluate(async () => {
        const state = JSON.parse(localStorage.getItem('smart_sync_state'));
        return {
          run: await window.FileNallyTest.RunLogStore.get(state.globalHistory[0].logId),
          checkpoint: state.profiles[state.activeProfileId].lastCheckpoint,
        };
      });
      assert.deepEqual(result.run.entries.map((entry) => entry.status), ['success', 'failed', 'not-run']);
      assert.match(result.run.entries[1].error, /Injected close failure/);
      assert.equal(result.run.entries[1].versionId, '');
      assert.equal(result.run.entries[1].versionPath, '');
      assert.equal(result.checkpoint.completed, 1);
      assert.equal(result.checkpoint.total, 3);
      assert.equal(result.checkpoint.planId, result.run.id);
    });
  }

  add('rename write failure retains its captured version and original file', async ({ page }) => {
    await planRename(page);
    await page.evaluate(() => {
      window.__setMockFile('target', 'renamed.txt', { content: 'appeared' });
      window.__setMockFailure({ operation: 'write', name: 'renamed.txt', occurrence: 2 });
    });
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target['renamed.txt'].content, 'appeared');
    assert.equal(snapshot.target['original.txt'].content, 'same');
    const index = JSON.parse(snapshot.target['.filenally']['index.json'].content);
    const version = index.versions[0];
    assert.equal(snapshot.target['.filenally'].versions[version.id]['renamed.txt'].content, 'appeared');
    const run = await page.evaluate(async () => {
      const state = JSON.parse(localStorage.getItem('smart_sync_state'));
      return window.FileNallyTest.RunLogStore.get(state.globalHistory[0].logId);
    });
    assert.equal(run.status, 'failed');
    assert.match(run.entries[0].error, /Injected write failure/);
    assert.equal(run.entries[0].versionId, version.id);
    assert.equal(run.entries[0].versionPath, version.storedPath);
  });

  add('capture rejects version index over size limit after append', async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: { 'report.txt': { content: 'new', lastModified: 200 } },
      target: { 'report.txt': { content: 'old', lastModified: 100 } },
    });
    await compare(page);
    await page.evaluate(() => {
      const limit = 5 * 1024 * 1024;
      const record = {
        id: 'existing', capturedAt: '2026-09-13T00:00:00.000Z',
        originalPath: 'report.txt', storedPath: 'versions/existing/report.txt',
        size: 3, type: '', lastModified: 100, reason: 'before-overwrite',
        runId: 'run', direction: 'unidirectional', fromSide: 'source', toSide: 'target',
      };
      const base = JSON.stringify({ schemaVersion: 1, versions: [record] }, null, 2);
      record.type = 'x'.repeat(limit - new Blob([base]).size - 64);
      const text = JSON.stringify({ schemaVersion: 1, versions: [record] }, null, 2);
      if (new Blob([text]).size >= limit) throw new Error('Fixture must begin below the size limit');
      window.__setMockFile('target', '.filenally/index.json', { content: text });
    });
    await executeCurrentPlan(page);
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().phase), 'error');
    assert.equal(await page.evaluate(() => window.__getMockFile('target', 'report.txt').content), 'old');
    assert.match(await page.locator('#syncStatus').innerText(), /Version index exceeds 5MB/);
  });

  add('capture rejects version index over record limit after append', async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: { 'report.txt': { content: 'new', lastModified: 200 } },
      target: { 'report.txt': { content: 'old', lastModified: 100 } },
    });
    await compare(page);
    await page.evaluate(() => {
      const NativeBlob = window.Blob;
      class ZeroSizeBlob extends NativeBlob { get size() { return 0; } }
      class ZeroSizeFile extends ZeroSizeBlob {
        constructor(parts, name, options = {}) {
          super(parts, options);
          this.name = name;
          this.lastModified = Number(options.lastModified || Date.now());
        }
      }
      window.Blob = ZeroSizeBlob;
      window.File = ZeroSizeFile;
      const record = {
        id: 'v', capturedAt: '2026-09-13T00:00:00.000Z',
        originalPath: 'r', storedPath: 'versions/v/r', size: 0,
        lastModified: 0, reason: 'before-overwrite', direction: 'unidirectional',
        fromSide: 'source', toSide: 'target',
      };
      window.__setMockFile('target', '.filenally/index.json', {
        content: JSON.stringify({ schemaVersion: 1, versions: Array.from({ length: 100000 }, (_, index) => ({
          ...record, id: `v-${index}`, storedPath: `versions/v-${index}/r`,
        })) }),
      });
    });
    await executeCurrentPlan(page);
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().phase), 'error');
    assert.equal(await page.evaluate(() => window.__getMockFile('target', 'report.txt').content), 'old');
    assert.match(await page.locator('#syncStatus').innerText(), /Version index has too many records/);
  });

  for (const failure of [
    { name: 'report.txt', operation: 'write', label: 'version bytes' },
    { name: 'index.json', operation: 'write', label: 'index write' },
    { name: 'index.json', operation: 'close', label: 'index close' },
  ]) {
    add(`a ${failure.label} failure leaves the destination unchanged`, async ({ page }) => {
      await page.locator('#dirOne').click();
      await mountPair(page, {
        source: { 'report.txt': { content: 'new', lastModified: 200 } },
        target: { 'report.txt': { content: 'old', lastModified: 100 } },
      });
      await compare(page);
      await page.evaluate((rule) => window.__setMockFailure(rule), failure);
      await executeCurrentPlan(page);
      const snapshot = await snapshotMockPair(page);
      assert.equal(snapshot.target['report.txt'].content, 'old');
      assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().phase), 'error');
    });
  }

  for (const fixture of [
    { label: 'malformed', index: { content: '{bad json' } },
    { label: 'unsupported', index: { content: '{"schemaVersion":2,"versions":[]}' } },
    { label: 'oversized', index: { contentSize: (5 * 1024 * 1024) + 1 } },
  ]) {
    add(`a ${fixture.label} damaged version index is never reset`, async ({ page }) => {
      await page.locator('#dirOne').click();
      await mountPair(page, {
        source: { 'report.txt': { content: 'new', lastModified: 200 } },
        target: {
          'report.txt': { content: 'old', lastModified: 100 },
          '.filenally': { type: 'directory', entries: {
            'index.json': fixture.index,
          } },
        },
      });
      const before = await page.evaluate(() => window.__getMockFile('target', '.filenally/index.json'));
      await compare(page);
      await executeCurrentPlan(page);
      const snapshot = await snapshotMockPair(page);
      const after = await page.evaluate(() => window.__getMockFile('target', '.filenally/index.json'));
      assert.equal(snapshot.target['report.txt'].content, 'old');
      assert.deepEqual(after, before);
      assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().phase), 'error');
    });
  }

  add('destination write failure retains version metadata and the last successful checkpoint', async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: {
        'a.txt': { content: 'new a', lastModified: 200 },
        'b.txt': { content: 'new b', lastModified: 200 },
        'c.txt': { content: 'new c', lastModified: 200 },
      },
      target: {
        'a.txt': { content: 'old a', lastModified: 100 },
        'b.txt': { content: 'old b', lastModified: 100 },
        'c.txt': { content: 'old c', lastModified: 100 },
      },
    });
    await compare(page);
    await page.evaluate(() => window.__setMockFailure({
      operation: 'write', name: 'b.txt', occurrence: 2,
    }));
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    const index = JSON.parse(snapshot.target['.filenally']['index.json'].content);
    assert.equal(snapshot.target['a.txt'].content, 'new a');
    assert.equal(snapshot.target['b.txt'].content, 'old b');
    assert.equal(snapshot.target['c.txt'].content, 'old c');
    assert.equal(index.versions[1].originalPath, 'b.txt');
    assert.equal(snapshot.target['.filenally'].versions[index.versions[1].id]['b.txt'].content, 'old b');
    const result = await page.evaluate(async () => {
      const state = JSON.parse(localStorage.getItem('smart_sync_state'));
      const run = await window.FileNallyTest.RunLogStore.get(state.globalHistory[0].logId);
      return { run, checkpoint: state.profiles[state.activeProfileId].lastCheckpoint };
    });
    assert.deepEqual(result.run.entries.map((entry) => entry.status), ['success', 'failed', 'not-run']);
    assert.equal(result.run.entries[1].versionId, index.versions[1].id);
    assert.equal(result.run.entries[1].versionPath, index.versions[1].storedPath);
    assert.equal(result.checkpoint.planId, result.run.id);
    assert.equal(result.checkpoint.completed, 1);
    assert.equal(result.checkpoint.total, 3);
  });

  add('legacy run entries normalize missing version fields', async ({ page }) => {
    await page.evaluate(async () => {
      const run = {
        id: 'legacy-run', entries: [{
          sequence: 1, action: 'copy', path: 'a.txt', status: 'success',
        }],
      };
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('file-nally-handles', 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('runLogs', 'readwrite');
          transaction.objectStore('runLogs').put(run);
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => { db.close(); reject(transaction.error); };
        };
      });
    });
    await page.reload();
    assert.equal(await page.evaluate(() => window.FileNallyTest.RunLogStore.peek('legacy-run')), null);
    const normalized = await page.evaluate(() => window.FileNallyTest.RunLogStore.get('legacy-run'));
    assert.equal(normalized.entries[0].path, 'a.txt');
    assert.equal(normalized.entries[0].versionId, '');
    assert.equal(normalized.entries[0].versionPath, '');
  });

  add('versioned overwrite exports raw version fields to JSON and CSV', async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: { 'report.txt': { content: 'new', lastModified: 200 } },
      target: { 'report.txt': { content: 'old', lastModified: 100 } },
    });
    await compare(page);
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    const index = JSON.parse(snapshot.target['.filenally']['index.json'].content);
    await page.locator('.history-detail-button').first().click();

    const jsonPromise = page.waitForEvent('download');
    await page.locator('#btnDownloadRunJson').click();
    const json = JSON.parse(await downloadText(await jsonPromise));
    assert.equal(json.entries[0].versionId, index.versions[0].id);
    assert.equal(json.entries[0].versionPath, index.versions[0].storedPath);

    const csvPromise = page.waitForEvent('download');
    await page.locator('#btnDownloadRunCsv').click();
    const csv = await downloadText(await csvPromise);
    assert.match(csv, /versionId,versionPath/);
    assert.match(csv, new RegExp(index.versions[0].id));
    assert.match(csv, /versions\//);
  });

  add('failed version capture detail retains the captured version reference', async ({ page }) => {
    await page.locator('#dirOne').click();
    await mountPair(page, {
      source: { 'report.txt': { content: 'new', lastModified: 200 } },
      target: { 'report.txt': { content: 'old', lastModified: 100 } },
    });
    await compare(page);
    await page.evaluate(() => window.__setMockFailure({
      operation: 'write', name: 'report.txt', occurrence: 2,
    }));
    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    const version = JSON.parse(snapshot.target['.filenally']['index.json'].content).versions[0];
    await page.locator('.history-detail-button').first().click();
    assert.match(await page.locator('#runDetailDialog thead').innerText(), /버전 ID/);
    assert.match(await page.locator('#runDetailDialog thead').innerText(), /버전 경로/);
    assert.match(await page.locator('#runDetailBody').innerText(), new RegExp(version.id));
    assert.match(await page.locator('#runDetailBody').innerText(), /\.filenally\/versions\//);
    await page.locator('#btnCloseRunDetail').click();
    await page.locator('#btnLangEn').click();
    await page.locator('.history-detail-button').first().click();
    assert.match(await page.locator('#runDetailDialog thead').innerText(), /Version ID/);
    assert.match(await page.locator('#runDetailDialog thead').innerText(), /Version path/);
    assert.match(await page.locator('#runDetailBody').innerText(), new RegExp(version.id));
    assert.match(await page.locator('#runDetailBody').innerText(), /\.filenally\/versions\//);
  });

  add('verified deletion moves the remaining file into versioned trash', async ({ page }) => {
    await mountPair(page, {
      source: { 'nested': { type: 'directory', entries: { 'gone.txt': { content: 'keepable', lastModified: 100 } } } },
      target: { 'nested': { type: 'directory', entries: { 'gone.txt': { content: 'keepable', lastModified: 100 } } } },
    });
    await compare(page);
    await page.locator('#btnSync').click();
    await page.waitForFunction(() => /완료|Complete/i.test(document.querySelector('#syncStatus')?.textContent || ''));
    await page.evaluate(() => window.__deleteMockEntry('target', 'nested/gone.txt'));
    await compare(page);
    await page.locator('#btnSync').click();
    await page.waitForFunction(() => /완료|Complete/i.test(document.querySelector('#syncStatus')?.textContent || ''));
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.source.nested['gone.txt'], undefined);
    const runs = Object.values(snapshot.source['.trash']);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].nested['gone.txt'].content, 'keepable');
  });

  add('abort finishes the current write and does not start the next action', async ({ page }) => {
    await page.locator('#conflictPolicy').selectOption('source-overwrite');
    await mountPair(page, {
      source: {
        'a.txt': { content: 'new a', lastModified: 300 },
        'b.txt': { content: 'new b', lastModified: 300 },
      },
      target: {
        'a.txt': { content: 'old a', lastModified: 100, writeDelay: 150 },
        'b.txt': { content: 'old b', lastModified: 100 },
      },
    });
    await compare(page);
    await page.locator('#btnSync').click();
    await page.waitForTimeout(25);
    await page.locator('#btnAbort').click();
    await page.waitForFunction(() => window.FileNallyTest?.getModel().phase === 'aborted');
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target['a.txt'].content, 'new a');
    assert.equal(snapshot.target['b.txt'].content, 'old b');
  });

  add('write failure stops later actions and records a failed run', async ({ page }) => {
    await page.locator('#conflictPolicy').selectOption('source-overwrite');
    await mountPair(page, {
      source: {
        'a.txt': { content: 'new a', lastModified: 300 },
        'b.txt': { content: 'new b', lastModified: 300 },
      },
      target: {
        'a.txt': { content: 'old a', lastModified: 100, failWrite: true },
        'b.txt': { content: 'old b', lastModified: 100 },
      },
    });
    await compare(page);
    await page.locator('#btnSync').click();
    await page.waitForFunction(() => /오류|failed/i.test(document.querySelector('#syncStatus')?.textContent || ''));
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target['a.txt'].content, 'old a');
    assert.equal(snapshot.target['b.txt'].content, 'old b');
    assert.match(await page.locator('#historyBody').innerText(), /실패|Failed/);
  });

  add('run details persist across reload and export complete JSON and safe CSV', async ({ page }) => {
    await mountPair(page, {
      source: {
        'safe.txt': { content: 'safe', lastModified: 200 },
        '=formula.txt': { content: 'formula', lastModified: 200 },
      },
      target: {},
    });
    await compare(page);
    await executeCurrentPlan(page);
    await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'success');

    await page.locator('.history-detail-button').first().click();
    const dialog = page.locator('#runDetailDialog');
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'btnCloseRunDetail');
    assert.equal(await page.locator('#runDetailBody tr').count(), 2);
    assert.match(await page.locator('#runDetailBody').innerText(), /safe\.txt/);
    assert.match(await page.locator('#runDetailBody').innerText(), /=formula\.txt/);

    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('history-detail-button')), true);
    await page.locator('.history-detail-button').first().click();

    const jsonDownloadPromise = page.waitForEvent('download');
    await page.locator('#btnDownloadRunJson').click();
    const jsonDownload = await jsonDownloadPromise;
    const json = JSON.parse(await downloadText(jsonDownload));
    assert.equal(json.entries.length, 2);
    assert.ok(json.entries.some((entry) => entry.path === '=formula.txt'));

    const csvDownloadPromise = page.waitForEvent('download');
    await page.locator('#btnDownloadRunCsv').click();
    const csvDownload = await csvDownloadPromise;
    const csv = await downloadText(csvDownload);
    assert.match(csv, /^\uFEFFsequence,action,path,/);
    assert.match(csv, /'=formula\.txt/);

    await page.locator('#btnCloseRunDetail').click();
    await page.reload();
    await page.locator('.history-detail-button').first().click();
    assert.equal(await page.locator('#runDetailBody tr').count(), 2);

    await page.locator('#btnCloseRunDetail').click();
    page.once('dialog', (confirmation) => confirmation.accept());
    await page.locator('#btnClearHistory').click();
    await page.waitForFunction(async () => (await window.FileNallyTest.RunLogStore.count()) === 0);
    assert.match(await page.locator('#historyBody').innerText(), /기록된 동기화 이력이 없습니다|No synchronization history/);
  });

  add('run detail paging shows one hundred actions per page without truncating export', async ({ page }) => {
    const source = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`file-${String(index).padStart(3, '0')}.txt`, { content: String(index), lastModified: 200 }]));
    await mountPair(page, { source, target: {} });
    await compare(page);
    await executeCurrentPlan(page);
    await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'success');
    await page.locator('.history-detail-button').first().click();

    assert.equal(await page.locator('#runDetailBody tr').count(), 100);
    assert.equal(await page.locator('#btnRunNextPage').isEnabled(), true);
    await page.locator('#btnRunNextPage').click();
    assert.equal(await page.locator('#runDetailBody tr').count(), 1);
    assert.match(await page.locator('#runDetailPageStatus').innerText(), /2\s*\/\s*2/);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btnDownloadRunJson').click();
    const exported = JSON.parse(await downloadText(await downloadPromise));
    assert.equal(exported.entries.length, 101);
  });

  add('failed action appears in detailed history with its error', async ({ page }) => {
    await page.locator('#conflictPolicy').selectOption('source-overwrite');
    await mountPair(page, {
      source: { 'broken.txt': { content: 'new', lastModified: 300 } },
      target: { 'broken.txt': { content: 'old', lastModified: 100, failWrite: true } },
    });
    await compare(page);
    await executeCurrentPlan(page);
    await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'error');
    await page.locator('.history-detail-button').first().click();
    assert.match(await page.locator('#runDetailBody').innerText(), /broken\.txt/);
    assert.match(await page.locator('#runDetailBody').innerText(), /실패|Failed/);
    assert.match(await page.locator('#runDetailBody').innerText(), /Injected write failure/);
  });

  add('language changes keep selected folder names visible', async ({ page }) => {
    await mountPair(page, { sourceName: 'my-source', targetName: 'my-target', source: {}, target: {} });
    await page.locator('#btnLangEn').click();
    assert.equal(await page.locator('#pathSrc').innerText(), 'my-source');
    assert.equal(await page.locator('#pathTgt').innerText(), 'my-target');
    assert.equal(await page.getByLabel('Show changed items only', { exact: true }).count(), 1);
  });

  for (const { action, ko, en } of [
    { action: 'create-directory', ko: '폴더 생성', en: 'Create folder' },
    { action: 'baseline-directory', ko: '폴더 기준 저장', en: 'Save folder baseline' },
    { action: 'trash-directory', ko: '폴더 휴지통 이동', en: 'Move folder to trash' },
  ]) {
    add(`directory actions render bilingually and preserve exports: ${action}`, async ({ page }) => {
      const tree = { '빈 폴더': { type: 'directory', entries: {} } };
      await mountPair(page, { source: tree, target: action === 'create-directory' ? {} : tree });
      if (action === 'trash-directory') {
        await compare(page);
        await executeCurrentPlan(page);
        await page.evaluate(() => window.__deleteMockEntry('source', '빈 폴더'));
      }
      await compare(page);
      assert.ok((await page.locator('#tgtFileBody').innerText()).includes(ko));
      await page.locator('#btnLangEn').click();
      assert.ok((await page.locator('#tgtFileBody').innerText()).includes(en));
      await executeCurrentPlan(page);
      for (const [lang, label] of [['En', en], ['Ko', ko]]) {
        await page.locator(`#btnLang${lang}`).click();
        await page.locator('.history-detail-button').first().click();
        assert.ok((await page.locator('#runDetailBody').innerText()).includes(label));
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#btnDownloadRunJson').click();
        const json = JSON.parse(await downloadText(await downloadPromise));
        assert.deepEqual(json.entries.map(({ action, path }) => ({ action, path })), [
          { action, path: '빈 폴더' },
        ]);
        const csvPromise = page.waitForEvent('download');
        await page.locator('#btnDownloadRunCsv').click();
        const csv = await downloadText(await csvPromise);
        assert.deepEqual(csv.trim().split(/\r?\n/).slice(1).map((row) => row.split(',').slice(1, 3)), [
          [action, '빈 폴더'],
        ]);
        await page.locator('#btnCloseRunDetail').click();
      }
    });
  }

  add('quick guide explains the safe workflow in both languages and restores focus', async ({ page }) => {
    const trigger = page.locator('#btnQuickGuide');
    const dialog = page.locator('#quickGuideDialog');

    assert.equal(await trigger.count(), 1);
    await trigger.click();
    assert.equal(await dialog.evaluate((node) => node.open), true);
    assert.equal(await page.locator('#btnCloseQuickGuide').evaluate((node) => node === document.activeElement), true);
    const korean = await dialog.innerText();
    assert.match(korean, /원본 폴더와 대상 폴더/);
    assert.match(korean, /작업 계획/);
    assert.match(korean, /권한.*재승인|재승인.*권한/);
    assert.match(korean, /백업/);
    assert.match(korean, /\.trash/);

    await page.keyboard.press('Escape');
    assert.equal(await dialog.evaluate((node) => node.open), false);
    assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);

    await page.locator('#btnLangEn').click();
    await trigger.click();
    const english = await dialog.innerText();
    assert.match(english, /source and target folders/i);
    assert.match(english, /work plan/i);
    assert.match(english, /renew.*permission|permission.*renew/i);
    assert.match(english, /backup/i);
    assert.match(english, /\.trash/);

    await page.locator('#btnCloseQuickGuide').click();
    assert.equal(await dialog.evaluate((node) => node.open), false);
    assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);

    await page.locator('#btnLangKo').click();
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await trigger.click();
      const layout = await page.evaluate(() => {
        const guide = document.querySelector('#quickGuideDialog').getBoundingClientRect();
        const closeButton = document.querySelector('#btnCloseQuickGuide').getBoundingClientRect();
        return {
          documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          guideLeft: guide.left,
          guideRight: guide.right,
          viewportWidth: document.documentElement.clientWidth,
          closeButtonHeight: closeButton.height,
        };
      });
      assert.equal(layout.documentOverflow, false);
      assert.ok(layout.guideLeft >= 0);
      assert.ok(layout.guideRight <= layout.viewportWidth);
      assert.ok(layout.closeButtonHeight <= 48, `close button wrapped at ${width}px (${layout.closeButtonHeight}px tall)`);
      await page.keyboard.press('Escape');
    }
  });

  add('rename policy preserves both conflicting versions', async ({ page }) => {
    await page.locator('#conflictPolicy').selectOption('rename');
    await mountPair(page, {
      source: { 'shared.txt': { content: 'source version', lastModified: 200 } },
      target: { 'shared.txt': { content: 'target version', lastModified: 300 } },
    });
    await compare(page);
    await page.locator('#btnSync').click();
    await page.waitForFunction(() => window.FileNallyTest?.getModel().phase === 'success');
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.source['shared.txt'].content, 'source version');
    assert.equal(snapshot.target['shared.txt'].content, 'target version');
    assert.equal(Object.entries(snapshot.source).find(([name]) => name.startsWith('shared.conflict-target-'))[1].content, 'target version');
    assert.equal(Object.entries(snapshot.target).find(([name]) => name.startsWith('shared.conflict-source-'))[1].content, 'source version');
  });

  add('interactive controls expose labels and unique ids', async ({ page }) => {
    const issues = await page.evaluate(() => {
      const found = [];
      const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
      if (new Set(ids).size !== ids.length) found.push('duplicate ids');
      for (const button of document.querySelectorAll('button')) {
        if (!(button.textContent || button.getAttribute('aria-label') || '').trim()) found.push(`unnamed button ${button.id}`);
      }
      for (const control of document.querySelectorAll('select, input:not([type="file"])')) {
        if (!control.labels?.length && !control.getAttribute('aria-label')) found.push(`unlabelled control ${control.id}`);
      }
      if (document.querySelector('#syncStatus')?.getAttribute('role') !== 'status') found.push('status region');
      if (document.querySelector('#logBox')?.getAttribute('role') !== 'log') found.push('log region');
      return found;
    });
    assert.deepEqual(issues, []);
  });

  add('reverse sync copies from target to source and preserves target-only files', async ({ page }) => {
    await mountPair(page, {
      source: { 'old.txt': { content: 'old source', lastModified: 100 } },
      target: { 'new.txt': { content: 'new target', lastModified: 200 } },
    });
    await page.locator('#dirReverse').click();
    await compare(page);
    const plan = await page.evaluate(() => window.FileNallyTest.getModel().plan);
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0].type, 'copy');
    assert.equal(plan.actions[0].fromSide, 'target');
    assert.equal(plan.actions[0].toSide, 'source');
    assert.equal(plan.actions[0].path, 'new.txt');
  });

  add('bookmark star button toggles active profile bookmark state', async ({ page }) => {
    await mountPair(page, {
      source: { 'a.txt': { content: 'a' } },
      target: { 'a.txt': { content: 'a' } },
    });
    const starBtn = page.locator('#btnBookmark');
    assert.equal(await starBtn.getAttribute('data-bookmarked'), 'false');
    await starBtn.click();
    assert.equal(await starBtn.getAttribute('data-bookmarked'), 'true');
    const bookmarkCount = await page.locator('#bookmarkChips .chip-bookmark').count();
    assert.equal(bookmarkCount, 1);
  });

  add('permission gate requests only prompt handles and requires both grants', async ({ page }) => {
    await configureMockPair(page, {
      sourcePermission: 'prompt',
      sourceRequestPermissionResult: 'granted',
      targetPermission: 'granted',
    });
    const result = await page.evaluate(() => window.FileNallyTest.PermissionGate.request({
      sourceHandle: window.__mockPair.source,
      targetHandle: window.__mockPair.target,
    }));
    const requests = await page.evaluate(() => window.__getPermissionCalls().filter((call) => call.method === 'request'));
    assert.equal(result.state, 'granted');
    assert.deepEqual(requests.map((call) => call.name), ['source']);
  });

  add('permission gate normalizes a denied permission request', async ({ page }) => {
    await configureMockPair(page, {
      sourcePermission: 'prompt',
      sourceRequestPermissionResult: 'denied',
      targetPermission: 'granted',
    });
    const result = await page.evaluate(() => window.FileNallyTest.PermissionGate.request({
      sourceHandle: window.__mockPair.source,
      targetHandle: window.__mockPair.target,
    }));
    assert.equal(result.state, 'denied');
  });

  add('permission gate normalizes a permission request exception', async ({ page }) => {
    await configureMockPair(page, {
      sourcePermission: 'prompt',
      sourceRequestPermissionError: 'Activation expired',
      targetPermission: 'granted',
    });
    const result = await page.evaluate(() => window.FileNallyTest.PermissionGate.request({
      sourceHandle: window.__mockPair.source,
      targetHandle: window.__mockPair.target,
    }));
    assert.equal(result.state, 'unavailable');
    assert.match(result.error, /Activation expired/);
  });

  add('saved profile click renews prompt permission before enabling compare', async ({ page }) => {
    await mountPair(page, {
      source: { 'source.txt': { content: 'source' } },
      target: {},
    });
    await page.evaluate(() => {
      window.__permissionCalls.length = 0;
      window.__setMockPermission('source', { state: 'prompt', requestResult: 'granted' });
    });
    await page.locator('#recentChips .chip').click();
    await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'ready');
    assert.equal(await page.locator('#btnCompare').isEnabled(), true);
    assert.equal(await page.locator('#syncStatus').getAttribute('role'), 'status');
    assert.equal(await page.locator('#syncStatus').getAttribute('aria-live'), 'polite');
    const requests = await page.evaluate(() => window.__getPermissionCalls().filter((call) => call.method === 'request'));
    assert.deepEqual(requests.map((call) => call.name), ['source']);
  });

  add('denied saved profile remains history-only and explains folder reselection', async ({ page }) => {
    await mountPair(page, {
      source: { 'source.txt': { content: 'source' } },
      target: {},
    });
    await compare(page);
    await executeCurrentPlan(page);
    const profileId = await page.evaluate(() => window.FileNallyTest.getModel().profileId);
    await page.evaluate(() => window.__setMockPermission('source', { state: 'denied' }));
    await page.locator('#recentChips .chip').click();
    const model = await page.evaluate(() => window.FileNallyTest.getModel());
    assert.equal(model.phase, 'idle');
    assert.equal(model.trustedProfile, false);
    assert.equal(model.profileId, profileId);
    assert.equal(await page.locator('#btnCompare').isDisabled(), true);
    const status = page.locator('#syncStatus');
    assert.match(await status.innerText(), /다시 선택|select.*again/i);
    assert.equal(await status.getAttribute('role'), 'alert');
    assert.equal(await status.getAttribute('aria-live'), 'assertive');
    assert.match(await page.locator('#historyBody').innerText(), /성공|Success/);
  });

  add('bootstrap inspection never requests prompt permission', async ({ page }) => {
    await mountPair(page, { source: {}, target: {} });
    await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'ready');
    const profileId = await page.evaluate(() => window.FileNallyTest.getModel().profileId);
    await page.evaluate(() => {
      window.__permissionCalls.length = 0;
      window.__setMockPermission('source', { state: 'prompt', requestResult: 'granted' });
    });
    const connected = await page.evaluate((id) => window.FileNallyTest.connectStoredProfile(id, false), profileId);
    const requests = await page.evaluate(() => window.__getPermissionCalls().filter((call) => call.method === 'request'));
    assert.equal(connected, false);
    assert.deepEqual(requests, []);
    assert.equal(await page.locator('#btnCompare').isDisabled(), true);
    assert.match(await page.locator('#syncStatus').innerText(), /최근 폴더|북마크|recent folder|bookmark/i);
  });

  add('rename detection verifies identical content in quick mode', async ({ page }) => {
    await mountPair(page, {
      source: { 'original.txt': { content: 'hello world' } },
      target: { 'original.txt': { content: 'hello world' } },
    });
    await compare(page);
    await executeCurrentPlan(page);

    await page.evaluate(() => {
      const source = window.__mockPair.source;
      const originalFile = source.entries.get('original.txt');
      source.entries.delete('original.txt');
      originalFile.name = 'renamed.txt';
      source.entries.set('renamed.txt', originalFile);
    });

    await compare(page);
    const plan = await page.evaluate(() => window.FileNallyTest.getModel().plan);
    const renameAction = plan.actions.find((a) => a.type === 'rename');
    assert.ok(renameAction, 'expected a rename action');
  });

  add('rename detection accepts one unambiguous empty file', async ({ page }) => {
    await mountPair(page, {
      source: { 'original.txt': { content: '' } },
      target: { 'original.txt': { content: '' } },
    });
    await compare(page);
    await executeCurrentPlan(page);

    await page.evaluate(() => {
      const source = window.__mockPair.source;
      const originalFile = source.entries.get('original.txt');
      source.entries.delete('original.txt');
      originalFile.name = 'renamed.txt';
      source.entries.set('renamed.txt', originalFile);
    });

    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.equal(actions.filter((action) => action.type === 'rename').length, 1);
    assert.equal(actions.some((action) => action.type === 'trash'), false);
  });

  add('rename detection preserves equal-size files with different content', async ({ page }) => {
    await mountPair(page, {
      source: { 'original.txt': { content: 'AAAA' } },
      target: { 'original.txt': { content: 'AAAA' } },
    });
    await compare(page);
    await executeCurrentPlan(page);

    await page.evaluate(() => {
      window.__deleteMockEntry('source', 'original.txt');
      window.__setMockFile('source', 'renamed.txt', { content: 'BBBB' });
    });

    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.equal(actions.some((action) => action.type === 'rename'), false);
    assert.deepEqual(actions.map((action) => action.type).sort(), ['copy', 'trash']);

    await executeCurrentPlan(page);
    const snapshot = await snapshotMockPair(page);
    assert.equal(snapshot.target['renamed.txt'].content, 'BBBB');
    assert.equal(Object.values(snapshot.target['.trash'])[0]['original.txt'].content, 'AAAA');
  });

  add('rename detection rejects a candidate that grows after scanning', async ({ page }) => {
    await mountPair(page, {
      source: { 'original.txt': { content: 'AAAA' } },
      target: { 'original.txt': { content: 'AAAA' } },
    });
    await compare(page);
    await executeCurrentPlan(page);

    await page.evaluate(() => {
      window.__deleteMockEntry('source', 'original.txt');
      window.__setMockFile('source', 'renamed.txt', { content: 'AAAA', contentAfterRead: 'AAAAB' });
    });

    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.equal(actions.some((action) => action.type === 'rename'), false);
    assert.deepEqual(actions.map((action) => action.type).sort(), ['copy', 'trash']);
  });

  add('rename detection rejects ambiguous identical-content candidates', async ({ page }) => {
    await mountPair(page, {
      source: { 'original.txt': { content: 'same' } },
      target: { 'original.txt': { content: 'same' } },
    });
    await compare(page);
    await executeCurrentPlan(page);

    await page.evaluate(() => {
      window.__deleteMockEntry('source', 'original.txt');
      window.__setMockFile('source', 'renamed-a.txt', { content: 'same' });
      window.__setMockFile('source', 'renamed-b.txt', { content: 'same' });
    });

    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.equal(actions.some((action) => action.type === 'rename'), false);
    assert.deepEqual(actions.map((action) => action.type).sort(), ['copy', 'copy', 'trash']);
  });

  add('rename detection rejects a many-to-one identical-content match', async ({ page }) => {
    await mountPair(page, {
      source: {
        'original-a.txt': { content: 'same' },
        'original-b.txt': { content: 'same' },
      },
      target: {
        'original-a.txt': { content: 'same' },
        'original-b.txt': { content: 'same' },
      },
    });
    await compare(page);
    await executeCurrentPlan(page);

    await page.evaluate(() => {
      window.__deleteMockEntry('source', 'original-a.txt');
      window.__deleteMockEntry('source', 'original-b.txt');
      window.__setMockFile('source', 'renamed.txt', { content: 'same' });
    });

    await compare(page);
    const actions = await page.evaluate(() => window.FileNallyTest.getModel().plan.actions);
    assert.equal(actions.some((action) => action.type === 'rename'), false);
    assert.deepEqual(actions.map((action) => action.type).sort(), ['copy', 'trash', 'trash']);
  });

  add('rename verification follows the authoritative sync direction', async ({ page }) => {
    for (const scenario of [
      { control: '#dirOne', changedSide: 'source', fromSide: 'source', toSide: 'target' },
      { control: '#dirReverse', changedSide: 'target', fromSide: 'target', toSide: 'source' },
    ]) {
      await page.locator(scenario.control).click();
      await mountPair(page, {
        source: { 'original.txt': { content: 'same' } },
        target: { 'original.txt': { content: 'same' } },
      });
      await compare(page);
      await executeCurrentPlan(page);
      await page.evaluate((changedSide) => {
        window.__deleteMockEntry(changedSide, 'original.txt');
        window.__setMockFile(changedSide, 'renamed.txt', { content: 'same' });
      }, scenario.changedSide);

      await compare(page);
      const rename = (await page.evaluate(() => window.FileNallyTest.getModel().plan.actions))
        .find((action) => action.type === 'rename');
      assert.deepEqual(
        { fromSide: rename?.fromSide, toSide: rename?.toSide, side: rename?.side },
        { fromSide: scenario.fromSide, toSide: scenario.toSide, side: scenario.toSide },
      );
      await executeCurrentPlan(page);
      const snapshot = await snapshotMockPair(page);
      assert.equal(snapshot[scenario.toSide]['renamed.txt'].content, 'same');
      assert.equal(snapshot[scenario.toSide]['original.txt'], undefined);
      await page.reload();
    }
  });

  add('safe stop cancels rename candidate verification', async ({ page }) => {
    const options = { contentSize: (4 * 1024 * 1024) + 1, readDelay: 100 };
    await mountPair(page, {
      source: { 'original.bin': options },
      target: { 'original.bin': options },
    });
    await compare(page);
    await executeCurrentPlan(page);
    await page.evaluate(() => {
      const source = window.__mockPair.source;
      const originalFile = source.entries.get('original.bin');
      source.entries.delete('original.bin');
      originalFile.name = 'renamed.bin';
      source.entries.set('renamed.bin', originalFile);
    });

    await page.locator('#btnCompare').click();
    await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'comparing');
    await page.locator('#btnAbort').click();
    await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'ready');
    assert.equal(await page.evaluate(() => window.FileNallyTest.getModel().plan), null);
    assert.match(await page.locator('#syncStatus').innerText(), /비교가 중지|comparison stopped/i);
  });

  const results = [];
  for (const test of tests) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await installMockFileSystem(page);
    await page.goto(url);
    await resetBrowserState(page);
    await page.reload();
    try {
      await test.run({ page, context, url, devUrl });
      const errors = await page.evaluate(() => window.__testUnhandledErrors || []);
      assert.deepEqual(errors, []);
      results.push({ name: test.name, status: 'PASS' });
    } catch (error) {
      results.push({ name: test.name, status: 'FAIL', error: error.message });
    } finally {
      await context.close();
    }
  }

  if (VISUAL) {
    await fs.mkdir(path.join(ROOT, 'artifacts', 'visual'), { recursive: true });
    const comparisonVisualRoot = path.join(ROOT, 'artifacts', 'issue-12-version-comparison', 'visual');
    await fs.mkdir(comparisonVisualRoot, { recursive: true });
    const storageVisualRoot = path.join(ROOT, 'artifacts', 'issue-12-version-storage-cleanup', 'visual');
    await fs.mkdir(storageVisualRoot, { recursive: true });
    for (const viewport of [
      { name: 'mobile', width: 375, height: 900 },
      { name: 'tablet', width: 768, height: 1000 },
      { name: 'desktop', width: 1280, height: 900 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await installMockFileSystem(page);
      await page.goto(url);
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'visual', `${viewport.name}.png`), fullPage: true });
      await page.locator('#btnQuickGuide').click();
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'visual', `${viewport.name}-quick-guide.png`), fullPage: true });
      await page.keyboard.press('Escape');
      if (!(await page.getByLabel('비교 모드').isVisible())) await page.locator('#btnAdvancedToggle').click();
      await page.getByLabel('비교 모드').selectOption('exact');
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'visual', `${viewport.name}-exact.png`), fullPage: true });
      await mountPair(page, {
        source: {
          'reports': { type: 'directory', entries: { 'q2-final.pdf': { content: 'source report', lastModified: 300 } } },
          'notes.txt': { content: 'source notes', lastModified: 200 },
          'stable.txt': { content: 'stable', lastModified: 100 },
        },
        target: {
          'notes.txt': { content: 'target notes', lastModified: 100 },
          'archive.txt': { content: 'archive', lastModified: 150 },
          'stable.txt': { content: 'stable', lastModified: 100 },
        },
      });
      await page.evaluate(() => window.__setMockPermission('source', { state: 'denied' }));
      await page.locator('#recentChips .chip').click();
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'visual', `${viewport.name}-permission-denied.png`), fullPage: true });
      await page.evaluate(() => window.__setMockPermission('source', { state: 'granted' }));
      await page.locator('#recentChips .chip').click();
      await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'ready');
      await compare(page);
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'visual', `${viewport.name}-planned.png`), fullPage: true });
      await page.getByLabel('변경된 항목만 보기', { exact: true }).check();
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'visual', `${viewport.name}-changed-only.png`), fullPage: true });
      await executeCurrentPlan(page);
      await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'success');
      await page.locator('.history-detail-button').first().click();
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'visual', `${viewport.name}-run-detail.png`), fullPage: true });
      await page.keyboard.press('Escape');
      const longPath = `reports/${'long-folder-name-'.repeat(6)}/${'분기별-최종-보고서-'.repeat(5)}.txt`;
      await mountVersion(page, { path: longPath });
      await page.evaluate(path => {
        window.__setMockFile('target', path, { content: 'Current file before restoration', lastModified: 200 });
        const record = window.__versionRecord;
        const versions = [record, ...Array.from({ length: 104 }, (_, i) => ({ ...record,
          id: `older-${i}`, originalPath: `archive/report-${i}.txt`, storedPath: `versions/older-${i}/archive/report-${i}.txt`, capturedAt: '2026-09-12T00:00:00.000Z' }))];
        window.__setMockFile('target', '.filenally/index.json', { content: JSON.stringify({ schemaVersion: 1, versions }) });
      }, longPath);
      await page.locator('#btnVersions').click();
      await page.waitForFunction(() => document.querySelectorAll('#versionBody tr').length === 100);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${viewport.name} versions has no document overflow`);
      assert.equal(await page.locator('.version-table').evaluate(el => el.scrollHeight > el.clientHeight), true);
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'visual', `${viewport.name}-versions.png`), fullPage: true });
      await page.locator('[data-version-action="restore"]').first().click();
      await page.locator('#restoreDialog').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${viewport.name} restore has no document overflow`);
      assert.equal(await page.locator('#restoreTitle').evaluate(el => el.getBoundingClientRect().top >= 0), true, `${viewport.name} restore heading stays visible on opening`);
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'visual', `${viewport.name}-restore.png`), fullPage: true });
      await page.locator('#btnConfirmRestore').focus();
      assert.equal(await page.locator('#btnConfirmRestore').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true);
      await page.locator('#btnCancelRestore').click();
      await page.locator('#btnCloseVersions').click();
      await page.waitForFunction(() => !window.FileNallyTest.getModel().versionBusy);
      for (const lang of ['ko', 'en']) {
        await page.locator(lang === 'ko' ? '#btnLangKo' : '#btnLangEn').click();
        const visualLeft = [`left-${'가'.repeat(180)}`, ...Array.from({ length: 239 }, (_, index) => `left-${index + 2}`)].join('\n');
        const visualRight = [`right-${'나'.repeat(180)}`, ...Array.from({ length: 239 }, (_, index) => `right-${index + 2}`)].join('\n');
        await mountVersion(page, { path: longPath, content: visualLeft });
        await page.evaluate(({ filePath, content }) => window.__setMockFile('target', filePath, { content, lastModified: 200 }), { filePath: longPath, content: visualRight });
        await openVersionComparison(page);
        await runVersionComparison(page);
        assert.equal(await page.locator('#comparisonBody [data-diff-kind]').count(), 200);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${viewport.name} ${lang} comparison has no document overflow`);
        assert.equal(await page.locator('.comparison-scroll').evaluate((element) => element.scrollHeight > element.clientHeight), true, `${viewport.name} ${lang} comparison scrolls internally`);
        assert.equal(await page.locator('.comparison-scroll').evaluate((element) => element.scrollTop), 0, `${viewport.name} ${lang} comparison opens at metadata`);
        for (const selector of ['#comparisonTitle', '#btnCloseComparison', '#btnRunComparison', '#btnStopComparison', '#btnComparisonNext']) {
          assert.equal(await page.locator(selector).evaluate((element) => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; }), true, `${viewport.name} ${lang} ${selector} is reachable`);
        }
        await page.screenshot({ path: path.join(comparisonVisualRoot, `${viewport.name}-${lang}-comparison-initial.png`), fullPage: false });
        await page.locator('.comparison-scroll').evaluate((element) => {
          const row = element.querySelector('#comparisonBody li');
          row.scrollIntoView({ block: 'start', inline: 'nearest' });
        });
        await page.waitForTimeout(30);
        assert.equal(await page.locator('.comparison-scroll').evaluate((element) => element.scrollTop > 0), true, `${viewport.name} ${lang} comparison reaches diff rows`);
        assert.equal(await page.locator('#comparisonBody li').first().evaluate((element) => {
          const row = element.getBoundingClientRect(), scroll = document.querySelector('.comparison-scroll').getBoundingClientRect();
          return row.bottom > scroll.top && row.top < scroll.bottom && element.querySelector('code').textContent.length > 180;
        }), true, `${viewport.name} ${lang} long diff line is visible`);
        for (const selector of ['#btnCloseComparison', '#btnRunComparison', '#btnStopComparison', '#btnComparisonNext']) {
          assert.equal(await page.locator(selector).evaluate((element) => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; }), true, `${viewport.name} ${lang} fixed ${selector} stays reachable`);
        }
        await page.screenshot({ path: path.join(comparisonVisualRoot, `${viewport.name}-${lang}-comparison-diff-scrolled.png`), fullPage: false });
        await page.locator('#btnCloseComparison').click();
        await page.locator('#btnCloseVersions').click();
        await page.waitForFunction(() => !window.FileNallyTest.getModel().versionBusy);
        const storagePath = `reports/${'very-long-folder-'.repeat(4)}/${'보관된-보고서-'.repeat(4)}.txt`;
        await mountCleanup(page, [cleanupFixture('saved-1', storagePath)]);
        await page.evaluate(() => {
          window.__mockPair.source.name = window.__mockPair.target.name = 'Same folder name';
          window.__setMockFile('source', '.filenally/index.json', { content: '<img src=x> unreadable index with a very-long-error-description-for-wrapping' });
        });
        await page.locator('#btnVersions').click();
        await page.waitForFunction(() => !document.querySelector('#btnVersionRefresh').disabled);
        assert.equal(await page.locator('[data-usage-side]').count(), 2);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${viewport.name} ${lang} storage has no document overflow`);
        assert.equal(await page.locator('#versionDialog').evaluate(el => el.scrollWidth <= el.clientWidth), true, `${viewport.name} ${lang} storage has no horizontal clipping`);
        await page.screenshot({ path: path.join(storageVisualRoot, `${viewport.name}-${lang}-usage.png`), fullPage: false });
        await page.locator('[data-cleanup-id="saved-1"]').check();
        await page.locator('#btnPrepareCleanup').click();
        await page.locator('#cleanupLastWarning').waitFor({ state: 'visible' });
        await page.locator('#cleanupLastAcknowledged').focus();
        assert.equal(await page.evaluate(() => document.activeElement.id), 'cleanupLastAcknowledged');
        for (const selector of ['#cleanupTitle', '#btnCancelCleanup', '#btnConfirmCleanup']) {
          assert.equal(await page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true, `${viewport.name} ${lang} ${selector} is visible`);
        }
        assert.equal(await page.locator('#cleanupDialog').evaluate(el => el.scrollWidth <= el.clientWidth), true, `${viewport.name} ${lang} cleanup has no horizontal clipping`);
        await page.screenshot({ path: path.join(storageVisualRoot, `${viewport.name}-${lang}-cleanup-last-warning.png`), fullPage: false });
        await page.locator('#btnCancelCleanup').click();
        await page.locator('#btnCloseVersions').click();
        await page.waitForFunction(() => !window.FileNallyTest.getModel().versionBusy);
        await mountCleanup(page, [cleanupFixture('saved-1', storagePath), cleanupFixture('saved-2', storagePath)],
          { schemaVersion: 2, cleanup: cleanupIntent({ remainingIds: ['saved-1', 'saved-2'] }) });
        await page.evaluate(filePath => window.__deleteMockEntry('target', `.filenally/versions/saved-1/${filePath}`), storagePath);
        await page.locator('#btnVersions').click();
        await page.locator('[data-recover-side="target"]').click();
        await page.waitForFunction(() => !document.querySelector('#btnConfirmCleanup').disabled);
        assert.equal(await page.locator('#cleanupLastWarning').isVisible(), false);
        await page.locator('#btnConfirmCleanup').focus();
        assert.equal(await page.evaluate(() => document.activeElement.id), 'btnConfirmCleanup');
        for (const selector of ['#cleanupTitle', '#btnCancelCleanup', '#btnConfirmCleanup']) {
          assert.equal(await page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true, `${viewport.name} ${lang} recovery ${selector} is visible`);
        }
        assert.equal(await page.locator('#cleanupDialog').evaluate(el => el.scrollWidth <= el.clientWidth), true, `${viewport.name} ${lang} recovery has no horizontal clipping`);
        await page.screenshot({ path: path.join(storageVisualRoot, `${viewport.name}-${lang}-recovery.png`), fullPage: false });
        await page.locator('#btnCancelCleanup').click();
        await page.locator('#btnCloseVersions').click();
        await page.waitForFunction(() => !window.FileNallyTest.getModel().versionBusy);
      }
      await context.close();
    }
  }

  await browser.close();
  await new Promise((resolve) => server.close(resolve));

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  const failed = results.filter((result) => result.status === 'FAIL');
  process.stdout.write(`${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
