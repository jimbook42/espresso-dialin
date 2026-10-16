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

## Future planned work

This section tracks approved follow-ups beyond the Niche table above. See also `docs/HANDOVER.md` for process and deploy rules.

### Flair pressure lab (feature-flagged; branches `cursor/6-29` … `cursor/6-35`, stacked, not merged to `main`)

Replay baseline and PM scoring use clips under `/workspace/flair-replay/720` (no clip names or expected values in non-test source). **0% confidently-wrong readings** remains a hard safety gate.

| Area | Status / notes |
|------|----------------|
| Harness + OpenCV path, 0–10 bar dial, worker, privacy checks | On branch stack (through **6.35** @ `2d211f2`) |
| Rotation, determinism, startup, blur | **Done** on branch (**6.34** @ `55a4b69`) |
| Glare / hard light | Tried in **6.35**; full approach reverted; pre-shot glare hint only — **more work queued** |
| **4× CPU throttle** latency on mid-tier phones | **Queued** (PM scores p95 per clip) |
| **Real-phone** test (camera path, not replay-only) | **Queued** |
| **Held-back real-shot clips** test (owner clips not all in replay suite) | **Queued** |
| **Beta label** in UI when lab is enabled for preview testers | **Queued** |
| **"Snap your gauge"** dial profiles + **other gauges** (beyond Flair 58) | **Future** |
| Difficult held-back clip accuracy (±0.5 bar still weak vs other clips) | **Open** — target 9/10 reading accuracy before ship |
| Hosted preview with visible lab entry | `qa/6-35-pressure-preview` @ `84cd36b` (env flag + link; not production) |

**Merge:** integrate stacked pressure-lab branches in order after QA; keep `VITE_ENABLE_PRESSURE_LAB` **OFF** in production until explicitly promoted.

Shot timer pressure integration (after pressure lab passes real-shot tests): live tracking status, smoothed pressure, live pressure profile, time and smart-scale weight during the shot; post-shot pressure and flow-rate graphs and stats. Storing pressure curves per shot is a data/schema change and needs Isaac's OK.

Before shot-timer pressure integration ships, plan a **combined on-phone test**: camera pressure reading + Bluetooth smart scale + shot timer running together (real phone, real shot).

### Queued v4.11.0 walkthrough polish (Isaac's rulings)

Batch UI/copy fixes from the App QA blind walkthrough (evidence screenshots: `/workspace/qa-reports/dialin-blind-2/`; PM log in the Dial-In store). Includes items deferred from earlier QA:

- Bean form **NaN** warnings on empty numeric fields; **"1 shots"** (and similar) pluralisation.
- After saving the **first bean**, stay on the current flow (no auto-jump to Brew Guide + welcome).
- Suppress **"Ready for a quicker workflow?"** right after CSV import.
- **Legacy CSV import:** backfill inferred per-shot targets (6.14 D-1).
- Import notice **doubled period**; **Apply rec** label clarity; **CSV Rec Followed** on first shots; **timer carryover**; bean-history copy (5.2c minors).
- **Yield** not prefilling from recipe on log form (if still desired); **previous-recipe** card shot-count mismatch ("Based on N").
- **Brew Guide** empty state / **"Choose a coffee"** after fresh load; welcome modal layout over tools list.
- **Settings** overlay: grinder/machine context at top (walkthrough finding).
- **Stats** timeline: target compliance / rating **N/A** where product expects a value.

### Scale / BLE

- Branch `feat/ble-scale`: Web Bluetooth (Timemore; more scales on `main`), simulated scale on Preview only. Merge per PM after pressure-lab stack.
- Protocol research: PM store `research/timemore-ble.md`.

### Multi-tab safety (follow-up)

`patchGlobalSettings` atomic merges are in App for most settings writes. **Follow-up:** audit remaining `settings.get` + `settings.put` paths (e.g. CSV import) for cross-tab lost updates until all global settings writes use the same pattern.

### Deferred (PM log / store)

- Niche item **4** (empirical recs on real hardware) — **DEFERRED** (no Niche Zero to validate against).
- Niche item **5** — full regression + browser QA still **pending** before merge.
- **Applied dial after Apply** — session-only in memory; product decision whether to persist across reload.
- Draft grinder/scale batch (**6.15**) — not on `main`; separate roadmap when approved.
- GitHub **default branch** still stale `master`; production canonical branch is **`main`** (`vercel.json` on `main` enables deploy for `main`, `master`, and `qa/*` only).
