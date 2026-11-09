# AGENTS.md — espresso-dialin (jimbook42/espresso-dialin)

## Project
- Espresso Dial-In PWA: React 19 + Vite, Dexie (IndexedDB), Tailwind, deployed on Vercel (project `espresso-dialin`, team jimbook).
- Pressure lab: OpenCV gauge discovery + ONNX needle reader on 64x64 crops + tap calibration. Lives in `src/flairPressureLab/`, behind the `VITE_ENABLE_PRESSURE_LAB` flag. Reader scripts: `scripts/needle-reader/`.
- B04 audit baseline: v4.14.11 on `main` (`c2a9657`), verified on the production alias. Check the current production deployment and `origin/main` before starting a release ticket. The GitHub default branch is stale `master`; always work from `main`. Create a new branch off `main` for each ticket, named in the prompt.
- Version lives in `package.json` `version`. Bump it only when the prompt says so.

## Commands (run from repo root)
- Install: `npm ci`
- Unit tests: `npm run test:vitest` (main suite). The v4.14.11 Windows baseline passed 596 tests with 4 existing conditional skips: two Python-backed needle-reader tests and two temporal replay placeholders for missing Linux-box fixtures under `/workspace/pl-state/nr`. Report these skips separately. Any other failure is real: stop and report. Never delete or skip tests to get green.
- Legacy tests: `npm test`. Under `TZ=UTC`, v4.14.11 reproduces the existing failure in `src/flairPressureLab/gaugeConfig.test.js:742`. The B03 release exception applied only to v4.14.11. Report the failure separately from new regressions.
- Shot browser checks: build with `VITE_ENABLE_PRESSURE_LAB=true` and `VITE_SCALE_ALLOW_SIM=true`, then run `node scripts/playwright-shot-screen-smoke.mjs` and `node scripts/playwright-shot-stop-regression.mjs`. The weighing-view smoke's direct `spawn('npm', ...)` fails with `ENOENT` on Windows. The assertions pass when its preview is launched through Node's Vite entry point.
- Lint: `npm run lint`. The B04 Windows baseline reports 12 errors and 7 warnings in `src/App.jsx`. When changing that file, compare the diagnostics with the baseline and report any new findings separately.
- Build: `npm run build`
- Pressure replay: `npm run replay:pressure`
- Live needle exam (runs on Isaac's PC): `node scripts/needle-reader/exam.mjs --live` from the repo root (Windows: no TZ prefix needed; on bash use `TZ=UTC`). It reads clips from `C:\Users\Isaac\dialin-exam-clips` (override with `DIALIN_EXAM_CLIPS`) and Isaac's WinGet ffmpeg (override with `FFMPEG`/`FFPROBE`), and writes to `scripts/needle-reader/out`. Other exam modes (`--r2`, `--models`, default) and `score_r7.mjs` hardcode Linux box paths (`/workspace/...`) and won't run on Windows; don't use them. Never edit the exam/scoring scripts, fixtures or frozen config (`r7_config`) to get a better number.

## Hard rules
1. No fake readings. Never manipulate, smooth-over, hand-pick, synthesise or hardcode pressure values, labels, clips or scores to pass a check. Report real numbers, including bad ones. Exam results are single runs: no cherry-picked reruns.
2. No schema, Dexie/DB migration, user-data, auth or privacy changes.
3. No merge to `main`, no push to `main`, no deploy/promote on Vercel without Isaac's explicit OK. Work on the branch named in the prompt.
4. Don't add production dependencies without asking.
5. Don't touch secrets or `.env*` files; never print tokens.
6. Use the model named in the prompt; if none is named, stop and ask.
7. Keep diffs small and on-task. Commit with a clear message.

## Done = report
Reply with: branch, commit hash(es), files changed, tests run with pass/fail counts, exam numbers if run (coverage, median error, worst error, false 10-bar count), what's unverified, and next step.
