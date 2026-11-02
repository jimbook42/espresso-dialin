# Wrong-ray production integration handover — complete / stopped

Branch fix/pressure-wrong-ray; final commit requested message fix(pressure): integrate pointer identity. Integration built on8ca8caa, from main f3e3db1 /v4.13.26. No main merge/push/deploy.

## Completed
- Shared pointerEvidence geometry now drives nonlegacy production measurement/recovery with rayAngleDeg. No unverified template fallback may override ambiguous direction. Calibration/legacy factory, taps/zero, registration, endpoint and pressure thresholds/frozen config unchanged.
- Only verified on-domain/endpoint-safe rays update tracking hint; only valid pressure updates lastGoodBar. Duplicates explicitly clear pointerVerified. Uncertain candidates retain existing450ms hold/gap, held samples excluded from confident curve.
- Same-captured-frame model corroboration uses read.pointerVerified and measured ray with unchanged5-degree agreement; no confidence/pose/timestamp threshold changes. Legacy path retained.
- State regression added: verified candidate can update hint/pressure; duplicate and ambiguous candidates cannot. No existing test weakened.

## Validation and final single live exam
- Targeted54/54 pass. Full npm run test:vitest452 passed,2 known Python-dependent failures,1 skipped (455); files85 passed,3 failed,1 skipped (89). Only known temporalReplay box-only fixture suite error in addition to Python pair. Build passed including PWA generation; existing chunk warnings.
- Exact unchanged requested live exam ran ONCE. Runtime hashes snapshot before run and verified after: out/wrong-ray-integration-source-hashes.json. No code change/tuning/rerun during/after run.
- All3961 live frame bar/fresh/held outputs match corrected standalone replay within1e-9. Official summary counts/medians/high flags reconciled with observer output.
- Live coverage94.445847% =83.236556fresh +11.209291held;5.554153%gaps. 3297fresh+444held+220gaps=3961. Median.112831743 bar;47/53 within.3;0%>1; worst+.904146 on094055@11s;0false10 (0fresh/0held).
- 094055@19:5.654830 held/uncertain vs5.972936 (-.318106);@40:5.055815 fresh vs5.404496 (-.348682). 130022@25 unchanged fresh-display window6.651306 vs6.61 (+.041306).
- Meets Isaac's revised acceptance:coverage>=90,median<=~.115 given0%>1,0false10. No sharp regression from diagnostic replay.

## Artifacts / risks / resume
- docs/pressure-wrong-ray-2026-11-02.md: integration report, all12 baseline/replay/live tables and requested points. -results.json: exact per-clip/hit/fresh-held data, source hashes, replayAgreement. Reproducible report script scripts/pressure-diagnostics/reportPointerIntegration.mjs.
- Original preintegration report/replay and old official outputs preserved ignored out/wrong-ray-before-production; prior bias diagnostics under out/wrong-ray-before-bias. Raw integration logs out/wrong-ray-integration-*.txt.
- Risks: no new phone/hardware latency benchmark; multiple direction/offset search CPU cost unverified on phone. Unchanged exam's private model sampler is canonical/unregistered, so primarily tests pointer reading; actual asynchronous ONNX corroboration not newly browser-verified. Inherited calibration inconsistency remains094055 residual-error risk. Sparse labels do not establish every frame's true pressure.
- Original abandoned step3 stash f96c56e321de594495d8a7ab2b6561effd6b83f1 remains preserved/unapplied.
- STOP as requested. Branch ready for Isaac review of this experimental integration; do not merge/deploy or rerun/tune without new direction. Keep handover for review context. No retraining, schema/data/auth/privacy, dependency/version or protected exam/scoring/fixture changes.
