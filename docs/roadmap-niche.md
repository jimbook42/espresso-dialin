# Niche Zero learning roadmap

Branch: `refactor/device-architecture`. Definition of done: learning eligibility is explainable per bean/recipe/grinder, valid comparable shots are not silently dropped, and confidence gates stay unchanged.

## Roadmap items

| # | Item | Status |
|---|------|--------|
| 1 | Fresh Niche espresso start at dial **15** labelled **app default** (not from shot history); no cross-grinder bleed | **Done** (`a997d26`) |
| 2 | Reason-coded `nicheLearningNote` + structured `nicheEligibility` on all non-empirical recommendation paths | **Done** (`c278d74`) |
| 3 | Evidence-filtering fixes (recipe comparability, grinder filter, missing-field reasons) | **Done** (`1c8b756`) — QA **5.2b: 9/9 pass** |
| 4 | Empirical recs fully validated in production | **DEFERRED** — owner has no Niche Zero hardware to test against; empirical dial suggestions are implemented but **not yet validated against real use**. Confidence gate constants unchanged. |
| 5 | Final regression + browser QA (recommendations, Apply, recipe edits, grinder switching, safe fallbacks) | **Pending** — full regression + browser QA before merge |
| 6 | Document completion (validated behaviour, limitations, test results) | **Done** (this document, ticket **5.2e**) |

## Follow-ups completed (post–5.2b)

| Ticket | Commit | Summary |
|--------|--------|---------|
| **5.2c** | `7b7e0cc` | Grinder switch-back restores correct dial state; taste label **Balanced** end-to-end; legacy `good` taste values still read as balanced (no data migration). |
| **5.2d** | `7ef3ee3` | **Apply** recommendation persists pending dial for the **session** (per bean + grinder until a shot is logged); CSV **Rec Followed** exports **N/A** when no prior recommendation (no history rewrite). |
| Lockfile | `9697322` | Revert unrelated `package-lock.json` libc churn. |
| **5.2f** | (this ticket) | User-facing shot counts use **logged** bean+grinder+recipe totals (5.2b funnel rules); in-progress pull still included in compact eligibility suffix only. Flair **Pressure lab** gated by `VITE_ENABLE_PRESSURE_LAB` (default off). Re-excluding a shot keeps prior `knownIssueReason`. |

## Confirmed defects fixed (5.2b)

QA tier **5.2b**: **9/9 pass**.

| ID | Issue | Resolution |
|----|--------|------------|
| **G2** | Fast/slow shots excluded because **actual yield** was compared to recipe target instead of **saved shot targets** | Shots with full saved `targetDoseG` / `targetYieldG` / `targetTimeMinS` / `targetTimeMaxS` match on those fields only; actual dose/yield no longer gate comparability |
| **G3** | Missing `actualDoseG` / `actualYieldG` treated as `0` and silently excluded | Legacy shots without saved targets require actuals; exclusion reason `missing_comparability_fields` in diagnostics |
| **G5** | `shotMatchesGrinderForLearning` vs strict `grinderModel ===` in App / initial grind | Single helper `shotMatchesGrinderForLearning` in `grinderLearningMatch.js`, used in App and `grinderLogic` |

## Not treated as product defects

| ID | Decision |
|----|----------|
| **G4** | Flair: when Flair is enabled and the recipe has a profile, shots without `flairProfile` are **intentionally** excluded; reported as `missing_flair_profile` in diagnostics |
| **G6** | Recipe edit: strict equality on saved target time windows **preserved** (recipe isolation); diagnostics surface `recipe_time_changed` |

## Comparability rules (summary)

- **Grinder**: Shot must match active grinder via `shotMatchesGrinderForLearning`. Legacy empty `grinderModel` counts only for Sette, never for Niche.
- **Learning opt-out**: `excludeFromLearning === true` → `excluded_from_learning`.
- **Recipe**:
  - **Saved target context** on shot (all four target fields): match current recipe on those targets (±0.01 g for dose/yield; exact seconds for time window).
  - **Legacy** (no full saved context): require `actualDoseG` / `actualYieldG` within ±0.5 g / ±1.5 g of recipe targets, plus partial saved-target checks when present.
- **Flair** (when enabled): shot must carry matching `flairProfile`.
- **Dial/time for learning points**: parseable `nicheZeroSetting` and finite `actualTimeS` (or legacy `actualTime`).

Confidence gate constants (`NICHE_LEARNING_MIN_OBSERVATIONS`, `MIN_PAIRS`, `MIN_SETTING_SPREAD`, residual/plausibility limits, max adjustment) are **unchanged**.

## Known limitations

- Diagnostics depend on shot records including saved recipe context (post–target-context logging); very old shots without actuals or saved targets cannot enter learning.
- **Empirical dial recommendations (item 4)** are not field-validated on real Niche Zero hardware; timing-bounded and qualitative fallbacks still apply when gates fail. When empirical mode is active, the Dial-in UI shows `nicheEmpiricalValidationNote` (“Personalised estimate from your shots, not yet validated against real-world use.”). `nicheLearningNote` still explains when numeric learning is inactive.
- **Fresh-bean copy**: when there are no shots on this bean but a starting dial is seeded from roast class + age, the UI can still show **“Based on previous bean history”** even though the seed is roast-baseline logic, not this bean’s shot log.
- **Pending dial after Apply** is **session-only** (in-memory per bean + grinder); it is not persisted across reloads until the user logs a shot with that grind.
- Sette/Sunbeam recommendation math unchanged; only shared recipe/grinder matching helpers are shared.
- **Pressure lab** (WIP): off in production builds unless preview sets `VITE_ENABLE_PRESSURE_LAB=true` in Vercel env for that environment; deep links to `#/flair-pressure-lab` are ignored when the flag is off.

## Test results (5.2e + empirical validation label)

| Check | Result |
|-------|--------|
| `npm test` | Pass |
| `npm run build` | Pass |
| Engine snapshots (`src/grinders/snapshots/engineSnapshots.json`) | **190** unchanged (no snapshot `reason` fields affected; Niche empirical paths are not in the golden suite) |
| ESLint | **31** warnings (baseline) |

Browser QA for item 5 remains outstanding before merge.
