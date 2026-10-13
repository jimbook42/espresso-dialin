import { shouldShowFirstLaunchOnboarding } from './onboardingGate.js';
import { resolveSettingsFromLiveQuery } from './settingsLiveQuery.js';

/**
 * First-launch wizard only after settings have loaded — avoids flashing onboarding on reload.
 * While settings are still loading, the main app shell renders (wizard deferred).
 */
export function shouldRenderFirstLaunchWizard(queryResult, options = {}) {
  const { settingsLoaded, settings } = resolveSettingsFromLiveQuery(queryResult);
  if (!settingsLoaded) return false;
  return shouldShowFirstLaunchOnboarding(settings, options);
}

/**
 * Fresh installs: avoid flashing the empty main shell while settings are still loading.
 * Returning users (beans/shots already on device) keep the main shell during the brief load.
 */
export function shouldDeferMainShellForFirstLaunch(queryResult, options = {}) {
  const { settingsLoaded } = resolveSettingsFromLiveQuery(queryResult);
  const { hasExistingUserData = false } = options;
  return !settingsLoaded && !hasExistingUserData;
}
