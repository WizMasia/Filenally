// Investigation for #18. Uses synthetic files and real native browser handles.
// Per-file failures are observations, not expected passing assertions.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

async function main() {
  const output = path.resolve('artifacts/issue-18');
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'fn-'));
  let server, browser, aliasDrive;
  try {
    const suffix = '%EC% (7).png';
    const prefix = '_D__' + '%EA%B0%80'.repeat(21);
    const encoded = prefix + 'x'.repeat(210 - prefix.length - suffix.length) + suffix;
    const validEncoded = prefix + 'x'.repeat(210 - prefix.length - 4) + '.png';
    const parents = ['a'.repeat(16), 'b'.repeat(16), 'c'.repeat(17)];
    const cases = [
      { id: 'short-ascii', parts: ['plain.png'] },
      { id: 'short-malformed', parts: ['name%EC% (7).png'] },
      { id: 'encoded-name-short-parent', parts: [encoded] },
      { id: 'relative-262-malformed', parts: [...parents, encoded] },
      { id: 'relative-262-valid-encoded', parts: [...parents, validEncoded] },
      { id: 'relative-262-ascii', parts: [...parents, 'x'.repeat(206) + '.png'] },
    ];
    for (const item of cases) {
      item.relativePath = item.parts.join('/');
      const absolute = path.join(root, ...item.parts);
      item.relativeLength = item.relativePath.length;
      item.absoluteLength = absolute.length;
      try {
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, 'fixture-content');
        item.nativeReadable = (await fs.readFile(absolute, 'utf8')) === 'fixture-content';
      } catch (error) { item.setupError = { code: error.code, message: error.message }; }
      delete item.parts;
    }
    server = http.createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><body style="height:100vh">Native file handle probe</body>');
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => {
      document.addEventListener('dragover', event => event.preventDefault());
      document.addEventListener('drop', event => {
        event.preventDefault();
        // Call while the real drop event still owns access to DataTransfer.
        window.probe = Promise.all(Array.from(event.dataTransfer.items, item => item.getAsFileSystemHandle())).then(async handles => {
          const files = [], enumerationErrors = [];
          async function scan(directory, current = '') {
            try {
              for await (const entry of directory.values()) {
                const relativePath = current ? `${current}/${entry.name}` : entry.name;
                if (entry.kind === 'directory') await scan(entry, relativePath);
                else {
                  let operation = 'getFile';
                  try {
                    const file = await entry.getFile();
                    operation = 'text';
                    const text = await file.text();
                    files.push({ path: relativePath, status: 'readable', contentMatches: text === 'fixture-content' });
                  } catch (error) { files.push({ path: relativePath, status: 'failed', operation, name: error.name, message: error.message }); }
                }
              }
            } catch (error) { enumerationErrors.push({ path: current, name: error.name, message: error.message }); }
          }
          for (const handle of handles) {
            if (!handle || handle.kind !== 'directory') throw new Error('Drop did not provide a native directory handle');
            await scan(handle);
          }
          if (!handles.length) throw new Error('No native handles received');
          return { files, enumerationErrors };
        });
      });
    });
    const cdp = await page.context().newCDPSession(page);
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', { type, x: 100, y: 100, data: { items: [], files: [root], dragOperationsMask: 1 } });
    }
    await page.waitForFunction(() => window.probe !== undefined, null, { timeout: 15000 });
    const observed = await page.evaluate(() => window.probe);
    let aliasProbe = null;
    if (process.platform === 'win32') {
      // Only this disposable runner is affected; never replace an occupied drive.
      for (const letter of ['Z', 'Y', 'X', 'W', 'V']) {
        const drive = `${letter}:`;
        try { await fs.stat(`${drive}\\`); continue; }
        catch (error) { if (error.code !== 'ENOENT') continue; }
        try {
          execFileSync('subst.exe', [drive, path.join(root, ...parents)]);
          aliasDrive = drive;
          break;
        } catch { /* Try another free drive without replacing mappings. */ }
      }
      if (aliasDrive) {
        await page.evaluate(() => { delete window.probe; });
        for (const type of ['dragEnter', 'dragOver', 'drop']) {
          await cdp.send('Input.dispatchDragEvent', { type, x: 100, y: 100, data: { items: [], files: [`${aliasDrive}\\`], dragOperationsMask: 1 } });
        }
        await page.waitForFunction(() => window.probe !== undefined, null, { timeout: 15000 });
        aliasProbe = { method: 'subst to deep parent', aliasLeafPathLength: 3 + encoded.length, result: await page.evaluate(() => window.probe) };
      } else aliasProbe = { error: 'No available drive alias' };
    }
    const report = {
      platform: process.platform, osRelease: os.release(), chrome: await browser.version(),
      storage: 'native temporary directory, not OPFS', longPathsEnabled: process.env.PROBE_LONG_PATHS_ENABLED ?? null,
      cases: cases.map(item => ({ ...item, browser: observed.files.find(file => file.path === item.relativePath) || { status: 'not-enumerated' } })),
      enumerationErrors: observed.enumerationErrors, aliasProbe,
    };
    await fs.writeFile(path.join(output, `native-${process.platform}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (report.cases[0].browser.status !== 'readable' || !report.cases[0].browser.contentMatches) {
      throw new Error('Short ASCII control failed; probe setup is not validated');
    }
  } finally {
    if (browser) await browser.close();
    if (aliasDrive) execFileSync('subst.exe', [aliasDrive, '/D']);
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
