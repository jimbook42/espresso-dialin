import { describe, expect, it, vi } from 'vitest';
import { calculateEffectiveBeanAge, calculateRecommendation, getInitialGrindRecommendation } from '../utils/grinderLogic.js';
import { formatGrindRecommendationSummary } from '../utils/grindRecommendationDisplay.js';
import { adjustCustomGrind } from './customGrinder.js';
import {
  formatRecommendedGrindDisplay,
  persistedSettingsPatchFromRecommendation,
  uiStateFromRecommendedSetting,
} from './grinderRegistry.js';

const recipe = { targetTimeMinS: 27, targetTimeMaxS: 32, targetDoseG: 18, targetYieldG: 36 };

function customRecommendation(profile, customGrindValue, actualTime, tasteProfile) {
  return calculateRecommendation({
    grinderModel: profile.name,
    customGrindValue,
    actualTime,
    tasteProfile,
    actualDose: 18,
    actualYield: 36,
    wasPurged: true,
  }, recipe, [], false, { settings: { customGrinder: profile } });
}

describe('custom dial direction', () => {
  const reverse = { name: 'Custom dial', dialType: 'stepped', min: 0, max: 40, step: 1, lowerIsFiner: false };

  it.each([
    ['stepped', 1, true, 18, 22],
    ['stepped', 1, false, 22, 18],
    ['stepless', 0.1, true, 19.8, 20.2],
    ['stepless', 0.1, false, 20.2, 19.8],
    ['stepless', 0.25, true, 19.5, 20.5],
    ['stepless', 0.25, false, 20.5, 19.5],
  ])('%s step %s with lowerIsFiner=%s applies signed engine shifts', (dialType, step, lowerIsFiner, finer, coarser) => {
    const profile = { ...reverse, dialType, step, lowerIsFiner };
    expect(adjustCustomGrind(20, -2, profile)).toBe(finer);
    expect(adjustCustomGrind(20, 2, profile)).toBe(coarser);
  });

  it.each([
    [20, 'sour', -2, 22, 'FINER', 'Grind finer'],
    [39, 'bitter', 2, 18, 'COARSER', 'Grind coarser'],
    [29, 'very_sour', -1, 21, 'FINER', 'Grind finer'],
    [29, 'very_bitter', 1, 19, 'COARSER', 'Grind coarser'],
  ])('agrees across engine, display, apply and persistence for %ss / %s', (time, taste, shift, dial, reason, advice) => {
    const rec = customRecommendation(reverse, 20, time, taste);
    const settings = { grinderModel: reverse.name, customGrinder: reverse };
    expect(rec.engineStats.shift).toBe(shift);
    expect(rec.reason).toContain(reason);
    expect(rec.recommendedSetting).toEqual({ customGrindValue: dial });
    expect(formatRecommendedGrindDisplay(reverse.name, rec.recommendedSetting, settings)).toBe(String(dial));
    expect(formatGrindRecommendationSummary(reverse.name, rec, settings)).toContain(`${advice} ·`);
    expect(uiStateFromRecommendedSetting(reverse.name, rec.recommendedSetting, settings)).toEqual({ customGrindValue: dial });
    expect(persistedSettingsPatchFromRecommendation(reverse.name, rec.recommendedSetting, settings, 'bean')).toEqual({
      lastCustomGrindValue: dial,
      grindUiByBeanGrinder: { 'bean::Custom dial': { customGrindValue: dial } },
    });
  });

  it.each([
    [40, 20, 'sour', 40, 'Already at the finest end'],
    [0, 39, 'bitter', 0, 'Already at the coarsest end'],
    [40, 29, 'very_sour', 40, 'Already at the finest end'],
    [0, 29, 'very_bitter', 0, 'Already at the coarsest end'],
    [39, 20, 'sour', 40, 'finest setting on your dial'],
    [1, 39, 'bitter', 0, 'coarsest setting on your dial'],
    [0, 20, 'sour', 2, 'Grind finer'],
    [40, 39, 'bitter', 38, 'Grind coarser'],
  ])('uses physical dial limits at %s for %ss / %s', (current, time, taste, dial, advice) => {
    const rec = customRecommendation(reverse, current, time, taste);
    expect(rec.recommendedSetting.customGrindValue).toBe(dial);
    expect(rec.grindSettingHeld).toBe(dial === current);
    if (dial === current) expect(rec.reason).toContain('KEEP GRIND');
    expect(formatGrindRecommendationSummary(reverse.name, rec, { customGrinder: reverse })).toContain(advice);
  });

  it.each([
    [0.1, 20, 21.2, '21.2'],
    [0.25, 20, 21, '21.00'],
  ])('preserves fractional step %s and display precision on a fast shot', (step, current, dial, display) => {
    const profile = { ...reverse, dialType: 'stepless', step };
    const settings = { customGrinder: profile };
    const rec = customRecommendation(profile, current, 20, 'sour');
    expect(rec.reason).toContain('INCREMENT(S) FINER');
    expect(rec.recommendedSetting.customGrindValue).toBe(dial);
    expect(formatRecommendedGrindDisplay(reverse.name, rec.recommendedSetting, settings)).toBe(display);
  });
});

