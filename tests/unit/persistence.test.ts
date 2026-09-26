import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createProject } from '../../src/data/defaults';
import {
  clearLocalData,
  DB_NAME,
  loadLocalProject,
  PERSISTENCE_KEY,
  readPersistenceEnabled,
  saveLocalProject,
  writePersistenceEnabled,
} from '../../src/data/persistence';
import { NOTICE_SEEN_KEY } from '../../src/ui/state/noticeStorage';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    map,
  };
}

const project = () => {
  const p = createProject('Stored', '2026-09-26T00:00:00.000Z');
  p.members = [
    { id: 'A', display_name: 'A', attributes: {} },
    { id: 'B', display_name: 'B', attributes: {} },
  ];
  p.ties = [
    { rater_id: 'A', ratee_id: 'B', variable: 'valence', value: 0, wave: 1 },
    { rater_id: 'B', ratee_id: 'A', variable: 'valence', value: null, wave: 1 },
  ];
  return p;
};

describe('local persistence', () => {
  it('is off by default', () => {
    expect(readPersistenceEnabled(memoryStorage())).toBe(false);
    expect(readPersistenceEnabled(null)).toBe(false);
  });

  it('remembers when it is turned on and off', () => {
    const storage = memoryStorage();
    writePersistenceEnabled(true, storage);
    expect(readPersistenceEnabled(storage)).toBe(true);
    writePersistenceEnabled(false, storage);
    expect(readPersistenceEnabled(storage)).toBe(false);
    expect(storage.map.size).toBe(0);
  });

  it('creates no database until something is saved', async () => {
    const factory = new IDBFactory();
    expect(await factory.databases()).toEqual([]);
  });

  it('saves and reloads a project without loss, keeping null and 0 apart', async () => {
    const factory = new IDBFactory();
    expect(await loadLocalProject(factory)).toBeNull();
    const p = project();
    await saveLocalProject(p, factory);
    expect(await loadLocalProject(factory)).toStrictEqual(p);
    const updated = { ...p, meta: { ...p.meta, title: 'Renamed' } };
    await saveLocalProject(updated, factory);
    expect((await loadLocalProject(factory))?.meta.title).toBe('Renamed');
  });

  it('clears the stored project and every Graticule key, and nothing else', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    await saveLocalProject(project(), factory);
    writePersistenceEnabled(true, storage);
    storage.setItem(NOTICE_SEEN_KEY, 'true');
    storage.setItem('another-app', 'keep');

    await clearLocalData(factory, storage);

    expect((await factory.databases()).map((d) => d.name)).not.toContain(DB_NAME);
    expect(await loadLocalProject(factory)).toBeNull();
    expect(storage.getItem(PERSISTENCE_KEY)).toBeNull();
    expect(storage.getItem(NOTICE_SEEN_KEY)).toBeNull();
    expect(storage.getItem('another-app')).toBe('keep');
  });
});
