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

function stableEqual(a, b) {
  assert.deepStrictEqual(canonicalStringify(a), canonicalStringify(b));
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
  if (record) {
    const next = { version: CANONICAL_JSON_VERSION, cases: { ...golden.cases } };
    for (const id of ids) {
      next.cases[id] = liveCases[id];
    }
    writeGolden(next);
    return { mode: 'record', caseCount: ids.length };
  }

  for (const id of ids) {
    assert.ok(Object.hasOwn(golden.cases, id), `missing golden case: ${id}`);
    try {
      stableEqual(liveCases[id], golden.cases[id]);
    } catch (err) {
      err.message = `snapshot mismatch for ${id}: ${err.message}`;
      throw err;
    }
  }
  return { mode: 'verify', caseCount: ids.length };
}

export { GOLDEN_PATH };
