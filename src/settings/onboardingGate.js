import { savedExperience } from './experiencePreference.js';

/**
 * First-launch onboarding is complete after an experience or grinder was saved.
 * Existing installs always have grinderModel set — they must not see onboarding again.
 * Legacy rows may lack grinderModel but still have beans/shots; treat those as returning users.
 */
export function shouldShowFirstLaunchOnboarding(settings, options = {}) {
  const { hasExistingUserData = false } = options;
  if (hasExistingUserData || savedExperience(settings)) return false;
  if (!settings) return true;
  const model = settings.grinderModel;
  return model === null || model === undefined || model === '';
}

export function isLegacySettingsRow(settings) {
  if (!settings || settings.id !== 'global') return false;
  return typeof settings.grinderModel === 'string' && settings.grinderModel.length > 0;
}
