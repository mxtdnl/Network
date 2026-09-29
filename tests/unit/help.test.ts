import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseInline,
  parseMarkdown,
  slug,
  type Block,
  type Inline,
} from '../../src/ui/help/markdown';

// The in-app help reads docs/ as written (src/ui/views/HelpDialog.tsx). These
// tests check the Markdown reader, and that every link between the help
// documents and every screenshot the user guide shows resolves in the app.

const root = join(import.meta.dirname, '..', '..');
const DOCS = {
  'user-guide.md': readFileSync(join(root, 'docs/user-guide.md'), 'utf8'),
  'method-notes.md': readFileSync(join(root, 'docs/method-notes.md'), 'utf8'),
  'respondent-help.md': readFileSync(join(root, 'docs/respondent-help.md'), 'utf8'),
};

function links(nodes: readonly Inline[]): string[] {
  return nodes.flatMap((n) =>
    n.kind === 'link' ? [n.href, ...links(n.children)] : 'children' in n ? links(n.children) : [],
  );
}

function blockLinks(blocks: readonly Block[]): string[] {
  return blocks.flatMap((b) => {
    switch (b.kind) {
      case 'heading':
      case 'paragraph':
        return links(b.children);
      case 'list':
        return b.items.flatMap(links);
      case 'table':
        return [...b.header.flatMap(links), ...b.rows.flat().flatMap(links)];
      case 'quote':
        return blockLinks(b.blocks);
      default:
        return [];
    }
  });
}

const ids = (blocks: readonly Block[]) =>
  new Set(blocks.flatMap((b) => (b.kind === 'heading' ? [b.id] : [])));

describe('Markdown reader', () => {
  it('reads headings, lists, tables, code, quotes and images', () => {
    const blocks = parseMarkdown(
      [
        '# Title',
        '',
        'A paragraph with `code`, **bold**, *italic* and a [link](other.md#part)',
        'continued on a second line.',
        '',
        '- one',
        '  continued',
        '- two',
        '',
        '3. three',
        '4. four',
        '',
        '| A | B |',
        '|---|---|',
        '| `a \\| b` | 2 |',
        '',
        '```',
        'npm ci',
        '```',
        '',
        '> **Warning.** Quoted.',
        '',
        '![A screenshot](user-guide/map.png)',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'table',
      'code',
      'quote',
      'image',
    ]);
    const para = blocks[1];
    expect(para?.kind === 'paragraph' && para.children.map((c) => c.kind)).toEqual([
      'text',
      'code',
      'text',
      'strong',
      'text',
      'em',
      'text',
      'link',
      'text',
    ]);
    const list = blocks[2];
    expect(list?.kind === 'list' && list.items.length).toBe(2);
    const ordered = blocks[3];
    expect(ordered?.kind === 'list' && ordered.ordered && ordered.start).toBe(3);
    const table = blocks[4];
    expect(table?.kind === 'table' && table.rows[0]?.[0]).toEqual([
      { kind: 'code', text: 'a | b' },
    ]);
  });

  it('makes GitHub-style anchors, numbering repeated headings', () => {
    expect(slug('1.1 Not rated is not zero')).toBe('11-not-rated-is-not-zero');
    expect(slug('Formal–informal comparison')).toBe('formalinformal-comparison');
    expect(slug('Communities (Louvain) and modularity')).toBe('communities-louvain-and-modularity');
    const blocks = parseMarkdown('## Caveats\n\n## Caveats');
    expect([...ids(blocks)]).toEqual(['caveats', 'caveats-1']);
  });

  it('leaves formulas with asterisks-free notation and underscores alone', () => {
    expect(parseInline('C_ij = Σ_l ω_l r_l')).toEqual([
      { kind: 'text', text: 'C_ij = Σ_l ω_l r_l' },
    ]);
  });
});

describe('help documents', () => {
  const parsed = Object.fromEntries(
    Object.entries(DOCS).map(([name, text]) => [name, parseMarkdown(text)]),
  ) as Record<keyof typeof DOCS, Block[]>;

  it('each opens with a title', () => {
    for (const blocks of Object.values(parsed)) {
      const first = blocks[0];
      expect(first?.kind === 'heading' && first.level).toBe(1);
    }
  });

  it('link to each other, and every link between them reaches a heading', () => {
    const targets = new Set<string>();
    for (const [name, blocks] of Object.entries(parsed)) {
      for (const href of blockLinks(blocks)) {
        if (/^https?:/.test(href)) continue;
        const [path = '', anchor] = href.split('#');
        const file = path === '' ? name : path.replace(/^(\.\.?\/)*(docs\/)?/, '');
        if (!(file in parsed)) continue; // a repository file, shown as text in the app
        targets.add(file);
        if (anchor)
          expect(ids(parsed[file as keyof typeof DOCS]), `${name}: ${href}`).toContain(anchor);
      }
    }
    expect(targets).toContain('method-notes.md');
    expect(targets).toContain('user-guide.md');
  });

  it('shows only screenshots that exist', () => {
    const images = parsed['user-guide.md'].flatMap((b) => (b.kind === 'image' ? [b] : []));
    expect(images.length).toBeGreaterThan(10);
    for (const image of images) {
      expect(image.src, image.src).toMatch(/^user-guide\/[\w-]+\.(png|jpg)$/);
      expect(existsSync(join(root, 'docs', image.src)), image.src).toBe(true);
      expect(image.alt.length, image.src).toBeGreaterThan(10);
    }
  });
});
