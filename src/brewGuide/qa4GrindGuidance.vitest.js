import { describe, it, expect } from 'vitest';
import { brewDialSummary, buildBrewSteps } from './steps.js';
import { buildBrewGuideDialPayload } from './grinderBrewGuide.js';
import { buildQuickChecklist } from './guidance.js';

describe('current and suggested grind guidance', () => {
  it('keeps the current value separate from an unapplied suggestion', () => {
    const dial = buildBrewGuideDialPayload({ beanName: 'Coffee', grinderModel: 'Sette 270Wi', grindLabel: '14-D', suggestedGrindLabel: '13-H' });
    expect(brewDialSummary(dial).metrics).toEqual(expect.arrayContaining([
      { label: 'Current grind', value: '14-D' },
      { label: 'Suggested grind (not applied)', value: '13-H' },
    ]));
    const grind = buildBrewSteps({}, dial).find((step) => step.id === 'grindSetting');
    expect(grind.highlight).toBe('14-D');
    expect(grind.instruction).toContain('Suggested: 13-H');
    expect(buildQuickChecklist({}, dial).map((item) => item.text).join(' ')).toContain('Suggested: 13-H (not applied)');
  });
  it.each([undefined, '14-D'])('does not duplicate a missing or equal suggestion', (suggestedGrindLabel) => {
    const summary = brewDialSummary({ grindLabel: '14-D', suggestedGrindLabel });
    expect(summary.suggestedGrindLabel).toBeNull();
    expect(summary.metrics.some((metric) => metric.label.startsWith('Suggested'))).toBe(false);
  });
});
