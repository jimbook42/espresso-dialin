import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { availableShotMetrics, cycleShotMetric, resolveShotScreen, shotEquipmentPatch } from './shotScreenLayout.js';
import { patchGlobalSettings } from './patchGlobalSettings.js';

describe('shot screen setup', () => {
  it.each([
    [false, false, 'timer', ['time']],
    [false, true, 'scale', ['weight', 'time', 'flow']],
    [true, false, 'gauge', ['pressure', 'time']],
    [true, true, 'gauge-scale', ['pressure', 'weight', 'time', 'flow']],
  ])('chooses a layout for gauge=%s scale=%s', (gauge, scale, layout, metrics) => {
    const equipment = { gauge, scale };
    const result = resolveShotScreen({}, equipment);
    expect(result.layout).toBe(layout);
    expect(result.available).toEqual(metrics);
    expect(result.bigNumber).toBe(metrics[0]);
    expect(result.cameraPreview).toBe(gauge);
  });

  it('falls back when the saved big number is no longer available', () => {
    expect(resolveShotScreen({ shotScreen: { bigNumber: 'pressure', showGauge: true } }).bigNumber).toBe('time');
    expect(resolveShotScreen({ shotScreen: { showGauge: true, chart: true } }).showGauge).toBe(false);
  });

  it('cycles only through available metrics, pressure first and wraps', () => {
    const available = availableShotMetrics({ gauge: true, scale: false });
    expect(cycleShotMetric('pressure', available)).toBe('time');
    expect(cycleShotMetric('time', available)).toBe('pressure');
    expect(cycleShotMetric('time', ['time'])).toBe('time');
  });

  it('persists presentation settings using the existing store without changing shots or bean settings', async () => {
    const db = new Dexie('shot-screen-settings-test');
    db.version(1).stores({ settings: 'id', shots: 'id' });
    const shot = { id: 'existing', beanId: 'bean', actualDoseG: 18, actualTimeS: 30 };
    try {
      await db.settings.put({ id: 'global', grinderModel: 'existing grinder', lastSelectedBeanId: 'bean' });
      await db.shots.put(shot);
      await patchGlobalSettings(db, shotEquipmentPatch({ gauge: true, scale: true }));
      await patchGlobalSettings(db, (row) => ({ shotScreen: { ...row.shotScreen, minimal: true } }));
      const settings = await db.settings.get('global');
      expect(settings.grinderModel).toBe('existing grinder');
      expect(settings.lastSelectedBeanId).toBe('bean');
      expect(resolveShotScreen(settings)).toMatchObject({ layout: 'gauge-scale', minimal: true });
      expect(await db.shots.toArray()).toEqual([shot]);
    } finally {
      await db.delete();
    }
  });
});
