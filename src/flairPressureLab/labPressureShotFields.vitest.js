import { describe, expect, it, vi } from 'vitest';
import { buildLabPressureShotFields } from './labPressureShotFields.js';

describe('buildLabPressureShotFields', () => {
  it('returns curve fields from stop-time metrics state', () => {
    const { fields } = buildLabPressureShotFields({
      labCameraPressureEnabled: true,
      labPressureShotMetrics: {
        labPressureCurve: [{ tS: 0, bar: 3 }],
        labPressurePeakBar: 3,
      },
      captureLabPressureShotMetrics: () => ({}),
    });
    expect(fields.labPressureCurve).toHaveLength(1);
    expect(fields.labPressureMissingReason).toBeUndefined();
  });

  it('falls back to capture when state is empty', () => {
    const { fields } = buildLabPressureShotFields({
      labCameraPressureEnabled: true,
      labPressureShotMetrics: null,
      captureLabPressureShotMetrics: () => ({
        labPressureCurve: [{ tS: 1, bar: 6 }],
        labPressurePeakBar: 6,
      }),
    });
    expect(fields.labPressurePeakBar).toBe(6);
  });

  it('records missing reason when lab enabled but no curve', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fields, missingReason } = buildLabPressureShotFields({
      labCameraPressureEnabled: true,
      labPressureShotMetrics: null,
      captureLabPressureShotMetrics: () => ({ labPressureRawSampleCount: 42 }),
    });
    expect(missingReason).toBe('no_curve_after_filter');
    expect(fields.labPressureMissingReason).toBe('no_curve_after_filter');
    warn.mockRestore();
  });
});
