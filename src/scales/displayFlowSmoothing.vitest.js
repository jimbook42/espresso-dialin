import { describe, expect, it } from 'vitest';
import { benchmark, flowFixture } from '../../scripts/flow-smoothing-benchmark.mjs';
import { buildPressureFlowAnalytics } from '../utils/pressureFlowAnalytics.js';
import { buildExtractionFlowPlot, buildShotProfile } from '../utils/shotProfile.js';
import { createLiveFlowDisplay, plottedFlowFromWeights, SAVED_SMOOTH_FLOW_WINDOW_S } from './displayFlow.js';
import { flowPointsForPlot, splitFlowPlot, typicalFlowRange } from './flowPlotRange.js';

const sample = (tS, weightG) => ({ tS, weightG });
const quantized = (weightG) => Math.round(weightG * 10) / 10;
const straight = (length, step = 0.1) => Array.from({ length }, (_, i) => sample(i * step, quantized(i * step)));

describe('display-only flow estimation', () => {
  it('reduces error and noise with quantised, bursty BLE data while retaining the peak', () => {
    const stats = Object.fromEntries(benchmark().map(({ name, ...values }) => [name, values]));
    const live = stats['Causal regression 1 s'];
    const saved = stats['Centred regression 1.5 s'];
    expect(live.steadyNoise).toBeLessThan(stats['Current live (0.75 s)'].steadyNoise * 0.65);
    expect(saved.steadyNoise).toBeLessThan(stats['Current saved / detail'].steadyNoise * 0.2);
    expect(live.steadyMae).toBeLessThan(0.1);
    expect(saved.steadyMae).toBeLessThan(0.05);
    for (const measured of [live, saved]) expect(Math.abs(measured.peakGs - 3.6)).toBeLessThan(0.25);
    expect(live.onsetS).toBeLessThan(0.7);
    expect(live.accelerationS).toBeLessThan(0.7);
    expect(live.stopS).toBeLessThan(0.7);
    expect(Math.abs(saved.accelerationS)).toBeLessThan(0.2);
  });

  it('keeps duplicate observations on the same clock instant and rejects invalid or reversed time', () => {
    const live = createLiveFlowDisplay();
    const add = (tS, weightG) => live.add(sample(tS, weightG));
    expect(add(-0.1, -0.1)).toEqual({ smooth: null, detail: null });
    [0, 0.1, 0.2, 0.3].forEach((time) => add(time, time));
    expect(add(0.4, 0.4).smooth.flowGs).toBeCloseTo(1);
    const duplicate = add(0.4, 0.5);
    expect(duplicate.smooth.tS).toBe(0.4);
    expect(duplicate.smooth.flowGs).toBeLessThan(1.5);
    expect(duplicate.detail.flowGs).toBeLessThan(2);
    expect(add(0.401, 0.5).detail.flowGs).toBeLessThan(2);
    expect(add(0.2, 20)).toEqual({ smooth: null, detail: null });
    expect(add(NaN, 50)).toEqual({ smooth: null, detail: null });
    expect(add(0.5, 0.5)).toEqual({ smooth: null, detail: null });
    [0.6, 0.7, 0.8].forEach((time) => add(time, time));
    expect(add(0.9, 0.9).smooth).toMatchObject({ breakBefore: true, flowGs: expect.closeTo(1) });
  });

  it('shows initial zero, a gradual rise, a sustained plateau, a taper and the final zero', () => {
    const events = straight(164).map(({ tS }) => {
      const rise = Math.min(2, Math.max(0, tS - 2));
      const fall = Math.min(2, Math.max(0, tS - 10));
      return sample(tS, quantized(0.3 * rise ** 2 + 1.2 * Math.max(0, Math.min(tS - 4, 6)) + 1.2 * fall - 0.3 * fall ** 2));
    });
    const live = createLiveFlowDisplay();
    const rows = events.map((point) => live.add(point));
    const saved = plottedFlowFromWeights(events, 0, Infinity, SAVED_SMOOTH_FLOW_WINDOW_S);
    for (const series of [rows.map(({ smooth }) => smooth).filter(Boolean),
      rows.map(({ detail }) => detail).filter(Boolean), saved]) {
      const value = (at) => series.find(({ tS }) => Math.abs(tS - at) < 1e-8).flowGs;
      expect(value(1)).toBe(0);
      expect(value(3)).toBeGreaterThan(0);
      expect(value(3)).toBeLessThan(value(4));
      expect(value(6)).toBeCloseTo(1.2, 1);
      expect(value(9)).toBeCloseTo(1.2, 1);
      expect(value(11)).toBeLessThan(value(9));
      expect(value(14)).toBe(0);
    }
  });

  it('keeps transport gaps, cup disturbances, explicit resets and negative weights from generating rebound flow', () => {
    const events = [
      ...straight(11), sample(1.1, -0.4),
      ...straight(11).map(({ tS, weightG }) => sample(tS + 1.2, weightG + 1.2)),
      ...straight(11).map(({ tS, weightG }) => sample(tS + 3, weightG + 2.2)),
      ...straight(11).map(({ tS, weightG }) => ({ ...sample(tS + 4.1, weightG), reset: tS === 0 })),
    ];
    const live = createLiveFlowDisplay();
    const rows = events.map((point) => live.add(point));
    const saved = [0, SAVED_SMOOTH_FLOW_WINDOW_S].map((window) =>
      plottedFlowFromWeights(events, 0, Infinity, window));
    for (const series of [...saved, ...['detail', 'smooth'].map((key) => rows.map((row) => row[key]).filter(Boolean))]) {
      expect(series.filter(({ breakBefore }) => breakBefore)).toHaveLength(4);
      expect(series.every(({ flowGs }) => Math.abs(flowGs - 1) < 1e-8)).toBe(true);
      expect(series.some(({ tS }) => tS === 1.1)).toBe(false);
    }
    live.interrupt();
    expect(live.add(sample(0, 0))).toEqual({ smooth: null, detail: null });
  });

  it('keeps unsupported internal fits separate and retains short runs of usable detail', () => {
    const events = [sample(0, 0), sample(0.25, 0.3), sample(1, 1),
      sample(1.2, 1.2), sample(1.4, 1.4), sample(1.9, 1.9), sample(2.1, 2.1), sample(2.3, 2.3)];
    const flow = plottedFlowFromWeights(events, 0, Infinity, SAVED_SMOOTH_FLOW_WINDOW_S);
    expect(flow[0]).toMatchObject({ tS: 0.25, breakBefore: true });
    expect(flow.find(({ tS }) => tS >= 1)).toMatchObject({ breakBefore: true });
    const interrupted = [sample(0, 0), sample(0.2, 0.2), sample(0.4, 0.4),
      { ...sample(0.5, 25), gap: true }, sample(0.6, 0.6), sample(0.8, 0.8), sample(1, 1)];
    for (const window of [0, SAVED_SMOOTH_FLOW_WINDOW_S]) {
      const plotted = plottedFlowFromWeights(interrupted, 0, Infinity, window);
      expect(plotted.filter(({ breakBefore }) => breakBefore)).toHaveLength(2);
      expect(plotted.every(({ flowGs }) => Math.abs(flowGs - 1) < 1e-8)).toBe(true);
    }
  });

  it('keeps numeric spikes visible as markers and retains sustained peaks and gaps in long traces', () => {
    const points = straight(18001).map(({ tS }, i) => ({
      tS, flowGs: i === 100 ? 40 : i >= 1000 && i <= 1010 ? 4.2 : 1.2,
      breakBefore: i === 400,
    }));
    expect(typicalFlowRange(points.slice(99, 102))).toEqual([0, 2]);
    const [min, max] = typicalFlowRange(points);
    expect(max).toBe(4.2);
    const { visible, outliers } = splitFlowPlot(points, min, max);
    expect(outliers).toEqual([points[100]]);
    const display = flowPointsForPlot(visible, 0, points.at(-1).tS, 300);
    expect(display.length).toBeLessThan(1210);
    expect(display[0]).toBe(points[0]);
    expect(display.at(-1)).toBe(points.at(-1));
    expect(display).toContain(points[400]);
    expect(display.some(({ flowGs }) => flowGs === 4.2)).toBe(true);
    expect(display.find(({ tS }) => tS === points[101].tS).breakBefore).toBe(true);
  });

  it('shares extraction flow across saved surfaces while preserving pressure bands, clocks, and recorded data', () => {
    const { events } = flowFixture();
    const shot = {
      actualDoseG: 18.3, actualYieldG: 32.6, actualTimeS: 11,
      scaleFlowCurve: events, labPressureCurve: straight(270, 0.05).map(({ tS }) => ({ tS, bar: 6 })),
      shotProfileTiming: {
        version: 1, scaleSource: 'native-ble', pressureSource: 'camera', scaleInterrupted: false,
        clockDriftMs: 0, scaleOriginMs: 1300, pressureOriginMs: 1000, extractionStartMs: 2000, extractionEndMs: 13000,
      },
    };
    const original = structuredClone(shot);
    const on = buildPressureFlowAnalytics(shot, { smoothFlow: true });
    const off = buildPressureFlowAnalytics(shot, { smoothFlow: false });
    expect({ ...on, displayFlow: off.displayFlow }).toEqual(off);
    expect(on.bands.length).toBeGreaterThan(0);
    expect(on.displayFlow).not.toEqual(off.displayFlow);
    for (const smoothFlow of [false, true]) {
      const profile = buildShotProfile(shot, { smoothFlow, physicalOnly: true });
      const advanced = smoothFlow ? on : off;
      expect(buildExtractionFlowPlot(shot, smoothFlow)).toEqual(advanced.displayFlow);
      expect(profile.flow).toHaveLength(advanced.displayFlow.length);
      profile.flow.forEach((point, index) => {
        expect(point.tS - 2).toBeCloseTo(advanced.displayFlow[index].tS, 9);
        expect(point.flowGs).toBeCloseTo(advanced.displayFlow[index].flowGs, 9);
      });
    }
    expect(shot).toEqual(original);
  });
});
