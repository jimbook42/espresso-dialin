import assert from 'assert';
import { SETTINGS_QUERY_PENDING } from './settingsLiveQuery.js';
import { resolveSettingsFromLiveQuery } from './settingsLiveQuery.js';
import { shouldRenderFirstLaunchWizard } from './firstLaunchRenderGate.js';

export function runFirstLaunchRenderGateTests() {
  assert.deepEqual(resolveSettingsFromLiveQuery(SETTINGS_QUERY_PENDING), {
    settingsLoaded: false,
    settings: null,
  });
  assert.deepEqual(resolveSettingsFromLiveQuery(undefined), {
    settingsLoaded: true,
    settings: null,
  });
  assert.deepEqual(resolveSettingsFromLiveQuery(null), {
    settingsLoaded: true,
    settings: null,
  });
  assert.deepEqual(resolveSettingsFromLiveQuery({ grinderModel: 'Sette 270Wi' }), {
    settingsLoaded: true,
    settings: { grinderModel: 'Sette 270Wi' },
  });

  assert.equal(
    shouldRenderFirstLaunchWizard(SETTINGS_QUERY_PENDING, { hasExistingUserData: false }),
    false,
    'pending settings must not show wizard (main shell renders instead)'
  );
  assert.equal(
    shouldRenderFirstLaunchWizard(SETTINGS_QUERY_PENDING, { hasExistingUserData: true }),
    false
  );

  assert.equal(
    shouldRenderFirstLaunchWizard(undefined, { hasExistingUserData: false }),
    true,
    'fresh profile after load shows wizard'
  );
  assert.equal(
    shouldRenderFirstLaunchWizard({ grinderModel: 'Sette 270Wi' }, { hasExistingUserData: false }),
    false,
    'configured grinder never shows wizard'
  );
  assert.equal(
    shouldRenderFirstLaunchWizard(undefined, { hasExistingUserData: true }),
    false,
    'legacy data without settings row skips wizard'
  );

  console.log('First launch render gate tests passed.');
}
