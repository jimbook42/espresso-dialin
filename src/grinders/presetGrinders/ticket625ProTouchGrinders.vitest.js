import { describe, expect, it } from 'vitest';
import {
  BARISTA_PRO_GRINDER_ID,
  BARISTA_TOUCH_GRINDER_ID,
  getPresetGrinderSpec,
  isHeldbackEstimatedPresetId,
} from './catalog.js';
import { defaultPresetGrindValue } from './dial.js';
import { getPresetGrinderDefinition } from './index.js';
import {
  getPresetUpperBurr,
  presetUpperBurrSettingsKey,
  validatePresetUpperBurrInput,
} from './presetOptionalFields.js';
import { getInitialGrindRecommendation } from '../../utils/grinderLogic.js';

const BEAN = { id: 'bean-625', roastType: 'Medium' };
const RECIPE = { beanId: BEAN.id, targetTimeMinS: 27, targetTimeMaxS: 32, targetDoseG: 18, targetYieldG: 36 };

describe('Ticket 6.25 Barista Pro and Touch presets', () => {
  it('Barista Pro: range, direction, start, estimated', () => {
    const spec = getPresetGrinderSpec(BARISTA_PRO_GRINDER_ID);
    expect(spec.lowerIsFiner).toBe(true);
    expect(spec.min).toBe(1);
    expect(spec.max).toBe(30);
    expect(defaultPresetGrindValue(spec)).toBe(15);
    expect(getPresetGrinderDefinition(BARISTA_PRO_GRINDER_ID).recommendationIsEstimated).toBe(true);
    expect(isHeldbackEstimatedPresetId(BARISTA_PRO_GRINDER_ID)).toBe(true);
  });

  it('Barista Touch: range, direction, start, estimated', () => {
    const spec = getPresetGrinderSpec(BARISTA_TOUCH_GRINDER_ID);
    expect(spec.lowerIsFiner).toBe(true);
    expect(spec.min).toBe(1);
    expect(spec.max).toBe(30);
    expect(defaultPresetGrindValue(spec)).toBe(14);
    expect(getPresetGrinderDefinition(BARISTA_TOUCH_GRINDER_ID).recommendationIsEstimated).toBe(true);
    expect(isHeldbackEstimatedPresetId(BARISTA_TOUCH_GRINDER_ID)).toBe(true);
  });

  it('upperBurr settings keys and default for Pro and Touch', () => {
    expect(presetUpperBurrSettingsKey(BARISTA_PRO_GRINDER_ID)).toBe('bes878UpperBurr');
    expect(presetUpperBurrSettingsKey(BARISTA_TOUCH_GRINDER_ID)).toBe('bes880UpperBurr');
    expect(getPresetUpperBurr({}, BARISTA_PRO_GRINDER_ID)).toBe(6);
    expect(getPresetUpperBurr({ bes880UpperBurr: 7 }, BARISTA_TOUCH_GRINDER_ID)).toBe(7);
  });

  it('upperBurr validation: default, warn non-6, reject out of range', () => {
    expect(validatePresetUpperBurrInput('6').warning).toBeNull();
    expect(validatePresetUpperBurrInput('8').warning).toMatch(/Factory default is 6/);
    expect(validatePresetUpperBurrInput('11').ok).toBe(false);
    expect(validatePresetUpperBurrInput('0').ok).toBe(false);
  });

  it('fresh-bean initial grind uses preset defaults', () => {
    for (const id of [BARISTA_PRO_GRINDER_ID, BARISTA_TOUCH_GRINDER_ID]) {
      const spec = getPresetGrinderSpec(id);
      const initial = getInitialGrindRecommendation(id, 'Medium', BEAN, [RECIPE], [], [BEAN]);
      expect(initial.customGrindValue).toBe(defaultPresetGrindValue(spec));
    }
  });
});
