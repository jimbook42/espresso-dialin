import assert from 'assert';
import { calculateRecommendation, shotEligibleForLearning } from './grinderLogic.js';
import {
  detectLikelyShotOutlier,
  dampQuantitativeShift,
  applyGrindShiftDamping,
  proportionalGrindShiftFromTimeDelta,
  GRIND_SHIFT_DAMPING,
  filterOutliersFromLearningShots,
  KNOWN_ISSUE_OUTLIER_HINT,
  KNOWN_ISSUE_CHOKE_HINT,
} from './recommendationTuning.js';
import { getRecommendationGrinderProfile } from '../grinders/grinderRegistry.js';

const QA_RECIPE = {
  targetTimeMinS: 25,
  targetTimeMaxS: 30,
  targetDoseG: 18,
  targetYieldG: 36,
};

const QA_TIMES = [25, 12, 45, 28, 8, 28];

function baseShot(grinderModel, grind, time, ts) {
  return {
    grinderModel,
    ...grind,
    wasPurged: true,
    actualTime: time,
    actualTimeS: time,
    actualYield: 36,
    actualYieldG: 36,
    actualDose: 18,
    actualDoseG: 18,
    tasteProfile: 'balanced',
    timestamp: new Date(ts).toISOString(),
    beanId: 'b1',
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    targetDoseG: 18,
    targetYieldG: 36,
  };
}

function replayQaSeries(grinderModel, initialGrind, applyRecommendation, calcOptions = undefined) {
  let grind = { ...initialGrind };
  const history = [];
  const rows = [];
  for (let i = 0; i < QA_TIMES.length; i++) {
    const time = QA_TIMES[i];
    const shot = baseShot(grinderModel, grind, time, i);
    const rec = calculateRecommendation(shot, QA_RECIPE, history, false, calcOptions);
    rows.push({
      timeS: time,
      shift: rec.engineStats?.shift ?? 0,
      recommended: { ...rec.recommendedSetting },
      reason: rec.reason,
      warning: rec.warning,
    });
    history.push({ ...shot, id: `qa-${i}`, recommendation: rec });
    grind = applyRecommendation(grind, rec.recommendedSetting);
  }
  return rows;
}

function runKnownIssueSoftNoteQaSeriesTests() {
  const grinders = [
    {
      name: 'Sette 270Wi',
      initial: { setteMacro: 13, setteMicro: 'E' },
      apply: (g, rec) => ({
        setteMacro: rec.macro ?? g.setteMacro,
        setteMicro: rec.micro ?? g.setteMicro,
      }),
    },
    {
      name: 'Sunbeam Barista Max',
      initial: { sunbeamSetting: 15 },
      apply: (g, rec) => ({ sunbeamSetting: rec.setting ?? g.sunbeamSetting }),
    },
    {
      name: 'Niche Zero',
      initial: { nicheZeroSetting: 15 },
      apply: (g, rec) => ({ nicheZeroSetting: rec.nicheZeroSetting ?? g.nicheZeroSetting }),
    },
    {
      name: 'DF64',
      initial: { customGrindValue: 11 },
      apply: (g, rec) => ({ customGrindValue: rec.customGrindValue ?? g.customGrindValue }),
      options: {
        settings: {
          grinderModel: 'DF64',
          customGrinder: {
            name: 'DF64',
            dialType: 'stepped',
            min: 1,
            max: 20,
            step: 1,
            lowerIsFiner: true,
          },
        },
      },
    },
  ];

  for (const grinder of grinders) {
    const rows = replayQaSeries(
      grinder.name,
      grinder.initial,
      grinder.apply,
      grinder.options
    );
    const shot6 = rows[5];
    assert.match(shot6.reason, /KEEP GRIND/i, `${grinder.name} shot 6 should keep grind`);
    const warning = shot6.warning || '';
    assert.ok(
      !warning.includes(KNOWN_ISSUE_OUTLIER_HINT) && !warning.includes(KNOWN_ISSUE_CHOKE_HINT),
      `${grinder.name} shot 6 must not show stale known-issue soft note`
    );
    const outlierRows = rows.filter((r) => r.timeS === 8 || r.timeS === 12 || r.timeS === 45);
    for (const row of outlierRows) {
      const text = row.warning || '';
      assert.ok(
        text.includes(KNOWN_ISSUE_OUTLIER_HINT) || text.includes(KNOWN_ISSUE_CHOKE_HINT),
        `${grinder.name} ${row.timeS}s outlier should surface soft note`
      );
    }
  }
}

