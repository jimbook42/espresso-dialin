# B09 handoff — Per-shot insights

**Status: READY**

## Checkpoint

- Base `origin/main`: `95faa345d6ba9a69a43b7e373ab528b87043f503` (v4.14.17).
- Branch: `b09/per-shot-insights`.
- Latest pushed implementation/candidate SHA: `aa019e7b18e2653e66f80a3080d195f13b5581da` (v4.14.18, exact SHA embedded in the verified release build). This final handoff update is documentation-only.
- Production provenance: Vercel project `espresso-dialin` reports latest deployment `dpl_JD9n99iVtgXXcv8hxvS4zNzhUvDE` as READY/production but exposes no Git metadata and lists no project domains. The supplied expected production SHA could not be verified; no project settings or deployments were changed.

## Audit findings

- Existing functionality to reuse: `classifyShotOutcome` and `recipeContextForShot` in `src/utils/grinderLogic.js`; taste normalization and labels in `src/utils/tasteProfile.js`; the saved `shot.recommendation` and target fields assembled in `App.jsx`; and lazy B08 metrics in `buildShotProfile` (`src/utils/shotProfile.js`). History already expands `ShotProfile` and keeps share, replay, issue toggle, export, and delete actions on the card.
- New Brew/Combined records persist `targetTimeMinS`, `targetTimeMaxS`, `targetDoseG`, and `targetYieldG` at save time. Historical records without these fields cannot reliably reconstruct original targets. B09 will compare only to shot-level saved targets; no current recipe fallback or implicit defaults.
- Saved recommendation objects contain the then-current recommendation and explanation. They are historical context only. B09 will render these values without recalculation. Standalone Pressure Tracker records have no Dial recommendation context.
- `buildShotProfile` already distinguishes observed pressure/weight/flow, interruptions, and approximate alignment. Reuse it only when insights render for an expanded shot, not across collapsed History cards.
- Missing measurements and taste remain unknown. Pressure/flow do not establish extraction quality, taste, or causes.
- After-save UI was audited: persistence already transitions directly into next-shot/review workflows and replay commit handling. History is the required primary experience; after-save insights are deferred to avoid changing save lifecycle or delaying the next shot.

## Proposed files

- `vercel.json` — exclude B09 from automatic deployment builds.
- `docs/b09-handoff.md` — this continuity record.
- `src/utils/shotInsights.js` and focused Vitest file — pure deterministic insight generation.
- `src/components/ShotInsights.jsx` and `src/components/ShotProfile.jsx` — present insights inside B08’s expandable profile.
- `scripts/playwright-shot-stop-regression.mjs` — validate insights, mobile layouts, theme, restart retention, and shot immutability.
- `package.json` and `package-lock.json` — target version v4.14.18 at final candidate checkpoint.

## Minimal implementation plan

1. Implement a pure function receiving the shot, its built profile, saved target values, saved taste/recommendation, and exclusion/known-issue state. Return a small ordered set of structured findings; reuse existing outcome classifications only when their required saved targets and measurements exist.
2. Cover targets, taste, saved recommendation context, learning exclusion, known issue, pressure/scale observations, interruptions, approximate timing, and missing-data cases with focused unit tests. Never invoke recommendation calculation.
3. Integrate an accessible compact insight section into the expanded History profile. Keep profile computation lazy and use saved targets only.
4. Run staged focused checks, then requested browser and regression suite; record all actual outcomes and finish with production build preflight. Do not deploy or merge.

## Completed / incomplete

- Completed: baseline `main` SHA verified; `AGENTS.md` read from main; recommendation, save, taste, history, profile, and standalone pressure paths audited; B09 branch created; Vercel auto-build exclusion added; pure insight function and 10 focused tests pass; insights integrated into expanded History Shot profile; missing-data behavior, mobile widths, dark/light rendering, saved recommendation, interruptions, browser restart, and no-record-mutation checks pass. Calculation runs only when the profile is expanded. Version is v4.14.18. Exact-SHA release-mode build preflight passed.
- Incomplete: none for development candidate. Release remains subject to explicit product-owner approval. Current production Git SHA/version could not be confirmed from Vercel metadata; resolve before release execution.
- Known uncertainty: current production Git SHA/version cannot be established from Vercel's deployment metadata available in this session.
- Blockers requiring owner input: none for development. Production provenance uncertainty should be resolved before any release review.

## Existing behavior deliberately preserved

- No change to grinder recommendation generation, thresholds, sensitivities, saved recommendation objects, Dexie schema, historical records, exports, recording lifecycle, or Vercel project settings.

## Logic checkpoint details

- Added `src/utils/shotInsights.js` and `src/utils/shotInsights.vitest.js`.
- Test command: `npm run test:vitest -- --run src/utils/shotInsights.vitest.js` — 1 file passed, 10 tests passed (exit 0).
- Focused lint: `npx eslint src/utils/shotInsights.js src/utils/shotInsights.vitest.js src/components/ShotInsights.jsx src/components/ShotProfile.jsx` — exit 0. `git diff --check` — exit 0.
- Browser follow-up: shot-screen smoke passes 7/7 (exit 0). Stop regression passes 6/6 (exit 0), including 320×640/412×915 no-overflow checks, light theme, browser restart, and unchanged stored shots. Final viewport screenshots are saved under `C:\Users\Isaac\AppData\Local\Temp\` as `b09-shot-insights-320x640.png`, `b09-shot-insights-412x915.png`, and `b09-shot-insights-light-412x915.png`. Saved Sette micro labels (including letters) render correctly; reason text preserves the outlier context and removes duplicated uppercase grind commands.
- Full Vitest: 111 files passed, 2 skipped; 659 passed, 4 skipped (the four expected conditional skips). Legacy `npm test` passed with `TZ=UTC` and `TZ=Pacific/Auckland` (both exit 0). Focused B09 Vitest: 1 file, 10 tests passed. Browser stop regression: 6/6; shot screen smoke: 7/7. Changed-file ESLint passed (exit 0). Full `npm run lint` failed with ESLint `RangeError: Maximum call stack size exceeded` while linting generated `public/flair-pressure-lab/opencv.js` line 23; no changed-file lint errors.
- Final build: `npm run build:release`, exit 0; release preflight passed for `aa019e7b18e2653e66f80a3080d195f13b5581da`. Embedded app bundle `dist/assets/App-BpJObfwO.js` contains v4.14.18 and the exact full SHA. Pressure/scale enabled; pressure simulation, scale simulation, and replay disabled. Build reports the existing >500 kB chunk warning.
- Exact next steps: product owner reviews/approves candidate SHA `aa019e7b18e2653e66f80a3080d195f13b5581da`. After explicit release approval, follow the established staged build/promotion process. Do not deploy, merge, or start B10 before that release is approved and completed.
