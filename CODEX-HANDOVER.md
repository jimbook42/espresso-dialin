# Wrong-ray repair handover

Branch fix/pressure-wrong-ray from main f3e3db1 /v4.13.26. Local dependency junction safely unlinked (target preserved); npm ci succeeded into this checkout.

## Step 1 complete
- Optional third diagnostics argument to readCalibratedFrame records raw detector, hint, template result and selected source, without changing outputs.
- scripts/pressure-diagnostics/wrongRayReplay.mjs replays real clips through unchanged calibration/registration/publisher; asserts saved baseline bar/fresh/held equivalence per frame.
- Targeted: 41/41 pass. 094055 435 frames +130022 400 frames reproduce baseline exactly (835/835 verified).
- 094055 @19: detector277.436°, quality.7302, bar.026808; @40 detector106.001°, peak0/margin0 but quality boosted to.18, publisher holds .056692 vs fresh candidate7.882643.
- 130022 @25.25: detector279.392° off arc; template85.164°, corr.927 ->7.686812. @25 label uses this fresh-display window; truth6.61.
- Logs ignored under out/wrong-ray-step1-*. No official exam run.

## Next / mandatory stop
Step 2: independent bounded-offset pointer evidence and tests, standalone diagnostic replay all12 clips (own candidate tracking/publisher state; existing pose/calibration/map/endpoint unchanged). Verify baseline adapter before reporting new results. Update docs/pressure-wrong-ray-2026-11-02.md and this handover; commit/push validated step2, then STOP before production integration. Do not import new candidate reader in production. Any unexpected non-env test failure stops for reporting. The local stash f96c56e remains untouched. No main edits/merge/deploy.
