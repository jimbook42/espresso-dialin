import { buildSunbeamGuides } from '../sunbeam.js';
import { GENERIC_BREW_GUIDE_MENU } from './shell.js';

/** Sunbeam Barista Max EM5300 / EM5300K machine reference (maintenance guides). */
export const SUNBEAM_MACHINE_BREW_GUIDE = Object.freeze({
  key: 'sunbeam',
  machineSettingsDetail: 'Sunbeam Barista Max EM5300 / EM5300K. These change the machine itself.',
  guides: buildSunbeamGuides(),
});

export { GENERIC_BREW_GUIDE_MENU };
