/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// The Content Security Policy <meta> in index.html (spec §10) applies to the
// built site. The dev server needs inline scripts and styles for hot reload,
// so the tag is removed while serving in development only.
function stripCspInDev(): Plugin {
  return {
    name: 'graticule:strip-csp-in-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/, '');
    },
  };
}

export default defineConfig({
  base: '/network/',
  plugins: [react(), stripCspInDev()],
  build: {
    // Never inline assets as data: URIs; the CSP allows fonts from 'self' only.
    assetsInlineLimit: 0,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
