const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function parseFiniteDecimal(value) {
  if (typeof value === 'string' && DECIMAL_NUMBER.test(value.trim())) value = Number(value);
  return Number.isFinite(value) ? value : null;
}

export function validateShotFields({ dose, yieldG, time, taste }) {
  const parsedDose = parseFiniteDecimal(dose);
  const parsedYield = parseFiniteDecimal(yieldG);
  const timeSeconds = parseFiniteDecimal(time);
  // Form edits are strings. The timer and Brew Guide hand off measured numbers.
  const parsedTime = typeof time === 'string' && timeSeconds !== null ? Math.round(timeSeconds) : timeSeconds;
  const errors = {};
  if (!(parsedDose > 0 && parsedDose <= 100)) errors.dose = 'Enter a dose greater than 0 and up to 100 g.';
  if (!(parsedYield > 0 && parsedYield <= 500)) errors.yield = 'Enter a yield greater than 0 and up to 500 g.';
  if (!(parsedTime > 0 && timeSeconds <= 600)) errors.time = 'Enter an extraction time that saves as 1 to 600 seconds.';
  if (!taste) errors.taste = 'Select the extraction taste.';
  return { errors, parsedDose, parsedYield, parsedTime };
}

export function validateBeanFields(bean, today = new Date()) {
  const name = String(bean.name ?? '').trim();
  const localDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  const errors = {};
  if (!name) errors.name = 'Enter a bean name.';
  if (!bean.roastDate) errors.roastDate = 'Roast date is required.';
  else if (bean.roastDate > localDate) errors.roastDate = 'Choose today or an earlier roast date.';
  return { name, errors };
}

export function validateRecipeFields(form) {
  const targetDoseG = parseFiniteDecimal(form.targetDoseG);
  const targetYieldG = parseFiniteDecimal(form.targetYieldG);
  const targetTimeMinS = parseFiniteDecimal(form.targetTimeMinS);
  const targetTimeMaxS = parseFiniteDecimal(form.targetTimeMaxS);
  const brewTemperatureC = parseFiniteDecimal(form.brewTemperatureC);
  const errors = {};
  if (!(targetDoseG > 0)) errors.targetDoseG = 'Enter a target dose greater than 0 g.';
  if (!(targetYieldG > 0)) errors.targetYieldG = 'Enter a target yield greater than 0 g.';
  if (!(targetTimeMinS > 0)) errors.targetTimeMinS = 'Enter a minimum extraction time greater than 0 s.';
  if (!(targetTimeMaxS > 0)) errors.targetTimeMaxS = 'Enter a maximum extraction time greater than 0 s.';
  else if (targetTimeMinS > 0 && targetTimeMaxS <= targetTimeMinS) {
    errors.targetTimeMaxS = 'Maximum extraction time must be greater than the minimum.';
  }
  const temperatureSupplied = form.brewTemperatureC != null && form.brewTemperatureC !== '';
  if (temperatureSupplied && !(brewTemperatureC >= 70 && brewTemperatureC <= 100)) {
    errors.brewTemperatureC = 'Enter a brew temperature between 70 and 100 °C, or leave it blank.';
  }
  return {
    errors,
    recipe: {
      targetDoseG, targetYieldG, targetTimeMinS, targetTimeMaxS, brewTemperatureC,
      flairProfile: form.flairProfile ?? null,
    },
  };
}
