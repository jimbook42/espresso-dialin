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
