/** Brew Guide accessories and the one-step Sunbeam Barista Max workflow they shape. */

export const BREW_ACCESSORIES = [
  {
    id: 'dosingCup',
    name: 'Dosing cup',
    explanation: 'A small cup used to catch and weigh freshly ground coffee before transferring it to the portafilter.',
  },
  {
    id: 'dosingFunnel',
    name: 'Dosing funnel',
    explanation: 'A collar that sits on the portafilter to stop coffee grounds spilling while you transfer and prepare them.',
  },
  {
    id: 'rdt',
    name: 'RDT',
    explanation: 'A very small amount of water sprayed on the beans before grinding to reduce static and mess.',
  },
  {
    id: 'blindShaker',
    name: 'Blind shaker',
    explanation: 'A container used to mix and settle freshly ground coffee before it goes into the basket.',
  },
  {
    id: 'wdt',
    name: 'WDT',
    explanation: 'A thin-needle tool used to gently break up clumps and distribute the grounds.',
  },
  {
    id: 'distributor',
    name: 'Distributor',
    explanation: 'A tool that helps level and distribute the grounds before tamping.',
  },
  {
    id: 'selfLevellingTamper',
    name: 'Self-levelling tamper',
    explanation: 'A tamper designed to sit level on the basket so the coffee bed is compressed evenly.',
  },
  {
    id: 'puckScreen',
    name: 'Puck screen',
    explanation: 'A thin metal screen placed on top of the tamped coffee puck before brewing.',
  },
];

export const DEFAULT_BREW_ACCESSORIES = Object.freeze({
  dosingCup: false,
  dosingFunnel: false,
  rdt: false,
  blindShaker: false,
  wdt: false,
  distributor: false,
  selfLevellingTamper: false,
  puckScreen: false,
});

export function normalizeBrewAccessories(value) {
  const next = { ...DEFAULT_BREW_ACCESSORIES };
  if (!value || typeof value !== 'object') return next;
  for (const item of BREW_ACCESSORIES) {
    if (Object.prototype.hasOwnProperty.call(value, item.id)) {
      next[item.id] = Boolean(value[item.id]);
    }
  }
  return next;
}

