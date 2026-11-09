import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { EXPERIENCES, preferredExperience, savedExperience } from './experiencePreference.js';
import { shouldShowFirstLaunchOnboarding } from './onboardingGate.js';
import { patchGlobalSettings } from './patchGlobalSettings.js';

describe('experience preference', () => {
  it('keeps legacy onboarding and pressure preferences intact', () => {
    expect(shouldShowFirstLaunchOnboarding(null)).toBe(true);
    expect(shouldShowFirstLaunchOnboarding(null, { hasExistingUserData: true })).toBe(false);
    const legacy = Object.freeze({ grinderModel: 'Sette 270Wi', labCameraPressureEnabled: true });
    expect(shouldShowFirstLaunchOnboarding(legacy)).toBe(false);
    expect(savedExperience(legacy)).toBeNull();
    expect(preferredExperience(legacy)).toBe('combined');
    expect(preferredExperience({ ...legacy, experiencePreference: 'unknown' })).toBe('combined');
    expect(preferredExperience({ grinderModel: 'Sette 270Wi' })).toBe('brew');
    expect(preferredExperience({ flairEnabled: true })).toBe('combined');
  });

  it.each(EXPERIENCES.map(({ id }) => id))('accepts %s as completed onboarding without a grinder', (experiencePreference) => {
    const settings = { experiencePreference };
    expect(shouldShowFirstLaunchOnboarding(settings)).toBe(false);
    expect(preferredExperience({ ...settings, labCameraPressureEnabled: true })).toBe(experiencePreference);
  });

  it('persists each switch through repeated database reopen without changing existing settings', async () => {
    const db = new Dexie('experience-preference-test');
    db.version(1).stores({ settings: 'id' });
    const original = {
      id: 'global', grinderModel: 'Sette 270Wi', smartScaleDeviceId: 'manual',
      brewGuideIntroSeen: true, labCameraPressureEnabled: true,
      labGaugeTapCalibration: { viewMoved: true },
    };
    try {
      await db.settings.put(original);
      for (const { id } of EXPERIENCES) {
        await patchGlobalSettings(db, { experiencePreference: id });
        db.close();
        await db.open();
        expect(await db.settings.get('global')).toEqual({ ...original, experiencePreference: id });
      }
    } finally {
      await db.delete();
    }
  });
});
