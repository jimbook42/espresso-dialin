# B04 pressure tracker performance and stability

Baseline v4.14.11, commit `c2a9657f79d8adecba92396327c69231a248d760`.

## What the live path does

- The shot reader observes presented camera frames and takes up to one processing slot per 125 ms. It rejects unchanged or absent pixels. The calibrated reader and its local OpenCV tracking and reacquisition run on the main thread. The Pressure Lab has a separate discovery worker with a latest-frame mailbox, so its worker timings do not describe calibrated shots.
- ONNX runs on demand for a usable registered crop, with one inference in flight. The cached 64 × 64 model uses single-threaded WASM without a proxy worker. A generation guard ignores stale results. The classical reader and confidence gates still apply if the model is unavailable.
- The reader publishes pressure, hold and preview state at bounded rates. Pressure and flow SVGs derive their paths from the current samples. Scale state follows notifications. B01 derives elapsed time from a monotonic clock, B02 handles visibility and camera interruption, and B03 freezes and saves the correct extraction time across scale gaps.
- One owner supplies the camera stream to the preview, calibration and recorder. Hidden documents suppress reader processing. Camera ownership ends when the relevant UI closes. The replay recorder shares the stream and encodes at a target 1.2 Mb/s with a 90 s cap. The replay store retains the latest clip.

## Desktop baseline

Windows Chromium on an Intel i7-3770, running a production-mode harness with the actual shot reader, replay hook and charts. The harness played an unmodified 38.16 s phone export on a loop and used its exported calibration. A 10 Hz synthetic scale feed drove the charts. Three shots ran in one page and each stopped and released the camera before the next. Local exam or test work overlapped parts of the run, so small differences in elapsed performance are inconclusive.

| Shot | Reader slot median / P95 | ONNX call median / P95 | Confident reads/s | Long tasks ≥50 ms | React commits/s | JS heap before / active / stopped |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 s | 142 / 188 ms | 152 / 188 ms | 5.49 | 171 | 7.60 | 18.2 / 19.9 / 19.7 MB |
| 90 s | 139 / 202 ms | 144 / 211 ms | 4.88 | 493 | 8.09 | 19.7 / 21.3 / 20.5 MB |
| 125 s | 160 / 226 ms | 159 / 234 ms | 3.88 | 566 | 7.25 | 20.5 / 22.4 / 20.7 MB |

Reader slot time is synchronous work from the animation callback to the replay observer. ONNX call latency is wall time and can overlap subsequent slots. Renderer task time was 26.8, 78.0 and 107.1 s. That metric covers scheduled renderer work and is separate from whole-browser CPU utilisation. Heap is post-GC JavaScript heap and excludes native camera buffers, WASM and encoder memory. The harness observed one live track in each shot and zero after each stop.

## Replay defect

The 30 s shot stored a 660,388-byte video. After the 90 s and 125 s shots, the replay store still returned that same clip. The cap stopped the encoder, but the later shot stop discarded its buffered chunks because the recorder was already inactive. A second regression test showed that a new recording could overwrite the finalizing recording's dimensions and start time.

The repair attaches finalization handlers when recording starts and keeps the result with that recording until the shot retrieves or discards it. Encoder settings and the 90 s cap stay the same.

| Shot | Baseline saved replay | Candidate saved replay |
| --- | --- | --- |
| 30 s | New clip, 660,388 bytes | New clip, 634,434 bytes |
| 90 s | Previous clip | New 90 s clip, 1,725,825 bytes |
| 125 s | Previous clip | New 90 s clip, 1,928,421 bytes |

## Candidate desktop comparison

| Shot | Reader slot median / P95 | ONNX call median / P95 | Confident reads/s | Long tasks ≥50 ms | React commits/s | JS heap before / active / stopped |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 s | 151 / 211 ms | 156 / 220 ms | 4.93 | 151 | 7.64 | 18.2 / 20.0 / 19.7 MB |
| 90 s | 146 / 192 ms | 155 / 213 ms | 5.10 | 531 | 7.14 | 19.7 / 21.2 / 20.5 MB |
| 125 s | 151 / 207 ms | 156 / 215 ms | 4.32 | 645 | 7.50 | 20.4 / 21.6 / 20.7 MB |

Renderer task time was 26.0, 83.9 and 109.8 s. One camera track ran per shot, zero after Stop. The recorder was inactive by the 90 s cap. The browser tests show a retention fix, with no consistent speed improvement and no large retained JavaScript heap increase across the three shots.

A supplemental 30 s Chromium process measurement totalled 36.15 CPU-seconds over 30.87 s on the baseline and 34.93 over 30.68 s on the candidate, about 1.17 and 1.14 logical cores on average. The local workload varied between runs. These numbers do not estimate phone power use.

## Scale flow at save

The combined camera and simulated GATT run exposed an early-save path. On the v4.14.11 production build, logging while the one-second final-weight settle was pending wrote the shot before the scale hook returned its flow metrics. The save guard covers the submit button and the form handler. The settle interval, manual yield override, and extraction-time calculation use the existing paths. The browser regression checks that early submission writes no shot and that the eventual saved shot keeps the edited yield, extraction time and flow curve. The full candidate app saved 110 mock scale samples, 50 measured pressure samples, and a matching replay in the combined run.

## Phone reference

The owner reports usable pressure tracking on the Galaxy S23 Ultra. Drive listed 12 matching video and pressure export pairs. Sampled video frames and original pressure JSON were inspected for the `b0975706`, `dda2fffe` and `deb2ee45` pairs. The exports show 6.90, 6.95 and 6.98 saved samples/s over their first-to-last sample spans. Longest sample gaps were 1.23, 1.10 and 1.19 s. The `dda2fffe` diagnostics logged 258 confident readings, zero reader errors and zero inference rejections. Its longest interval included held readings followed by explicit needle-missing gaps and recovery.

The recordings show gauge movement and pressure through a shot. They contain no battery or thermal telemetry and do not establish physical BLE coexistence, OS suspension behaviour or performance across other phones.

## Regression gates

- The frozen live exam ran once per version with the same local inputs. All reported non-timing metrics matched across 12 clips and 3,961 stream frames. Both runs had 94.93% stream coverage, 0.099 bar median absolute error across 57 labelled comparisons, 0.255 bar P90, zero errors over 1 bar and zero false 10-bar readings. The worst reported hand-label error was 0.40 bar. The exam does not report a maximum across the older labelled clips. The lowest clip coverage was 74.38% and the exam's angle-flip metric was 37.5%.
- Full Vitest passed 596 baseline tests and 598 candidate tests with four existing conditional skips in each. The focused baseline suite passed 81 tests, including 20 reacquisition cases. Both new recorder regressions failed on the baseline recorder and passed with the repair.
- Both production builds passed. Seven Playwright smoke scripts and all six candidate shot-stop scenarios passed. The weighing smoke used a Windows launcher shim for its existing `spawn('npm')` limitation.
- The legacy suite reproduced the v4.14.11 `gaugeConfig.test.js:742` failure. Changed-file lint found the same 12 errors and seven warnings in `App.jsx` as the baseline and no findings in the other changed JavaScript files.
