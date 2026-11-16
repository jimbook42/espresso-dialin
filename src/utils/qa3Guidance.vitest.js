import { describe, expect, it } from 'vitest';
import { buildQuickChecklist } from '../brewGuide/guidance.js';
import { brewStopYield, buildBrewSteps } from '../brewGuide/steps.js';
import { buildNicheFallbackReason } from '../grinders/nicheZeroLearning.js';
import { calculateRecommendation } from './grinderLogic.js';

const dial = { grinderModel: 'Sette 270Wi', beanName: 'Test', doseG: 18, timeMinS: 27, timeMaxS: 32 };
const recipe = { targetDoseG: 18, targetYieldG: 36, targetTimeMinS: 27, targetTimeMaxS: 32 };

describe('F11 timing explanations', () => {
  it.each([-7.5, 7.5])('rounds a %s s deviation symmetrically', (timeDelta) => {
    const shot = {
      grinderModel: dial.grinderModel, setteMacro: 14, setteMicro: 'E', wasPurged: true,
      actualTime: 29.5 + timeDelta, actualDose: 18, actualYield: 36, tasteProfile: 'balanced',
    };
    expect(calculateRecommendation(shot, recipe).reason).toContain('8s off target midpoint');
    expect(buildNicheFallbackReason({ timeDelta, reasonCode: 'insufficient_observations' }))
      .toContain(timeDelta < 0 ? '8s fast' : '8s slow');
  });
});

describe('F13 Brew Guide early-stop instructions', () => {
  it.each([[4, null], [4.1, null], [9.9, null], [10, '6'], [36, '32']])(
    'uses the expected guidance for %s g', (yieldG, stopAt) => {
      const steps = buildBrewSteps({}, { ...dial, yieldG });
      const checklist = buildQuickChecklist({}, { ...dial, yieldG });
      expect(brewStopYield(yieldG)).toBe(stopAt);
      expect(steps.find((step) => step.id === 'extract').stopAt).toBe(stopAt);
      const extract = checklist.find((step) => step.id.startsWith('extract-'));
      expect(extract.text).toContain(stopAt ? `stop around ${stopAt}g` : 'Pull shot toward');
    },
  );
});
