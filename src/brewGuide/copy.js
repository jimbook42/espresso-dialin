import { isSunbeamGrinderModel } from '../grinders/grinderRegistry.js';

export function brewGuideShowsSunbeamMachineGuides(grinderModel) {
  return isSunbeamGrinderModel(grinderModel);
}

/** First-visit Brew Guide intro bullet for machine settings. */
export function brewGuideIntroMachineSettingsLine(grinderModel) {
  if (brewGuideShowsSunbeamMachineGuides(grinderModel)) {
    return 'Sunbeam Barista Max machine settings (brew temperature and pre-infusion)';
  }
  return 'Optional machine settings (brew temperature and pre-infusion, when your machine supports them)';
}

/** Settings panel subtitle under the Brew Guide toggle. */
export function brewGuideSettingsToggleDetail(grinderModel) {
  if (brewGuideShowsSunbeamMachineGuides(grinderModel)) {
    return 'Shot steps from Dial-In, plus Barista Max machine guides';
  }
  return 'Shot steps from Dial-In, plus optional machine and milk guides';
}
