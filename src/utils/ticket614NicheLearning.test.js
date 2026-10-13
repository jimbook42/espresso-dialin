import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'fake-indexeddb/auto';
import {
  adjustNicheZero,
  formatNicheZeroDialRangeLabel,
  getNicheZeroDialLimits,
  parseNicheZeroSetting,
} from '../grinders/nicheZero.js';
import { buildAppDefaultInitialGrindHint } from './initialGrindHint.js';
import {
  CUSTOM_GRINDER_PICKER_ID,
  formatShotGrindForHistory,
  grinderPickerValueForSettings,
  parseGrindForShotSave,
} from '../grinders/grinderRegistry.js';
import { buildShotsCsvRows, SHOT_CSV_HEADERS } from './csvExport.js';
import { formatSecondsPerStepDisplay } from './grinderSensitivityDisplay.js';
import { HIGH_LEARNED_CONFIDENCE_THRESHOLD } from './grindShiftDamping.js';
import {
  calculateRecommendation,
  db,
  filterShotsForGrinderModelLearning,
  getInitialGrindRecommendation,
  getRecommendationEvidenceContext,
  getShotEngineStats,
  recomputeQuantitativeRecommendationFromLastShot,
  shotEligibleForLearning,
  shotMatchesGrinderForLearning,
} from './grinderLogic.js';
import { importShotsCsvThroughAppPath, importShotsFromCsv } from './csvImport.js';
import { NICHE_ZERO_GRINDER_ID } from '../grinders/nicheZero.js';
import { resolveRecipeForBean } from './beanRecipeResolution.js';
import {
  formatCurrentGrindLabel,
  formatInitialGrindDisplay,
} from '../grinders/grinderRegistry.js';
import { sensitivityConfidenceForQuantitativeGrinder } from './recommendationTuning.js';

const LEGACY_FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isaac-b2-sette-shots-legacy-export.csv'
);

function runNicheCalibrationTests() {
  assert.deepEqual(getNicheZeroDialLimits(null), { min: 0, max: 50, hasCalibration: false });
  assert.equal(parseNicheZeroSetting(-1, null), null);
  assert.equal(parseNicheZeroSetting(51, null), null);

  const calibrated = { nicheZeroDialZeroOffset: -3 };
  assert.equal(parseNicheZeroSetting(-2.5, calibrated), -2.5);
  assert.equal(parseNicheZeroSetting(-4, calibrated), null);
  assert.equal(adjustNicheZero(0, -1, calibrated), -0.1);

  const extendedMax = { nicheZeroDialZeroOffset: 4 };
  assert.equal(parseNicheZeroSetting(53, extendedMax), 53);
  assert.equal(parseNicheZeroSetting(54, extendedMax), 54);
  assert.equal(parseNicheZeroSetting(55, extendedMax), null);

  const symmetricNeg = { nicheZeroDialZeroOffset: -5, grinderModel: 'Niche Zero' };
  const negLimits = getNicheZeroDialLimits(symmetricNeg);
  assert.equal(negLimits.min, -5);
  assert.equal(negLimits.max, 55);
  assert.match(formatNicheZeroDialRangeLabel(symmetricNeg), /-5–55/);
  assert.equal(parseNicheZeroSetting(-5, symmetricNeg), -5);
  assert.equal(parseNicheZeroSetting(55, symmetricNeg), 55);

  const savedNeg = parseGrindForShotSave('Niche Zero', { nicheZeroSetting: -5 }, symmetricNeg);
  assert.equal(savedNeg.ok, true);
  assert.equal(savedNeg.nicheZeroSetting, -5);
  const savedHigh = parseGrindForShotSave('Niche Zero', { nicheZeroSetting: 55 }, symmetricNeg);
  assert.equal(savedHigh.nicheZeroSetting, 55);
  assert.equal(
    formatShotGrindForHistory(
      { grinderModel: 'Niche Zero', nicheZeroSetting: -5 },
      symmetricNeg
    ),
    '-5'
  );
  assert.equal(
    formatShotGrindForHistory(
      { grinderModel: 'Niche Zero', nicheZeroSetting: 55 },
      symmetricNeg
    ),
    '55'
  );

  const csvRows = buildShotsCsvRows(
    [
      {
        grinderModel: 'Niche Zero',
        nicheZeroSetting: 55,
        timestamp: '2026-01-01T00:00:00.000Z',
        beanId: 'b1',
        actualTimeS: 30,
        actualDoseG: 18,
        actualYieldG: 36,
        tasteProfile: 'balanced',
      },
    ],
    {
      beans: [{ id: 'b1', name: 'B1' }],
      formatShotGrindForHistory: (shot) => formatShotGrindForHistory(shot, symmetricNeg),
      normalizeTasteProfile: (t) => t,
      formatRecFollowedForCsv: () => 'N/A',
      knownIssueReasonLabel: () => '',
    }
  );
  const grindIdx = SHOT_CSV_HEADERS.indexOf('Grind Setting');
  assert.equal(csvRows[0][grindIdx], '55');
}

