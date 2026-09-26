// Detects raw design values outside src/styles/tokens.css (spec §12: the
// approved tokens are the only source of colour, type, spacing, radius,
// elevation and motion values; hard-coded values are defects).

export interface Finding {
  line: number;
  rule: string;
  text: string;
}

const HEX = /#[0-9a-f]{3,8}\b/gi;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;
const CSS_COLOUR_FUNCTION = /\bcolor\(/gi;
// Absolute and font-relative lengths and all durations. Percentages, fr and
// viewport units describe layout proportions and are allowed.
const LENGTH_OR_TIME =
  /(?<![\w#.-])-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|ex|ch|lh|rlh|cap|ic|pt|pc|cm|mm|in|q|ms|s)\b/gi;

// Properties whose value must come entirely from tokens (var()), optionally
// combined with calc() arithmetic between tokens, 0 or a CSS-wide keyword.
const TOKEN_ONLY_PROPERTIES = new Set([
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-start-start-radius',
  'border-start-end-radius',
  'border-end-start-radius',
  'border-end-end-radius',
  'transition-duration',
  'transition-delay',
  'animation-duration',
  'animation-delay',
]);
// Shadows are elevation tokens used whole (design-system §4.3), never composed.
const SHADOW_PROPERTIES = new Set(['box-shadow', 'text-shadow']);
const KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'none', 'normal', '0']);
// Descriptors inside @font-face describe the font files, not styling.
const FONT_FACE_DESCRIPTORS = new Set(['font-family', 'font-weight']);

// CSS named colours (CSS Color 4), excluding transparent and currentcolor.
const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function scanPattern(source: string, pattern: RegExp, rule: string, out: Finding[]): void {
  for (const match of source.matchAll(pattern)) {
    out.push({ line: lineOf(source, match.index), rule, text: match[0] });
  }
}

function isTokenOnly(value: string): boolean {
  const stripped = value
    .replace(/!important/g, '')
    .replace(/var\(--[\w-]+\)/g, '')
    .replace(/calc\(|min\(|max\(|\(|\)|[+\-*/,]/g, ' ')
    .trim();
  return stripped.split(/\s+/).every((word) => word === '' || KEYWORDS.has(word));
}

// Replace comments with spaces so line numbers are kept.
function stripComments(source: string, kind: 'css' | 'ts'): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  const block = source.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (kind === 'css') return block;
  return block.replace(/(^|[^:])\/\/.*$/gm, (m, p: string) => p + blank(m.slice(p.length)));
}

export function lintCss(raw: string): Finding[] {
  const source = stripComments(raw, 'css');
  const findings: Finding[] = [];
  scanPattern(source, HEX, 'hex colour', findings);
  scanPattern(source, COLOUR_FUNCTION, 'colour function', findings);
  scanPattern(source, CSS_COLOUR_FUNCTION, 'colour function', findings);
  scanPattern(source, LENGTH_OR_TIME, 'raw length or duration', findings);

  const fontFaceRanges: [number, number][] = [];
  for (const m of source.matchAll(/@font-face\s*\{[^}]*\}/g)) {
    fontFaceRanges.push([m.index, m.index + m[0].length]);
  }
  const inFontFace = (i: number) => fontFaceRanges.some(([a, b]) => i >= a && i < b);

  for (const m of source.matchAll(/(?<=[{;\s])([a-z-]+)\s*:\s*([^;{}]+?)\s*(?=;|\})/g)) {
    const property = (m[1] ?? '').toLowerCase();
    const value = m[2] ?? '';
    if (property.startsWith('--')) continue;
    const line = lineOf(source, m.index);
    if (TOKEN_ONLY_PROPERTIES.has(property)) {
      const exempt = inFontFace(m.index) && FONT_FACE_DESCRIPTORS.has(property);
      if (!exempt && !isTokenOnly(value)) {
        findings.push({ line, rule: `${property} must use a token`, text: value });
      }
    }
    const withoutTokens = value.toLowerCase().replace(/var\(--[\w-]+\)/g, ' ');
    if (SHADOW_PROPERTIES.has(property) && !/^(?:none|var\(--e-\d\))$/.test(value.trim())) {
      findings.push({ line, rule: `${property} must be an elevation token`, text: value });
    }
    for (const word of withoutTokens.split(/[^a-z]+/)) {
      if (NAMED_COLOURS.has(word)) findings.push({ line, rule: 'named colour', text: word });
    }
  }
  return findings;
}

export function lintScript(raw: string): Finding[] {
  const source = stripComments(raw, 'ts');
  const findings: Finding[] = [];
  scanPattern(source, HEX, 'hex colour', findings);
  scanPattern(source, COLOUR_FUNCTION, 'colour function', findings);
  scanPattern(source, LENGTH_OR_TIME, 'raw length or duration', findings);
  return findings;
}
