import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../components/Dialog';
import { Tabs } from '../components/Tabs';
import { helpCopy, type HelpDoc } from '../copy/help';
import { parseMarkdown, type Block, type Inline } from '../help/markdown';

// In-app help (Help menu): the user guide, the method notes, the help for
// respondents and the licence, read from the repository as written. Each document is bundled as text
// and loaded when first opened; the user guide's screenshots are bundled
// assets, so nothing is fetched from anywhere but this site (CSP, spec §10).

type MarkdownDoc = Exclude<HelpDoc, 'licence'>;

const SOURCES: Record<MarkdownDoc, () => Promise<{ default: string }>> = {
  guide: () => import('../../../docs/user-guide.md?raw'),
  method: () => import('../../../docs/method-notes.md?raw'),
  respondent: () => import('../../../docs/respondent-help.md?raw'),
};

/** Documents by their file name, for links between them. */
const FILES: Record<string, HelpDoc> = {
  'user-guide.md': 'guide',
  'method-notes.md': 'method',
  'respondent-help.md': 'respondent',
};

// Screenshots referenced by the user guide as user-guide/<file>.
const IMAGES = import.meta.glob('../../../docs/user-guide/*.{png,jpg}', {
  query: '?url',
  import: 'default',
  eager: true,
});
const imageUrl = (src: string) => IMAGES[`../../../docs/${src.replace(/^\.\//, '')}`];

const ORDER: readonly HelpDoc[] = ['guide', 'method', 'respondent', 'licence'];

interface Target {
  doc: HelpDoc;
  anchor: string | null;
}

/** Where a link in a document leads: another place in the help, a web page, or nowhere in the app. */
function resolve(href: string, current: HelpDoc): Target | { url: string } | null {
  if (/^https?:\/\//.test(href)) return { url: href };
  const [path = '', anchor = null] = href.split('#');
  if (path === '') return { doc: current, anchor };
  const doc = FILES[path.replace(/^(\.\.?\/)*(docs\/)?/, '')];
  // A link to a repository file (source code, CLAUDE.md) has no page in the app.
  return doc ? { doc, anchor } : null;
}

interface HelpDialogProps {
  open: boolean;
  doc: HelpDoc;
  onDoc: (doc: HelpDoc) => void;
  onClose: () => void;
}

export function HelpDialog({ open, doc, onDoc, onClose }: HelpDialogProps) {
  // A new object on every link, so following the same link twice scrolls again.
  const [anchor, setAnchor] = useState<{ id: string | null }>({ id: null });
  const go = (target: Target) => {
    setAnchor({ id: target.anchor });
    onDoc(target.doc);
  };
  return (
    <Dialog
      open={open}
      title={helpCopy.title}
      wide
      onClose={onClose}
      actions={
        <button type="button" className="button button--primary" onClick={onClose}>
          {helpCopy.close}
        </button>
      }
    >
      <div className="help">
        <Tabs
          label={helpCopy.tabsLabel}
          selected={doc}
          onSelect={(key) => {
            go({ doc: key, anchor: null });
          }}
          items={ORDER.map((key) => ({
            key,
            label: helpCopy.menu[key],
            panel:
              key === 'licence' ? (
                <LicenceDocument />
              ) : (
                <HelpDocument doc={key} anchor={anchor} onNavigate={go} />
              ),
          }))}
        />
      </div>
    </Dialog>
  );
}

// The licence statement is plain text wrapped at 78 characters, with numbered
// sections and lettered items. It is reflowed for reading, never reworded: a
// single-line paragraph "1. Scope" becomes a heading, "(a) …" starts an item,
// and wrapped lines are joined. The third-party notices are a file served
// with the site (public/THIRD-PARTY-NOTICES.txt), opened in a new window.
export function licenceParagraphs(text: string): { heading: boolean; text: string }[] {
  const out: { heading: boolean; text: string }[] = [];
  for (const block of text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim());
    if (lines.length === 1 && /^\d+\. \S/.test(lines[0] ?? '')) {
      out.push({ heading: true, text: lines[0] ?? '' });
      continue;
    }
    let current: string[] = [];
    const flush = () => {
      if (current.length > 0) out.push({ heading: false, text: current.join(' ') });
      current = [];
    };
    for (const line of lines) {
      if (/^\([a-z]\) /.test(line)) flush();
      current.push(line);
    }
    flush();
  }
  return out;
}

function LicenceDocument() {
  const [text, setText] = useState<{ ok: true; text: string } | { ok: false } | null>(null);
  useEffect(() => {
    let live = true;
    import('../../../LICENSE?raw')
      .then((m) => {
        if (live) setText({ ok: true, text: m.default });
      })
      .catch(() => {
        if (live) setText({ ok: false });
      });
    return () => {
      live = false;
    };
  }, []);
  if (text === null) return <p className="help__status">{helpCopy.loading}</p>;
  if (!text.ok) return <p className="help__status">{helpCopy.failed}</p>;
  const [title, ...rest] = licenceParagraphs(text.text);
  return (
    <div className="help__document">
      <div className="help__article">
        <h3 className="help__heading help__heading--2">{title?.text}</h3>
        {rest.map((p, i) =>
          p.heading ? (
            <h4 key={i} className="help__heading help__heading--3">
              {p.text}
            </h4>
          ) : (
            <p key={i}>{p.text}</p>
          ),
        )}
        <h3 className="help__heading help__heading--2">{helpCopy.thirdParty}</h3>
        <p>{helpCopy.thirdPartyBody}</p>
        <p>
          <a href="THIRD-PARTY-NOTICES.txt" target="_blank" rel="noreferrer noopener">
            {helpCopy.thirdPartyLink}
            <span className="visually-hidden"> {helpCopy.newWindow}</span>
          </a>
        </p>
      </div>
    </div>
  );
}

