# B09 handoff — Per-shot insights

**Status: TESTING**

## Checkpoint

- Base `origin/main`: `95faa345d6ba9a69a43b7e373ab528b87043f503` (v4.14.17).
- Branch: `b09/per-shot-insights`.
- Latest pushed SHA: `f4e955a70426ed67a6624e439f14fc0af49dc52e` (saved recommendation reason formatting; latest UI refinements pending).
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
- `src/App.jsx` — pass only per-shot data to the expanded profile (and avoid computing on collapsed cards).
- `package.json` — set v4.14.18 only at final candidate checkpoint.

## Minimal implementation plan

1. Implement a pure function receiving the shot, its built profile, saved target values, saved taste/recommendation, and exclusion/known-issue state. Return a small ordered set of structured findings; reuse existing outcome classifications only when their required saved targets and measurements exist.
2. Cover targets, taste, saved recommendation context, learning exclusion, known issue, pressure/scale observations, interruptions, approximate timing, and missing-data cases with focused unit tests. Never invoke recommendation calculation.
3. Integrate an accessible compact insight section into the expanded History profile. Keep profile computation lazy and use saved targets only.
4. Run staged focused checks, then requested browser and regression suite; record all actual outcomes and finish with production build preflight. Do not deploy or merge.

## Completed / incomplete

- Completed: baseline `main` SHA verified; `AGENTS.md` read from main; recommendation, save, taste, history, profile, and standalone pressure paths audited; B09 branch created; Vercel auto-build exclusion added; pure insight function and 10 focused tests pass; insights integrated into expanded History Shot profile; mode-aware missing-data behavior, mobile widths, dark/light rendering, saved recommendation, and interruption status exercised. Calculation runs only when the profile is expanded.
- Incomplete: final full regression after the latest wording cleanup; final build and screenshot inspection; final version bump and release-mode preflight with full SHA.
- Known uncertainty: current production Git SHA/version cannot be established from Vercel's deployment metadata available in this session.
- Blockers requiring owner input: none for development. Production provenance uncertainty should be resolved before any release review.

## Existing behavior deliberately preserved

- No change to grinder recommendation generation, thresholds, sensitivities, saved recommendation objects, Dexie schema, historical records, exports, recording lifecycle, or Vercel project settings.

## Logic checkpoint details

- Added `src/utils/shotInsights.js` and `src/utils/shotInsights.vitest.js`.
- Test command: `npm run test:vitest -- --run src/utils/shotInsights.vitest.js` — 1 file passed, 10 tests passed (exit 0).
- Focused lint: `npx eslint src/utils/shotInsights.js src/utils/shotInsights.vitest.js src/components/ShotInsights.jsx src/components/ShotProfile.jsx` — exit 0. `git diff --check` — exit 0.
- Browser follow-up: shot-screen smoke passes 7/7 (exit 0). Stop regression passes 6/6 (exit 0), including 320×640/412×915 no-overflow checks and a light-theme render. Latest screenshot files are saved under `%TEMP%` as `b09-shot-insights-320x640.png`, `b09-shot-insights-412x915.png`, and `b09-shot-insights-light-412x915.png`. Saved Sette micro labels (including letters) render correctly; uppercase engine action tokens are removed from the detail because the recommended setting is already shown.
- Full Vitest (before final minor wording cleanup): 111 files passed, 2 skipped; 659 passed, 4 skipped (the expected conditional skips). Legacy `npm test` passed with `TZ=UTC` and `TZ=Pacific/Auckland` (both exit 0). Full `npm run lint` hit ESLint stack overflow while traversing generated `public/flair-pressure-lab/opencv.js`; focused ESLint on every changed source/test/script file passed (exit 0). Recheck focused tests after final refinements.
- Exact next steps: push current insight wording/fallback refinements; rebuild with `VITE_ENABLE_PRESSURE_LAB=true` and `VITE_SCALE_ALLOW_SIM=true`; rerun focused tests, stop regression and inspect fresh screenshots; then repeat full Vitest, both legacy timezones and changed-file lint. Bump to v4.14.18, push final candidate, and run the release-mode production build preflight with pressure/scale enabled, simulations/replay disabled, and the exact full candidate SHA. Do not deploy or merge.