function runInitialGrindHintLiveTrackingTests() {
  const hintAt7 = buildAppDefaultInitialGrindHint('DF64', '7');
  assert.match(hintAt7, /Starting grind 7/);
  assert.doesNotMatch(hintAt7, /Starting grind 11/);
  const hintAt20 = buildAppDefaultInitialGrindHint('DF64', '20');
  assert.match(hintAt20, /Starting grind 20/);
}

function runCustomGrinderPickerPersistenceTests() {
  assert.equal(
    grinderPickerValueForSettings({
      grinderModel: 'Niche Zero',
      grinderPickerSelection: CUSTOM_GRINDER_PICKER_ID,
    }),
    CUSTOM_GRINDER_PICKER_ID
  );
  assert.equal(
    grinderPickerValueForSettings({
      grinderModel: 'Niche Zero',
      customGrinderSetupDraft: {
        name: 'DF64',
        dialType: 'stepped',
        min: 1,
        max: 20,
        step: 1,
        lowerIsFiner: true,
      },
      grinderPickerSelection: CUSTOM_GRINDER_PICKER_ID,
    }),
    CUSTOM_GRINDER_PICKER_ID
  );
}

function runEstimatedLabelTests() {
  const low = formatSecondsPerStepDisplay(1.25, {
    confidence: HIGH_LEARNED_CONFIDENCE_THRESHOLD - 0.1,
    usedEmpiricalSlope: true,
    isDefaultSensitivity: false,
  });
  assert.match(low, /Estimated/i);

  const high = formatSecondsPerStepDisplay(1.25, {
    confidence: HIGH_LEARNED_CONFIDENCE_THRESHOLD,
    usedEmpiricalSlope: true,
    isDefaultSensitivity: false,
  });
  assert.doesNotMatch(high, /Estimated/i);
  assert.match(high, /1\.25s per step/);
}

function runCrossBeanCarryOverTests() {
  const recipe = { targetTimeMinS: 27, targetTimeMaxS: 32, targetDoseG: 18, targetYieldG: 36 };
  const grinderHistory = [
    {
      beanId: 'bean-a',
      grinderModel: 'DF64',
      customGrindValue: 8,
      actualTimeS: 40,
      timestamp: '2026-01-02T00:00:00.000Z',
      targetTimeMinS: 27,
      targetTimeMaxS: 32,
      targetDoseG: 18,
      targetYieldG: 36,
    },
    {
      beanId: 'bean-a',
      grinderModel: 'DF64',
      customGrindValue: 10,
      actualTimeS: 28,
      timestamp: '2026-01-01T00:00:00.000Z',
      targetTimeMinS: 27,
      targetTimeMaxS: 32,
      targetDoseG: 18,
      targetYieldG: 36,
    },
    {
      beanId: 'bean-a',
      grinderModel: 'DF64',
      customGrindValue: 12,
      actualTimeS: 20,
      timestamp: '2025-12-31T00:00:00.000Z',
      targetTimeMinS: 27,
      targetTimeMaxS: 32,
      targetDoseG: 18,
      targetYieldG: 36,
    },
  ];
  const settings = {
    grinderModel: 'DF64',
    customGrinder: {
      name: 'DF64',
      dialType: 'stepped',
      min: 1,
      max: 20,
      step: 1,
      lowerIsFiner: true,
    },
  };
  const beanOnly = [];
  const grinderWide = grinderHistory;
  const beanEstimate = sensitivityConfidenceForQuantitativeGrinder(
    beanOnly,
    'DF64',
    recipe,
    settings,
    grinderWide
  );
  assert.ok(beanEstimate.usedGrinderWideLearning);
  assert.ok(beanEstimate.usedEmpiricalSlope);
}

function runCustomStartingGrindConsistencyTests() {
  const settings = {
    grinderModel: 'DF64',
    customGrinder: {
      name: 'DF64',
      dialType: 'stepped',
      min: 1,
      max: 20,
      step: 1,
      lowerIsFiner: true,
    },
  };
  const bean = {
    id: 'fresh-bean',
    roastType: 'Medium',
    roastDate: '2026-09-01',
    storageType: 'bag',
  };
  const initial = getInitialGrindRecommendation(
    'DF64',
    'Medium',
    bean,
    [],
    [],
    [bean],
    '2026-09-20T12:00:00.000Z',
    false,
    settings
  );
  const cardLabel = formatInitialGrindDisplay('DF64', initial, settings);
  const formLabel = formatCurrentGrindLabel('DF64', { customGrindValue: initial.customGrindValue }, settings);
  assert.equal(cardLabel, formLabel);
}

function runLegacyRecordCompatibilityTests() {
  const legacyShot = {
    id: 'legacy-1',
    beanId: 'b1',
    grinderModel: 'Sette 270Wi',
    setteMacro: 7,
    setteMicro: 'C',
    actualTimeS: 30,
    actualDoseG: 18,
    actualYieldG: 30,
    tasteProfile: 'balanced',
    timestamp: '2026-01-01T00:00:00.000Z',
  };
  const rec = calculateRecommendation(
    {
      ...legacyShot,
      wasPurged: true,
      actualTime: 30,
      actualYield: 30,
    },
    { targetTimeMinS: 27, targetTimeMaxS: 32, targetDoseG: 18, targetYieldG: 30 },
    []
  );
  assert.ok(rec.recommendedSetting);
  const stats = getShotEngineStats({ recommendation: rec }, { targetTimeMinS: 27, targetTimeMaxS: 32 });
  assert.ok(stats.sensitivity);
}

