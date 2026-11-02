# Wrong-ray pre-integration checkpoint — 2 November 2026

Branch fix/pressure-wrong-ray, from main f3e3db1 / v4.13.26. Step1 commit968e8bf adds non-invasive source diagnostics. Step2 candidate commit a41960b plus bias correction296b201 are experimental, not imported by production. Production bar mapping, calibration, registration, endpoint protection and publisher are unchanged. The step3 stash remains untouched.

**All targets are not yet met; do not integrate.** The geometric correction
reduces median error0.192689→0.112832 and improves within0.3 from34/53→47/53.
Coverage94.445847%, >1-bar errors0%, and false-ten flags0 meet their targets,
but median remains above0.100191. No further tuning followed this replay.

## Bias diagnosis and geometric correction

There is no single low-reading offset:160844's previous signed median error
was−0.603bar while160931's was+0.398bar. Among3313 comparisons with both
directions present and less than30° separation, Pearson correlation between
shaft-minus-baseline angle and fitted offset/radius is **−0.912507**. This
direction filter is only for diagnosis; all pressure metrics use all labels.

The pressure adapter was interpreting an offset shaft's orientation as a ray
through the user's hub. The correction preserves the orientation API and
projects the observed tip in that hub's coordinates:
`ray = shaft + atan2(lateralOffset, observedAlongReach)`.
Reach is measured from the fitted coherent endpoint at the existing radial
sample positions; no bar offset, fixed angular correction, calibration change,
or threshold tuning is used. The same3313-comparison cohort's median absolute
angle disagreement with baseline falls **2.626°→0.705°**. This diagnoses a
coordinate mismatch; baseline angles are not treated as ground-truth labels.

| Requested comparison | Original production | Previous candidate | Corrected diagnostic | Truth / state |
| --- | ---: | ---: | ---: | --- |
| 094055 @19s | 0.026808 | 5.360987 | 5.654830 | 5.972936; held/uncertain, error−0.318106 |
| 094055 @40s | 0.056692 | 4.781597 | 5.055815 | 5.404496; fresh, error−0.348682 |
| 130022 @25s display window | 7.686812 | 6.651306 | 6.651306 | 6.610000; fresh-derived, error+0.041306 |

130022's25.25s actual sample is now6.759217 fresh. The25s comparison uses the
existing fresh-display-window procedure. The named gains are preserved, but
094055 retains residual error and its baseline calibration inconsistency.
Worst corrected error is+0.904146 on094055@11s. Residual fit precision,
coherent endpoint localization and calibration compatibility are not fully
resolved; their individual contributions are unverified. They are not grounds
to tune a pressure correction to these labels.

## Single correction and tests

The initial candidate favored offset/tilted lines and falsely preferred a direction on symmetric shafts. The single authorized correction includes transverse dark-ridge centroid residual in candidate ranking. The later bias correction retains shaft orientation but supplies a separate hub-to-measured-tip ray for pressure mapping, using fitted offset and measured radial reach. No calibration, test or pressure threshold was changed. Targeted correction run: **47/47 passed** (6 experimental evidence,37 calibration,4 endpoint). Existing45 tests unchanged; two geometric projection regressions added. Pivot error remains<3 degrees; broad-tail pointer error now<3 degrees; equal-end shaft returns uncertainty. npm ci succeeded with local dependencies; the original shared junction target was preserved. No full suite/build/new official exam at this pre-integration checkpoint.

## Diagnostic replay (not an exam)

All12 real clips replayed. **3961/3961** production baseline frames exactly match saved bar/fresh/held outputs. The standalone pressure adapter additionally asserts raw-pressure equivalence frame-by-frame using existing mapper, inverse pose, endpoint check and calibration. Candidate has its own evidence and publisher state; it uses unchanged production pose/calibration only. No production integration. Candidate confidence, missing readings and pressure are never replaced by baseline values. Hand labels retain the existing fresh-display-window calculation. No label, score script, exam, fixture or frozen-config change.

Diagnostic totals: **94.45%** published (83.24 fresh /11.21 held /5.55 gaps), median **0.112832**, within.3 **47/53**, >1 bar **0.00%**, worst **0.904146 at11s**, false10 **0 (0 fresh /0 held)**. Frames3297+444+220=3961. Targets: {"coverage":true,"median":false,"wild":true,"falseTen":true}.

B=preserved v4.13.26 production baseline; P=previous step2 candidate; D=geometrically corrected standalone candidate diagnostic. These are not claims of production/live improvement.

