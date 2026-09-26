// Keeps the IndexedDB copy of the project in step with the store while the user
// has turned persistence on (spec §5). Off by default: until it is turned on,
// nothing is written to the browser.

import {
  clearLocalData,
  deleteLocalProject,
  loadLocalProject,
  readPersistenceEnabled,
  saveLocalProject,
  writePersistenceEnabled,
} from '../../data/persistence';
import { persistenceCopy } from '../copy/data';
import { useAppStore } from './store';

let enabled = false;
let saving = false;
let dirty = false;
// Read through a function: `dirty` changes while a save is awaited.
const isDirty = () => dirty;

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function flush(): Promise<void> {
  if (saving) {
    dirty = true;
    return;
  }
  saving = true;
  const { setPersistence, setStatus } = useAppStore.getState();
  try {
    do {
      dirty = false;
      const project = useAppStore.getState().data.project;
      if (project && enabled) await saveLocalProject(project);
    } while (isDirty() && enabled);
    if (enabled) setPersistence('saved');
  } catch (e) {
    setPersistence('error');
    setStatus({ text: persistenceCopy.saveFailed(reason(e)), tone: 'error' });
  } finally {
    saving = false;
  }
}

useAppStore.subscribe((state, prev) => {
  if (enabled && state.data.project !== prev.data.project) {
    state.setPersistence('saving');
    void flush();
  }
});

export function persistenceEnabled(): boolean {
  return enabled;
}

export async function setPersistenceOn(on: boolean): Promise<void> {
  const { setPersistence, setStatus } = useAppStore.getState();
  if (on) {
    if (typeof indexedDB === 'undefined') {
      setStatus({ text: persistenceCopy.unavailable, tone: 'error' });
      return;
    }
    enabled = true;
    writePersistenceEnabled(true);
    setPersistence('saving');
    await flush();
    if (useAppStore.getState().data.persistence === 'saved') {
      setStatus({ text: persistenceCopy.turnedOn, tone: 'info' });
    }
  } else {
    enabled = false;
    writePersistenceEnabled(false);
    setPersistence('off');
    try {
      await deleteLocalProject();
      setStatus({ text: persistenceCopy.turnedOff, tone: 'info' });
    } catch (e) {
      setStatus({ text: persistenceCopy.clearFailed(reason(e)), tone: 'error' });
    }
  }
}

export async function clearAllLocalData(): Promise<void> {
  const { setPersistence, setStatus } = useAppStore.getState();
  enabled = false;
  setPersistence('off');
  try {
    await clearLocalData();
    setStatus({ text: persistenceCopy.cleared, tone: 'info' });
  } catch (e) {
    setStatus({ text: persistenceCopy.clearFailed(reason(e)), tone: 'error' });
  }
}

/** On start-up, reopens the stored project if persistence was left on. */
export async function restoreLocalProject(): Promise<void> {
  if (!readPersistenceEnabled()) return;
  enabled = true;
  const { setProject, setPersistence, setStatus } = useAppStore.getState();
  try {
    const project = await loadLocalProject();
    if (project) {
      setProject(project, { text: persistenceCopy.restored(project.meta.title), tone: 'info' });
    }
    setPersistence('saved');
  } catch (e) {
    setPersistence('error');
    setStatus({ text: persistenceCopy.restoreFailed(reason(e)), tone: 'error' });
  }
}
