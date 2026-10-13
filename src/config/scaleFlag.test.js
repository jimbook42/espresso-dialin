import assert from 'assert';
import { isScaleEnabledFromEnv } from './scaleFlag.js';

function isScaleSimPickerEnabledFromEnv(scaleRaw, simRaw, dev) {
  if (!isScaleEnabledFromEnv(scaleRaw)) return false;
  if (dev) return true;
  return simRaw === 'true';
}

export function runScaleFlagTests() {
  assert.equal(isScaleEnabledFromEnv(undefined), true);
  assert.equal(isScaleEnabledFromEnv('false'), false);
  assert.equal(isScaleEnabledFromEnv('true'), true);
  assert.equal(isScaleSimPickerEnabledFromEnv('true', 'false', false), false);
  assert.equal(isScaleSimPickerEnabledFromEnv('true', 'true', false), true);
  assert.equal(isScaleSimPickerEnabledFromEnv('true', 'false', true), true);
  console.log('Scale flag tests passed.');
}
