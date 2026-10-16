# Video path — clip 20261015_225219, frame index 9 (t ≈ 0.31 s)

Replay build only. Numbers are from the live `#/flair-pressure-lab` pipeline on the Y4M fake camera, compared with `debug-candidates.mjs` on the ffmpeg frame at the same index. No image was stored or sent; the trace is centres, radii, and scores.

## What is not the bug

| Check | Live value |
| --- | --- |
| `video.videoWidth` × `video.videoHeight` | 406 × 720 |
| `track.getSettings()` | 406 × 720 |
| `devicePixelRatio` | 1 |
| Preview element CSS box | 333 × 444 (layout only) |
| Rotation | none |

`drawImage(video)` uses the video frame, not the CSS box. The bitmap is not letterboxed or stretched. The file, the capture track, and `videoWidth`/`videoHeight` are the same 406 × 720 frame.

## Where coordinates diverged

`readTrackedGauge` drew the video into a processing canvas whose short side was 280 (scale 0.69, canvas 280 × 497), then ran `discoverGaugeInFrame`. That function returns centres in the **input image**, which was the canvas, not the video. The tracker was seeded with those canvas pixels as if they were video pixels, and discovery did not run again.

On that first live frame:

| Space | Centre | Radius |
| --- | ---: | ---: |
| Discovery in the 280 × 497 canvas | (89.2, 345.9) | 60.0 |
| Same point mapped back to 406 × 720 | (129.3, 501.0) | 87.0 |
| Value actually seeded | (89.2, 345.9) | 60.0 |
| `debug-candidates.mjs` on extracted frame 10 (full 406 × 720) | (231.7, 354.5) | 51.2 |

The seeded pose never moved (tracker stayed in `searching` on that circle). That is the PM lock near x ≈ 85–90. It is the unmapped canvas coordinate, not a second detector and not a centre-of-frame default.

The 280px bilinear shrink also changed the winner. Probing the same live pixels at full resolution ranks the dial first. The 280px image often ranked a different circle (lamp / body) first, so mapping the 280px result back to video pixels would still have been the wrong object.

## Second miss on the full frame

After drawing the full 406 × 720 frame (scale 1), the live top candidate is the dial but its canonical score sits just under the 0.28 gate:

| Candidate | Centre | Radius | Rank | Canonical | Verified |
| --- | ---: | ---: | ---: | ---: | --- |
| Dial (best rank) | (235.4, 350.8) | 56.1 | 18.15 | 0.27 | no |
| Weaker circle | (71.6, 393.6) | 18.0 | 13.27 | 0.32 | yes |

The old picker kept any verified circle, so the weaker one was seeded. Still-frame discovery on the extracted frame ranks the same dial first and, on that decode, clears the gate (canonical 0.286, centre (237.3, 347.0), radius 55.8). The live score flickers around 0.25–0.29 from frame to frame. The dial stays rank 1.

## Fix

- Discovery runs on the full video frame. `discoverGaugeInFrame` still downscales internally and returns coordinates in that frame. `mapCanvasDiscoveryToVideo` maps them into video pixels (identity when the canvas is the video).
- A weaker verified circle cannot replace a clearly stronger circle (rank at least 1.25×) that is close to the canonical gate (at least 90% of the minimum) and already passes the dial-face score. Otherwise the frame is skipped and discovery tries again.
- When OpenCV is loaded, a rejected frame does not fall through to the grid search.
- Minimum discovery radius is 3% of the short side (was 5.5%). Maximum stays 50%.

After the fix, the same clip seeds (235.4, 350.8) radius 56.1 and the tracker holds about x 232–236, y 349–351, dial-face score about 0.38–0.41. That matches the still-frame dial within a few pixels.

## Phone speed

Locked frames confirm the rim at the current pose instead of searching the whole window, and two of every three of those frames reuse the last needle reading. Discovery stays on the full video frame, only when the pose is due for a re-check, and a farther circle does not replace a pose that still verifies.

Measured on `20261015_225219` (CDP `Emulation.setCPUThrottlingRate` 4). The centre stayed on the dial (x 232–237, y 345–354) for all 184 frames.

| | Median | p95 |
| --- | ---: | ---: |
| Normal | 3.9 ms | 48.6 ms |
| 4× CPU | 14.4 ms | 198.5 ms |

The 4× median is under the 33 ms target. The p95 is a full-frame re-detect.
