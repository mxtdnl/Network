import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintCss, lintScript } from './tokenLint';

const root = join(import.meta.dirname, '..', '..');
const TOKENS = 'src/styles/tokens.css';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function sourceFiles(): string[] {
  return [...walk(join(root, 'src')), join(root, 'index.html')]
    .map((p) => relative(root, p).split('\\').join('/'))
    .filter((p) => /\.(css|ts|tsx|html)$/.test(p) && p !== TOKENS);
}

describe('design tokens are the only source of design values', () => {
  it('finds source files to check', () => {
    expect(sourceFiles().filter((p) => p.endsWith('.css')).length).toBeGreaterThan(0);
    expect(sourceFiles().filter((p) => p.endsWith('.tsx')).length).toBeGreaterThan(0);
  });

  it.each(sourceFiles())(
    '%s has no raw colour, type, spacing, radius or duration values',
    (file) => {
      const text = readFileSync(join(root, file), 'utf8');
      const findings = file.endsWith('.css') ? lintCss(text) : lintScript(text);
      expect(findings).toEqual([]);
    },
  );
});

describe('the token checker', () => {
  it.each([
    ['.a { color: #fff; }', 'hex colour'],
    ['.a { background: rgb(0 0 0 / 0.5); }', 'colour function'],
    ['.a { color: red; }', 'named colour'],
    ['.a { border: 1px solid var(--stone); }', 'raw length or duration'],
    ['.a { padding: 0.5rem; }', 'raw length or duration'],
    ['.a { width: 60ch; }', 'raw length or duration'],
    ['.a { transition: opacity 200ms ease; }', 'raw length or duration'],
    ['.a { font-size: large; }', 'font-size must use a token'],
    ['.a { font-weight: 700; }', 'font-weight must use a token'],
    ['.a { line-height: 1.5; }', 'line-height must use a token'],
    ['.a { border-radius: 50%; }', 'border-radius must use a token'],
    ['.a { box-shadow: 0 0 0 var(--s-1) var(--ink); }', 'box-shadow must be an elevation token'],
    ['.a { font-family: Arial, sans-serif; }', 'font-family must use a token'],
  ])('flags %s', (css, rule) => {
    expect(lintCss(css).map((f) => f.rule)).toContain(rule);
  });

  it.each([
    ['const c = "#1c2127";', 'hex colour'],
    ["ctx.fillStyle = 'rgba(0,0,0,1)';", 'colour function'],
    ["el.style.padding = '12px';", 'raw length or duration'],
    ["el.style.transition = 'all 0.3s';", 'raw length or duration'],
  ])('flags %s in scripts', (ts, rule) => {
    expect(lintScript(ts).map((f) => f.rule)).toContain(rule);
  });

  it('accepts token references, calc of tokens, keywords and layout proportions', () => {
    const css = `
      .a {
        color: var(--ink);
        background: transparent;
        padding: var(--s-2) 0;
        font-size: var(--t-0-size);
        font-weight: var(--weight-medium);
        border-radius: calc(var(--r-control) + var(--focus-offset));
        box-shadow: var(--e-1);
        transition: transform var(--m-fast) var(--ease-standard);
        width: min(var(--dialog-width), 100% - var(--s-6));
        grid-template-columns: var(--col-left) minmax(0, 1fr);
        min-height: 100vh;
      }
      @font-face { font-family: 'Fira Sans'; font-weight: 400; }
    `;
    expect(lintCss(css)).toEqual([]);
  });

  it('ignores comments', () => {
    expect(lintCss('/* 48px, #fff */ .a { color: var(--ink); }')).toEqual([]);
    expect(lintScript('// 250ms at most\nconst a = 1;')).toEqual([]);
  });
});

describe('tokens.css matches docs/design-system.md', () => {
  const doc = readFileSync(join(root, 'docs/design-system.md'), 'utf8');
  const css = readFileSync(join(root, TOKENS), 'utf8');
  const rootBlock = /^:root\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '';
  const tokens = new Map(
    [...rootBlock.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1] ?? '',
      (m[2] ?? '').trim(),
    ]),
  );
  const tokenValue = (name: string) => tokens.get(name)?.toLowerCase();
  const px = (s: string) => s.replace(/\s+/g, '').toLowerCase();

  // Colours: rows such as "| `ink` | `#1C2127` |" and "| 1 | `cat-1` teal | `#44AA99` |".
  const colours = [...doc.matchAll(/`([a-z][\w-]*)`[^|\n]*\|\s*`(#[0-9A-Fa-f]{6})`/g)].map(
    (m) => [m[1] ?? '', (m[2] ?? '').toLowerCase()] as const,
  );

  it('parses every colour table', () => {
    expect(colours.length).toBe(6 + 9 + 7);
  });

  it.each(colours)('--%s is %s', (name, hex) => {
    expect(tokenValue(name)).toBe(hex);
  });

  const scale = [...doc.matchAll(/^\| `(t-{1,2}\d)` \| [\d.]+ \| (\d+ px) \| (\d+ px) \|/gm)];
  it('parses the type scale', () => {
    expect(scale.length).toBe(8);
  });
  it.each(scale.map((m) => [m[1] ?? '', m[2] ?? '', m[3] ?? '']))(
    '%s is %s on %s',
    (step, size, line) => {
      expect(tokenValue(`${step}-size`)).toBe(px(size));
      expect(tokenValue(`${step}-line`)).toBe(px(line));
    },
  );

  const simple = [...doc.matchAll(/^\| `((?:s|r|m)-[\w-]+)` \| (\d+ (?:px|ms)|0) /gm)].map(
    (m) => [m[1] ?? '', m[2] ?? ''] as const,
  );
  it('parses spacing, radius and motion', () => {
    expect(simple.length).toBe(8 + 5 + 6);
  });
  it.each(simple)('--%s is %s', (name, value) => {
    expect(tokenValue(name)).toBe(px(value));
  });

  it.each([
    ['e-1', '0 1px 2px rgb(28 33 39 / 0.12), 0 4px 12px rgb(28 33 39 / 0.10)'],
    ['e-2', '0 2px 4px rgb(28 33 39 / 0.12), 0 12px 32px rgb(28 33 39 / 0.16)'],
    ['scrim', 'rgb(28 33 39 / 0.32)'],
  ])('--%s matches the elevation table', (name, value) => {
    expect(doc).toContain(value);
    const norm = (s: string) => s.replace(/0\.(\d)0\b/g, '0.$1');
    expect(norm(tokenValue(name) ?? '')).toBe(norm(value));
  });

  it('sets every duration to 0 ms under prefers-reduced-motion', () => {
    const reduced =
      /prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const name of ['m-fast', 'm-base', 'm-panel', 'm-max-ui', 'm-layout']) {
      expect(reduced).toMatch(new RegExp(`--${name}:\\s*0ms`));
    }
  });
});
