async function installMockFileSystem(page) {
  await page.addInitScript(() => {
    window.__testUnhandledErrors = [];
    window.addEventListener('error', (event) => {
      window.__testUnhandledErrors.push(event.error?.message || event.message || 'Unknown page error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      window.__testUnhandledErrors.push(event.reason?.message || String(event.reason || 'Unknown rejection'));
    });

    let clock = 1700000000000;

    class MockFileHandle {
      constructor(name, options = {}) {
        this.kind = 'file';
        this.name = name;
        this.content = String(options.content ?? '');
        this.lastModified = Number(options.lastModified ?? ++clock);
        this.failWrite = Boolean(options.failWrite);
        this.writeDelay = Number(options.writeDelay ?? 0);
      }

      async getFile() {
        return new File([this.content], this.name, { lastModified: this.lastModified });
      }

      async createWritable() {
        if (this.failWrite) throw new DOMException('Injected write failure', 'NotAllowedError');
        let nextContent = this.content;
        return {
          write: async (value) => {
            if (this.writeDelay) await new Promise((resolve) => setTimeout(resolve, this.writeDelay));
            if (value instanceof Blob) nextContent = await value.text();
            else if (typeof value === 'string') nextContent = value;
            else if (value && typeof value.data !== 'undefined') nextContent = String(value.data);
            else nextContent = String(value ?? '');
          },
          close: async () => {
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
        return this.permission;
      }

      async requestPermission() {
        if (this.permission === 'prompt') this.permission = 'granted';
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
      });
      let target;
      if (options.sameEntry) target = source;
      else if (options.targetInsideSource) {
        target = buildDirectory(options.targetName || 'target', options.target || {});
        source.entries.set(target.name, target);
      } else if (options.sourceInsideTarget) {
        target = buildDirectory(options.targetName || 'target', options.target || {}, {
          permission: options.targetPermission || 'granted',
        });
        target.entries.set(source.name, source);
      } else {
        target = buildDirectory(options.targetName || 'target', options.target || {}, {
          permission: options.targetPermission || 'granted',
        });
      }
      window.__mockPair = { source, target };
      window.__pickerQueue = [source, target];
      return { sourceName: source.name, targetName: target.name };
    };

    window.__snapshotMockPair = async () => ({
      source: await snapshot(window.__mockPair.source),
      target: await snapshot(window.__mockPair.target),
    });

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
