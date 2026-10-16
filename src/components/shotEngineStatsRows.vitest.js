import { describe, expect, it } from 'vitest';
import {
  buildShotEngineStatsRows,
  shotHasSmartScaleLoggedData,
} from './shotEngineStatsRows.js';
import { formatSecondsPerStepDisplay } from '../utils/grinderSensitivityDisplay.js';

const baseStats = {
  timeDelta: -2,
  yieldDelta: 1.5,
  sensitivity: 1.25,
  sensitivityConfidence: 0.5,
  sensitivityUsedEmpiricalSlope: true,
  sensitivityIsDefault: false,
  shiftSummary: 'No recommendation recorded for this shot.',
  ageOffsetNote: null,
  evidenceContext: null,
};

describe('shotEngineStatsRows', () => {
  it('does not treat a shot without scale fields as scale-logged', () => {
    expect(shotHasSmartScaleLoggedData({ actualYieldG: 36 })).toBe(false);
    expect(shotHasSmartScaleLoggedData(null)).toBe(false);
  });

  it('detects scale flow curve or rate on logged shots', () => {
    expect(shotHasSmartScaleLoggedData({ scaleFlowCurve: [{ t: 0, g: 0 }] })).toBe(true);
    expect(shotHasSmartScaleLoggedData({ scaleFlowRateGs: 1.2 })).toBe(true);
  });

  it('builds standard rows when no scale data was stored', () => {
    const rows = buildShotEngineStatsRows(
      baseStats,
      { actualYieldG: 36 },
      formatSecondsPerStepDisplay
    );
    expect(rows.map((r) => r.label)).toEqual([
      'Time delta (vs midpoint)',
      'Yield delta (vs target)',
      'Sensitivity',
      'Applied shift',
      'Age / freshness',
      'Baseline history',
    ]);
    expect(rows.some((r) => r.label.startsWith('Scale'))).toBe(false);
  });

  it('inserts scale yield and flow rows when scale metrics exist', () => {
    const rows = buildShotEngineStatsRows(
      baseStats,
      {
        actualYieldG: 35.2,
        scaleFlowCurve: [{ t: 0, g: 0 }, { t: 1, g: 10 }],
        scaleFlowRateGs: 1.85,
      },
      formatSecondsPerStepDisplay
    );
    expect(rows.map((r) => r.label)).toEqual([
      'Time delta (vs midpoint)',
      'Yield delta (vs target)',
      'Scale measured yield',
      'Scale avg flow',
      'Sensitivity',
      'Applied shift',
      'Age / freshness',
      'Baseline history',
    ]);
    expect(rows.find((r) => r.label === 'Scale measured yield')?.value).toBe('35.2g');
    expect(rows.find((r) => r.label === 'Scale avg flow')?.value).toBe('1.85 g/s');
  });

  it('shows scale yield without flow row when only the curve was stored', () => {
    const rows = buildShotEngineStatsRows(
      baseStats,
      { actualYieldG: 40, scaleFlowCurve: [{ t: 0, g: 0 }] },
      formatSecondsPerStepDisplay
    );
    expect(rows.map((r) => r.label)).toContain('Scale measured yield');
    expect(rows.map((r) => r.label)).not.toContain('Scale avg flow');
  });
});
