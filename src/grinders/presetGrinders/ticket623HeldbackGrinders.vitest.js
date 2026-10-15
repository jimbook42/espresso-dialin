import { describe, expect, it } from 'vitest';
import {
  BARISTA_EXPRESS_GRINDER_ID,
  DF54_GRINDER_ID,
  DF64_GEN2_GRINDER_ID,
  TIMEMORE_SCULPTOR_064S_GRINDER_ID,
  getPresetGrinderSpec,
  isHeldbackEstimatedPresetId,
} from './catalog.js';
import {
  defaultPresetGrindValue,
  formatPresetGrindDisplay,
  parsePresetGrindValue,
  resolveEffectiveZeroOffsetPresetDial,
} from './dial.js';
import { getPresetGrinderDefinition } from './index.js';
import { getRecommendationGrinderProfile } from '../grinderRegistry.js';
import { getInitialGrindRecommendation } from '../../utils/grinderLogic.js';
import {
  formatPresetZeroPlusDisplay,
  presetZeroPlusOffset,
  validatePresetUpperBurrInput,
  validatePresetZeroOffsetInput,
} from './presetOptionalFields.js';
import { formatGrindRecommendationSummary } from '../../utils/grindRecommendationDisplay.js';

const BEAN = { id: 'bean-623', roastType: 'Medium' };
const RECIPE = { beanId: BEAN.id, targetTimeMinS: 27, targetTimeMaxS: 32, targetDoseG: 18, targetYieldG: 36 };

describe('Ticket 6.23 held-back grinder presets', () => {
  it('Barista Express: range, direction, start, estimated', () => {
    const spec = getPresetGrinderSpec(BARISTA_EXPRESS_GRINDER_ID);
    expect(spec.lowerIsFiner).toBe(true);
    expect(spec.min).toBe(1);
    expect(spec.max).toBe(16);
    expect(defaultPresetGrindValue(spec)).toBe(5);
    expect(getPresetGrinderDefinition(BARISTA_EXPRESS_GRINDER_ID).recommendationIsEstimated).toBe(true);
  });

  it('resolveEffectiveZeroOffsetPresetDial upgrades implicit default when zero is set', () => {
    const spec = getPresetGrinderSpec(DF64_GEN2_GRINDER_ID);
    const withZero = { df64Gen2ZeroOffset: 20 };
    expect(resolveEffectiveZeroOffsetPresetDial(12, spec, withZero, false)).toBe(32);
    expect(resolveEffectiveZeroOffsetPresetDial(25, spec, withZero, false)).toBe(25);
  });

  it('DF64 Gen 2: zero+N default and with calibrated zero', () => {
    const spec = getPresetGrinderSpec(DF64_GEN2_GRINDER_ID);
    expect(spec.zeroStartOffset).toBe(12);
    expect(defaultPresetGrindValue(spec)).toBe(12);
    expect(formatPresetGrindDisplay(12, spec)).toBe('zero + 12');
    const withZero = { df64Gen2ZeroOffset: 20 };
    expect(defaultPresetGrindValue(spec, withZero)).toBe(32);
    expect(formatPresetGrindDisplay(32, spec, withZero)).toBe('zero + 12 (dial 32)');
    expect(presetZeroPlusOffset(32, spec, withZero)).toBe(12);
  });

  it('DF54: zero + 15 start', () => {
    const spec = getPresetGrinderSpec(DF54_GRINDER_ID);
    expect(defaultPresetGrindValue(spec)).toBe(15);
    expect(formatPresetGrindDisplay(15, spec)).toBe('zero + 15');
  });

  it('Timemore Sculptor 064S: stepless subdivisions and start', () => {
    const spec = getPresetGrinderSpec(TIMEMORE_SCULPTOR_064S_GRINDER_ID);
    expect(spec.dialKind).toBe('stepless');
    expect(spec.step).toBe(0.1);
    expect(defaultPresetGrindValue(spec)).toBe(1.5);
    expect(parsePresetGrindValue(1.5, spec)).toBe(1.5);
  });

  it('upperBurr validation: default, warn non-6, reject out of range', () => {
    expect(validatePresetUpperBurrInput('').ok).toBe(true);
    expect(validatePresetUpperBurrInput('6').warning).toBeNull();
    expect(validatePresetUpperBurrInput('7').warning).toMatch(/Factory default is 6/);
    expect(validatePresetUpperBurrInput('0').ok).toBe(false);
    expect(validatePresetUpperBurrInput('11').ok).toBe(false);
  });

  it('zeroOffset validation respects dial range', () => {
    const spec = getPresetGrinderSpec(DF54_GRINDER_ID);
    expect(validatePresetZeroOffsetInput('10', spec).ok).toBe(true);
    expect(validatePresetZeroOffsetInput('120', spec).ok).toBe(false);
  });

  it('fresh-bean initial grind uses preset defaults', () => {
    for (const id of [
      BARISTA_EXPRESS_GRINDER_ID,
      DF64_GEN2_GRINDER_ID,
      DF54_GRINDER_ID,
      TIMEMORE_SCULPTOR_064S_GRINDER_ID,
    ]) {
      const spec = getPresetGrinderSpec(id);
      const initial = getInitialGrindRecommendation(
        id,
        'Medium',
        BEAN,
        [RECIPE],
        [],
        [BEAN]
      );
      expect(initial.customGrindValue).toBe(defaultPresetGrindValue(spec));
    }
  });

  it('recommendation summary is labelled Estimated for new presets', () => {
    const spec = getPresetGrinderSpec(DF64_GEN2_GRINDER_ID);
    const profile = getRecommendationGrinderProfile(DF64_GEN2_GRINDER_ID);
    expect(profile.recommendationIsEstimated).toBe(true);
    const summary = formatGrindRecommendationSummary(
      DF64_GEN2_GRINDER_ID,
      {
        reason: 'ESTIMATED — Grind finer — shot ran fast',
        recommendedSetting: { customGrindValue: defaultPresetGrindValue(spec) },
      },
      null
    );
    expect(summary).toMatch(/Estimated/i);
    expect(summary).toMatch(/zero \+ 12/);
  });

  it('held-back preset ids are flagged for starting-card Estimated label', () => {
    expect(isHeldbackEstimatedPresetId(BARISTA_EXPRESS_GRINDER_ID)).toBe(true);
    expect(isHeldbackEstimatedPresetId('Baratza Encore ESP')).toBe(false);
  });

  it('zero offset set shows absolute dial in parentheses; unset does not', () => {
    const spec = getPresetGrinderSpec(DF64_GEN2_GRINDER_ID);
    expect(formatPresetGrindDisplay(32, spec)).toBe('zero + 32');
    expect(formatPresetGrindDisplay(32, spec, { df64Gen2ZeroOffset: 20 })).toBe(
      'zero + 12 (dial 32)'
    );
    expect(formatGrindRecommendationSummary(
      DF64_GEN2_GRINDER_ID,
      {
        reason: 'ESTIMATED — Grind finer',
        recommendedSetting: { customGrindValue: 32 },
      },
      { df64Gen2ZeroOffset: 20 }
    )).toMatch(/zero \+ 12 \(dial 32\)/);
  });

  it('formatPresetZeroPlusDisplay rounds stepped zero-offset grinders to whole numbers', () => {
    const spec = getPresetGrinderSpec(DF64_GEN2_GRINDER_ID);
    expect(formatPresetZeroPlusDisplay(12.5, spec)).toBe('zero + 13');
  });
});
