# Wide-arc endpoint repair handover — complete

Branch feat/pressure-accuracy-p2-endpoint. Candidate f7914e5 based on beb8473; main 5628c33 fetched and remains ancestor.

- Repair: endpoint guard uses candidate progress on the directed calibrated zero-to-ten arc before applying pixel-derived endpoint uncertainty. Regression protects 225219's >180° near-zero ray while checking 160931 near/past ten.
- Targeted tests: 41/41 pass. Full Vitest: 445 passed, 2 documented Python-only failures, 1 skipped /448; known box-only temporal fixture also fails. Build passed.
- Unchanged live exam ran once on f7914e5. Results: 91.82025% published, 80.03030% fresh, 11.78995% held, 8.17975% gaps; 0 false-ten, median .100191 bar, 45/54 within .3, 5.55556% >1, worst -5.946128 at 094055/19s. Targets not all met.
- Full baseline/previous beb8473/now report: docs/pressure-p2-endpoint-wide-arc-2026-11-02.md and -results.json.
- Exam outputs preserved: scripts/needle-reader/out/p2-endpoint-before-widearc. Logs wide-arc-*.txt. No protected exam/scoring/threshold/fixtures/config/model edits. No merge/deploy.
- No more exam run or runtime edits in this task. Commit/push completed fix and report, then stop.
