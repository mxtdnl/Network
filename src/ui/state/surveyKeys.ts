// Unlocked survey keys, held in this page's memory only (spec §15.5): never in
// the store, the project file or browser storage, and gone on reload.

import { useSyncExternalStore } from 'react';

const keys = new Map<string, CryptoKey>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}

export function setUnlockedKey(surveyId: string, key: CryptoKey): void {
  keys.set(surveyId, key);
  emit();
}

export function lockKey(surveyId: string): void {
  if (keys.delete(surveyId)) emit();
}

export function unlockedKey(surveyId: string): CryptoKey | null {
  return keys.get(surveyId) ?? null;
}

export function useUnlockedKey(surveyId: string): CryptoKey | null {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return keys.get(surveyId) ?? null;
}
