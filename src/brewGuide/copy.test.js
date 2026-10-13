import assert from 'assert';
import { SETTE_GRINDER_ID, SUNBEAM_GRINDER_ID } from '../grinders/grinderRegistry.js';
import {
  brewGuideIntroMachineSettingsLine,
  brewGuideSettingsToggleDetail,
  brewGuideShowsSunbeamMachineGuides,
} from './copy.js';

export function runBrewGuideCopyTests() {
  assert.equal(brewGuideShowsSunbeamMachineGuides(SUNBEAM_GRINDER_ID), true);
  assert.equal(brewGuideShowsSunbeamMachineGuides(SETTE_GRINDER_ID), false);
  assert.equal(brewGuideShowsSunbeamMachineGuides('Niche Zero'), false);

  assert.match(brewGuideIntroMachineSettingsLine(SETTE_GRINDER_ID), /Optional machine settings/i);
  assert.doesNotMatch(brewGuideIntroMachineSettingsLine(SETTE_GRINDER_ID), /Barista Max/i);

  assert.match(brewGuideIntroMachineSettingsLine(SUNBEAM_GRINDER_ID), /Barista Max/i);

  assert.match(brewGuideSettingsToggleDetail(SETTE_GRINDER_ID), /optional machine and milk/i);
  assert.doesNotMatch(brewGuideSettingsToggleDetail(SETTE_GRINDER_ID), /Barista Max/i);
  assert.match(brewGuideSettingsToggleDetail(SUNBEAM_GRINDER_ID), /Barista Max/i);

  console.log('Brew Guide copy tests passed.');
}
