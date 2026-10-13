import assert from 'assert';
import {
  isSmartScaleIntegrationActive,
  normalizeSmartScaleDeviceId,
  SMART_SCALE_MANUAL_ID,
} from './scalePreference.js';

export function runScalePreferenceTests() {
  assert.equal(normalizeSmartScaleDeviceId(SMART_SCALE_MANUAL_ID), SMART_SCALE_MANUAL_ID);
  assert.equal(isSmartScaleIntegrationActive({ smartScaleDeviceId: SMART_SCALE_MANUAL_ID }), false);
  assert.equal(isSmartScaleIntegrationActive({ smartScaleDeviceId: 'timemore-dot' }), true);
  assert.equal(isSmartScaleIntegrationActive({ smartScaleDeviceId: 'not-listed' }), false);
  console.log('Scale preference tests passed.');
}
