import assert from 'assert';
import { calculateRecommendation, shotEligibleForLearning } from './grinderLogic.js';
import {
  detectLikelyShotOutlier,
  dampQuantitativeShift,
  filterOutliersFromLearningShots,
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

function replayQaSeries(grinderModel, initialGrind, applyRecommendation) {
  let grind = { ...initialGrind };
  const history = [];
  const rows = [];
  for (let i = 0; i < QA_TIMES.length; i++) {
    const time = QA_TIMES[i];
    const shot = baseShot(grinderModel, grind, time, i);
    const rec = calculateRecommendation(shot, QA_RECIPE, history, false);
    rows.push({
      timeS: time,
      shift: rec.engineStats?.shift ?? 0,
      recommended: { ...rec.recommendedSetting },
      reason: rec.reason,
    });
    history.push({ ...shot, id: `qa-${i}`, recommendation: rec });
    grind = applyRecommendation(grind, rec.recommendedSetting);
  }
  return rows;
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

  for (const rows of [sette, sunbeam, niche]) {
    for (const row of rows) {
      assert.ok(Math.abs(row.shift) <= 3, `shift ${row.shift} too large at ${row.timeS}s`);
    }
    const fastRow = rows.find((r) => r.timeS === 12);
    const slowRow = rows.find((r) => r.timeS === 45);
    assert.equal(Math.abs(fastRow.shift), 2, '12s gusher should move ~2 units');
    assert.equal(Math.abs(slowRow.shift), 2, '45s choke should move ~2 units');
    const outlierRow = rows.find((r) => r.timeS === 8);
    assert.equal(outlierRow.shift, 0, '8s outlier should not move grind');
    const final = rows[rows.length - 1].recommended;
    const dialledRow = rows.find((r) => r.timeS === 28 && rows.indexOf(r) === 3);
    assert.deepEqual(final, dialledRow.recommended, 'final grind should match post-dialled-in anchor');
  }

  assert.deepEqual(sette[sette.length - 1].recommended, { macro: 13, micro: 'E' });
  assert.deepEqual(sunbeam[sunbeam.length - 1].recommended, { setting: 15 });
  assert.deepEqual(niche[niche.length - 1].recommended, { nicheZeroSetting: 15 });
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
  assert.equal(outlier.holdGrind, true);
  assert.equal(dampQuantitativeShift(-12, 0.2, { isOutlier: true, holdOutlier: true }), 0);
  assert.equal(
    dampQuantitativeShift(-12, 0, { secondsOffMidpoint: 15 }),
    -2
  );
  assert.equal(
    dampQuantitativeShift(14, 0, { secondsOffMidpoint: 18 }),
    2
  );
}

function runSteadyFastSeriesTest() {
  const recipe = QA_RECIPE;
  let macro = 13;
  let micro = 'E';
  const history = [];
  for (let i = 0; i < 3; i++) {
    const time = 19;
    const shot = baseShot('Sette 270Wi', { setteMacro: macro, setteMicro: micro }, time, i);
    const rec = calculateRecommendation(shot, recipe, history, false);
    assert.equal(Math.abs(rec.engineStats.shift), 2, `steady ${time}s shot should step 2 units`);
    history.push({ ...shot, id: `steady-${i}`, recommendation: rec });
    macro = rec.recommendedSetting.macro;
    micro = rec.recommendedSetting.micro;
  }
}

runQaSeriesTests();
runKnownIssueExclusionTests();
runOutlierDetectionTests();
runSteadyFastSeriesTest();
console.log('recommendationTuning tests passed');