| Clip | Published % B / P / D | Fresh % B / P / D | Held % B / P / D | Gaps % B / P / D | Median B / P / D | Within .3 B / P / D | Worst B / P / D | >1 % B / P / D | False10 B / P / D |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20261015_225219 | 81.00 / 100.00 / 100.00 | 64.00 / 96.00 / 96.00 | 17.00 / 4.00 / 4.00 | 19.00 / 0.00 / 0.00 | 0.002 / 0.143 / 0.043 | 1/1 / 1/1 / 1/1 | 0.002 / 0.143 / 0.043 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261015_225307 | 73.55 / 73.55 / 74.38 | 52.89 / 42.98 / 46.28 | 20.66 / 30.58 / 28.10 | 26.45 / 26.45 / 25.62 | — / — / — | 0/0 / 0/0 / 0/0 | — / — / — | — / — / — | 0 / 0 / 0 |
| 20261017_084814 | 96.58 / 97.11 / 97.11 | 92.89 / 93.42 / 93.42 | 3.68 / 3.68 / 3.68 | 3.42 / 2.89 / 2.89 | 0.138 / 0.154 / 0.138 | 3/4 / 3/5 / 4/5 | -0.302 / -0.451 / -0.361 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_084919 | 93.10 / 100.00 / 97.81 | 85.58 / 95.92 / 90.60 | 7.52 / 4.08 / 7.21 | 6.90 / 0.00 / 2.19 | 0.009 / 0.157 / 0.058 | 3/3 / 3/3 / 3/3 | 0.136 / 0.240 / 0.154 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_134943 | 95.13 / 100.00 / 96.40 | 85.59 / 92.16 / 85.17 | 9.53 / 7.84 / 11.23 | 4.87 / 0.00 / 3.60 | 0.098 / 0.280 / 0.168 | 4/5 / 3/5 / 5/5 | 0.625 / -0.385 / -0.274 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_135116 | 91.90 / 98.60 / 94.69 | 85.75 / 90.78 / 87.15 | 6.15 / 7.82 / 7.54 | 8.10 / 1.40 / 5.31 | 0.010 / 0.146 / 0.044 | 3/3 / 3/3 / 3/3 | -0.031 / -0.211 / -0.060 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_094055 | 95.17 / 97.24 / 97.70 | 66.21 / 85.98 / 85.52 | 28.97 / 11.26 / 12.18 | 4.83 / 2.76 / 2.30 | 5.348 / 0.623 / 0.349 | 0/3 / 0/3 / 0/3 | -5.946 / 1.060 / 0.904 | 66.67 / 33.33 / 0.00 | 0 / 0 / 0 |
| 20261018_094151 | 78.57 / 99.40 / 96.13 | 67.26 / 98.21 / 84.82 | 11.31 / 1.19 / 11.31 | 21.43 / 0.60 / 3.87 | 0.152 / 0.455 / 0.200 | 3/3 / 1/3 / 3/3 | 0.184 / 0.565 / 0.268 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_160844 | 90.03 / 93.36 / 89.37 | 76.08 / 82.06 / 80.07 | 13.95 / 11.30 / 9.30 | 9.97 / 6.64 / 10.63 | 0.115 / 0.603 / 0.183 | 3/4 / 0/4 / 4/4 | 0.416 / -0.637 / -0.224 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_160931 | 96.92 / 92.12 / 90.75 | 91.44 / 83.22 / 80.82 | 5.48 / 8.90 / 9.93 | 3.08 / 7.88 / 9.25 | 0.032 / 0.398 / 0.112 | 3/3 / 0/3 / 2/3 | 0.278 / 0.413 / 0.307 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261024_124006 | 93.96 / 91.05 / 92.84 | 86.58 / 74.72 / 76.06 | 7.38 / 16.33 / 16.78 | 6.04 / 8.95 / 7.16 | 0.079 / 0.113 / 0.113 | 12/12 / 11/11 / 11/11 | 0.231 / 0.223 / 0.223 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261025_130022 | 93.25 / 94.75 / 94.75 | 77.00 / 78.75 / 78.25 | 16.25 / 16.00 / 16.50 | 6.75 / 5.25 / 5.25 | 0.128 / 0.075 / 0.091 | 10/13 / 9/12 / 11/12 | 1.077 / 0.494 / 0.397 | 7.69 / 0.00 / 0.00 | 0 / 0 / 0 |

## Requested checkpoints

20261018_094055

