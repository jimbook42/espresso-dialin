import { describe, expect, it } from 'vitest';
import {
  buildShotEngineStatsRows,
  shotHasSmartScaleLoggedData,
} from './shotEngineStatsRows.js';
import { formatSecondsPerStepDisplay } from '../utils/grinderSensitivityDisplay.js';
import { getShotEngineStats } from '../utils/grinderLogic.js';
import {
  SETTE_GRINDER_ID,
  SUNBEAM_GRINDER_ID,
} from '../grinders/grinderRegistry.js';
import { DF64_GEN2_GRINDER_ID } from '../grinders/presetGrinders/catalog.js';
import { getPresetGrinderSpec } from '../grinders/presetGrinders/catalog.js';

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

const recipe = { targetTimeMinS: 27, targetTimeMaxS: 32, targetYieldG: 36 };

describe('shotEngineStatsRows', () => {
  it('does not treat a shot without scale fields as scale-logged', () => {
    expect(shotHasSmartScaleLoggedData({ actualYieldG: 36 })).toBe(false);
    expect(shotHasSmartScaleLoggedData(null)).toBe(false);
  });

  it('detects scale flow curve or rate on logged shots', () => {
    expect(shotHasSmartScaleLoggedData({ scaleFlowCurve: [{ t: 0, g: 0 }] })).toBe(true);
    expect(shotHasSmartScaleLoggedData({ scaleFlowRateGs: 1.2 })).toBe(true);
  });

  it('builds technical rows when no scale data was stored', () => {
    const rows = buildShotEngineStatsRows(
      baseStats,
      { grinderModel: SETTE_GRINDER_ID, actualYieldG: 36 },
      formatSecondsPerStepDisplay
    );
    expect(rows.map((r) => r.label)).toEqual([
      'Δt vs target mid (s)',
      'Yield Δ vs target (g)',
      'Sensitivity (s/step, Sette 270Wi)',
      'Grind shift applied',
      'Freshness offset @ log',
      'Recipe-matched evidence',
    ]);
    expect(rows[0].value).toBe('-2');
    expect(rows[1].value).toBe('+1.5');
    expect(rows[2].value).toMatch(/^Estimated · 1\.25$/);
    expect(rows.some((r) => r.label.includes('Scale'))).toBe(false);
  });

  it('inserts scale yield and flow rows when scale metrics exist', () => {
    const rows = buildShotEngineStatsRows(
      baseStats,
      {
        grinderModel: SUNBEAM_GRINDER_ID,
        actualYieldG: 35.2,
        scaleFlowCurve: [{ t: 0, g: 0 }, { t: 1, g: 10 }],
        scaleFlowRateGs: 1.85,
      },
      formatSecondsPerStepDisplay
    );
    expect(rows.map((r) => r.label)).toEqual([
      'Δt vs target mid (s)',
      'Yield Δ vs target (g)',
      'Scale yield (g)',
      'Scale mean flow (g/s)',
      'Sensitivity (s/step, Sunbeam)',
      'Grind shift applied',
      'Freshness offset @ log',
      'Recipe-matched evidence',
    ]);
    expect(rows.find((r) => r.label === 'Scale yield (g)')?.value).toBe('35.2');
    expect(rows.find((r) => r.label === 'Scale mean flow (g/s)')?.value).toBe('1.85');
  });

  it('shows scale yield without flow row when only the curve was stored', () => {
    const rows = buildShotEngineStatsRows(
      baseStats,
      { actualYieldG: 40, scaleFlowCurve: [{ t: 0, g: 0 }] },
      formatSecondsPerStepDisplay
    );
    expect(rows.map((r) => r.label)).toContain('Scale yield (g)');
    expect(rows.map((r) => r.label)).not.toContain('Scale mean flow (g/s)');
  });

  it('getShotEngineStats sensitivity follows shot grinder when engineStats is missing', () => {
    const shotBase = { actualTimeS: 29.5, actualYieldG: 36 };
    const sette = getShotEngineStats({ ...shotBase, grinderModel: SETTE_GRINDER_ID }, recipe);
    const sunbeam = getShotEngineStats({ ...shotBase, grinderModel: SUNBEAM_GRINDER_ID }, recipe);
    const df64 = getShotEngineStats({ ...shotBase, grinderModel: DF64_GEN2_GRINDER_ID }, recipe);
    expect(sette.sensitivity).toBe(1.25);
    expect(sunbeam.sensitivity).toBe(4.5);
    expect(df64.sensitivity).toBe(getPresetGrinderSpec(DF64_GEN2_GRINDER_ID).sensitivity);
  });

  it('getShotEngineStats uses stored sensitivity from recommendation when present', () => {
    const learned = 2.1;
    const stats = getShotEngineStats(
      {
        grinderModel: SUNBEAM_GRINDER_ID,
        actualTimeS: 30,
        actualYieldG: 36,
        recommendation: {
          engineStats: {
            sensitivity: learned,
            sensitivityConfidence: 0.9,
            sensitivityUsedEmpiricalSlope: true,
            sensitivityIsDefault: false,
            timeDelta: 0,
            yieldDelta: 0,
            targetMid: 29.5,
            targetYield: 36,
          },
        },
      },
      recipe
    );
    expect(stats.sensitivity).toBe(learned);
  });
});
