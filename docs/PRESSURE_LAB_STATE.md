# Pressure lab: resumable state (updated 2026-10-17 13:30 NZT)

- Branch: cursor/6-39-pressure-small-gauge (worktree /workspace/cursor-dialin-6.39), off cursor/6-37-pressure-speed @ 91db57b.
- Last Cursor commit: e510a52; WIP auto-committed and pushed when the running CLI exits.
- Cursor session for --resume: a648c797-650c-45a6-8dfc-44941bd64a97 (grok-4.7-high). Repairs used: 1/2.
- Rollback point: 91db57b (6.37 honest timing); preview qa/6-37-pressure-preview @ 1823246.
- Done: 6.39 small off-centre gauge search, 1 s hold cap, native-scale dial read, full-res locked read. Dry clips: confident-wrong 0.
- Open: synthetic ~150 px dials gave no readings before repair 1; repair 1 outcome not yet scored.
- Next:
  1. Score dry plus synthetic clips.
  2. If readings appear, run the held-out real-shot exam (/workspace/flair-real, 720p→1280x720@30, run-clip-browser.mjs, 1x and 4x, honest timing) and compare against the 2/10 baseline at 09:38 in log.md.
  3. Run an overfitting audit vs 9864842.
- Rules: real clips are held out and must never be given to Cursor. No merge or promote. Isaac's OK is needed for repair 2, xhigh, or any merge.
- Log: /cursor/stores/store-445de824-e720-4e29-bb73-daa191ac255a/log.md
