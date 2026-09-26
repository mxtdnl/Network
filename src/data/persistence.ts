// Optional IndexedDB persistence (spec §5). Off by default: nothing is written
// to the browser until the user turns it on. Whether it is on is a UI flag in
// localStorage; the project itself goes to IndexedDB. `clearLocalData` removes
// both, and every other Graticule key in localStorage (CLAUDE.md D20).
// The project is stored as its .ona.json text and read back through the same
// parser and migrations as a file, so an older stored project is upgraded.

import { parseProject, serialiseProject } from './projectFile';
import type { Project } from './schema';

export const DB_NAME = 'graticule';
const DB_VERSION = 1;
const STORE = 'projects';
const CURRENT = 'current';
export const PERSISTENCE_KEY = 'graticule.persistence';
export const STORAGE_PREFIX = 'graticule.';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function defaultFactory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

export function readPersistenceEnabled(storage = defaultStorage()): boolean {
  try {
    return storage?.getItem(PERSISTENCE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function writePersistenceEnabled(on: boolean, storage = defaultStorage()): void {
  try {
    if (on) storage?.setItem(PERSISTENCE_KEY, 'on');
    else storage?.removeItem(PERSISTENCE_KEY);
  } catch {
    // Storage unavailable: persistence stays off after a reload.
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB request failed.'));
    };
  });
}

function open(factory: IDBFactory): Promise<IDBDatabase> {
  const req = factory.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    req.result.createObjectStore(STORE);
  };
  return request(req);
}

async function withStore<T>(
  factory: IDBFactory,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open(factory);
  try {
    const tx = db.transaction(STORE, mode);
    const result = await request(run(tx.objectStore(STORE)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('IndexedDB transaction failed.'));
      };
      tx.onabort = () => {
        reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
      };
    });
    return result;
  } finally {
    db.close();
  }
}

export class PersistenceUnavailableError extends Error {
  constructor() {
    super('This browser does not allow Graticule to store data (IndexedDB is unavailable).');
    this.name = 'PersistenceUnavailableError';
  }
}

export async function saveLocalProject(project: Project, factory = defaultFactory()) {
  if (!factory) throw new PersistenceUnavailableError();
  const text = serialiseProject(project);
  await withStore(factory, 'readwrite', (s) => s.put(text, CURRENT));
}

export async function loadLocalProject(factory = defaultFactory()): Promise<Project | null> {
  if (!factory) return null;
  const value = await withStore<unknown>(factory, 'readonly', (s) => s.get(CURRENT));
  return typeof value === 'string' ? parseProject(value) : null;
}

export class LocalDataBlockedError extends Error {
  constructor() {
    super(
      'Another Graticule tab is using the stored data. Close other Graticule tabs, then try again.',
    );
    this.name = 'LocalDataBlockedError';
  }
}

/** Deletes the stored project and every Graticule key in localStorage. */
export async function clearLocalData(
  factory = defaultFactory(),
  storage = defaultStorage(),
): Promise<void> {
  try {
    if (storage) {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing was stored there.
  }
  await deleteLocalProject(factory);
}

/** Deletes the stored project copy only. */
export async function deleteLocalProject(factory = defaultFactory()): Promise<void> {
  if (!factory) return;
  await new Promise<void>((resolve, reject) => {
    const req = factory.deleteDatabase(DB_NAME);
    req.onsuccess = () => {
      resolve();
    };
    req.onerror = () => {
      reject(req.error ?? new Error('Could not delete the local database.'));
    };
    req.onblocked = () => {
      reject(new LocalDataBlockedError());
    };
  });
}
