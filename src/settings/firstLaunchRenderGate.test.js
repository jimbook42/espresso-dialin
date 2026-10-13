import assert from 'assert';
import { SETTINGS_QUERY_PENDING } from './settingsLiveQuery.js';
import { resolveSettingsFromLiveQuery } from './settingsLiveQuery.js';
import {
  shouldDeferMainShellForFirstLaunch,
  shouldRenderFirstLaunchWizard,
} from './firstLaunchRenderGate.js';

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
    'pending settings must not show wizard yet'
  );
  assert.equal(
    shouldDeferMainShellForFirstLaunch(SETTINGS_QUERY_PENDING, { hasExistingUserData: false }),
    true,
    'fresh install should defer empty main shell while settings load'
  );
  assert.equal(
    shouldDeferMainShellForFirstLaunch(SETTINGS_QUERY_PENDING, { hasExistingUserData: true }),
    false,
    'returning users keep main shell during settings load'
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
