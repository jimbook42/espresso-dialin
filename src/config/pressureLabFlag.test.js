import assert from 'assert';
import { isPressureLabEnabledFromEnv } from './pressureLabFlag.js';

export function runPressureLabFlagTests() {
  assert.equal(isPressureLabEnabledFromEnv(undefined), false);
  assert.equal(isPressureLabEnabledFromEnv(''), false);
  assert.equal(isPressureLabEnabledFromEnv('false'), false);
  assert.equal(isPressureLabEnabledFromEnv('true'), true);
  console.log('Pressure lab flag tests passed.');
}
