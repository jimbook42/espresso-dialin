# Pressure label batch 2026-11-02 (62 frames, b001–b062)

Hand labels by Isaac via https://dialin-label-b2-jimbook.vercel.app. Each frame has 5 points: hub, tip, zero pin, and gauge numbers (see labels JSON).

- `labels-orig.json` — **use this.** Coordinates are in the **UPRIGHT original frame** (ffmpeg autorotate applied, e.g. 720x1280 for phone clips). This differs from older sets (`../labels-2026-10-22.json`), which use the raw sideways (-noautorotate) frame.
- `labels-merged.json` — same labels in display (zoomed crop) px, as tapped.
- `frames/` — the 900x900 zoomed crops shown to the labeller; `frames/manifest.json` has per-frame crop `{x,y,size,scale,outSize,srcW,srcH,rotation}`. Display → original: rotate back (none:(x,y); r180:(899-x,899-y); ccw90:(899-y,x)), then orig = (crop.x+u/scale, crop.y+v/scale). See `to-orig.py`.
- `selection-notes.json` — per frame: source clip, time `t`, phase, why chosen, group (existing exam clip vs new shot), `repeatOf`.
- Sources: 20 frames from existing exam clips (around known misses: 094055 @11 s burst, @19 s, @40 s, gaps, held readings, rest); 32 from 4 new shots (9801a937, e146d592, f62a5256, 20261024_124140); 10 repeats.
- **10 repeat pairs** (noise floor): b036↔b003, b044↔b005, b050↔b025, b051↔b038, b054↔b043, b055↔b027, b058↔b011, b060↔b042, b061↔b008, b062↔b052. Observed agreement: hub ≈3 px, tip ≈9 px.
- **Recovered from tap logs**: the "Send labels" export couldn't be read from Vercel, so labels were rebuilt from per-tap `PLABEL`/`PLABEL_CHUNK` runtime log lines (`merge-logs.mjs`, then `to-orig.py`). All 62 frames complete, all have a 0 pin.
- Pipeline scripts: `upright.py` → `detect.py` (Hough circle, `hough.json`) → `crop.py`.
