# B09 handoff — Per-shot insights

**Status: UI**

## Checkpoint

- Base `origin/main`: `95faa345d6ba9a69a43b7e373ab528b87043f503` (v4.14.17).
- Branch: `b09/per-shot-insights`.
- Latest pushed SHA: `7bb057c64508bbd6d41658a647b8a9c273181876` (UI checkpoint; Sette saved-setting rendering fix pending).
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

- Completed: baseline `main` SHA verified; `AGENTS.md` read from main; recommendation, save, taste, history, profile, and standalone pressure paths audited; B09 branch created; Vercel auto-build exclusion added; pure insight function and 10 focused tests pass; insights integrated into expanded History Shot profile; Playwright regression now asserts insights and checks 320/640 and 412/915 layout, with screenshots saved to the OS temp directory when run. Calculation runs only when the profile is expanded.
- Incomplete: browser scripts and screenshot/layout validation; full regression; production build preflight; final version bump.
- Known uncertainty: current production Git SHA/version cannot be established from Vercel's deployment metadata available in this session.
- Blockers requiring owner input: none for development. Production provenance uncertainty should be resolved before any release review.

## Existing behavior deliberately preserved

- No change to grinder recommendation generation, thresholds, sensitivities, saved recommendation objects, Dexie schema, historical records, exports, recording lifecycle, or Vercel project settings.

## Logic checkpoint details

- Added `src/utils/shotInsights.js` and `src/utils/shotInsights.vitest.js`.
- Test command: `npm run test:vitest -- --run src/utils/shotInsights.vitest.js` — 1 file passed, 10 tests passed (exit 0).
- Focused lint: `npx eslint src/utils/shotInsights.js src/utils/shotInsights.vitest.js src/components/ShotInsights.jsx src/components/ShotProfile.jsx` — exit 0. `git diff --check` — exit 0.
- Browser follow-up: stop regression exposed Sette micro settings stored as letters; the insight formatter now preserves string micro labels (including `C`). Focused tests pass with this case. The previous browser run had 1 failed assertion because the recommendation was not rendered; remaining scenarios passed. Rebuild before rerunning browser checks.
- Exact next steps: commit/push the Sette setting fix; rebuild with `VITE_ENABLE_PRESSURE_LAB=true` and `VITE_SCALE_ALLOW_SIM=true`; rerun the stop regression, then shot-screen smoke; inspect generated 320×640 and 412×915 screenshots; then run the staged full regression and production build preflight. Keep failures and pre-existing baselines distinct.
