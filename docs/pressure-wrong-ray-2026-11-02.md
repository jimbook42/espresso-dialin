# Wrong-ray diagnosis — 2 November 2026

Step 1 on fix/pressure-wrong-ray, from v4.13.26 f3e3db1. Reader behavior unchanged; optional diagnostic sink and standalone replay added. Local npm ci succeeded.

Targeted tests: 41/41 pass. Baseline replay on 094055 (435 frames) and130022 (400) exactly matched all saved bar/fresh/held observations.

094055 @19s uses direct detection (277.436°, quality.730); output.026808 vs5.972936. At40s direct detection106.001° has peak0/margin0 yet quality.18 from hub-lobe promotion. Its7.882643 candidate is rate-rejected, holding earlier.056692 vs5.404496. 130022 @25s label error comes from25.25s template recovery85.164°/corr.927, output7.686812 vs6.61.

Next: independent pointer evidence, all12 standalone diagnostic replays and checkpoint report. No integration or new official exam at this checkpoint. Current official baseline remains91.82% coverage, .100191 median,45/54 within.3,5.56% >1,0 false10.
