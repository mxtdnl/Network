import { describe, expect, it } from 'vitest';
import { NOTICE_SEEN_KEY, readNoticeSeen, writeNoticeSeen } from '../../src/ui/state/noticeStorage';
import { initialUiState } from '../../src/ui/state/store';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('first-run notice flag', () => {
  it('is unseen on first run and seen after it is written', () => {
    const storage = memoryStorage();
    expect(readNoticeSeen(storage)).toBe(false);
    writeNoticeSeen(storage);
    expect(storage.getItem(NOTICE_SEEN_KEY)).toBe('true');
    expect(readNoticeSeen(storage)).toBe(true);
  });

  it('treats unavailable storage as unseen, so the notice is shown', () => {
    expect(readNoticeSeen(null)).toBe(false);
    expect(readNoticeSeen(throwing)).toBe(false);
    expect(() => {
      writeNoticeSeen(throwing);
    }).not.toThrow();
  });

  it('opens the notice only when it has not been seen', () => {
    expect(initialUiState(false).noticeOpen).toBe(true);
    expect(initialUiState(true).noticeOpen).toBe(false);
  });
});
