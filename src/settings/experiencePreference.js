export const EXPERIENCES = [
  {
    id: 'brew',
    label: 'Brew & Dial-In',
    description: 'Get grinder suggestions, manage beans and recipes, and rate your shots.',
  },
  {
    id: 'pressure',
    label: 'Pressure Tracker',
    description: 'Set up a gauge camera and find saved shots. Standalone pressure recording and analysis are coming.',
  },
  {
    id: 'combined',
    label: 'Combined',
    description: 'Use dial-in guidance with optional camera pressure, scale weight and flow, all in one shot history.',
  },
];

export function savedExperience(settings) {
  return EXPERIENCES.find(({ id }) => id === settings?.experiencePreference)?.id ?? null;
}

export function preferredExperience(settings) {
  return savedExperience(settings)
    ?? (settings?.labCameraPressureEnabled === true || settings?.flairEnabled === true ? 'combined' : 'brew');
}
