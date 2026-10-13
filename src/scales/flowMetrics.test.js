import assert from 'assert';
import { instantaneousFlowGs, summarizeScaleFlow } from './flowMetrics.js';

export function runScaleFlowMetricsTests() {
  const samples = [
    { tS: 0, weightG: 0 },
    { tS: 10, weightG: 36 },
  ];
  const summary = summarizeScaleFlow(samples);
  assert.equal(summary.averageFlowRateGs, 3.6);
  assert.equal(summary.flowCurve.length, 2);

  assert.equal(instantaneousFlowGs(samples[0], samples[1]), 3.6);
  assert.equal(summarizeScaleFlow([]).averageFlowRateGs, null);

  console.log('Scale flow metrics tests passed.');
}
