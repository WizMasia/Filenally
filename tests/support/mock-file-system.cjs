async function installMockFileSystem(page) {
  await page.addInitScript(() => {
    window.__testUnhandledErrors = [];
    window.__permissionCalls = [];
    window.addEventListener('error', (event) => {
      window.__testUnhandledErrors.push(event.error?.message || event.message || 'Unknown page error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      window.__testUnhandledErrors.push(event.reason?.message || String(event.reason || 'Unknown rejection'));
    });

    let clock = 1700000000000;
    window.__mockFailure = null;
    window.__setMockFailure = (rule) => { window.__mockFailure = { ...rule, seen: 0 }; };
    const shouldFail = (operation, name) => {
      const rule = window.__mockFailure;
      if (!rule || rule.operation !== operation || (rule.name && rule.name !== name)) return false;
      rule.seen += 1;
      return rule.seen === (rule.occurrence || 1);
    };

    class MockFileHandle {
      constructor(name, options = {}) {
        this.kind = 'file';
        this.name = name;
        this.content = Number.isInteger(options.contentSize) ? 'x'.repeat(options.contentSize) : String(options.content ?? '');
        this.contentAfterRead = options.contentAfterRead == null ? null : String(options.contentAfterRead);
        this.lastModified = Number(options.lastModified ?? ++clock);
        this.failWrite = Boolean(options.failWrite);
        this.readDelay = Number(options.readDelay ?? 0);
        this.writeDelay = Number(options.writeDelay ?? 0);
      }

      async getFile() {
        const file = new File([this.content], this.name, { lastModified: this.lastModified });
        if (this.contentAfterRead != null) {
          this.content = this.contentAfterRead;
          this.contentAfterRead = null;
          this.lastModified = ++clock;
        }
        if (this.readDelay) {
          const originalSlice = file.slice.bind(file);
          Object.defineProperty(file, 'slice', {
            value: (...args) => {
              const chunk = originalSlice(...args);
              const arrayBuffer = chunk.arrayBuffer.bind(chunk);
              Object.defineProperty(chunk, 'arrayBuffer', {
                value: async () => {
                  await new Promise((resolve) => setTimeout(resolve, this.readDelay));
                  return arrayBuffer();
                },
              });
              return chunk;
            },
          });
        }
        return file;
      }

      async createWritable() {
        if (this.failWrite) throw new DOMException('Injected write failure', 'NotAllowedError');
        let nextContent = this.content;
        return {
          write: async (value) => {
            if (shouldFail('write', this.name)) throw new DOMException('Injected write failure', 'NotAllowedError');
            if (this.writeDelay) await new Promise((resolve) => setTimeout(resolve, this.writeDelay));
            if (value instanceof Blob) nextContent = await value.text();
            else if (typeof value === 'string') nextContent = value;
            else if (value && typeof value.data !== 'undefined') nextContent = String(value.data);
            else nextContent = String(value ?? '');
          },
          close: async () => {
            if (shouldFail('close', this.name)) throw new DOMException('Injected close failure', 'NotAllowedError');
            this.content = nextContent;
            this.lastModified = ++clock;
          },
        };
      }

      async isSameEntry(other) {
        return this === other;
      }
    }

    class MockDirectoryHandle {
      constructor(name, options = {}) {
        this.kind = 'directory';
        this.name = name;
        this.entries = new Map();
        this.permission = options.permission || 'granted';
        this.requestPermissionResult = options.requestPermissionResult || 'granted';
        this.queryPermissionError = options.queryPermissionError || '';
        this.requestPermissionError = options.requestPermissionError || '';
      }

      async *values() {
        yield* this.entries.values();
      }

      async getDirectoryHandle(name, options = {}) {
        const current = this.entries.get(name);
        if (current?.kind === 'directory') return current;
        if (current || !options.create) throw new DOMException('Directory not found', 'NotFoundError');
        const directory = new MockDirectoryHandle(name, { permission: this.permission });
        this.entries.set(name, directory);
        return directory;
      }

      async getFileHandle(name, options = {}) {
        const current = this.entries.get(name);
        if (current?.kind === 'file') return current;
        if (current || !options.create) throw new DOMException('File not found', 'NotFoundError');
        const file = new MockFileHandle(name);
        this.entries.set(name, file);
        return file;
      }

      async removeEntry(name, options = {}) {
        const current = this.entries.get(name);
        if (!current) throw new DOMException('Entry not found', 'NotFoundError');
        if (current.kind === 'directory' && current.entries.size && !options.recursive) {
          throw new DOMException('Directory is not empty', 'InvalidModificationError');
        }
        this.entries.delete(name);
      }

      async isSameEntry(other) {
        return this === other;
      }

      async resolve(target) {
        if (target === this) return [];
        const visit = (directory, parts) => {
          for (const entry of directory.entries.values()) {
            const next = [...parts, entry.name];
            if (entry === target) return next;
            if (entry.kind === 'directory') {
              const found = visit(entry, next);
              if (found) return found;
            }
          }
          return null;
        };
        return visit(this, []);
      }

      async queryPermission() {
        window.__permissionCalls.push({ method: 'query', name: this.name });
        if (this.queryPermissionError) throw new DOMException(this.queryPermissionError, 'NotAllowedError');
        return this.permission;
      }

      async requestPermission() {
        window.__permissionCalls.push({ method: 'request', name: this.name });
        if (this.requestPermissionError) throw new DOMException(this.requestPermissionError, 'SecurityError');
        if (this.permission === 'prompt') this.permission = this.requestPermissionResult;
        return this.permission;
      }
    }

    function buildDirectory(name, spec = {}, options = {}) {
      const directory = new MockDirectoryHandle(name, options);
      for (const [entryName, value] of Object.entries(spec)) {
        if (value?.type === 'directory') {
          directory.entries.set(entryName, buildDirectory(entryName, value.entries || {}, options));
        } else {
          directory.entries.set(entryName, new MockFileHandle(entryName, value || {}));
        }
      }
      return directory;
    }

    function getDirectory(root, parts, create = false) {
      let current = root;
      for (const part of parts) {
        let next = current.entries.get(part);
        if (!next && create) {
          next = new MockDirectoryHandle(part);
          current.entries.set(part, next);
        }
        if (!next || next.kind !== 'directory') throw new Error(`Directory not found: ${parts.join('/')}`);
        current = next;
      }
      return current;
    }

    async function snapshot(directory) {
      const result = Object.create(null);
      for (const entry of directory.entries.values()) {
        if (entry.kind === 'directory') result[entry.name] = await snapshot(entry);
        else result[entry.name] = { content: entry.content, lastModified: entry.lastModified };
      }
      return result;
    }

    window.__configureMockPair = (options = {}) => {
      const source = buildDirectory(options.sourceName || 'source', options.source || {}, {
        permission: options.sourcePermission || 'granted',
        requestPermissionResult: options.sourceRequestPermissionResult || 'granted',
        queryPermissionError: options.sourceQueryPermissionError || '',
        requestPermissionError: options.sourceRequestPermissionError || '',
      });
      let target;
      if (options.sameEntry) target = source;
      else if (options.targetInsideSource) {
        target = buildDirectory(options.targetName || 'target', options.target || {});
        source.entries.set(target.name, target);
      } else if (options.sourceInsideTarget) {
        target = buildDirectory(options.targetName || 'target', options.target || {}, {
          permission: options.targetPermission || 'granted',
          requestPermissionResult: options.targetRequestPermissionResult || 'granted',
          queryPermissionError: options.targetQueryPermissionError || '',
          requestPermissionError: options.targetRequestPermissionError || '',
        });
        target.entries.set(source.name, source);
      } else {
        target = buildDirectory(options.targetName || 'target', options.target || {}, {
          permission: options.targetPermission || 'granted',
          requestPermissionResult: options.targetRequestPermissionResult || 'granted',
          queryPermissionError: options.targetQueryPermissionError || '',
          requestPermissionError: options.targetRequestPermissionError || '',
        });
      }
      window.__mockPair = { source, target };
      window.__pickerQueue = [source, target];
      return { sourceName: source.name, targetName: target.name };
    };

    window.__setMockPermission = (side, options = {}) => {
      const handle = window.__mockPair[side];
      if ('state' in options) handle.permission = options.state;
      if ('requestResult' in options) handle.requestPermissionResult = options.requestResult;
      if ('queryError' in options) handle.queryPermissionError = options.queryError;
      if ('requestError' in options) handle.requestPermissionError = options.requestError;
    };

    window.__getPermissionCalls = () => [...window.__permissionCalls];

    window.__snapshotMockPair = async () => ({
      source: await snapshot(window.__mockPair.source),
      target: await snapshot(window.__mockPair.target),
    });

    window.__getMockFile = (side, path) => {
      const parts = path.split('/');
      const name = parts.pop();
      const entry = getDirectory(window.__mockPair[side], parts).entries.get(name);
      if (!entry || entry.kind !== 'file') throw new Error(`File not found: ${path}`);
      return { content: entry.content, lastModified: entry.lastModified };
    };

    window.__deleteMockEntry = (side, path) => {
      const parts = path.split('/');
      const name = parts.pop();
      getDirectory(window.__mockPair[side], parts).entries.delete(name);
    };

    window.__setMockFile = (side, path, options) => {
      const parts = path.split('/');
      const name = parts.pop();
      getDirectory(window.__mockPair[side], parts, true).entries.set(name, new MockFileHandle(name, options));
    };

    window.showDirectoryPicker = async () => {
      const handle = window.__pickerQueue?.shift();
      if (!handle) throw new DOMException('Picker cancelled', 'AbortError');
      return handle;
    };
  });
}

async function configureMockPair(page, options) {
  return page.evaluate((value) => window.__configureMockPair(value), options);
}

async function snapshotMockPair(page) {
  return page.evaluate(() => window.__snapshotMockPair());
}

module.exports = {
  configureMockPair,
  installMockFileSystem,
  snapshotMockPair,
};
