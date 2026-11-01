# AGENTS.md — espresso-dialin (jimbook42/espresso-dialin)

## Project
- Espresso Dial-In PWA: React 19 + Vite, Dexie (IndexedDB), Tailwind, deployed on Vercel (project `espresso-dialin`, team jimbook).
- Pressure lab: OpenCV gauge discovery + ONNX needle reader on 64x64 crops + tap calibration. Lives in `src/flairPressureLab/`, behind the `VITE_ENABLE_PRESSURE_LAB` flag. Reader scripts: `scripts/needle-reader/`.
- Live: v4.13.22 on `main` (3cf27e9). Note: the GitHub default branch is `master` (stale); always work from `main`. Create a new branch off `main` for each ticket, named in the prompt.
- Version lives in `package.json` `version`. Bump it only when the prompt says so.

## Commands (run from repo root)
- Install: `npm ci`
- Unit tests: `npm run test:vitest` (main suite). Known environment-only failures on Isaac's PC: the 2 needle-reader tests that need Python, and the temporal replay suite that needs `/workspace/.../raw-frames.json` (box-only). These do NOT count as failures: if everything else passes and the build passes, treat tests as green and carry on (merge/deploy if the prompt says so). Any other failure is real: stop and report. Never delete or skip tests to get green.
- Legacy tests: `npm test`
- Lint: `npm run lint`
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
