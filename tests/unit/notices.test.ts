import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain JavaScript build script with no type declarations.
import { buildNotices, NOTICES_PATH } from '../../scripts/third-party-notices.mjs';

// The built site must carry the notices its dependencies' licences require
// (public/THIRD-PARTY-NOTICES.txt). This fails when a dependency changes and
// the file was not regenerated with `npm run notices`.

describe('third-party notices', () => {
  it('are up to date with the installed production dependencies', () => {
    const committed = readFileSync(NOTICES_PATH as string, 'utf8');
    expect(committed).toBe((buildNotices as () => string)());
  });

  it('cover the fonts and every shipped library, with licence text', () => {
    const text = readFileSync(NOTICES_PATH as string, 'utf8');
    for (const name of [
      'Fira Sans',
      'react ',
      'graphology ',
      'd3-force ',
      'papaparse ',
      'xlsx ',
      'pdf-lib ',
    ])
      expect(text).toContain(name);
    expect(text).toContain('SIL OPEN FONT LICENSE');
    expect(text).toContain('Apache License');
    expect(text).not.toContain('@types/');
  });
});
