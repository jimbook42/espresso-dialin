import { buildSunbeamGuides } from '../sunbeam.js';

/** Sunbeam Barista Max EM5300 / EM5300K machine reference (menus + maintenance guides). */
export const SUNBEAM_MACHINE_BREW_GUIDE = Object.freeze({
  key: 'sunbeam',
  menuTitle: 'Sunbeam Barista Max',
  menuSubtitle: 'EM5300 / EM5300K. Start your espresso workflow, then open supporting guides below.',
  machineSettingsDetail: 'Sunbeam Barista Max EM5300 / EM5300K. These change the machine itself.',
  guides: buildSunbeamGuides(),
});
