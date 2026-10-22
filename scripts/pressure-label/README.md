# Pressure gauge labelling tool

Standalone Node server + static page for marking hub, needle tip, and dial pins on extracted JPEG frames. Outputs labels to `/workspace/pl-state/labels.json`.

## Prerequisites

- `ffmpeg` / `ffprobe` on PATH
- Clips under `/workspace/flair-train/` (see `extract-frames.mjs`)

## Extract frames (~30 JPEGs)

```bash
node scripts/pressure-label/extract-frames.mjs
```

Writes frames and `manifest.json` to `/workspace/pl-state/label-frames/` only.

## Run server

```bash
export LABEL_TOKEN='your-secret'
# optional: PORT=8787 (default)
node scripts/pressure-label/server.mjs
```

Open `http://127.0.0.1:8787/?k=your-secret` on a phone or desktop browser.

## API (requires `?k=` token; wrong/missing token → 404)

```bash
export LABEL_TOKEN='test-token'

# manifest
curl -s "http://127.0.0.1:8787/api/manifest?k=test-token" | head

# labels
curl -s "http://127.0.0.1:8787/api/labels?k=test-token"

# save
curl -s -X POST "http://127.0.0.1:8787/api/labels?k=test-token" \
  -H 'Content-Type: application/json' \
  -d '{"frames":{}}'
```

Labels are written atomically to `/workspace/pl-state/labels.json` on each POST.
