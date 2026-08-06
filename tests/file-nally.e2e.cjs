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

async function main() {
  const { server, url, devUrl } = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const tests = [];
  const add = (name, run) => {
    if (!NAME_FILTER || NAME_FILTER.test(name)) tests.push({ name, run });
  };

  add('development sources load with external CSS and JavaScript', async ({ page, devUrl }) => {
    await page.goto(devUrl);
    await page.waitForFunction(() => Boolean(window.FileNallyTest));
    const result = await page.evaluate(() => ({
      version: document.querySelector('.version')?.textContent,
      background: getComputedStyle(document.body).backgroundColor,
      errors: window.__testUnhandledErrors || [],
    }));
    assert.equal(result.version, 'Beta v0.10.0');
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

    const filter = page.getByLabel('변경된 파일만 보기', { exact: true });
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
    assert.equal(await page.getByLabel('변경된 파일만 보기', { exact: true }).isChecked(), true);
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

  add('language changes keep selected folder names visible', async ({ page }) => {
    await mountPair(page, { sourceName: 'my-source', targetName: 'my-target', source: {}, target: {} });
    await page.locator('#btnLangEn').click();
    assert.equal(await page.locator('#pathSrc').innerText(), 'my-source');
    assert.equal(await page.locator('#pathTgt').innerText(), 'my-target');
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

  add('rename detection converts deleted and added file with matching size to rename action', async ({ page }) => {
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
      await compare(page);
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'visual', `${viewport.name}-planned.png`), fullPage: true });
      await page.getByLabel('변경된 파일만 보기', { exact: true }).check();
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'visual', `${viewport.name}-changed-only.png`), fullPage: true });
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
