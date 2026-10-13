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
  assert.ok(exportedCsv.includes('Timestamp (ISO)'));
  assert.ok(exportedCsv.includes('2026-10-13T14:27:35.000Z'));

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

  const newestShot = afterLegacy.find((s) => s.timestamp === '2026-10-13T14:27:35.000Z');
  assert.ok(newestShot, 'legacy import should preserve newest shot timestamp');
  const locales = ['en-US', 'en-NZ'];
  for (const locale of locales) {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions() {
      return { ...original.call(this), locale };
    };
    try {
      const row = buildShotsCsvRows([newestShot], {
        beans,
        recipes,
        formatShotGrindForHistory: (s) => formatShotGrindForHistory(s),
        normalizeTasteProfile,
        formatRecFollowedForCsv,
        knownIssueReasonLabel,
      })[0];
      assert.equal(row[isoIdx], '2026-10-13T14:27:35.000Z');
    } finally {
      Intl.DateTimeFormat.prototype.resolvedOptions = original;
    }
  }

  db.close();
  console.log('CSV round-trip tests passed.');
}
