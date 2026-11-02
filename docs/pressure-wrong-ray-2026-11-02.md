# Wrong-ray pre-integration checkpoint — 2 November 2026

Branch fix/pressure-wrong-ray, from main f3e3db1 / v4.13.26. Step1 commit968e8bf adds non-invasive source diagnostics. Step2 candidate commit a41960b is experimental, not imported by production. Production bar mapping, calibration, registration, endpoint protection and publisher are unchanged. The step3 stash remains untouched.

**Do not integrate this candidate yet.** The requested two tests pass and the
three named misses improve, but the whole-set median worsens from 0.100191 to
0.192689 and within-0.3 comparisons fall from45/54 to34/53. This fails the
approved acceptance criteria despite better coverage and fewer extreme errors.
All replay results are retained; no second algorithm attempt followed them.

| Checkpoint | Baseline | Candidate diagnostic | Truth | Candidate error/state |
| --- | ---: | ---: | ---: | --- |
| 094055 @19s | 0.026808 | 5.360987 | 5.972936 | -0.611949; held, uncertain direction |
| 094055 @40s | 0.056692 | 4.781597 | 5.404496 | -0.622899; fresh |
| 130022 @25s display window | 7.686812 | 6.651306 | 6.610000 | +0.041306; fresh-derived |

130022's actual25.25s candidate sample is6.931470 fresh; its25s reported
comparison above uses the unchanged ±0.3s fresh-display-window procedure.
Production remains on its original path. Candidate and production numbers must
not be confused.

## Single correction and tests

The initial candidate favored offset/tilted lines and falsely preferred a direction on symmetric shafts. The single authorized correction includes transverse dark-ridge centroid residual in candidate ranking. No test or pressure threshold was weakened. Targeted run: **45/45 passed** (4 experimental evidence,37 calibration,4 endpoint). Pivot error remains<3 degrees; broad-tail pointer error now<3 degrees; equal-end shaft returns uncertainty. npm ci succeeded with local dependencies; the original shared junction target was preserved. No full suite/build/new official exam at this pre-integration checkpoint.

## Diagnostic replay (not an exam)

All12 real clips replayed. **3961/3961** production baseline frames exactly match saved bar/fresh/held outputs. The standalone pressure adapter additionally asserts raw-pressure equivalence frame-by-frame using existing mapper, inverse pose, endpoint check and calibration. Candidate has its own evidence and publisher state; it uses unchanged production pose/calibration only. No production integration. Candidate confidence, missing readings and pressure are never replaced by baseline values. Hand labels retain the existing fresh-display-window calculation. No label, score script, exam, fixture or frozen-config change.

Diagnostic totals: **95.81%** published (86.14 fresh /9.67 held /4.19 gaps), median **0.192689**, within.3 **34/53**, >1 bar **1.89%**, worst **1.060430 at11s**, false10 **0 (0 fresh /0 held)**. Frames3412+383+166=3961. Targets: {"coverage":true,"median":false,"wild":true,"falseTen":true}.

B=preserved v4.13.26 production baseline; D=standalone candidate diagnostic. These are not claims of production/live improvement.

