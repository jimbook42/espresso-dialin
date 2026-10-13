# Niche Zero learning roadmap

Branch: `refactor/device-architecture`. Definition of done: learning eligibility is explainable per bean/recipe/grinder, valid comparable shots are not silently dropped, and confidence gates stay unchanged.

## Roadmap items

| # | Item | Status |
|---|------|--------|
| 1 | Fresh Niche espresso start at dial **15** labelled **app default** (not from shot history); no cross-grinder bleed | **Verified** (unit tests) |
| 2 | Reason-coded `nicheLearningNote` + structured `nicheEligibility` on all non-empirical recommendation paths | **Done** |
| 3 | Evidence-filtering fixes (recipe comparability, grinder filter, missing-field reasons) | **Done** (see defects below) |
| 4 | Empirical recs fully validated in production | **Not validated** — empirical suggestions remain labelled; timing-bounded / qualitative paths still used when gates fail |
| 5 | Final regression + browser QA (recommendations, Apply, recipe edits, grinder switching, safe fallbacks) | **In progress** — automated tests green; manual Dial-in QA on preview |
| 6 | Document completion (validated behaviour, limitations, test results) | **In progress** — this file + unit/snapshot coverage; item 4 empirical still not field-validated |

## Confirmed defects fixed (5.2b)

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
- Empirical mode (item 4) is not field-validated; notes still explain when numeric learning is inactive.
- Sette/Sunbeam recommendation math unchanged; only shared recipe/grinder matching helpers are shared.
