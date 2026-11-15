import { describe, expect, it } from 'vitest';
import { parseGrindForShotSave } from '../grinders/grinderRegistry.js';
import { classifyShotOutcome } from './grinderLogic.js';
import { validateRecipeFields, validateShotFields } from './inputValidation.js';
import { isPerfectShot } from './perfectShot.js';

const ordinary = { dose: '18', yieldG: '36', time: '28', taste: 'balanced' };
const recipe = { targetDoseG: 18, targetYieldG: 36, targetTimeMinS: 25, targetTimeMaxS: 30, brewTemperatureC: 93 };

describe('shot logging validation', () => {
  it.each([
    ['24.5', 25, true, false],
    ['28.1', 28, true, true],
    ['28.5', 29, true, false],
    ['28.9', 29, true, false],
    ['30.5', 31, false, false],
  ])('rounds manual %s s before classifying and checking for a perfect shot', (time, rounded, inRange, perfect) => {
    const { errors, parsedTime } = validateShotFields({ ...ordinary, time });
    expect(errors).toEqual({});
    expect(parsedTime).toBe(rounded);
    expect(classifyShotOutcome({ actualTimeS: parsedTime, actualYieldG: 36, tasteProfile: 'balanced' }, recipe)
      .isTimeInRange).toBe(inRange);
    expect(isPerfectShot({
      yieldG: 36, targetYieldG: 36, timeS: parsedTime, timeMinS: 25, timeMaxS: 30, taste: 'balanced',
    })).toBe(perfect);
  });

  it.each([28, 28.9])('preserves a measured time of %s s', (time) => {
    expect(validateShotFields({ ...ordinary, time }).parsedTime).toBe(time);
  });

  it.each([
    ['dose', '0', 'dose'],
    ['dose', '-1', 'dose'],
    ['dose', '100.1', 'dose'],
    ['dose', '18 beans', 'dose'],
    ['yieldG', '0', 'yield'],
    ['yieldG', '-1', 'yield'],
    ['yieldG', '500.1', 'yield'],
    ['yieldG', Infinity, 'yield'],
    ['time', ' ', 'time'],
    ['time', '0', 'time'],
    ['time', '-1', 'time'],
    ['time', '0.49', 'time'],
    ['time', '600.1', 'time'],
    ['time', '28.9x', 'time'],
    ['time', '0x20', 'time'],
    ['time', '1e309', 'time'],
  ])('rejects %s=%s', (key, value, errorKey) => {
    expect(validateShotFields({ ...ordinary, [key]: value }).errors).toHaveProperty(errorKey);
  });

  it.each([
    { dose: '100', yieldG: '500', time: '600' },
    { dose: '7.2', yieldG: '4.1', time: '0.5' },
    { dose: 18, yieldG: 35.51, time: 2 },
  ])('accepts valid shots, including boundaries and scale precision (%o)', (fields) => {
    expect(validateShotFields({ ...ordinary, ...fields }).errors).toEqual({});
  });
});

describe('recipe validation', () => {
  it.each([
    ['targetDoseG', NaN],
    ['targetDoseG', '-2'],
    ['targetYieldG', 0],
    ['targetYieldG', ''],
    ['targetTimeMinS', 0],
    ['targetTimeMaxS', 25],
    ['targetTimeMaxS', 24],
    ['targetTimeMaxS', Infinity],
    ['brewTemperatureC', 69.9],
    ['brewTemperatureC', 100.1],
    ['brewTemperatureC', '93C'],
  ])('rejects invalid %s=%s', (key, value) => {
    expect(validateRecipeFields({ ...recipe, [key]: value }).errors).toHaveProperty(key);
  });

  it.each(['', 70, 93.5, 100])('accepts optional or in-range temperature %s', (brewTemperatureC) => {
    expect(validateRecipeFields({ ...recipe, brewTemperatureC }).errors).toEqual({});
  });
});

describe('custom settings passed to shot save', () => {
  const profile = { name: 'QA custom', min: 10, max: 40, step: 1, dialType: 'stepped' };
  it.each(['', '25x', NaN, Infinity])('rejects explicit invalid dial value %s', (customGrindValue) => {
    expect(parseGrindForShotSave(profile.name, { customGrindValue }, { customGrinder: profile, grinderModel: profile.name }).ok)
      .toBe(false);
  });
});
