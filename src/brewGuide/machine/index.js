import { buildSunbeamGuides } from '../sunbeam.js';
import { buildGenericMachineGuides, GENERIC_MACHINE_SETTINGS_DETAIL } from './generic.js';
import { GENERIC_BREW_GUIDE_MENU } from './shell.js';

/** Sunbeam Barista Max EM5300 / EM5300K machine reference (maintenance guides). */
export const SUNBEAM_MACHINE_BREW_GUIDE = Object.freeze({
  key: 'sunbeam',
  machineSettingsDetail: 'Sunbeam Barista Max EM5300 / EM5300K. These change the machine itself.',
  guides: buildSunbeamGuides(),
});

export const GENERIC_MACHINE_BREW_GUIDE = Object.freeze({
  key: 'generic',
  machineSettingsDetail: GENERIC_MACHINE_SETTINGS_DETAIL,
  guides: buildGenericMachineGuides(),
});

export { GENERIC_BREW_GUIDE_MENU };
