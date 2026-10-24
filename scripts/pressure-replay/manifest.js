import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');
const DEFAULT_REPLAY_DIR = '/workspace/flair-replay/720';

/**
 * Load replay manifest. Expected values stay in the harness only — never passed to the app/CV.
 */
export function loadPressureReplayManifest(manifestPath = MANIFEST_PATH) {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!raw?.clips?.length) throw new Error('manifest has no clips');
  const clips = raw.clips.map((clip, index) => {
    const id = clip.id || clip.file?.replace(/\.[^.]+$/, '');
    if (!id || !clip.file) throw new Error(`clip ${index} missing id or file`);
    return {
      id,
      file: clip.file,
      description: clip.description || '',
      expectedBar: clip.expectedBar ?? 0,
      expectedPeakBar: clip.expectedPeakBar ?? null,
      tolerance: clip.tolerance ?? 0.5,
      notes: clip.notes || '',
    };
  });
  return { version: raw.version ?? 1, clips };
}

export function resolveClipPath(clip, replayDir = DEFAULT_REPLAY_DIR) {
  return path.join(replayDir, clip.file);
}

export function selectClips(manifest, filterId) {
  if (!filterId) return manifest.clips;
  const match = manifest.clips.filter((c) => c.id === filterId || c.file === filterId);
  if (!match.length) throw new Error(`no manifest clip for ${filterId}`);
  return match;
}
