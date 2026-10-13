import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CANONICAL_JSON_VERSION, canonicalStringify, parseCanonicalJson } from './canonicalJson.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(__dirname, 'snapshots', 'engineSnapshots.json');

export function loadGolden() {
  if (!fs.existsSync(GOLDEN_PATH)) {
    return { version: CANONICAL_JSON_VERSION, cases: {} };
  }
  const raw = fs.readFileSync(GOLDEN_PATH, 'utf8');
  return parseCanonicalJson(raw);
}

export function writeGolden(doc) {
  fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
  fs.writeFileSync(GOLDEN_PATH, canonicalStringify(doc) + '\n', 'utf8');
}

export function stableEqual(a, b) {
  assert.deepStrictEqual(canonicalStringify(a), canonicalStringify(b));
}

function assertExactCaseIdSets(liveIds, goldenIds) {
  const liveSet = new Set(liveIds);
  const goldenSet = new Set(goldenIds);

  const missingFromGolden = liveIds.filter((id) => !goldenSet.has(id));
  const staleInGolden = goldenIds.filter((id) => !liveSet.has(id));

  const liveDupes = liveIds.filter((id, idx) => liveIds.indexOf(id) !== idx);
  const goldenDupes = goldenIds.filter((id, idx) => goldenIds.indexOf(id) !== idx);

  const parts = [];
  if (liveIds.length !== liveSet.size || liveDupes.length) {
    parts.push(`duplicate live case IDs: ${[...new Set(liveDupes)].join(', ') || 'unknown'}`);
  }
  if (goldenIds.length !== goldenSet.size || goldenDupes.length) {
    parts.push(`duplicate golden case IDs: ${[...new Set(goldenDupes)].join(', ') || 'unknown'}`);
  }
  if (missingFromGolden.length) {
    parts.push(`missing golden cases (${missingFromGolden.length}): ${missingFromGolden.join(', ')}`);
  }
  if (staleInGolden.length) {
    parts.push(`stale golden cases (${staleInGolden.length}): ${staleInGolden.join(', ')}`);
  }
  if (liveIds.length !== goldenIds.length && !missingFromGolden.length && !staleInGolden.length) {
    parts.push(`case count mismatch: live=${liveIds.length} golden=${goldenIds.length}`);
  }

  if (parts.length) {
    throw new Error(`snapshot case ID integrity failure:\n${parts.join('\n')}`);
  }
}

/**
 * @param {Record<string, unknown>} liveCases id -> value
 * @param {{ record: boolean }} opts
 */
export function verifyOrRecordSnapshotSuite(liveCases, opts = {}) {
  const record = opts.record ?? process.env.UPDATE_SNAPSHOTS === '1';
  const golden = loadGolden();
  assert.equal(golden.version, CANONICAL_JSON_VERSION, 'golden file version mismatch');

  const ids = Object.keys(liveCases).sort();
  const goldenIds = Object.keys(golden.cases || {}).sort();

  if (record) {
    const nextCases = {};
    for (const id of ids) {
      nextCases[id] = liveCases[id];
    }
    writeGolden({ version: CANONICAL_JSON_VERSION, cases: nextCases });
    return { mode: 'record', caseCount: ids.length };
  }

  assertExactCaseIdSets(ids, goldenIds);

  for (const id of ids) {
    try {
      stableEqual(liveCases[id], golden.cases[id]);
    } catch (err) {
      const detail = err && err.message ? err.message : String(err);
      const mismatch = new Error(`Snapshot mismatch: ${id}\n${detail}`);
      mismatch.cause = err;
      throw mismatch;
    }
  }
  return { mode: 'verify', caseCount: ids.length };
}

export { GOLDEN_PATH };
