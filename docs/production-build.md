# Production build

Use `npm run build:release` from a clean checkout or Git worktree. Vercel's
production build command uses this entry point automatically.

Set these build-time variables:

| Variable | Value |
| --- | --- |
| `VITE_ENABLE_PRESSURE_LAB` | `true` |
| `VITE_ENABLE_SCALE` | `true` |
| `VITE_PRESSURE_ALLOW_SIM` | `false` |
| `VITE_SCALE_ALLOW_SIM` | `false` |
| `VITE_PRESSURE_REPLAY` | `false` |

For a Vercel source upload without a Git checkout on the builder, pass both
`VERCEL_GIT_COMMIT_SHA` and `RELEASE_EXPECTED_SHA` as build variables. Resolve
the first with `git rev-parse HEAD` in the clean source worktree and get the
second from the approved release commit. Supply the full SHA in both cases.
For a local release build, the clean worktree's HEAD supplies provenance.

Before serving production traffic, stage a production deployment with
`vercel deploy --prod --skip-domain`, then check the camera controls,
calibration, both recording flows and the full SHA in a Diagnostics v2 export.
Git pushes to `main` and the B07 recovery branch skip automatic Vercel builds.
Promote the staged production deployment once verified.

## Beta offline scope

The installed app can reopen History and log manual shots offline after the
app shell is cached. A cold pressure camera session needs an internet
connection to load OpenCV, the ONNX model and its WASM runtime. If those
assets are unavailable offline, reconnect while the pressure screen or gauge
setup is open to retry automatically. If the reader still cannot start after
a connection loss during initialization, save any work and reopen the app
online to start with a fresh runtime.

Full offline pressure recording needs a separate product decision on camera
asset storage and updates, followed by acceptance on physical devices.
