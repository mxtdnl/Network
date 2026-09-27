// Respondent route: copy rules (spec §15.4) and saved progress.

import { describe, expect, it } from 'vitest';
import { respondCopy } from '../../src/respond/copy';
import {
  clearProgress,
  emptyProgress,
  loadProgress,
  progressKey,
  saveProgress,
} from '../../src/respond/progress';

/** Every string in the copy, calling functions with sample arguments. */
function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (typeof v === 'function') {
    const f = v as (...a: unknown[]) => unknown;
    return strings(f(...Array.from({ length: f.length }, (_, i) => (i === 0 ? 2 : 'Sample'))));
  }
  if (typeof v === 'object' && v !== null) return Object.values(v).flatMap(strings);
  return [];
}

describe('respondent copy', () => {
  const all = strings(respondCopy);

  it('never uses the word anonymous', () => {
    expect(all.length).toBeGreaterThan(60);
    expect(all.filter((s) => /anonym/i.test(s))).toStrictEqual([]);
  });

  it('says plainly that answers carry the respondent’s name and are not sent automatically', () => {
    expect(respondCopy.welcome.confidential).toMatch(/confidential/);
    expect(respondCopy.welcome.confidential).toMatch(/carry your name/);
    expect(respondCopy.welcome.how).toMatch(/Nothing is sent automatically/);
  });

  it('uses sentence case and no exclamation marks', () => {
    for (const s of all) {
      expect(s).not.toMatch(/!/);
      expect(s).not.toMatch(/\b[A-Z]{4,}\b/);
    }
  });
});

describe('saved progress', () => {
  it('saves, loads and clears answers keyed by survey, version and token', () => {
    const store = new Map<string, string>();
    const localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
    (globalThis as { window?: unknown }).window = { localStorage };
    const key = progressKey('S1', 2, 'tok');
    expect(key).toBe('graticule.respond.S1.2.tok');
    expect(loadProgress(key)).toBeNull();
    const p = { ...emptyProgress(), step: 'rate' as const, answers: { a: { '3': 4 } } };
    expect(saveProgress(key, p)).toBe(true);
    expect(loadProgress(key)).toStrictEqual(p);
    clearProgress(key);
    expect(loadProgress(key)).toBeNull();
    // Unavailable storage: nothing throws, nothing is saved.
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      },
    };
    expect(saveProgress(key, p)).toBe(false);
    expect(loadProgress(key)).toBeNull();
    expect(() => {
      clearProgress(key);
    }).not.toThrow();
    delete (globalThis as { window?: unknown }).window;
  });
});
