/** Rebuild one exam sidecar's tap points from the nearest Isaac-labelled frame.
 * Usage: node scripts/pressure-label/analysis/retap-sidecar.mjs
 * Writes a new .retap.json beside the local exam clips; never edits the source.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const clip = '20261018_094055';
const clipsDir = process.env.DIALIN_EXAM_CLIPS || 'C:\\Users\\Isaac\\dialin-exam-clips';
const sidecarPath = path.join(clipsDir, `${clip}.json`);
const outputPath = path.join(clipsDir, `${clip}.retap.json`);
const labelsPath = new URL('../fixtures/batch-2026-11-02/labels-merged.json', import.meta.url);
const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
const labels = JSON.parse(readFileSync(labelsPath, 'utf8')).frames;
const atSec = sidecar.tapCalibration?.atSec ?? sidecar.tapCalibration4x?.atSec ?? 0;
const candidates = Object.entries(labels)
  .filter(([, row]) => row.clip === clip && row.orig?.hub && row.orig?.five && row.orig?.ten)
  .sort((a, b) => Math.abs(a[1].t - atSec) - Math.abs(b[1].t - atSec));
if (!candidates.length) throw new Error(`No complete labels found for ${clip}`);
const [labelId, label] = candidates[0];
const point = (coords) => ({ x: coords[0], y: coords[1] });
// replay-batch.mjs uses each label's `orig` points: upright source-frame pixels,
// matching the autorotated pixels consumed by decodeStill/sidecar calibration.
const anchors = {
  centre: point(label.orig.hub),
  five: point(label.orig.five),
  ten: point(label.orig.ten),
};
const sourceNote = `Retapped from Isaac label ${labelId} at ${label.t}s (nearest to sidecar atSec ${atSec}s), labels-merged.json orig coordinates; points copied as tapped.`;
const rebuilt = structuredClone(sidecar);
for (const key of ['tapCalibration', 'tapCalibration4x']) {
  if (!rebuilt[key]) continue;
  rebuilt[key].anchors = { ...rebuilt[key].anchors, ...anchors };
  rebuilt[key].sourceNote = sourceNote;
}
rebuilt.retapSourceNote = sourceNote;
writeFileSync(outputPath, `${JSON.stringify(rebuilt)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ outputPath, labelId, labelTimeS: label.t, atSec, anchors, sourceNote }, null, 2));
