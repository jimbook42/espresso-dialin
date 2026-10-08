import assert from 'assert';
import { buildBrewSteps } from './steps.js';
import {
  buildBrewGuideDialPayload,
  getBrewGuideGrindConfig,
  getBrewGuideMachinePackage,
  getBrewGuideMachinePackageForGrinder,
} from './grinderBrewGuide.js';
import { SETTE_GRINDER_ID, SUNBEAM_GRINDER_ID } from '../grinders/grinderRegistry.js';

function grindStepInstruction(accessories, dial) {
  const step = buildBrewSteps(accessories, dial).find((item) => item.id === 'grindSetting');
  return step?.instruction || '';
}

export function runGrinderBrewGuideTests() {
  const none = () => ({});

  const setteConfig = getBrewGuideGrindConfig(SETTE_GRINDER_ID);
  assert.equal(setteConfig.grindSettingLabel, 'Grind setting');
  assert.match(setteConfig.changedGrindPurgeExtraLine, /Keep the purge separate/);
  assert.doesNotMatch(setteConfig.changedGrindPurgeExtraLine, /hopper empty/i);

  const sunbeamConfig = getBrewGuideGrindConfig(SUNBEAM_GRINDER_ID);
  assert.equal(sunbeamConfig.grindSettingLabel, 'Dial setting');
  assert.match(sunbeamConfig.changedGrindPurgeExtraLine, /hopper empty/i);

  const unknownConfig = getBrewGuideGrindConfig('your grinder');
  assert.equal(unknownConfig.grindSettingLabel, 'Grind setting');
  assert.doesNotMatch(unknownConfig.changedGrindPurgeExtraLine, /hopper empty/i);

  assert.equal(getBrewGuideMachinePackageForGrinder(SUNBEAM_GRINDER_ID)?.key, 'sunbeam');
  assert.equal(getBrewGuideMachinePackageForGrinder(SETTE_GRINDER_ID), null);
  assert.equal(getBrewGuideMachinePackage().menuTitle, 'Sunbeam Barista Max');

  const changedSette = grindStepInstruction(none(), {
    beanName: 'Bean',
    doseG: 18,
    yieldG: 36,
    timeMinS: 27,
    timeMaxS: 32,
    grinderModel: SETTE_GRINDER_ID,
    grindLabel: '13-E',
    previousGrindLabel: '12-A',
  });
  assert.doesNotMatch(changedSette, /hopper empty/i);

  const changedSunbeam = grindStepInstruction(none(), {
    beanName: 'Bean',
    doseG: 18,
    yieldG: 36,
    timeMinS: 27,
    timeMaxS: 32,
    grinderModel: SUNBEAM_GRINDER_ID,
    grindLabel: '15',
    previousGrindLabel: '14',
  });
  assert.match(changedSunbeam, /hopper empty/i);

  const payload = buildBrewGuideDialPayload({
    beanName: 'House',
    targetDoseG: 18,
    targetYieldG: 36,
    targetTimeMinS: 27,
    targetTimeMaxS: 32,
    brewTemperatureC: 92,
    grinderModel: SUNBEAM_GRINDER_ID,
    grindLabel: '15',
    previousGrindLabel: '14',
  });
  assert.equal(payload.grindLabel, '15');
  assert.equal(payload.grinderModel, SUNBEAM_GRINDER_ID);

  console.log('Brew Guide grinder configuration tests passed.');
}