{
  "checkpoints": [
    {
      "timeS": 19,
      "baseline": 0.026808218091805204,
      "candidate": {
        "bar": 5.654830016349084,
        "fresh": false,
        "held": true,
        "uncertain": true,
        "measuredAtMs": null,
        "reason": "held:needle-missing",
        "classicalStep": {
          "bar": 6.565337835511741,
          "needleDeg": 66.17979551093492,
          "published": true,
          "reason": "uncertain-hold",
          "rawBar": null,
          "spikeRejected": false
        }
      },
      "axisAngleDeg": null,
      "rayAngleDeg": null,
      "decision": "ambiguous",
      "rawBar": null
    },
    {
      "timeS": 40,
      "baseline": 0.05669237133985777,
      "candidate": {
        "bar": 5.055814685235514,
        "fresh": true,
        "held": false,
        "uncertain": false,
        "measuredAtMs": 40000,
        "reason": "tap-fresh",
        "classicalStep": {
          "bar": null,
          "needleDeg": 55.84154002825164,
          "published": false,
          "reason": "spike-reject",
          "rawBar": null,
          "spikeRejected": true
        }
      },
      "axisAngleDeg": 49,
      "rayAngleDeg": 55.84154002825164,
      "decision": "shaft",
      "rawBar": 5.055814685235514
    }
  ],
  "scored": [
    {
      "id": "f011",
      "phase": "ramp",
      "t": 19,
      "truth": 5.972936406294782,
      "published": 5.654830016349084,
      "display": 0.027802019994949616,
      "reason": "held:needle-missing",
      "hubPx": 9.203688296382703,
      "r5Bar": 0,
      "classicalBar": 0.026808218091805204,
      "r6Bar": 0,
      "needleErr": 81.18054160360845
    },
    {
      "id": "f033",
      "phase": "taper",
      "t": 40,
      "truth": 5.404496304798196,
      "published": 5.055814685235514,
      "display": 0.024754110648302397,
      "reason": "tap-fresh",
      "hubPx": 10.273747403802508,
      "r5Bar": 0.07511565353648204,
      "classicalBar": 7.882642721114219,
      "r6Bar": null,
      "needleErr": 95.3678766875235
    }
  ]
}

20261025_130022

{
  "checkpoints": [
    {
      "timeS": 25,
      "baseline": 6.769574942489873,
      "candidate": {
        "bar": 6.572410503227031,
        "fresh": false,
        "held": true,
        "uncertain": true,
        "measuredAtMs": null,
        "reason": "held:needle-missing",
        "classicalStep": {
          "bar": 6.382696952286832,
          "needleDeg": 65.75979175428017,
          "published": true,
          "reason": "uncertain-hold",
          "rawBar": null,
          "spikeRejected": false
        }
      },
      "axisAngleDeg": null,
      "rayAngleDeg": null,
      "decision": "ambiguous",
      "rawBar": null
    },
    {
      "timeS": 25.25,
      "baseline": 7.6868118712664675,
      "candidate": {
        "bar": 6.75921683102827,
        "fresh": true,
        "held": false,
        "uncertain": false,
        "measuredAtMs": 25250,
        "reason": "tap-fresh",
        "classicalStep": {
          "bar": 6.464589680885467,
          "needleDeg": 69.01742013095327,
          "published": true,
          "reason": "tracking",
          "rawBar": 6.580080915664669,
          "spikeRejected": false
        }
      },
      "axisAngleDeg": 72,
      "rayAngleDeg": 69.01742013095327,
      "decision": "shaft",
      "rawBar": 6.75921683102827
    }
  ],
  "scored": [
    {
      "id": "0201",
      "phase": "hand",
      "t": 25,
      "truth": 6.61,
      "published": 6.651305536045395,
      "display": 7.6868118712664675,
      "reason": "diagnostic-fresh-display",
      "hubPx": null,
      "r5Bar": null,
      "classicalBar": 7.6868118712664675,
      "r6Bar": null,
      "needleErr": null
    }
  ]
}

## Limits and stop

The candidate is a standalone experiment. Fixed baseline pose isolates pointer identity; it does not validate changed feedback in an integrated tracker. Runtime latency/phone performance and model-corroboration behavior remain unverified. Calibration zero remains the baseline zero, including 094055's inconsistent span. Diagnostic failures/gaps are retained; no tuning after historical results. Existing production hint/last-good handling is not replaced. No deploy, merge, retraining, schema/data/auth/privacy or dependency/version changes. Full suite/build and one unchanged official exam belong to a separately approved integration phase.

The12-clip checkpoint is complete. Commit/push report and harness, update handover, and STOP before integration.
