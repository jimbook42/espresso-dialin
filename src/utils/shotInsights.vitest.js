import { describe, expect, it } from 'vitest';
import { generateShotInsights } from './shotInsights.js';

const shot = (overrides = {}) => ({
  actualTimeS: 30,
  actualDoseG: 18,
  actualYieldG: 36,
  targetTimeMinS: 27,
  targetTimeMaxS: 32,
  targetYieldG: 36,
  tasteProfile: 'balanced',
  grinderModel: 'Niche Zero',
  ...overrides,
});
const result = (overrides, profile = {}) => generateShotInsights({ shot: shot(overrides), profile });

describe('generateShotInsights', () => {
  it('compares extraction time with saved shot-level range', () => {
    expect(result({ actualTimeS: 27 }).mainTakeaway.message).toContain('within the saved');
    expect(result({ actualTimeS: 20 }).mainTakeaway.message).toContain('faster than the saved');
    expect(result({ actualTimeS: 40 }).mainTakeaway.message).toContain('slower than the saved');
  });

  it('compares yield and dose only against persisted shot targets and measurements', () => {
    const below = result({ actualYieldG: 30 }).insights.find((item) => item.category === 'recipe-comparison' && item.message.includes('yield'));
    const above = result({ actualYieldG: 40 }).insights.find((item) => item.category === 'recipe-comparison' && item.message.includes('yield'));
    expect(below.message).toContain('below the saved target');
    expect(above.message).toContain('above the saved target');
    expect(result({ actualDoseG: 17.5, targetDoseG: 18 }).insights.some((item) =>
      item.category === 'recipe-comparison' && item.message.includes('saved target was 18 g'))).toBe(true);
    expect(result({ targetTimeMinS: undefined, targetTimeMaxS: undefined, targetYieldG: undefined })
      .insights.some((item) => item.category === 'recipe-comparison')).toBe(false);
    expect(result({ actualYieldG: undefined }).insights.some((item) => item.message.includes('yield was'))).toBe(false);
  });

  it('does not use current recipe context when a saved target is absent', () => {
    const generated = generateShotInsights({ shot: shot({ targetTimeMinS: undefined, targetTimeMaxS: undefined }),
      targets: { targetTimeMinS: 10, targetTimeMaxS: 15 } });
    expect(generated.insights.some((item) => item.category === 'recipe-comparison')).toBe(false);
  });

  it('uses saved taste labels only and preserves balanced and legacy values', () => {
    expect(result({ tasteProfile: undefined }).insights.some((item) => item.category === 'taste-feedback')).toBe(false);
    expect(result({ tasteProfile: 'balanced' }).insights.find((item) => item.category === 'taste-feedback').message)
      .toBe('You described this shot as balanced.');
    expect(result({ tasteProfile: 'good' }).insights.find((item) => item.category === 'taste-feedback').message)
      .toBe('You described this shot as balanced.');
    expect(result({ tasteProfile: 'very_sour' }).insights.find((item) => item.category === 'taste-feedback').message)
      .toBe('You described this shot as very sour.');
    expect(result({ tasteProfile: 'bitter' }).insights.find((item) => item.category === 'taste-feedback').message)
      .toBe('You described this shot as bitter.');
  });

  it('reports a saved recommendation as historical and does not invent one', () => {
    const recommendation = { recommendedSetting: { macro: 15, micro: 'C' },
      reason: 'GO 2 MICRO STEP(S) FINER — Shot was 4s off target midpoint.' };
    const generated = result({ recommendation });
    const savedRecommendation = generated.observations.find((item) => item.category === 'saved-recommendation');
    expect(savedRecommendation.message).toContain('At the time');
    expect(savedRecommendation.message).toContain('macro 15, micro C');
    expect(savedRecommendation.contextualDetail).toContain('Saved reason: Shot was 4s off target midpoint.');
    expect(generated.nextStep.message).toContain('check the current Dial recommendation');
    expect(result({ recommendation: undefined }).nextStep).toBeNull();
    expect(result({ recordType: 'standalone-pressure', recommendation }).nextStep).toBeNull();
    const outlier = result({ recommendation: {
      recommendedSetting: { macro: 13, micro: 'E' },
      reason: 'LIKELY OUTLIER — Shot time (11s) is unusually fast. GO 9 MICRO STEP(S) FINER — Shot was 18s off target midpoint.',
    } }).observations.find((item) => item.category === 'saved-recommendation');
    expect(outlier.contextualDetail).toBe('Saved reason: Possible outlier: Shot time (11s) is unusually fast. Shot was 18s off target midpoint.');
  });

  it('retains learning exclusion and known issue context', () => {
    const generated = result({ excludeFromLearning: true, knownIssueReason: 'puck_prep' });
    expect(generated.insights.some((item) => item.category === 'learning-status'
      && item.message.includes('not for learning') && item.message.includes('puck prep'))).toBe(true);
  });

  it('reports pressure and scale observations without judging quality or inventing causes', () => {
    const generated = result({ recordType: 'standalone-pressure', actualTimeS: undefined }, {
      pressure: [{ tS: 0, bar: 0 }], peakPressureBar: 0,
      weight: [{ tS: 1, weightG: 0 }], finalWeightG: 0,
    });
    expect(generated.insights.some((item) => item.message.includes('0.0 bar'))).toBe(true);
    expect(generated.insights.some((item) => item.message.includes('0 g'))).toBe(true);
    expect(generated.insights.some((item) => /channel|caused|perfect|good extraction/i.test(item.message))).toBe(false);
    expect(result({ recordType: 'standalone-pressure' }, { pressure: [], weight: [] }).mainTakeaway.message)
      .toContain('No pressure or scale measurements');
  });

  it('handles scale-only recordings, sensor-free Brew, and invalid or missing observations', () => {
    const scaleOnly = generateShotInsights({ shot: shot({ recordType: 'standalone-pressure', labPressureCurve: undefined }),
      profile: { pressure: [], weight: [{ tS: 0, weightG: 0 }], finalWeightG: 0, averageFlowGs: null } });
    expect(scaleOnly.insights.some((item) => item.message.includes('Last observed scale weight was 0 g'))).toBe(true);
    expect(scaleOnly.insights.some((item) => item.category === 'pressure-observation')).toBe(false);

    const brewWithoutSensors = result({ labPressureCurve: undefined, scaleFlowCurve: undefined }, {});
    expect(brewWithoutSensors.insights.some((item) => item.category === 'pressure-observation' || item.category === 'flow-observation')).toBe(false);

    const invalid = result({ actualTimeS: Number.NaN, actualYieldG: Number.NaN }, {
      pressure: [{ tS: 0, bar: Number.NaN }], peakPressureBar: Number.NaN,
      weight: [], finalWeightG: Number.NaN, averageFlowGs: Number.NaN,
    });
    expect(invalid.insights.some((item) => /NaN|Infinity|0\.0 bar/.test(item.message))).toBe(false);
  });

  it('surfaces interruptions and approximate historical alignment', () => {
    const generated = result({}, { pressure: [{ tS: 0, bar: 0 }], pressureInterrupted: true,
      scaleInterrupted: true, approximate: true });
    expect(generated.insights.map((item) => item.category)).toEqual(expect.arrayContaining([
      'sensor-availability', 'timing-context',
    ]));
    expect(generated.insights.find((item) => item.category === 'timing-context').message).toContain('approximately');
    const interruptedOnly = result({ recordType: 'standalone-pressure' }, {
      pressure: [{ tS: 0, bar: Number.NaN }], pressureInterrupted: true,
    });
    expect(interruptedOnly.mainTakeaway.message).toContain('no saved Dial target');
    expect(interruptedOnly.observations.some((item) => item.category === 'sensor-availability')).toBe(true);
  });

  it('returns stable, bounded presentation slots for incomplete historical records', () => {
    const incomplete = generateShotInsights({ shot: {} });
    expect(incomplete.mainTakeaway.message).toContain('No saved targets or measurements');
    expect(incomplete.observations.length).toBeLessThanOrEqual(2);
    expect(result({ actualTimeS: 0 }).mainTakeaway.message).toContain('faster than the saved');
    expect(generateShotInsights({ shot: shot({ targetTimeMinS: null, targetTimeMaxS: null }), profile: {} }))
      .toEqual(generateShotInsights({ shot: shot({ targetTimeMinS: null, targetTimeMaxS: null }), profile: {} }));
  });
});