const cache = new Map<MarkdownDoc, Block[]>();

function HelpDocument({
  doc,
  anchor,
  onNavigate,
}: {
  doc: MarkdownDoc;
  anchor: { id: string | null };
  onNavigate: (target: Target) => void;
}) {
  const [blocks, setBlocks] = useState<Block[] | 'failed' | null>(() => cache.get(doc) ?? null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cache.has(doc)) return;
    let live = true;
    SOURCES[doc]()
      .then((m) => {
        const parsed = parseMarkdown(m.default);
        cache.set(doc, parsed);
        if (live) setBlocks(parsed);
      })
      .catch(() => {
        if (live) setBlocks('failed');
      });
    return () => {
      live = false;
    };
  }, [doc]);

  // Show the linked heading once the document is on screen, or the top of the document.
  useEffect(() => {
    if (!Array.isArray(blocks)) return;
    const root = rootRef.current;
    const target = anchor.id ? document.getElementById(`help-${doc}-${anchor.id}`) : null;
    if (target) {
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
    } else root?.closest('.dialog__body')?.scrollTo(0, 0);
  }, [blocks, anchor, doc]);

  if (blocks === null) return <p className="help__status">{helpCopy.loading}</p>;
  if (blocks === 'failed') return <p className="help__status">{helpCopy.failed}</p>;

  const inline = (nodes: readonly Inline[]): ReactNode =>
    nodes.map((n, i) => {
      switch (n.kind) {
        case 'text':
          return <Fragment key={i}>{n.text}</Fragment>;
        case 'code':
          return <code key={i}>{n.text}</code>;
        case 'strong':
          return <strong key={i}>{inline(n.children)}</strong>;
        case 'em':
          return <em key={i}>{inline(n.children)}</em>;
        case 'link': {
          const target = resolve(n.href, doc);
          if (target === null) return <Fragment key={i}>{inline(n.children)}</Fragment>;
          if ('url' in target)
            return (
              <a key={i} href={target.url} target="_blank" rel="noreferrer noopener">
                {inline(n.children)}
                <span className="visually-hidden"> {helpCopy.newWindow}</span>
              </a>
            );
          return (
            <a
              key={i}
              href={`#help-${target.doc}-${target.anchor ?? ''}`}
              onClick={(e) => {
                e.preventDefault();
                onNavigate(target);
              }}
            >
              {inline(n.children)}
            </a>
          );
        }
      }
    });

  const block = (b: Block, i: number): ReactNode => {
    switch (b.kind) {
      case 'heading': {
        // The document title is the dialog's tab; its sections start at h3 under the dialog's h2.
        const Tag = (['h3', 'h3', 'h4', 'h5', 'h6', 'h6'] as const)[b.level - 1] ?? 'h6';
        return (
          <Tag
            key={i}
            id={`help-${doc}-${b.id}`}
            tabIndex={-1}
            className={`help__heading help__heading--${String(b.level)}`}
          >
            {inline(b.children)}
          </Tag>
        );
      }
      case 'paragraph':
        return <p key={i}>{inline(b.children)}</p>;
      case 'list':
        return b.ordered ? (
          <ol key={i} start={b.start}>
            {b.items.map((item, k) => (
              <li key={k}>{inline(item)}</li>
            ))}
          </ol>
        ) : (
          <ul key={i}>
            {b.items.map((item, k) => (
              <li key={k}>{inline(item)}</li>
            ))}
          </ul>
        );
      case 'table':
        return (
          // A wide table scrolls on its own, and can be scrolled by keyboard.
          <div
            key={i}
            className="help__table"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            role="region"
            aria-label={helpCopy.tableLabel}
          >
            <table>
              <thead>
                <tr>
                  {b.header.map((c, k) => (
                    <th key={k} scope="col">
                      {inline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, k) => (
                      <td key={k}>{inline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'code':
        return (
          <pre key={i} className="help__code">
            <code>{b.text}</code>
          </pre>
        );
      case 'quote':
        return (
          <blockquote key={i} className="help__quote">
            {b.blocks.map(block)}
          </blockquote>
        );
      case 'image': {
        const url = imageUrl(b.src);
        return url ? (
          <img key={i} className="help__image" src={url} alt={b.alt} loading="lazy" />
        ) : (
          <p key={i} className="help__status">
            {helpCopy.imageMissing(b.alt)}
          </p>
        );
      }
    }
  };

  const headings = blocks.filter(
    (b): b is Extract<Block, { kind: 'heading' }> => b.kind === 'heading' && b.level === 2,
  );
  const [first, ...rest] = blocks;
  const body = first?.kind === 'heading' && first.level === 1 ? rest : blocks;

  return (
    <div ref={rootRef} className="help__document">
      {headings.length > 2 && (
        <nav className="help__contents" aria-label={helpCopy.contents}>
          <p className="help__contents-heading">{helpCopy.contents}</p>
          <ul>
            {headings.map((h) => (
              <li key={h.id}>
                <a
                  href={`#help-${doc}-${h.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate({ doc, anchor: h.id });
                  }}
                >
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="help__article">{body.map(block)}</div>
    </div>
  );
}
