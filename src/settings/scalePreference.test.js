import assert from 'assert';
import {
  isSmartScaleIntegrationActive,
  normalizeSmartScaleDeviceId,
  resolveSmartScalePickerValue,
  smartScaleActiveSummary,
  SMART_SCALE_MANUAL_ID,
} from './scalePreference.js';

export function runScalePreferenceTests() {
  assert.equal(normalizeSmartScaleDeviceId(SMART_SCALE_MANUAL_ID), SMART_SCALE_MANUAL_ID);
  assert.equal(isSmartScaleIntegrationActive({ smartScaleDeviceId: SMART_SCALE_MANUAL_ID }), false);
  assert.equal(isSmartScaleIntegrationActive({ smartScaleDeviceId: 'timemore-dot' }), true);
  assert.equal(isSmartScaleIntegrationActive({ smartScaleDeviceId: 'not-listed' }), false);
  assert.equal(
    resolveSmartScalePickerValue(
      { smartScaleDeviceId: SMART_SCALE_MANUAL_ID },
      { devUrlSimActive: true, scaleConnected: true }
    ),
    'timemore-dot'
  );
  assert.match(
    smartScaleActiveSummary(
      { smartScaleDeviceId: SMART_SCALE_MANUAL_ID },
      { devUrlSimActive: true, scaleConnected: true }
    ),
    /^Simulated scale /
  );
  console.log('Scale preference tests passed.');
}
