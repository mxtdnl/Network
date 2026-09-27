// Copies the self-hosted Fira Sans and Fira Sans Condensed WOFF2 files from the
// @fontsource packages into src/assets/fonts, with the OFL 1.1 licence. The
// WOFF (version 1) files are copied too: the PDF report converts them to
// TrueType in the browser and embeds subsets (CLAUDE.md D106), because WOFF2
// needs a Brotli decoder and PDF readers cannot read WOFF of either version.
// Run with `npm run fonts` after upgrading either package; commit the result.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src/assets/fonts');
mkdirSync(out, { recursive: true });

const families = [
  { pkg: '@fontsource/fira-sans', file: 'fira-sans', weights: [400, 500, 600] },
  { pkg: '@fontsource/fira-sans-condensed', file: 'fira-sans-condensed', weights: [400, 500] },
];
const subsets = ['latin', 'latin-ext'];

for (const { pkg, file, weights } of families) {
  for (const subset of subsets) {
    for (const weight of weights) {
      for (const ext of ['woff2', 'woff']) {
        const name = `${file}-${subset}-${String(weight)}-normal.${ext}`;
        copyFileSync(join(root, 'node_modules', pkg, 'files', name), join(out, name));
      }
    }
  }
}

// The @fontsource LICENSE carries a placeholder copyright line ("Google Inc.").
// Replace it with the notice embedded in the font files' name table (ID 0).
const licence = readFileSync(join(root, 'node_modules/@fontsource/fira-sans/LICENSE'), 'utf8');
const notice =
  'Copyright 2012-2016, The Mozilla Foundation and Telefonica S.A.\n' +
  'Fira Sans and Fira Sans Condensed, version 4.203, via @fontsource 5.3.0.';
writeFileSync(join(out, 'OFL.txt'), licence.replace(/^Google Inc\.\n/, `${notice}\n`));