function runQaSeriesTests() {
  const sette = replayQaSeries(
    'Sette 270Wi',
    { setteMacro: 13, setteMicro: 'E' },
    (g, rec) => ({ setteMacro: rec.macro ?? g.setteMacro, setteMicro: rec.micro ?? g.setteMicro })
  );
  const sunbeam = replayQaSeries(
    'Sunbeam Barista Max',
    { sunbeamSetting: 15 },
    (g, rec) => ({ sunbeamSetting: rec.setting ?? g.sunbeamSetting })
  );
  const niche = replayQaSeries(
    'Niche Zero',
    { nicheZeroSetting: 15 },
    (g, rec) => ({ nicheZeroSetting: rec.nicheZeroSetting ?? g.nicheZeroSetting })
  );
  const customSettings = {
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
  const df64 = replayQaSeries(
    'DF64',
    { customGrindValue: 11 },
    (g, rec) => ({ customGrindValue: rec.customGrindValue ?? g.customGrindValue }),
    { settings: customSettings }
  );

  const series = { sette, sunbeam, niche, df64 };
  for (const rows of Object.values(series)) {
    const outlierRow = rows.find((r) => r.timeS === 8);
    assert.ok(Math.abs(outlierRow.shift) >= 1, '8s outlier should still move finer (never held)');
  }

  console.log('QA series shifts:', {
    sette: sette.map((r) => `${r.timeS}s:${r.shift}`),
    sunbeam: sunbeam.map((r) => `${r.timeS}s:${r.shift}`),
    niche: niche.map((r) => `${r.timeS}s:${r.shift}`),
    df64: df64.map((r) => `${r.timeS}s:${r.shift}`),
  });
}

function runKnownIssueExclusionTests() {
  const excluded = {
    excludeFromLearning: true,
    knownIssueReason: 'puck_prep',
    grinderModel: 'Sette 270Wi',
    setteMacro: 10,
    setteMicro: 'A',
    actualTimeS: 8,
    actualYieldG: 36,
    actualDoseG: 18,
    tasteProfile: 'balanced',
    timestamp: '2026-01-01T00:00:00.000Z',
    beanId: 'b1',
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    targetDoseG: 18,
    targetYieldG: 36,
  };
  assert.equal(shotEligibleForLearning(excluded), false);

  const recipe = QA_RECIPE;
  const learningPool = filterOutliersFromLearningShots(
    [
      excluded,
      {
        grinderModel: 'Sette 270Wi',
        setteMacro: 13,
        setteMicro: 'E',
        actualTimeS: 28,
        actualYieldG: 36,
        tasteProfile: 'balanced',
        timestamp: '2026-01-02T00:00:00.000Z',
      },
    ],
    recipe,
    'Sette 270Wi'
  );
  assert.equal(learningPool.length, 1);
  assert.equal(learningPool[0].actualTimeS, 28);

  const rec = calculateRecommendation(
    baseShot('Sette 270Wi', { setteMacro: 13, setteMicro: 'E' }, 27, 99),
    recipe,
    [excluded, learningPool[0]],
    false
  );
  assert.ok(rec.reason);
}

function runOutlierHintParityTests() {
  const recipe = QA_RECIPE;
  const history = [
    {
      grinderModel: 'Sette 270Wi',
      setteMacro: 13,
      setteMicro: 'E',
      actualTimeS: 28,
      actualYieldG: 36,
      tasteProfile: 'balanced',
      timestamp: '2026-01-01T00:00:00.000Z',
      targetTimeMinS: 25,
      targetTimeMaxS: 30,
    },
  ];
  const chokeHint = 'choke is usually grind';
  const customSettings = {
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
  for (const grinderModel of ['Sette 270Wi', 'Sunbeam Barista Max', 'Niche Zero', 'DF64']) {
    const shot =
      grinderModel === 'Sette 270Wi'
        ? { setteMacro: 13, setteMicro: 'E' }
        : grinderModel === 'Sunbeam Barista Max'
          ? { sunbeamSetting: 15 }
          : grinderModel === 'DF64'
            ? { customGrindValue: 10 }
            : { nicheZeroSetting: 15 };
    const rec = calculateRecommendation(
      {
        grinderModel,
        ...shot,
        wasPurged: true,
        actualTime: 45,
        actualYield: 36,
        tasteProfile: 'bitter',
      },
      recipe,
      history.map((h) => ({ ...h, grinderModel })),
      false,
      grinderModel === 'DF64' ? { settings: customSettings } : undefined
    );
    const combined = `${rec.warning || ''} ${rec.reason || ''}`.toLowerCase();
    assert.ok(combined.includes(chokeHint), `${grinderModel} should surface choke soft-note at 45s`);
  }
}

function runOutlierDetectionTests() {
  const profile = getRecommendationGrinderProfile('Sette 270Wi');
  const recipe = QA_RECIPE;
  const history = [
    {
      setteMacro: 13,
      setteMicro: 'E',
      actualTimeS: 28,
      actualYieldG: 36,
      tasteProfile: 'balanced',
      targetTimeMinS: 25,
      targetTimeMaxS: 30,
    },
  ];
  const outlier = detectLikelyShotOutlier({
    actualTime: 8,
    grindNumeric: profile.shotToNumeric(history[0]),
    recipe,
    comparableShots: history,
    grinderProfile: profile,
  });
  assert.equal(outlier.isOutlier, true);
  assert.equal(
    proportionalGrindShiftFromTimeDelta(-19, 1.25, { isOutlier: true }),
    Math.round((-19 / 1.25) * GRIND_SHIFT_DAMPING.OUTLIER)
  );
  assert.equal(
    proportionalGrindShiftFromTimeDelta(-10, 1.25, { reliableLearnedSensitivity: false }),
    Math.round((-10 / 1.25) * GRIND_SHIFT_DAMPING.DEFAULT_OR_LOW_CONFIDENCE)
  );
  assert.equal(dampQuantitativeShift(-12, 0.2, { isOutlier: true }), applyGrindShiftDamping(-12, { isOutlier: true, confidence: 0.2 }));
}

function runNicheStableHistory12sTest() {
  const recipe = QA_RECIPE;
  const history = [22, 28, 30, 32, 27].map((time, i) => ({
    grinderModel: 'Niche Zero',
    nicheZeroSetting: 15,
    actualTimeS: time,
    actualYieldG: 36,
    tasteProfile: 'balanced',
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    timestamp: new Date(i).toISOString(),
  }));
  const rec = calculateRecommendation(
    baseShot('Niche Zero', { nicheZeroSetting: 15 }, 12, 99),
    recipe,
    history
  );
  assert.equal(rec.outlierGrindHeld, false);
  assert.ok(Math.abs(rec.engineStats.shift) > 0, '12s after 22-32s history should recommend a grind move');
}

function runSteadyFastSeriesTest() {
  const recipe = QA_RECIPE;
  const shot = baseShot('Sette 270Wi', { setteMacro: 13, setteMicro: 'E' }, 19, 0);
  const rec = calculateRecommendation(shot, recipe, [], false);
  assert.equal(
    Math.abs(rec.engineStats.shift),
    Math.abs(proportionalGrindShiftFromTimeDelta(27.5 - 19, 1.25, { reliableLearnedSensitivity: false }))
  );
}

runQaSeriesTests();
runKnownIssueSoftNoteQaSeriesTests();
runKnownIssueExclusionTests();
runOutlierHintParityTests();
runOutlierDetectionTests();
runNicheStableHistory12sTest();
runSteadyFastSeriesTest();
console.log('recommendationTuning tests passed');
