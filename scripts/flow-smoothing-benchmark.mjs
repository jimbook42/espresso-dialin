import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createDisplayFlowEstimator, createLiveFlowDisplay, plottedFlowFromWeights } from '../src/scales/displayFlow.js';
import { flowRateSeriesFromWeightCurve } from '../src/scales/flowMetrics.js';
import { flowPointsForPlot, splitFlowPlot, typicalFlowRange } from '../src/scales/flowPlotRange.js';

const jitterMs = [0, 0, 197, 100, 10, 0, 91, 0, 0, 0];
const ramp = (t, start, seconds) => Math.max(0, Math.min(seconds, t - start));

export function flowFixture(phase = 0, irregular = true) {
  const start = 2 + phase / 10;
  const speedUp = start + 4;
  const slowDown = speedUp + 1.2;
  const stop = slowDown + 3;
  const events = Array.from({ length: 146 }, (_, i) => {
    const t = i / 10;
    const weight = 1.2 * ramp(t, start, stop - start) + 2.4 * ramp(t, speedUp, 1.2);
    // Notifications are delayed in bursts relative to the scale's sample clock.
    return { tS: (i * 100 + (irregular ? jitterMs[(i + phase) % 10] : 0)) / 1000, weightG: Math.round(weight * 10) / 10 };
  });
  return { events, start, speedUp, slowDown, stop };
}

const rms = (values) => Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const rounded = (value) => Number(value.toFixed(3));
const evaluate = (build, irregular) => {
  const residuals = [];
  const peaks = [];
  const lags = [];
  const slowdown = [];
  const onset = [];
  const declines = [];
  for (let phase = 0; phase < 10; phase += 1) {
    const { events, start, speedUp, slowDown, stop } = flowFixture(phase, irregular);
    const series = build(events);
    residuals.push(...series.filter(({ tS }) => tS >= start + 2 && tS <= speedUp - 0.5)
      .map(({ flowGs }) => flowGs - 1.2));
    peaks.push(Math.max(...series.filter(({ tS }) => tS >= speedUp && tS <= slowDown + 1.4).map(({ flowGs }) => flowGs)));
    const crossing = (at, test, after = at - 0.75) => {
      const point = series.find(({ tS, flowGs }) => tS >= after && test(flowGs));
      return point ? point.tS - at : NaN;
    };
    onset.push(crossing(start, (rate) => rate >= 0.6));
    const acceleration = crossing(speedUp, (rate) => rate >= 2.4);
    lags.push(acceleration);
    slowdown.push(crossing(slowDown, (rate) => rate <= 2.4, Math.max(slowDown - 0.35, speedUp + acceleration + 0.001)));
    declines.push(crossing(stop, (rate) => rate <= 0.6));
  }
  const median = (values) => {
    const sorted = values.toSorted((a, b) => a - b);
    return rounded((sorted[4] + sorted[5]) / 2);
  };
  const bias = mean(residuals);
  return { steadyMae: rounded(mean(residuals.map(Math.abs))), steadyRmse: rounded(rms(residuals)),
    steadyNoise: rounded(rms(residuals.map((x) => x - bias))), onsetS: median(onset),
    accelerationS: median(lags), slowdownS: median(slowdown), stopS: median(declines), peakGs: median(peaks) };
};

function causal(events, window) {
  const estimator = createLiveFlowDisplay(window);
  return events.flatMap((event) => estimator.add(event).smooth ?? []);
}

export function benchmark(irregular = true) {
  const baselineLive = (events) => {
    const estimator = createDisplayFlowEstimator();
    return events.flatMap((event) => estimator.add(event) ?? []);
  };
  const algorithms = [
    ['Current live (0.75 s)', baselineLive],
    ['Current saved / detail', plottedFlowFromWeights],
    ['Previous EMA (1.75 s)', (events) => flowRateSeriesFromWeightCurve(events, 1.75, 0.5)],
    ...[0.75, 1, 1.25, 1.5, 2].flatMap((window) => [
      [`Causal regression ${window} s`, (events) => causal(events, window)],
      [`Centred regression ${window} s`, (events) => plottedFlowFromWeights(events, -Infinity, Infinity, window)],
    ]),
  ];
  return algorithms.map(([name, build]) => ({ name, ...evaluate(build, irregular) }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log('1.2 g/s steady, 3.6 g/s peak, 0.1 g resolution, irregular arrivals');
  console.table(benchmark());
  console.log('Same profile, regular 10 Hz arrivals');
  console.table(benchmark(false));
  const long = Array.from({ length: 18001 }, (_, i) => ({ tS: i / 10, weightG: Math.round(i * 1.2) / 10 }));
  for (const [name, build] of [['causal', (events) => causal(events, 1)], ['centred', (events) =>
    plottedFlowFromWeights(events, -Infinity, Infinity, 1.5)]]) {
    const start = performance.now();
    const samples = build(long);
    console.log(name, samples.length, 'estimates in', rounded(performance.now() - start), 'ms (30 minutes of 10 Hz samples)');
    const preparePlot = (points) => {
      const started = performance.now();
      const [min, max] = typicalFlowRange(points);
      const { visible } = splitFlowPlot(points, min, max);
      const plotted = flowPointsForPlot(visible, 0, points.at(-1).tS, 300);
      return { ms: performance.now() - started, plotted: plotted.length };
    };
    for (const points of [samples.slice(0, 900), samples]) {
      const runs = Array.from({ length: 21 }, () => preparePlot(points)).sort((a, b) => a.ms - b.ms);
      const { plotted, ms } = runs[10];
      console.log(name, points.length, 'estimates to', plotted, 'plot points in', rounded(ms), 'ms median (axis and plot preparation)');
    }
  }
}
