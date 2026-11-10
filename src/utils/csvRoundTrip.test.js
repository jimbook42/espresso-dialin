import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'fake-indexeddb/auto';
import {
  buildShotsCsvContent,
  buildShotsCsvRows,
  SHOT_CSV_HEADERS,
} from './csvExport.js';
import { importShotsCsvThroughAppPath } from './csvImport.js';
import {
  db,
  knownIssueReasonLabel,
  recomputeQuantitativeRecommendationFromLastShot,
  shotEligibleForLearning,
  shotMatchesGrinderForLearning,
} from './grinderLogic.js';
import { formatRecFollowedForCsv } from './recommendationFollowed.js';
import { resolveRecipeForBean } from './beanRecipeResolution.js';
import { formatShotGrindForHistory } from '../grinders/grinderRegistry.js';
import { normalizeTasteProfile } from './tasteProfile.js';

const LEGACY_FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isaac-b2-sette-shots-legacy-export.csv'
);

function dialRecommendationForB2(shots, beans, recipes) {
  const b2 = beans.find((b) => b.name === 'B2');
  const legacyShots = shots.filter((s) => s.beanId === b2.id).sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );
  const storedRecipe = recipes.find((r) => r.beanId === b2.id);
  const activeRecipe = resolveRecipeForBean(b2, storedRecipe, legacyShots, 'Sette 270Wi');
  const lastLearningShot = legacyShots.find(
    (s) => shotEligibleForLearning(s) && shotMatchesGrinderForLearning(s, 'Sette 270Wi')
  );
  const beanHistory = legacyShots.filter(
    (s) => shotEligibleForLearning(s) && s.id !== lastLearningShot?.id
  );
  return recomputeQuantitativeRecommendationFromLastShot(
    lastLearningShot,
    activeRecipe,
    beanHistory,
    false
  );
}

export async function runCsvRoundTripTests() {
  const legacyCsv = fs.readFileSync(LEGACY_FIXTURE_PATH, 'utf8');

  await db.open();
  await db.transaction('rw', db.beans, db.recipes, db.shots, async () => {
    await db.beans.clear();
    await db.recipes.clear();
    await db.shots.clear();
  });

  await importShotsCsvThroughAppPath(db, legacyCsv, { grinderModel: 'Sette 270Wi' });
  const afterLegacy = await db.shots.orderBy('timestamp').toArray();
  const beans = await db.beans.toArray();
  const recipes = await db.recipes.toArray();
  const recBefore = dialRecommendationForB2(afterLegacy, beans, recipes);
  assert.equal(recBefore.recommendedSetting.macro, 7);
  assert.equal(recBefore.recommendedSetting.micro, 'C');

  const exportRows = buildShotsCsvRows(
    await db.shots.orderBy('timestamp').reverse().toArray(),
    {
      beans,
      recipes,
      formatShotGrindForHistory: (s) => formatShotGrindForHistory(s),
      normalizeTasteProfile,
      formatRecFollowedForCsv,
      knownIssueReasonLabel,
    }
  );
  const exportedCsv = buildShotsCsvContent(SHOT_CSV_HEADERS, exportRows);
  // This legacy fixture carries a local wall time with no timezone offset.
  const newestTimestamp = new Date(2026, 9, 13, 14, 27, 35).toISOString();
  assert.ok(exportedCsv.includes('Timestamp (ISO)'));
  assert.ok(exportedCsv.includes(newestTimestamp));

  const isoIdx = SHOT_CSV_HEADERS.indexOf('Timestamp (ISO)');
  const recIdx = SHOT_CSV_HEADERS.indexOf('Rec Followed');
  const yesRows = exportRows.filter((row) => row[recIdx] === 'Yes');
  assert.ok(yesRows.length > 0, 'export should preserve Rec Followed Yes from legacy import');

  const targetYieldIdx = SHOT_CSV_HEADERS.indexOf('Target Yield (g)');
  assert.ok(exportRows.every((row) => row[targetYieldIdx] === 30 || row[targetYieldIdx] === '30'));

  const timestampsBefore = new Set(afterLegacy.map((s) => s.timestamp));

  await db.transaction('rw', db.beans, db.recipes, db.shots, async () => {
    await db.beans.clear();
    await db.recipes.clear();
    await db.shots.clear();
  });

  await importShotsCsvThroughAppPath(db, exportedCsv, { grinderModel: 'Sette 270Wi' });
  const afterRoundTrip = await db.shots.orderBy('timestamp').toArray();
  const timestampsAfter = new Set(afterRoundTrip.map((s) => s.timestamp));
  assert.equal(timestampsAfter.size, timestampsBefore.size);
  for (const ts of timestampsBefore) {
    assert.ok(timestampsAfter.has(ts), `missing timestamp after round trip: ${ts}`);
  }

  const recAfter = dialRecommendationForB2(
    afterRoundTrip,
    await db.beans.toArray(),
    await db.recipes.toArray()
  );
  assert.equal(recAfter.recommendedSetting.macro, 7);
  assert.equal(recAfter.recommendedSetting.micro, 'C');

  assert.equal(afterLegacy.at(-1).timestamp, newestTimestamp);
  assert.equal(exportRows[0][isoIdx], newestTimestamp);
  assert.equal(exportRows[0][SHOT_CSV_HEADERS.indexOf('Timestamp')], '13/10/2026, 14:27:35');

  db.close();
  console.log('CSV round-trip tests passed.');
}
