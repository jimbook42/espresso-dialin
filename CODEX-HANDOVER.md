# Endpoint guard wide-arc repair handover

Branch feat/pressure-accuracy-p2-endpoint. Prior evaluated endpoint-only HEAD: 5f8bdd2. Latest main fetched; 5628c33 remains ancestor.

## Completed fix
- endpointIsResolved now takes calibrated zero and ten. It first verifies the candidate angle lies on the directed zero-to-ten arc, then uses absolute angular distance to ten against pixel-derived uncertainty. This handles near-zero rays on >180° arcs while still rejecting points past ten and ambiguous readings at ten.
- Added regression on saved 225219 geometry: zero321.254°, ten144.025°, nearzero321.741°; the arc is >180°, valid ray is resolved. Keeps 160931 endpoint overshoot/uncertainty test.
- Targeted endpoint + tap calibration tests: 41/41 pass.
- Full Vitest: 445 passed, 2 documented Python-dependent failures, 1 skipped /448 tests; files84 passed, 3 failed, 1 skipped /88. TemporalReplay missing box-only raw-frames fixture. Production build passed.

## Remaining
- Run the unchanged live exam once on this code. Preserve the prior 5f8bdd2 exam outputs first, then report baseline / beb8473 / now per-clip coverage fresh/held/gaps, median, within .3, worst, >1%, false10. Focus 225219 and ensure false-ten stays zero. Do not rerun.
- Commit the new runtime/test fix before the final exam (targeted and full tests/build validated), then record final exam and push. No merge/deploy. No other runtime changes after exam starts.
