import { describe, expect, it } from 'vitest';
import { buildStandalonePressureShot } from './standalonePressureShot.js';
import { shotEligibleForLearning } from '../utils/grinderLogic.js';

const capture = {
  id: 'standalone-1',
  timestamp: '2026-11-10T00:00:00Z',
  durationS: 125,
  pressure: {
    labPressureCurve: [{ tS: .1, bar: 0 }, { tS: 3.4, bar: 0 }, { tS: 120, bar: 0 }],
    labPressurePeakBar: 0,
  },
  details: { name: '', dose: '', yield: '', rating: '', notes: '' },
};

describe('standalone pressure shots', () => {
  it('keeps zero bar, long captures and observation gaps without inventing optional details', () => {
    expect(buildStandalonePressureShot(capture)).toEqual({
      id: capture.id, timestamp: capture.timestamp, recordType: 'standalone-pressure',
      actualTimeS: 125, ...capture.pressure,
    });
  });

  it('rejects empty or nonfinite captures', () => {
    expect(buildStandalonePressureShot({ ...capture, pressure: null })).toBeNull();
    expect(buildStandalonePressureShot({
      ...capture, pressure: { labPressureCurve: [{ tS: .1, bar: Number.NaN }] },
    })).toBeNull();
  });

  it('saves optional details and measured scale curve while excluding the record from learning', () => {
    const scale = { scaleFlowCurve: [{ tS: 1, weightG: 1 }, { tS: 2, weightG: 2 }], scaleFlowRateGs: 1 };
    const shot = buildStandalonePressureShot({
      ...capture, scale, details: { name: '  Morning shot  ', dose: '18', yield: '36', rating: '4', notes: '  First pull ' },
    });
    expect(shot).toMatchObject({
      ...scale, shotName: 'Morning shot', actualDoseG: 18, actualYieldG: 36, brewRatio: '1:2.0', shotRating: 4, notes: 'First pull',
    });
    expect(shot).not.toHaveProperty('beanId');
    expect(shot).not.toHaveProperty('grinderModel');
    expect(shotEligibleForLearning(shot)).toBe(false);
  });
});