export function formatBrewAmount(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

export function brewDialIsReady(dial) {
  if (!dial?.beanName || !dial?.grinderModel || !dial?.grindLabel) return false;
  const dose = formatBrewAmount(dial.doseG);
  const yieldG = formatBrewAmount(dial.yieldG);
  if (dose === null || yieldG === null || Number(dose) <= 0 || Number(yieldG) <= 0) return false;
  return Number.isFinite(Number(dial.timeMinS)) && Number.isFinite(Number(dial.timeMaxS));
}

/** True when the live recommendation differs from the previous shot on this grinder. */
export function grindSettingChanged(dial = {}) {
  const current = dial.grindLabel == null ? '' : String(dial.grindLabel).trim();
  const previous = dial.previousGrindLabel == null ? '' : String(dial.previousGrindLabel).trim();
  if (!current || !previous) return false;
  return current !== previous;
}

/** Grams at which to stop the machine: target yield minus 4, from the live recipe. */
export function brewStopYield(yieldG) {
  const formatted = formatBrewAmount(yieldG);
  if (formatted == null) return null;
  const stop = Math.round((Number(formatted) - 4) * 10) / 10;
  if (!(stop > 0)) return null;
  return formatBrewAmount(stop);
}

export function brewDialSummary(dial = {}) {
  const dose = formatBrewAmount(dial.doseG);
  const yieldG = formatBrewAmount(dial.yieldG);
  const timeMin = Number.isFinite(Number(dial.timeMinS)) ? String(Number(dial.timeMinS)) : null;
  const timeMax = Number.isFinite(Number(dial.timeMaxS)) ? String(Number(dial.timeMaxS)) : null;
  const grindLabel = dial.grindLabel ? String(dial.grindLabel) : null;
  const grinder = dial.grinderModel || null;
  const bean = dial.beanName || null;
  const temp = formatBrewAmount(dial.brewTemperatureC);
  const metrics = [
    bean ? { label: 'Bean', value: bean } : null,
    dose && yieldG ? { label: 'Recipe', value: `${dose}g → ${yieldG}g` } : null,
    dose ? { label: 'Dose', value: `${dose}g` } : null,
    yieldG ? { label: 'Yield', value: `${yieldG}g` } : null,
    timeMin && timeMax ? { label: 'Time', value: `${timeMin}–${timeMax}s` } : null,
    grinder ? { label: 'Grinder', value: grinder } : null,
    grindLabel ? { label: 'Grind', value: grindLabel } : null,
    temp ? { label: 'Temp', value: `${temp}°C` } : null,
  ].filter(Boolean);
  return { dose, yieldG, timeMin, timeMax, grindLabel, grinder, bean, temp, metrics };
}

function step(partial) {
  return partial;
}

/**
 * One screen per action. Dose, yield, time, grinder and grind setting come from Dial-In.
 * Purge beans are separate from the weighed recipe dose.
 */
export function buildBrewSteps(rawAccessories, dial = {}) {
  const accessories = normalizeBrewAccessories(rawAccessories);
  const summary = brewDialSummary(dial);
  const dose = summary.dose ?? '—';
  const yieldG = summary.yieldG ?? '—';
  const timeMin = summary.timeMin ?? '—';
  const timeMax = summary.timeMax ?? '—';
  const grindLabel = summary.grindLabel ?? '—';
  const grinder = summary.grinder || 'your grinder';
  const bean = summary.bean || 'your coffee';
  const isSunbeam = /sunbeam/i.test(grinder);
  const grindSettingLabel = isSunbeam ? 'Dial setting' : 'Grind setting';
  const changed = grindSettingChanged(dial);
  const previous = dial.previousGrindLabel ? String(dial.previousGrindLabel) : '';
  const stopAt = brewStopYield(dial.yieldG);

  const usesCup = accessories.dosingCup;
  const usesFunnel = accessories.dosingFunnel;
  const usesShaker = accessories.blindShaker;
  const groundsLeaveTheBasket = usesCup || usesShaker;

  const steps = [];

  steps.push(step({
    id: 'recipe',
    icon: 'recipe',
    title: 'This shot',
    instruction: 'Use these Dial-In values for this shot.',
    metrics: summary.metrics,
  }));

  steps.push(step({
    id: 'power',
    icon: 'power',
    title: 'Turn the machine on',
    instruction: 'Turn the Sunbeam Barista Max on and let it heat.',
  }));

  steps.push(step({
    id: 'water',
    icon: 'water',
    title: 'Check the water',
    instruction: 'Check the tank has enough water for this shot.',
  }));

  steps.push(step({
    id: 'warmCup',
    icon: 'cup',
    title: 'Warm the cup',
    instruction: 'Fill the cup with hot water from the machine and let it stand.',
  }));

  steps.push(step({
    id: 'emptyCup',
    icon: 'empty',
    title: 'Empty the cup',
    instruction: 'Tip the water out of the cup.',
  }));

  steps.push(step({
    id: 'dryCup',
    icon: 'dry',
    title: 'Dry the cup',
    instruction: 'Dry the cup.',
  }));

  steps.push(step({
    id: 'portafilter',
    icon: 'portafilter',
    title: 'Check the portafilter',
    instruction: 'Make sure the portafilter and basket are clean and dry.',
  }));

  let grindInstruction = `Set the ${grinder} to this.`;
  if (changed) {
    grindInstruction = `Set the ${grinder} to this. It changed since your last shot${previous ? ` (${previous})` : ''}, so purge next.`;
  } else if (previous) {
    grindInstruction = `Set the ${grinder} to this. It matches your last shot, so no purge.`;
  }

  steps.push(step({
    id: 'grindSetting',
    icon: 'grind',
    title: 'Set the grind',
    highlightLabel: grindSettingLabel,
    highlight: grindLabel,
    instruction: grindInstruction,
  }));

  if (changed) {
    steps.push(step({
      id: 'purge',
      icon: 'purge',
      title: 'Purge the grinder',
      instruction: 'Put a small amount of fresh beans in the empty hopper and grind them through. Do not use the dose for this shot.',
      help: isSunbeam
        ? 'The Sunbeam manual’s 1–2 second purge after a grind change is this short run of fresh beans. Do not run the hopper empty, and do not use the beans you will weigh next.'
        : 'A short run of fresh beans clears the previous setting. Keep those beans separate from the dose you will weigh next.',
    }));

    steps.push(step({
      id: 'discardPurge',
      icon: 'discard',
      title: 'Discard the purge',
      instruction: 'Throw those purge grounds away. Leave the hopper empty.',
    }));
  }

  steps.push(step({
    id: 'weigh',
    icon: 'weigh',
    title: 'Weigh the dose',
    highlightLabel: 'Dose',
    highlight: `${dose}g`,
    instruction: `Weigh ${dose}g of ${bean}. This is the dose you will grind.`,
  }));

  if (accessories.rdt) {
    steps.push(step({
      id: 'rdt',
      icon: 'rdt',
      title: 'RDT',
      instruction: 'Add a tiny spray of water to the beans and mix them through.',
      help: 'A light mist is enough. There is no set amount.',
    }));
  }

  steps.push(step({
    id: 'loadHopper',
    icon: 'load',
    title: 'Load the hopper',
    instruction: `The hopper is empty. Add only the ${dose}g you just weighed. Do not fill the hopper.`,
  }));

  if (!groundsLeaveTheBasket && usesFunnel) {
    steps.push(step({
      id: 'prepFunnel',
      icon: 'funnel',
      title: 'Fit the funnel',
      instruction: 'Place the dosing funnel on the portafilter.',
    }));
  }

  if (usesCup) {
    steps.push(step({
      id: 'grind',
      icon: 'grind',
      title: 'Grind the dose',
      instruction: `Grind all ${dose}g into the dosing cup.`,
    }));
    steps.push(step({
      id: 'verifyDose',
      icon: 'weigh',
      title: 'Check the dose',
      highlightLabel: 'Dose',
      highlight: `${dose}g`,
      instruction: `Check the dosing cup weighs ${dose}g.`,
    }));
  } else if (usesShaker) {
    steps.push(step({
      id: 'grind',
      icon: 'grind',
      title: 'Grind the dose',
      instruction: `Grind all ${dose}g into the blind shaker.`,
    }));
    steps.push(step({
      id: 'verifyDose',
      icon: 'weigh',
      title: 'Check the dose',
      highlightLabel: 'Dose',
      highlight: `${dose}g`,
      instruction: `Check the blind shaker holds ${dose}g.`,
    }));
  } else {
    steps.push(step({
      id: 'grind',
      icon: 'grind',
      title: 'Grind the dose',
      instruction: usesFunnel
        ? `Grind all ${dose}g through the funnel into the basket.`
        : `Hold the portafilter steady and grind all ${dose}g into the basket.`,
    }));
    steps.push(step({
      id: 'verifyDose',
      icon: 'weigh',
      title: 'Check the dose',
      highlightLabel: 'Dose',
      highlight: `${dose}g`,
      instruction: `Weigh the portafilter and check the grounds are ${dose}g.`,
    }));
  }

  if (usesShaker) {
    steps.push(step({
      id: 'shake',
      icon: 'shake',
      title: 'Shake the grounds',
      instruction: usesCup
        ? 'Tip the grounds into the blind shaker and shake until they look even.'
        : 'Shake the grounds until they look even.',
    }));
  }

  if (groundsLeaveTheBasket) {
    let instruction = 'Transfer the grounds carefully into the basket.';
    if (usesFunnel && usesShaker) {
      instruction = 'Place the dosing funnel on the portafilter and tip the grounds in from the shaker.';
    } else if (usesFunnel && usesCup) {
      instruction = 'Place the dosing funnel on the portafilter and tip the grounds in from the dosing cup.';
    } else if (usesShaker) {
      instruction = 'Tip the grounds from the shaker carefully into the basket.';
    } else if (usesCup) {
      instruction = 'Tip the grounds from the dosing cup carefully into the basket.';
    }
    steps.push(step({
      id: 'transfer',
      icon: 'transfer',
      title: 'Transfer to the basket',
      instruction,
    }));
  }

  if (accessories.wdt) {
    steps.push(step({
      id: 'wdt',
      icon: 'wdt',
      title: 'WDT',
      instruction: 'Gently break up clumps and distribute the grounds.',
      help: usesFunnel ? 'Leave the dosing funnel on while you do this.' : undefined,
    }));
  }

  if (usesFunnel) {
    steps.push(step({
      id: 'removeFunnel',
      icon: 'funnel',
      title: 'Remove the funnel',
      instruction: 'Lift the dosing funnel off so the basket rim is clear.',
    }));
  }

  if (accessories.distributor) {
    steps.push(step({
      id: 'distribute',
      icon: 'distribute',
      title: 'Level the bed',
      instruction: 'Use the distributor to level the coffee bed evenly.',
    }));
  }

  if (accessories.selfLevellingTamper) {
    steps.push(step({
      id: 'tamp',
      icon: 'tamp',
      title: 'Tamp',
      instruction: 'Place the tamper squarely and press once consistently.',
      help: 'One press. The tamper levels itself.',
    }));
  }

  if (accessories.puckScreen) {
    steps.push(step({
      id: 'screen',
      icon: 'screen',
      title: 'Add the puck screen',
      instruction: accessories.selfLevellingTamper
        ? 'Place the puck screen flat on the tamped puck.'
        : 'Place the puck screen flat on the coffee.',
    }));
  }

  steps.push(step({
    id: 'preheat',
    icon: 'preheat',
    title: 'Last check',
    highlightLabel: 'Target yield',
    highlight: `${yieldG}g`,
    instruction: 'The cup should still be warm. Lock in the portafilter. Put the scale under the cup if you have one.',
    help: `Target time is ${timeMin}–${timeMax} seconds.`,
  }));

  steps.push(step({
    id: 'extract',
    kind: 'timer',
    icon: 'timer',
    title: 'Pull the shot',
    highlightLabel: 'Target yield',
    highlight: `${yieldG}g`,
    stopAt,
    timeLabel: `${timeMin}–${timeMax}s`,
    instruction: stopAt
      ? `Stop the machine around ${stopAt}g.`
      : `Brew toward ${yieldG}g and stop a little early so the rest can finish flowing.`,
    note: 'The app cannot see the scale. This is only a reminder.',
    help: 'Start the timer as the shot starts. Tap when you stop the machine, let the cup reach the target, then stop the timer and take the cup off the scale.',
  }));

  steps.push(step({
    id: 'knockPuck',
    icon: 'discard',
    title: 'Remove the puck',
    instruction: 'Knock the puck out.',
  }));

  steps.push(step({
    id: 'rinsePortafilter',
    icon: 'rinse',
    title: 'Rinse the portafilter',
    instruction: 'Rinse the basket and portafilter.',
  }));

  steps.push(step({
    id: 'rinseGroup',
    icon: 'rinse',
    title: 'Rinse the group',
    instruction: 'Rinse the group head.',
  }));

  steps.push(step({
    id: 'readyMachine',
    icon: 'ready',
    title: 'Leave it ready',
    instruction: 'Leave the machine ready for the next use.',
  }));

  steps.push(step({
    id: 'logShot',
    kind: 'handoff',
    icon: 'log',
    title: 'Log the shot',
    instruction: 'Dial-In already has this coffee, recipe, dose, grind setting and the shot time. Enter the yield you weighed.',
    help: 'This opens the existing shot form. It does not save a second record.',
  }));

  return steps;
}
