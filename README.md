# Graticule

Organisational network analysis that runs entirely in the browser. Served at `https://<username>.github.io/network/`.

> **Never commit real participant data to this repository.** It is public. `.gitignore` excludes `*.ona.json` project files, `data/private/`, and any `.csv` or `.xlsx` outside `public/templates/`, but it is a safety net, not a guarantee: check `git status` before every commit.

## Development

Requires the Node version in `.nvmrc`.

```sh
npm ci
npm run dev         # development server (the Content Security Policy is applied to builds only)
npm run lint        # ESLint and Prettier
npm run typecheck
npm test            # Vitest unit tests
npm run build
npm run preview     # serves dist/ at http://localhost:4173/network/
npm run test:e2e    # Playwright against the production build (run `npx playwright install chromium` once)
```

`spec.md` is the specification; `CLAUDE.md` records build decisions.
