import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'fake-indexeddb/auto';
import { buildShotsCsvRows, SHOT_CSV_HEADERS } from './csvExport.js';
import {
  importShotsFromCsv,
  parseExportedTimestamp,
  parseShotsCsvText,
} from './csvImport.js';
import {
  calculateRecommendation,
  db,
  knownIssueReasonLabel,
  shotExcludedFromLearning,
} from './grinderLogic.js';
import { setteToNumeric } from '../grinders/grinderRegistry.js';
import { formatRecFollowedForCsv } from './recommendationFollowed.js';
import { normalizeTasteProfile } from './tasteProfile.js';

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isaac-b2-sette-shots.csv'
);

function parseSetteGrindFromShot(shot) {
  return { setteMacro: shot.setteMacro, setteMicro: shot.setteMicro };
}

export async function runCsvImportTests() {
  assert.ok(parseExportedTimestamp('13/10/2026, 14:27:35'));
  assert.ok(parseExportedTimestamp('2026-10-13T14:27:35.000Z'));

  const { header, rows } = parseShotsCsvText(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  assert.ok(header.includes('Excluded From Learning') || header.includes('Excluded'));
  assert.equal(rows.length, 35);

  await db.open();
  await db.transaction('rw', db.beans, db.shots, async () => {
    await db.beans.clear();
    await db.shots.clear();
  });

  const fixtureCsv = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const firstImport = await importShotsFromCsv(db, fixtureCsv);
  assert.equal(firstImport.imported, 35);
  assert.equal(firstImport.skipped, 0);
  assert.equal(firstImport.errors.length, 0);

  const secondImport = await importShotsFromCsv(db, fixtureCsv);
  assert.equal(secondImport.imported, 0);
  assert.equal(secondImport.skipped, 35);

  const allShots = await db.shots.orderBy('timestamp').reverse().toArray();
  assert.equal(allShots.length, 35);

  const current = allShots[0];
  const history = allShots.slice(1);
  const recipe = {
    targetTimeMinS: 27,
    targetTimeMaxS: 32,
    targetDoseG: 18,
    targetYieldG: 30,
  };
  const rec = calculateRecommendation(
    { ...current, grinderModel: 'Sette 270Wi', ...parseSetteGrindFromShot(current) },
    recipe,
    history.map((s) => ({ ...s, grinderModel: 'Sette 270Wi' })),
    false
  );
  const targetA = setteToNumeric(7, 'A');
  const sevenG = setteToNumeric(7, 'G');
  const recommended = setteToNumeric(rec.recommendedSetting.macro, rec.recommendedSetting.micro);
  const currentNumeric = setteToNumeric(current.setteMacro, current.setteMicro);
  assert.ok(recommended < sevenG);
  assert.ok(recommended < currentNumeric);
  assert.ok(Math.abs(recommended - targetA) <= 2);

  await db.shots.add({
    id: 'export-excluded-test',
    beanId: allShots[0].beanId,
    timestamp: '2099-01-01T00:00:00.000Z',
    grinderModel: 'Sette 270Wi',
    setteMacro: 10,
    setteMicro: 'A',
    actualDoseG: 18,
    actualYieldG: 36,
    actualTimeS: 8,
    tasteProfile: 'balanced',
    excludeFromLearning: true,
    knownIssueReason: 'puck_prep',
  });
  const beans = await db.beans.toArray();
  const exportRows = buildShotsCsvRows(await db.shots.toArray(), {
    beans,
    formatShotGrindForHistory: () => '10-A',
    normalizeTasteProfile,
    formatRecFollowedForCsv,
    knownIssueReasonLabel,
  });
  const excludedIdx = SHOT_CSV_HEADERS.indexOf('Excluded');
  const excludedRow = exportRows.find((row) => row[excludedIdx] === 'Yes');
  assert.ok(excludedRow, 'export should include excluded flag');
  assert.equal(shotExcludedFromLearning({ excludeFromLearning: true }), true);

  const excludedShotRow = exportRows.find(
    (row) => row[excludedIdx] === 'Yes' && row[excludedIdx + 1] === knownIssueReasonLabel('puck_prep')
  );
  assert.ok(excludedShotRow, 'export must carry excluded flag and known-issue reason label');

  db.close();
  console.log('CSV import tests passed.');
}
