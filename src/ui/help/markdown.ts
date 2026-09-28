// A small Markdown reader for the in-app help, which shows the documentation in
// docs/ as written (bundled as text), so the help and the documents cannot
// drift apart. It covers what those documents use: headings, paragraphs, flat
// lists, tables, fenced code, block quotes and images on their own line, with
// inline code, bold, italic and links. It builds a tree of plain objects; the
// view renders them as React elements, so no HTML is ever injected.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] };

export type Block =
  | { kind: 'heading'; level: number; id: string; text: string; children: Inline[] }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'image'; src: string; alt: string };

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
export function slug(text: string): string {
  return plain(parseInline(text))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** The text of inline nodes, markup removed. */
export function plain(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => (n.kind === 'text' || n.kind === 'code' ? n.text : plain(n.children)))
    .join('');
}

const INLINE =
  /`([^`]+)`|\*\*(.+?)\*\*|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|\[([^\]]+)\]\(([^)\s]+)\)/;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let rest = source;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push({ kind: 'text', text: rest });
      break;
    }
    if (m.index > 0) out.push({ kind: 'text', text: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'code', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'strong', children: parseInline(m[2]) });
    else if (m[3] !== undefined) out.push({ kind: 'em', children: parseInline(m[3]) });
    else out.push({ kind: 'link', href: m[5] ?? '', children: parseInline(m[4] ?? '') });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    // A pipe inside inline code (`a | b`) is written \| in the documents.
    .split(/(?<!\\)\|/)
    .map((c) => parseInline(c.trim().replace(/\\\|/g, '|')));

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const ids = new Map<string, number>();
  let i = 0;

  const isBlockStart = (line: string) =>
    /^(#{1,6} |```|>|\|)/.test(line) || LIST_ITEM.test(line) || IMAGE.test(line.trim());

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }
    const heading = /^(#{1,6}) (.+)$/.exec(line);
    if (heading) {
      const text = (heading[2] ?? '').trim();
      const base = slug(text);
      const seen = ids.get(base) ?? 0;
      ids.set(base, seen + 1);
      blocks.push({
        kind: 'heading',
        level: heading[1]?.length ?? 1,
        id: seen === 0 ? base : `${base}-${String(seen)}`,
        text: plain(parseInline(text)),
        children: parseInline(text),
      });
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) body.push(lines[i++] ?? '');
      i++;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>'))
        body.push((lines[i++] ?? '').replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', blocks: parseMarkdown(body.join('\n')) });
      continue;
    }
    if (line.startsWith('|') && /^\|?\s*:?-+/.test(lines[i + 1] ?? '')) {
      const header = cells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').startsWith('|'))
        rows.push(cells(lines[i++] ?? ''));
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const image = IMAGE.exec(line.trim());
    if (image) {
      blocks.push({ kind: 'image', alt: image[1] ?? '', src: image[2] ?? '' });
      i++;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2] ?? '');
      const start = ordered ? Number.parseInt(item[2] ?? '1', 10) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? '';
        const m = LIST_ITEM.exec(l);
        if (m && /\d/.test(m[2] ?? '') === ordered) {
          items.push(m[3] ?? '');
          i++;
        } else if (l.trim() !== '' && /^\s+/.test(l) && items.length > 0) {
          // A continuation line of the item above.
          items[items.length - 1] = `${items[items.length - 1] ?? ''} ${l.trim()}`;
          i++;
        } else break;
      }
      blocks.push({ kind: 'list', ordered, start, items: items.map(parseInline) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !isBlockStart(lines[i] ?? ''))
      para.push((lines[i++] ?? '').trim());
    if (para.length === 0) para.push((lines[i++] ?? '').trim());
    blocks.push({ kind: 'paragraph', children: parseInline(para.join(' ')) });
  }
  return blocks;
}
