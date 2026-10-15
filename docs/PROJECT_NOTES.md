# Espresso Dial-In — project notes

## Stack

- **Frontend:** React 19 + Vite 8, Tailwind CSS 4, PWA (`vite-plugin-pwa`)
- **Data:** Dexie/IndexedDB (`EspressoDialDB`, schema version **17** — do not bump without explicit ticket)
- **Tests:** Node `test.js` harness (fake-indexeddb), Vitest for focused unit files (`*.vitest.js`), Playwright for smoke scripts under `scripts/`

## Commands

```bash
npm ci --cache /workspace/.npm-cache --prefer-offline
npm run dev          # local dev server
npm run build        # production build → dist/
npm run lint
npm test             # node integration test suite
timeout 10m npx vitest run
node scripts/playwright-heldback-grinders-smoke.mjs  # after build + preview deps
```

Install Playwright browsers once per environment: `npx playwright install chromium`.

## Conventions

- Grinder identity strings in `src/grinders/grinderRegistry.js` and `src/grinders/presetGrinders/catalog.js` are **stable persisted IDs** — never rename without migration.
- Preset grinders: specs in `catalog.js`, dial math in `presetGrinders/dial.js`, optional Settings fields in `presetOptionalFields.js` + `PresetGrinderAuxFields.jsx`.
- New optional grinder fields belong on the **settings** document (free-form keys), not new IndexedDB stores.
- Footer version comes from `package.json` `version` via `src/config/appVersion.js` (`VITE_APP_VERSION`).
- Stop dev/preview servers by **PID only** (no `pkill -f` / `killall`).

## Gotchas

- Do not run Vitest in watch mode in CI/agents (`vitest run` only).
- `npm test` does not include Vitest; run both when validating grinder work.
- Engine snapshot tests pin recommendation output; preset-only changes usually do not touch `engineSnapshots.json`.
- Custom grinder picker id is separate from preset ids — presets must not alias uncertain siblings (e.g. Barista Pro/Touch vs Express).
