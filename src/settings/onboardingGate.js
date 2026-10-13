/**
 * First-launch onboarding is shown only when the user has never chosen a grinder.
 * Existing installs always have grinderModel set — they must not see onboarding again.
 */
export function shouldShowFirstLaunchOnboarding(settings) {
  if (!settings) return true;
  const model = settings.grinderModel;
  return model === null || model === undefined || model === '';
}

export function isLegacySettingsRow(settings) {
  if (!settings || settings.id !== 'global') return false;
  return typeof settings.grinderModel === 'string' && settings.grinderModel.length > 0;
}