| Clip | Published % B / D | Fresh % B / D | Held % B / D | Gaps % B / D | Median B / D | Within .3 B / D | Worst B / D | >1 % B / D | False10 B / D |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20261015_225219 | 81.00 / 100.00 | 64.00 / 96.00 | 17.00 / 4.00 | 19.00 / 0.00 | 0.002 / 0.143 | 1/1 / 1/1 | 0.002 / 0.143 | 0.00 / 0.00 | 0 / 0 |
| 20261015_225307 | 73.55 / 73.55 | 52.89 / 42.98 | 20.66 / 30.58 | 26.45 / 26.45 | — / — | 0/0 / 0/0 | — / — | — / — | 0 / 0 |
| 20261017_084814 | 96.58 / 97.11 | 92.89 / 93.42 | 3.68 / 3.68 | 3.42 / 2.89 | 0.138 / 0.154 | 3/4 / 3/5 | -0.302 / -0.451 | 0.00 / 0.00 | 0 / 0 |
| 20261017_084919 | 93.10 / 100.00 | 85.58 / 95.92 | 7.52 / 4.08 | 6.90 / 0.00 | 0.009 / 0.157 | 3/3 / 3/3 | 0.136 / 0.240 | 0.00 / 0.00 | 0 / 0 |
| 20261017_134943 | 95.13 / 100.00 | 85.59 / 92.16 | 9.53 / 7.84 | 4.87 / 0.00 | 0.098 / 0.280 | 4/5 / 3/5 | 0.625 / -0.385 | 0.00 / 0.00 | 0 / 0 |
| 20261017_135116 | 91.90 / 98.60 | 85.75 / 90.78 | 6.15 / 7.82 | 8.10 / 1.40 | 0.010 / 0.146 | 3/3 / 3/3 | -0.031 / -0.211 | 0.00 / 0.00 | 0 / 0 |
| 20261018_094055 | 95.17 / 97.24 | 66.21 / 85.98 | 28.97 / 11.26 | 4.83 / 2.76 | 5.348 / 0.623 | 0/3 / 0/3 | -5.946 / 1.060 | 66.67 / 33.33 | 0 / 0 |
| 20261018_094151 | 78.57 / 99.40 | 67.26 / 98.21 | 11.31 / 1.19 | 21.43 / 0.60 | 0.152 / 0.455 | 3/3 / 1/3 | 0.184 / 0.565 | 0.00 / 0.00 | 0 / 0 |
| 20261018_160844 | 90.03 / 93.36 | 76.08 / 82.06 | 13.95 / 11.30 | 9.97 / 6.64 | 0.115 / 0.603 | 3/4 / 0/4 | 0.416 / -0.637 | 0.00 / 0.00 | 0 / 0 |
| 20261018_160931 | 96.92 / 92.12 | 91.44 / 83.22 | 5.48 / 8.90 | 3.08 / 7.88 | 0.032 / 0.398 | 3/3 / 0/3 | 0.278 / 0.413 | 0.00 / 0.00 | 0 / 0 |
| 20261024_124006 | 93.96 / 91.05 | 86.58 / 74.72 | 7.38 / 16.33 | 6.04 / 8.95 | 0.079 / 0.113 | 12/12 / 11/11 | 0.231 / 0.223 | 0.00 / 0.00 | 0 / 0 |
| 20261025_130022 | 93.25 / 94.75 | 77.00 / 78.75 | 16.25 / 16.00 | 6.75 / 5.25 | 0.128 / 0.075 | 10/13 / 9/12 | 1.077 / 0.494 | 7.69 / 0.00 | 0 / 0 |

## Requested checkpoints

20261018_094055

{
  "checkpoints": [
    {
      "timeS": 19,
      "baseline": 0.026808218091805204,
      "candidate": {
        "bar": 5.360987059356033,
        "fresh": false,
        "held": true,
        "uncertain": true,
        "measuredAtMs": null,
        "reason": "held:needle-missing",
        "classicalStep": {
          "bar": 6.338197259282309,
          "needleDeg": 61,
          "published": true,
          "reason": "uncertain-hold",
          "rawBar": null,
          "spikeRejected": false
        }
      },
      "angleDeg": null,
      "decision": "ambiguous",
      "rawBar": null
    },
    {
      "timeS": 40,
      "baseline": 0.05669237133985777,
      "candidate": {
        "bar": 4.781596829840317,
        "fresh": true,
        "held": false,
        "uncertain": false,
        "measuredAtMs": 40000,
        "reason": "tap-fresh",
        "classicalStep": {
          "bar": 5.939366362430618,
          "needleDeg": 49,
          "published": true,
          "reason": "tracking",
          "rawBar": 5.803833794847561,
          "spikeRejected": false
        }
      },
      "angleDeg": 49,
      "decision": "shaft",
      "rawBar": 4.781596829840317
    }
  ],
  "scored": [
    {
      "id": "f011",
      "phase": "ramp",
      "t": 19,
      "truth": 5.972936406294782,
      "published": 5.360987059356033,
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
      "published": 4.781596829840317,
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
        "bar": 6.932867116030955,
        "fresh": false,
        "held": true,
        "uncertain": true,
        "measuredAtMs": null,
        "reason": "held:needle-missing",
        "classicalStep": {
          "bar": 6.7564783190797195,
          "needleDeg": 72,
          "published": true,
          "reason": "uncertain-hold",
          "rawBar": null,
          "spikeRejected": false
        }
      },
      "angleDeg": null,
      "decision": "ambiguous",
      "rawBar": null
    },
    {
      "timeS": 25.25,
      "baseline": 7.6868118712664675,
      "candidate": {
        "bar": 6.931470431688245,
        "fresh": true,
        "held": false,
        "uncertain": false,
        "measuredAtMs": 25250,
        "reason": "tap-fresh",
        "classicalStep": {
          "bar": 6.68955506462894,
          "needleDeg": 72,
          "published": true,
          "reason": "tracking",
          "rawBar": 6.758733360101333,
          "spikeRejected": false
        }
      },
      "angleDeg": 72,
      "decision": "shaft",
      "rawBar": 6.931470431688245
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
