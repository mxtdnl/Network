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
npm run demo        # regenerates src/demo/demo.ona.json from scripts/generate-demo.ts (seeded)
```

## Importing data

Import templates are in `public/templates/` and can be downloaded from the Import data dialog:

- `members.csv`: one row per member. Required columns `id` and `display_name`; optional `team`, `level`, `location`, `tenure_band`, `manager_id`. Any other column becomes a member attribute.
- `ties.csv`: one row per rating, `rater_id, ratee_id, variable, value[, wave]`. `variable` is a layer key such as `connection_strength`. Leave `value` empty for a rating that was not given; it is stored as not rated, never as 0.

Every file is checked before import. The validation report lists each problem with its spreadsheet row number (row 1 is the header); valid rows can be imported and invalid rows skipped. XLSX import is not available yet (see `CLAUDE.md`, open questions).

Projects are saved and opened as `.ona.json` files. Keeping a copy in the browser (IndexedDB) is off by default; Project → Clear local data removes everything Graticule stored.

`spec.md` is the specification; `CLAUDE.md` records build decisions.
