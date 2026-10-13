import assert from 'assert';
import { isLegacySettingsRow, shouldShowFirstLaunchOnboarding } from './onboardingGate.js';

export function runOnboardingGateTests() {
  assert.equal(shouldShowFirstLaunchOnboarding(null), true);
  assert.equal(shouldShowFirstLaunchOnboarding({}), true);
  assert.equal(shouldShowFirstLaunchOnboarding({ grinderModel: '' }), true);
  assert.equal(shouldShowFirstLaunchOnboarding({ grinderModel: 'Sette 270Wi' }), false);

  const legacy = {
    id: 'global',
    grinderModel: 'Sette 270Wi',
    flairEnabled: false,
    darkMode: true,
  };
  assert.equal(isLegacySettingsRow(legacy), true);
  assert.equal(shouldShowFirstLaunchOnboarding(legacy), false);
  assert.equal(Object.hasOwn(legacy, 'smartScaleDeviceId'), false);
  assert.equal(Object.hasOwn(legacy, 'customGrinder'), false);

  const pre69Settings = {
    id: 'global',
    flairEnabled: false,
    darkMode: true,
  };
  assert.equal(shouldShowFirstLaunchOnboarding(pre69Settings), true);
  assert.equal(
    shouldShowFirstLaunchOnboarding(pre69Settings, { hasExistingUserData: true }),
    false
  );
  assert.equal(
    shouldShowFirstLaunchOnboarding(pre69Settings, {
      hasExistingUserData: true,
    }),
    false
  );

  console.log('Onboarding gate tests passed.');
}
