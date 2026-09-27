// Built URLs of the font files the exports embed (Vite fingerprints them under
// the site's base path), and a loader that fetches them from the site.

import sans400 from '../../assets/fonts/fira-sans-latin-400-normal.woff2?url';
import sans400Ext from '../../assets/fonts/fira-sans-latin-ext-400-normal.woff2?url';
import sans500 from '../../assets/fonts/fira-sans-latin-500-normal.woff2?url';
import sans500Ext from '../../assets/fonts/fira-sans-latin-ext-500-normal.woff2?url';
import sans600 from '../../assets/fonts/fira-sans-latin-600-normal.woff2?url';
import sans600Ext from '../../assets/fonts/fira-sans-latin-ext-600-normal.woff2?url';
import cond500 from '../../assets/fonts/fira-sans-condensed-latin-500-normal.woff2?url';
import cond500Ext from '../../assets/fonts/fira-sans-condensed-latin-ext-500-normal.woff2?url';
import sans400W from '../../assets/fonts/fira-sans-latin-400-normal.woff?url';
import sans400ExtW from '../../assets/fonts/fira-sans-latin-ext-400-normal.woff?url';
import sans500W from '../../assets/fonts/fira-sans-latin-500-normal.woff?url';
import sans500ExtW from '../../assets/fonts/fira-sans-latin-ext-500-normal.woff?url';
import sans600W from '../../assets/fonts/fira-sans-latin-600-normal.woff?url';
import sans600ExtW from '../../assets/fonts/fira-sans-latin-ext-600-normal.woff?url';
import cond500W from '../../assets/fonts/fira-sans-condensed-latin-500-normal.woff?url';
import cond500ExtW from '../../assets/fonts/fira-sans-condensed-latin-ext-500-normal.woff?url';
import type { FontLoader } from './fonts';

const URLS: Record<string, string> = {
  'fira-sans-latin-400-normal.woff2': sans400,
  'fira-sans-latin-ext-400-normal.woff2': sans400Ext,
  'fira-sans-latin-500-normal.woff2': sans500,
  'fira-sans-latin-ext-500-normal.woff2': sans500Ext,
  'fira-sans-latin-600-normal.woff2': sans600,
  'fira-sans-latin-ext-600-normal.woff2': sans600Ext,
  'fira-sans-condensed-latin-500-normal.woff2': cond500,
  'fira-sans-condensed-latin-ext-500-normal.woff2': cond500Ext,
  'fira-sans-latin-400-normal.woff': sans400W,
  'fira-sans-latin-ext-400-normal.woff': sans400ExtW,
  'fira-sans-latin-500-normal.woff': sans500W,
  'fira-sans-latin-ext-500-normal.woff': sans500ExtW,
  'fira-sans-latin-600-normal.woff': sans600W,
  'fira-sans-latin-ext-600-normal.woff': sans600ExtW,
  'fira-sans-condensed-latin-500-normal.woff': cond500W,
  'fira-sans-condensed-latin-ext-500-normal.woff': cond500ExtW,
};

export const fetchFont: FontLoader = async (file) => {
  const url = URLS[file];
  if (!url) throw new Error(`No font file ${file}.`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The font ${file} could not be loaded.`);
  return new Uint8Array(await response.arrayBuffer());
};