async function runNicheExtendedCsvImportTests() {
  const header =
    'Timestamp,Bean,Grinder,Grind Setting,Purged,Dose(g),Yield(g),Ratio,Time(s),Taste,Rating,Bean Age (Days),Storage,Rec Followed,Excluded,Known Issue Reason,Notes';
  const rows = [
    ['2026-01-01, 10:00:00', 'N1', NICHE_ZERO_GRINDER_ID, '-5', 'Yes', '18', '36', '1:2', '28', 'balanced', '', '', 'bag', 'N/A', 'No', '', ''],
    ['2026-01-02, 10:00:00', 'N1', NICHE_ZERO_GRINDER_ID, '-4', 'Yes', '18', '36', '1:2', '28', 'balanced', '', '', 'bag', 'N/A', 'No', '', ''],
    ['2026-01-03, 10:00:00', 'N1', NICHE_ZERO_GRINDER_ID, '54', 'Yes', '18', '36', '1:2', '28', 'balanced', '', '', 'bag', 'N/A', 'No', '', ''],
    ['2026-01-04, 10:00:00', 'N1', NICHE_ZERO_GRINDER_ID, '55', 'Yes', '18', '36', '1:2', '28', 'balanced', '', '', 'bag', 'N/A', 'No', '', ''],
  ];
  const csv = [header, ...rows.map((r) => r.join(','))].join('\n');

  await db.open();
  await db.transaction('rw', db.beans, db.recipes, db.shots, db.settings, async () => {
    await db.beans.clear();
    await db.recipes.clear();
    await db.shots.clear();
    await db.settings.clear();
    await db.settings.put({ id: 'global', grinderModel: 'Sette 270Wi' });
  });

  const result = await importShotsFromCsv(db, csv, {
    settings: { id: 'global', grinderModel: 'Sette 270Wi' },
  });
  assert.equal(result.imported, 4);
  assert.equal(result.errors.length, 0);

  const shots = await db.shots.orderBy('timestamp').toArray();
  assert.equal(shots.length, 4);
  const values = shots.map((s) => s.nicheZeroSetting).sort((a, b) => a - b);
  assert.deepEqual(values, [-5, -4, 54, 55]);

  const globalSettings = await db.settings.get('global');
  assert.equal(globalSettings.nicheZeroDialZeroOffset, -5);
  assert.equal(result.nicheCalibrationApplied, -5);
}

async function runLegacyCsvImportEvidenceTests() {
  const legacyRaw = fs.readFileSync(LEGACY_FIXTURE, 'utf8');
  await db.open();
  await db.transaction('rw', db.beans, db.recipes, db.shots, async () => {
    await db.beans.clear();
    await db.recipes.clear();
    await db.shots.clear();
  });
  await importShotsCsvThroughAppPath(db, legacyRaw, { grinderModel: 'Sette 270Wi' });
  const shots = await db.shots.orderBy('timestamp').reverse().toArray();
  const b2 = (await db.beans.toArray()).find((b) => b.name === 'B2');
  const storedRecipe = (await db.recipes.toArray()).find((r) => r.beanId === b2.id);
  const activeRecipe = resolveRecipeForBean(b2, storedRecipe, shots, 'Sette 270Wi');
  const grinderShots = filterShotsForGrinderModelLearning(shots, 'Sette 270Wi');
  const evidence = getRecommendationEvidenceContext(grinderShots, activeRecipe, false);
  assert.match(evidence, /Based on 34 recent shots/);

  const last = shots.find(
    (s) =>
      s.beanId === b2.id
      && shotEligibleForLearning(s)
      && shotMatchesGrinderForLearning(s, 'Sette 270Wi')
  );
  const hist = shots.filter(
    (s) => s.beanId === b2.id && shotEligibleForLearning(s) && s.id !== last.id
  );
  const rec = recomputeQuantitativeRecommendationFromLastShot(
    last,
    activeRecipe,
    hist,
    false,
    { grinderModel: 'Sette 270Wi' },
    grinderShots
  );
  assert.equal(rec.recommendedSetting.macro, 7);
  assert.equal(rec.recommendedSetting.micro, 'C');
  db.close();
}

export async function runTicket614NicheLearningTests() {
  runNicheCalibrationTests();
  runEstimatedLabelTests();
  runCrossBeanCarryOverTests();
  runCustomStartingGrindConsistencyTests();
  runInitialGrindHintLiveTrackingTests();
  runCustomGrinderPickerPersistenceTests();
  runLegacyRecordCompatibilityTests();
  await runNicheExtendedCsvImportTests();
  await runLegacyCsvImportEvidenceTests();
  console.log('Ticket 6.14 niche learning tests passed.');
}
