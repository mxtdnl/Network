// Draws the full map picture off the main thread on an OffscreenCanvas and
// returns it as an ImageBitmap (CLAUDE.md D50). The main thread keeps
// answering the pointer and drawing cached frames while this runs, so a
// full-quality redraw of 10,000 ties never blocks pan, zoom or hover.

import condensedLatin from '../../assets/fonts/fira-sans-condensed-latin-500-normal.woff2?url';
import condensedLatinExt from '../../assets/fonts/fira-sans-condensed-latin-ext-500-normal.woff2?url';
import sansLatin from '../../assets/fonts/fira-sans-latin-600-normal.woff2?url';
import sansLatinExt from '../../assets/fonts/fira-sans-latin-ext-600-normal.woff2?url';
import { paint } from './canvas';
import type { Scene } from './scene';

export interface RenderRequest {
  id: number;
  scene: Scene;
  dpr: number;
}

export interface RenderResponse {
  id: number;
  bitmap: ImageBitmap;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

// Map labels use Fira Sans Condensed 500 and group names Fira Sans 600
// (design-system §3.2); workers do not see the page's @font-face rules, so the
// same files are loaded here.
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122, U+2212';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02FF, U+1E00-1EFF, U+A720-A7FF';
const fontsReady = (async () => {
  const faces = [
    new FontFace('Fira Sans', `url(${sansLatin})`, { weight: '600', unicodeRange: LATIN }),
    new FontFace('Fira Sans', `url(${sansLatinExt})`, { weight: '600', unicodeRange: LATIN_EXT }),
    new FontFace('Fira Sans Condensed', `url(${condensedLatin})`, {
      weight: '500',
      unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122, U+2212',
    }),
    new FontFace('Fira Sans Condensed', `url(${condensedLatinExt})`, {
      weight: '500',
      unicodeRange: 'U+0100-02BA, U+02BD-02FF, U+1E00-1EFF, U+A720-A7FF',
    }),
  ];
  for (const face of faces) scope.fonts.add(face);
  // A font that fails to load falls back to the next family in the token.
  await Promise.allSettled(faces.map((f) => f.load()));
})();

scope.onmessage = async (event: MessageEvent<RenderRequest>) => {
  await fontsReady;
  const { id, scene, dpr } = event.data;
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(scene.width * dpr)),
    Math.max(1, Math.round(scene.height * dpr)),
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  paint(ctx, scene, dpr);
  const bitmap = canvas.transferToImageBitmap();
  scope.postMessage({ id, bitmap } satisfies RenderResponse, [bitmap]);
};