describe('bean age in local calendar days', () => {
  const mediumBag = { roastType: 'Medium', storageType: 'bag' };

  it.each([
    [2, -3, -2, 'B', 13], [3, -3, -2, 'B', 13], [4, -2, -1, 'C', 14],
    [6, -2, -1, 'C', 14], [7, -2, -1, 'C', 14], [8, -1, 0, 'D', 15],
    [13, -1, 0, 'D', 15], [14, -1, 0, 'D', 15], [15, 0, 0, 'E', 15],
    [29, 0, 0, 'E', 15], [30, 0, 0, 'E', 15], [31, 1, 1, 'F', 16],
    [44, 1, 1, 'F', 16], [45, 1, 1, 'F', 16], [46, 2, 1, 'G', 16],
    [59, 2, 1, 'G', 16], [60, 2, 1, 'G', 16], [61, 3, 2, 'H', 17],
  ])('uses day %s for freshness offsets and initial Sette/Sunbeam settings', (days, offsetSette, offsetSunbeam, micro, setting) => {
    const roastDate = new Date(Date.UTC(2026, 0, 20 - days)).toISOString().slice(0, 10);
    const bean = { ...mediumBag, roastDate };
    for (const hour of [8, 12, 20]) {
      const now = new Date(2026, 0, 20, hour);
      expect(calculateEffectiveBeanAge(bean, now)).toMatchObject({
        daysOld: days,
        recommendedOffsetSette: offsetSette,
        recommendedOffsetSunbeam: offsetSunbeam,
      });
      expect(getInitialGrindRecommendation('Sette 270Wi', 'Medium', bean, [], [], [], now)).toEqual({ macro: 14, micro });
      expect(getInitialGrindRecommendation('Sunbeam Barista Max', 'Medium', bean, [], [], [], now)).toEqual({ setting });
    }
  });

  it.each([
    ['NZ DST start', '2026-09-26', '2026-09-28T00:15', 2],
    ['NZ DST end', '2026-04-04', '2026-04-06T00:15', 2],
    ['Adelaide DST start', '2026-10-03', '2026-10-05T00:15', 2],
    ['LA DST start', '2026-03-07', '2026-03-09T00:15', 2],
    ['leap day', '2024-02-28', '2024-03-01T00:15', 2],
    ['non-leap February', '2026-02-28', '2026-03-01T00:15', 1],
    ['future roast', '2026-03-02', '2026-03-01T20:00', 0],
    ['legacy local timestamp', '2026-02-28T23:59:59', '2026-03-01T00:15', 1],
    ['date-only override', '2026-02-28', '2026-03-01', 1],
  ])('counts %s by calendar date', (_label, roastDate, now, daysOld) => {
    expect(calculateEffectiveBeanAge({ ...mediumBag, roastDate }, now).daysOld).toBe(daysOld);
  });

  it('uses the local date on the live wall-clock path', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 20, 8));
      expect(calculateEffectiveBeanAge({ ...mediumBag, roastDate: '2026-01-16' }).daysOld).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['standard bag', {}, 19],
    ['vacuum bag', { storageType: 'vacuum' }, 16],
    ['legacy storage', { storageType: undefined }, 19],
    ['missing freeze', { storageType: 'frozen', thawDate: '2026-01-10' }, 19],
    ['invalid freeze', { storageType: 'frozen', freezeDate: 'unknown' }, 19],
    ['future freeze', { storageType: 'frozen', freezeDate: '2026-02-01' }, 19],
    ['freeze before roast', { storageType: 'frozen', freezeDate: '2025-12-30' }, 19],
    ['paused at freeze', { storageType: 'frozen', freezeDate: '2026-01-08' }, 7],
    ['invalid thaw', { storageType: 'frozen', freezeDate: '2026-01-08', thawDate: 'unknown' }, 7],
    ['future thaw', { storageType: 'frozen', freezeDate: '2026-01-08', thawDate: '2026-02-01' }, 7],
    ['thaw before freeze', { storageType: 'frozen', freezeDate: '2026-01-08', thawDate: '2026-01-06' }, 7],
    ['thawed bag', { storageType: 'frozen', freezeDate: '2026-01-08', thawDate: '2026-01-10' }, 18],
    ['thawed vacuum', { storageType: 'frozen', freezeDate: '2026-01-08', thawDate: '2026-01-10', postThawStorage: 'vacuum' }, 16],
  ])('handles %s without changing storage multipliers', (_label, fields, daysOld) => {
    const bean = { ...mediumBag, roastDate: '2026-01-01', ...fields };
    expect(calculateEffectiveBeanAge(bean, new Date(2026, 0, 20, 8)).daysOld).toBe(daysOld);
  });

  it.each([undefined, '', false, 'invalid', '2026-02-30'])('uses neutral freshness offsets for invalid roast date %s', (roastDate) => {
    expect(calculateEffectiveBeanAge({ ...mediumBag, roastDate }, '2026-03-01')).toEqual({
      daysOld: 0, recommendedOffsetSette: 0, recommendedOffsetSunbeam: 0, notice: '',
    });
  });
});
