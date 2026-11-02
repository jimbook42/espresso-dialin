# Label batch 2026-11-03

This batch covers shot a1efe497-86bd-4219-bdc7-7b43623c9ef6, recorded at about 8:40am NZ on 3 Nov 2026 with v4.13.29. It has 18 frames (c001-c018) from 0.3-13.57 s, covering rest and preinfusion. Isaac tapped them on 3 Nov 2026: all 18 have hub, tip, 0, 5 and 10, and none are marked Unclear.

- `source/lab-replay-a1efe497.mp4` is the original video. `source/lab-replay-a1efe497-pressure.json` is the curve the app saved (labPressureCurve, tS and bar).
- `frames/` holds 900x900 crops zoomed to the gauge and rotated 180°, with crop parameters in `frames/manifest.json`. Display px map back to original px as: r180 gives (u,v)=(899-x,899-y), then orig=(crop.x+u/scale, crop.y+v/scale).
- `labels-merged.json` stores display (crop) px plus `orig` in upright source-frame px (720x1280, ffmpeg autorotate). `labels-orig.json` is the output of `to-orig.py`. Note that `to-orig.py` reads the manifest from a /workspace path on the box.
- Labels were rebuilt from the per-tap PLABEL runtime logs. c001 was taken from the Send-labels snapshot.
- Finding: the reader's preinfusion dips to about 0.1-0.3 bar (5.7, 6.76, 7.5, 9.96 and 10.5 s) are false. The gauge was at about 1.8-2.1 bar at those times.
