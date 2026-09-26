// Remembers whether the first-run notice (spec §10) has been acknowledged.
// This is a UI flag, not project data; it lives in localStorage so the notice
// is shown once per browser. Storage can be unavailable (private windows,
// blocked site data), in which case the notice is shown on every load.
// Phase 2's "clear all locally stored data" action must also remove this key.

export const NOTICE_SEEN_KEY = 'graticule.firstRunNoticeSeen';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readNoticeSeen(storage: KeyValueStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(NOTICE_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeNoticeSeen(storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(NOTICE_SEEN_KEY, 'true');
  } catch {
    // Not persisted; the notice will appear again on the next load.
  }
}
