(function () {
  'use strict';

  const DB_NAME = 'felisos-vdisk';
  const DB_VERSION = 2;
  const STORE_NAME = 'entries';
  const STATE_STORE_NAME = 'state';
  const ROOT = '/vdisk/local/usr/home';
  const USER_ROOT = `${ROOT}/`;
  const SEEDED_DIRECTORIES = [
    '/vdisk',
    '/vdisk/local',
    '/vdisk/local/usr',
    '/vdisk/local/usr/apps',
    '/vdisk/local/usr/home',
    '/vdisk/local/usr/home/desktop',
    '/vdisk/local/usr/home/downloads',
    '/vdisk/local/usr/home/readfiles',
    '/vdisk/local/usr/home/music',
    '/vdisk/local/usr/home/videos',
    '/vdisk/local/usr/home/documents'
  ];

  const SEEDED_FILES = [
    {
      path: '/vdisk/local/usr/home/documents/welcome.txt',
      content: 'Welcome to FelisOS!\n\nThis is your personal workspace on the virtual disk (/vdisk/local/usr/home).\nYou can create, edit, and organize files across Scribe, Kit.nCmd, and Storage @ Local.\n'
    },
    {
      path: '/vdisk/local/usr/home/documents/felis-notes.md',
      content: '# FelisOS System Notes\n\n- 8-directional window resizing\n- Snap to screen edges or corners\n- Terminal commands: pwd, cd, ls, cat, touch, mkdir, rm, echo, stat, tree, apps, launch\n- Built-in crash recovery and autosave\n'
    }
  ];

  function normalizePath(path) {
    const raw = String(path || '').trim();
    const aliased = raw === '/usr' ? '/vdisk/local/usr' : raw;
    const candidate = aliased === '/usr/home' || aliased === '/usr/home/' ? ROOT : aliased;
    const parts = String(candidate || '').split('/').filter(Boolean);
    const normalized = [];
    parts.forEach(part => {
      if (part === '.') return;
      if (part === '..') {
        normalized.pop();
      } else {
        normalized.push(part);
      }
    });
    return normalized.length ? `/${normalized.join('/')}` : '/';
  }

  function parentPath(path) {
    const normalized = normalizePath(path);
    const separator = normalized.lastIndexOf('/');
    return separator > 0 ? normalized.slice(0, separator) : '/';
  }

  function entryName(path) {
    return normalizePath(path).split('/').pop();
  }

  function isUserModifiable(path) {
    const normalized = normalizePath(path);
    return normalized === ROOT || normalized.startsWith(USER_ROOT);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'path' });
        }
        if (!database.objectStoreNames.contains(STATE_STORE_NAME)) {
          database.createObjectStore(STATE_STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function transaction(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const store = database.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
      const request = operation(store);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function stateTransaction(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const store = database.transaction(STATE_STORE_NAME, mode).objectStore(STATE_STORE_NAME);
      const request = operation(store);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  function notifyVfsChanged(...paths) {
    window.dispatchEvent(new CustomEvent('felisos:vfs-changed', {
      detail: { paths },
    }));
  }

  async function seed() {
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const store = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
      const queue = [...SEEDED_DIRECTORIES, ...SEEDED_FILES.map(fileDef => fileDef.path)];
      let remaining = queue.length;

      const finalize = () => {
        if (remaining <= 0) {
          resolve();
        }
      };

      if (remaining === 0) {
        resolve();
        return;
      }

      SEEDED_DIRECTORIES.forEach(path => {
        const request = store.get(path);
        request.onsuccess = () => {
          if (!request.result) {
            store.put({
              path,
              name: entryName(path) || 'vdisk',
              type: 'directory',
              parent: parentPath(path),
              userModifiable: isUserModifiable(path),
              createdAt: Date.now(),
              updatedAt: Date.now()
            });
          }
          remaining -= 1;
          finalize();
        };
        request.onerror = () => reject(request.error);
      });

      SEEDED_FILES.forEach(fileDef => {
        const request = store.get(fileDef.path);
        request.onsuccess = () => {
          if (!request.result) {
            store.put({
              path: fileDef.path,
              name: entryName(fileDef.path),
              type: 'file',
              parent: parentPath(fileDef.path),
              content: fileDef.content,
              userModifiable: true,
              createdAt: Date.now(),
              updatedAt: Date.now()
            });
          }
          remaining -= 1;
          finalize();
        };
        request.onerror = () => reject(request.error);
      });

      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  }

  async function ensureSeeded() {
    try {
      const database = await openDatabase();
      await new Promise((resolve, reject) => {
        const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(ROOT);
        request.onsuccess = () => {
          if (request.result) {
            resolve();
            return;
          }
          seed().then(resolve).catch(reject);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (_) {
      await seed();
    }
  }

  async function stat(path) {
    await ensureSeeded();
    return transaction('readonly', store => store.get(normalizePath(path)));
  }

  async function exists(path) {
    try {
      const result = await stat(path);
      return Boolean(result);
    } catch (_) {
      return false;
    }
  }

  async function list(path) {
    const normalized = normalizePath(path);
    const entries = await transaction('readonly', store => store.getAll());
    return entries
      .filter(entry => entry.parent === normalized)
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }

  async function listFiles(path = ROOT) {
    const normalized = normalizePath(path || ROOT);
    const entries = await transaction('readonly', store => store.getAll());
    return entries
      .filter(entry => {
        if (entry.type !== 'file') return false;
        if (!entry.path) return false;
        return entry.path === normalized || entry.path.startsWith(`${normalized}/`);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function createDirectory(path) {
    const normalized = normalizePath(path);
    if (!isUserModifiable(normalized) || normalized === ROOT) {
      throw new Error('Directories may only be created inside the user home VDisk.');
    }
    if (await stat(normalized)) throw new Error('A directory with that name already exists.');
    const parent = await stat(parentPath(normalized));
    if (!parent || parent.type !== 'directory') {
      throw new Error('The parent directory does not exist.');
    }
    const result = await transaction('readwrite', store => store.put({
      path: normalized,
      name: entryName(normalized),
      type: 'directory',
      parent: parentPath(normalized),
      userModifiable: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }));
    notifyVfsChanged(normalized);
    return result;
  }

  async function writeFile(path, content, overwrite = false) {
    const normalized = normalizePath(path);
    if (!isUserModifiable(normalized) || normalized === ROOT) {
      throw new Error('Files may only be created inside the user home VDisk.');
    }
    const existing = await stat(normalized);
    if (existing) {
      if (overwrite) {
        return updateFile(normalized, content);
      }
      throw new Error('An entry with that name already exists.');
    }
    const parent = await stat(parentPath(normalized));
    if (!parent || parent.type !== 'directory') throw new Error('The parent directory does not exist.');
    const result = await transaction('readwrite', store => store.put({
      path: normalized,
      name: entryName(normalized),
      type: 'file',
      parent: parentPath(normalized),
      content: String(content ?? ''),
      userModifiable: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }));
    notifyVfsChanged(normalized);
    return result;
  }

  async function readFile(path) {
    const file = await stat(path);
    if (!file || file.type !== 'file') throw new Error('The requested VFS entry is not a file.');
    return file.content;
  }

  async function updateFile(path, content) {
    const normalized = normalizePath(path);
    const file = await stat(normalized);
    if (!file || file.type !== 'file' || !isUserModifiable(normalized)) {
      throw new Error('Only user files can be updated.');
    }
    const result = await transaction('readwrite', store => store.put({
      ...file,
      content: String(content ?? ''),
      updatedAt: Date.now()
    }));
    notifyVfsChanged(normalized);
    return result;
  }

  async function rename(path, name) {
    const source = await stat(path);
    const nextName = String(name || '').trim();
    if (!source || source.path === ROOT || !isUserModifiable(path) || !nextName || /[\\/]/.test(nextName)) {
      throw new Error('Only user entries can be renamed.');
    }
    const nextPath = `${source.parent}/${nextName}`;
    if (await stat(nextPath)) throw new Error('An entry with that name already exists.');
    const result = await transaction('readwrite', store => {
      store.delete(source.path);
      return store.put({
        ...source,
        path: nextPath,
        name: nextName,
        updatedAt: Date.now()
      });
    });
    notifyVfsChanged(source.path, nextPath);
    return result;
  }

  async function remove(path) {
    const source = await stat(path);
    if (!source || !isUserModifiable(path) || source.path === ROOT) {
      throw new Error('Only user entries can be deleted.');
    }
    const children = await list(path);
    if (children.length) throw new Error('Only empty folders can be deleted.');
    const result = await transaction('readwrite', store => store.delete(source.path));
    notifyVfsChanged(source.path);
    return result;
  }

  async function readState(key, fallback) {
    const record = await stateTransaction('readonly', store => store.get(String(key)));
    return record ? record.value : fallback;
  }

  async function writeState(key, value) {
    if (!key) throw new Error('State keys must be non-empty.');
    return stateTransaction('readwrite', store => store.put({ key: String(key), value }));
  }

  window.FelisOSVFS = Object.freeze({
    ROOT,
    init: seed,
    list,
    listFiles,
    stat,
    exists,
    createDirectory,
    writeFile,
    readFile,
    updateFile,
    readState,
    writeState,
    rename,
    remove,
    normalizePath
  });
}());
