/** Brew Guide accessories and the espresso workflow they shape. */

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
  const lines = partial.lines?.filter(Boolean);
  const actions = partial.actions?.filter((item) => item?.title && item?.text);
  const helps = partial.helps?.filter((item) => item?.text);
  const actionText = (actions || []).map((item) => `${item.title}. ${item.text}`);
  return {
    ...partial,
    lines,
    actions: actions?.length ? actions : undefined,
    helps: helps?.length ? helps : undefined,
    instruction: partial.instruction || [...actionText, ...(lines || [])].join(' '),
  };
}

function accessoryAction(title, text) {
  return { title, text };
}

function toolHelp(accessories, ids) {
  const wanted = new Set(ids);
  return BREW_ACCESSORIES
    .filter((item) => wanted.has(item.id) && accessories[item.id])
    .map((item) => ({ id: item.id, name: item.name, text: item.explanation }));
}

function needsPuck(accessories, groundsLeaveTheBasket) {
  if (groundsLeaveTheBasket || accessories.blindShaker) return true;
  if (accessories.wdt || accessories.distributor || accessories.selfLevellingTamper || accessories.puckScreen) return true;
  return false;
}

/**
 * Related actions share a screen. Dose, yield, time, grinder and grind setting come from Dial-In.
 * A grind-setting change purges with separate beans, before the recipe dose is weighed.
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

  const grindLines = [`Set the ${grinder} to this.`];
  if (changed) {
    grindLines.push(previous
      ? `The setting changed from ${previous}. Purge a small amount of fresh beans through the grinder, then discard those grounds.`
      : 'The setting changed. Purge a small amount of fresh beans through the grinder, then discard those grounds.');
    grindLines.push(isSunbeam
      ? 'Keep the purge separate from the dose. A short run is enough — do not run the hopper empty.'
      : 'Keep the purge separate from the dose.');
  } else if (!previous) {
    grindLines.push('If the grind setting changed, purge a little fresh coffee through and discard it before you weigh the dose.');
  }

  const doseLines = [`Weigh ${dose}g of ${bean}.`];
  doseLines.push(`Put only that ${dose}g in the empty hopper. Do not fill the hopper.`);
  const doseActions = [];
  if (accessories.rdt) {
    doseActions.push(accessoryAction(
      'Use RDT',
      'Lightly spray the beans with water using the RDT before grinding.',
    ));
  }

  const grindDoseLines = [];
  const grindActions = [];
  if (usesCup) {
    grindActions.push(accessoryAction(
      'Use the dosing cup',
      `Grind all ${dose}g into the dosing cup and check it is ${dose}g.`,
    ));
  } else if (usesShaker) {
    grindActions.push(accessoryAction(
      'Use the blind shaker',
      `Grind all ${dose}g into the blind shaker and check it is ${dose}g.`,
    ));
  } else if (usesFunnel) {
    grindActions.push(accessoryAction(
      'Use the dosing funnel',
      `Place the dosing funnel on the portafilter, grind all ${dose}g into the basket, and check the portafilter is ${dose}g.`,
    ));
    if (!needsPuck(accessories, false)) grindDoseLines.push('Lift the dosing funnel off.');
  } else {
    grindDoseLines.push(`Grind all ${dose}g into the basket and check the portafilter is ${dose}g.`);
  }

  const puckLines = [];
  const puckActions = [];
  if (usesShaker && usesCup) {
    puckActions.push(accessoryAction(
      'Use the blind shaker',
      'Tip the grounds into the blind shaker and shake until they look even.',
    ));
  } else if (usesShaker) {
    puckActions.push(accessoryAction(
      'Use the blind shaker',
      'Shake the grounds until they look even.',
    ));
  }
  if (groundsLeaveTheBasket) {
    if (usesFunnel && usesShaker) {
      puckActions.push(accessoryAction(
        'Use the dosing funnel',
        'Place the dosing funnel on the portafilter and tip the grounds in from the blind shaker.',
      ));
    } else if (usesFunnel && usesCup) {
      puckActions.push(accessoryAction(
        'Use the dosing funnel',
        'Place the dosing funnel on the portafilter and tip the grounds in from the dosing cup.',
      ));
    } else if (usesShaker) {
      puckLines.push('Tip the grounds from the blind shaker into the basket.');
    } else {
      puckLines.push('Tip the grounds from the dosing cup into the basket.');
    }
  }
  if (accessories.wdt) {
    puckActions.push(accessoryAction(
      'Use the WDT',
      'Gently use the WDT to break up clumps and distribute the grounds throughout the portafilter.',
    ));
  }
  if (usesFunnel && needsPuck(accessories, groundsLeaveTheBasket)) {
    puckLines.push('Lift the dosing funnel off.');
  }
  if (accessories.distributor) {
    puckActions.push(accessoryAction(
      'Use the distributor',
      'Use the distributor to evenly level the coffee grounds in the portafilter.',
    ));
  }
  if (accessories.selfLevellingTamper) {
    puckActions.push(accessoryAction(
      'Use the self-levelling tamper',
      'Place the self-levelling tamper squarely and press once consistently.',
    ));
  }
  if (accessories.puckScreen) {
    puckActions.push(accessoryAction(
      'Use the puck screen',
      accessories.selfLevellingTamper
        ? 'Place the puck screen flat on top of the tamped coffee puck.'
        : 'Place the puck screen flat on top of the prepared coffee bed.',
    ));
  }

  const steps = [];

  steps.push(step({
    id: 'recipe',
    icon: 'recipe',
    title: 'This shot',
    instruction: 'From Dial-In.',
    metrics: summary.metrics,
  }));

  steps.push(step({
    id: 'warmup',
    icon: 'power',
    title: 'Heat up',
    lines: [
      'Turn the machine on and let it heat.',
      'Check there is enough water.',
    ],
  }));

  steps.push(step({
    id: 'preheat',
    icon: 'rinse',
    title: 'Preheat the group',
    lines: [
      'Lock the empty portafilter and filter basket into the group head.',
      'Run hot water through the group head to warm the group, portafilter, and basket.',
      'Discard the water, remove the portafilter, and dry the basket and portafilter thoroughly before adding coffee.',
    ],
    note: 'This is a preheat rinse with water — not an espresso shot.',
  }));

  steps.push(step({
    id: 'cup',
    icon: 'cup',
    title: 'Warm the cup',
    lines: [
      'Fill the cup with hot water from the machine.',
      'Empty it and dry it.',
    ],
  }));

  steps.push(step({
    id: 'grindSetting',
    icon: 'grind',
    title: 'Set the grind',
    highlightLabel: grindSettingLabel,
    highlight: grindLabel,
    lines: grindLines,
  }));

  const grindHelpIds = [];
  if (usesCup) grindHelpIds.push('dosingCup');
  else if (usesShaker) grindHelpIds.push('blindShaker');
  else if (usesFunnel) grindHelpIds.push('dosingFunnel');

  const puckHelpIds = [];
  if (usesShaker && usesCup) puckHelpIds.push('blindShaker');
  if (usesFunnel && groundsLeaveTheBasket) puckHelpIds.push('dosingFunnel');
  if (accessories.wdt) puckHelpIds.push('wdt');
  if (accessories.distributor) puckHelpIds.push('distributor');
  if (accessories.selfLevellingTamper) puckHelpIds.push('selfLevellingTamper');
  if (accessories.puckScreen) puckHelpIds.push('puckScreen');

  steps.push(step({
    id: 'dose',
    icon: 'weigh',
    title: 'Dose',
    highlightLabel: 'Dose',
    highlight: `${dose}g`,
    lines: doseLines,
    actions: doseActions,
    helps: toolHelp(accessories, ['rdt']),
  }));

  steps.push(step({
    id: 'grind',
    icon: 'grind',
    title: 'Grind',
    lines: grindDoseLines,
    actions: grindActions,
    helps: toolHelp(accessories, grindHelpIds),
  }));

  if (puckLines.length || puckActions.length) {
    steps.push(step({
      id: 'puck',
      icon: 'portafilter',
      title: 'Prepare the puck',
      lines: puckLines,
      actions: puckActions,
      helps: toolHelp(accessories, puckHelpIds),
    }));
  }

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
      ? `Lock in, cup on the scale. Stop the machine around ${stopAt}g.`
      : `Lock in, cup on the scale. Brew toward ${yieldG}g.`,
    note: 'The timer does not read the scale.',
  }));

  steps.push(step({
    id: 'yield',
    kind: 'yield',
    icon: 'weigh',
    title: 'Yield',
    highlightLabel: 'Target',
    highlight: `${yieldG}g`,
    yieldPrompt: 'What was the final yield?',
    yieldFieldLabel: 'Actual yield',
    instruction: 'Enter the actual yield from the scale. It is sent to Dial-In with the shot time.',
  }));

  steps.push(step({
    id: 'clean',
    icon: 'rinse',
    title: 'Clean up',
    lines: [
      'Knock the puck out.',
      'Rinse the basket and portafilter.',
      'Rinse the group head.',
      'Leave the machine ready for next time.',
    ],
  }));

  steps.push(step({
    id: 'taste',
    kind: 'handoff',
    icon: 'log',
    title: 'Your shot details are ready in Dial-In',
    instruction: 'Your shot time and yield have been carried over to the Dial-In screen. Select how the shot tasted, then log the shot to get your next grind recommendation.',
    doneLabel: 'Go to Dial-In',
  }));

  return steps;
}
