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

async function downloadText(download) {
  const filePath = await download.path();
  return fs.readFile(filePath, 'utf8');
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
    assert.equal(result.version, 'Beta v0.13.0');
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

  add('reserved exclusions remain inside the normalized 100-entry cap', async ({ page }) => {
    const excludes = await page.evaluate(() => window.FileNallyTest.StateStore.sanitize({
      schemaVersion: 2,
      config: { excludeDirs: Array.from({ length: 100 }, (_, index) => `custom-${index}`) },
    }).config.excludeDirs);
    assert.equal(excludes.length, 100);
    assert.equal(excludes.includes('.trash'), true);
    assert.equal(excludes.includes('.filenally'), true);
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
        content: JSON.stringify({ schemaVersion: 1, versions: Array(100000).fill(record) }),
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

  add('destination write failure retains the indexed version and log reference', async ({ page }) => {
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
    const index = JSON.parse(snapshot.target['.filenally']['index.json'].content);
    assert.equal(snapshot.target['report.txt'].content, 'old');
    assert.equal(snapshot.target['.filenally'].versions[index.versions[0].id]['report.txt'].content, 'old');
    const run = await page.evaluate(async () => {
      const id = JSON.parse(localStorage.getItem('smart_sync_state')).globalHistory[0].logId;
      return window.FileNallyTest.RunLogStore.get(id);
    });
    assert.equal(run.entries[0].status, 'failed');
    assert.equal(run.entries[0].versionId, index.versions[0].id);
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
