/** Brew Guide accessories and the puck-prep steps they turn on or off. */

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

function amountOrDash(value) {
  return formatBrewAmount(value) ?? '—';
}

/**
 * Build the prep steps for the accessories the user actually has.
 * Dose, yield, time, grinder and grind setting come from the live Dial-In dial.
 */
export function buildBrewSteps(rawAccessories, dial = {}) {
  const accessories = normalizeBrewAccessories(rawAccessories);
  const dose = amountOrDash(dial.doseG);
  const yieldG = amountOrDash(dial.yieldG);
  const timeMin = Number.isFinite(Number(dial.timeMinS)) ? String(Number(dial.timeMinS)) : '—';
  const timeMax = Number.isFinite(Number(dial.timeMaxS)) ? String(Number(dial.timeMaxS)) : '—';
  const grindLabel = dial.grindLabel ? String(dial.grindLabel) : '—';
  const grinder = dial.grinderModel || 'your grinder';
  const bean = dial.beanName || 'your coffee';
  const temp = formatBrewAmount(dial.brewTemperatureC);
  const grindSettingLabel = /sunbeam/i.test(grinder) ? 'Dial setting' : 'Grind setting';

  const usesCup = accessories.dosingCup;
  const usesFunnel = accessories.dosingFunnel;
  const usesShaker = accessories.blindShaker;
  const holdsGroundsOutsideBasket = usesCup || usesShaker;

  const steps = [];

  steps.push({
    id: 'recipe',
    icon: 'recipe',
    title: 'Check the recipe',
    instruction: temp ? `${bean} on the ${grinder} at ${temp}°C.` : `${bean} on the ${grinder}.`,
    note: 'Taken from your current Dial-In recipe.',
    metrics: [
      { label: 'Dose', value: `${dose}g` },
      { label: 'Yield', value: `${yieldG}g` },
      { label: 'Time', value: `${timeMin}–${timeMax}s` },
      { label: 'Grind', value: grindLabel },
    ],
  });

  if (accessories.rdt) {
    steps.push({
      id: 'rdt',
      icon: 'rdt',
      title: 'Spray the beans',
      instruction: 'Spray a very small amount of water on the beans before you grind.',
      note: 'This reduces static so the grounds cling less and make less mess.',
    });
  }

  if (usesCup) {
    steps.push({
      id: 'grind',
      icon: 'grind',
      title: 'Grind into the cup',
      highlightLabel: grindSettingLabel,
      highlight: grindLabel,
      instruction: `Grind ${dose}g and catch it in the dosing cup. Check the weight is ${dose}g.`,
    });
  } else if (usesShaker) {
    steps.push({
      id: 'grind',
      icon: 'grind',
      title: 'Grind into the shaker',
      highlightLabel: grindSettingLabel,
      highlight: grindLabel,
      instruction: `Grind ${dose}g straight into the blind shaker.`,
    });
  } else if (usesFunnel) {
    steps.push({
      id: 'grind',
      icon: 'grind',
      title: 'Grind into the basket',
      highlightLabel: grindSettingLabel,
      highlight: grindLabel,
      instruction: `Fit the dosing funnel on the portafilter. Grind ${dose}g into the basket.`,
    });
  } else {
    steps.push({
      id: 'grind',
      icon: 'grind',
      title: 'Grind into the basket',
      highlightLabel: grindSettingLabel,
      highlight: grindLabel,
      instruction: `Grind ${dose}g into the basket. Hold the portafilter steady so the grounds do not spill.`,
    });
  }

  if (usesShaker) {
    steps.push({
      id: 'shake',
      icon: 'shake',
      title: 'Shake the grounds',
      instruction: usesCup
        ? 'Pour the grounds from the dosing cup into the blind shaker. Shake until they look even and settled.'
        : 'Shake the blind shaker until the grounds look even and settled.',
    });
  }

  if (holdsGroundsOutsideBasket) {
    let instruction;
    if (usesFunnel && usesShaker) {
      instruction = 'Set the dosing funnel on the portafilter. Tip the grounds in from the blind shaker so they stay in the basket.';
    } else if (usesFunnel && usesCup) {
      instruction = 'Set the dosing funnel on the portafilter. Tip the grounds in from the dosing cup so they stay in the basket.';
    } else {
      instruction = 'Transfer the grounds carefully into the basket so they do not spill over the rim.';
    }
    steps.push({
      id: 'transfer',
      icon: 'transfer',
      title: 'Transfer to the basket',
      instruction,
    });
  }

  if (accessories.wdt) {
    steps.push({
      id: 'wdt',
      icon: 'wdt',
      title: 'Break up clumps',
      instruction: usesFunnel
        ? 'Use the thin needle tool to gently stir the grounds. Leave the dosing funnel on.'
        : 'Use the thin needle tool to gently stir the grounds so they sit evenly in the basket.',
    });
  }

  if (usesFunnel) {
    steps.push({
      id: 'removeFunnel',
      icon: 'funnel',
      title: 'Remove the funnel',
      instruction: 'Lift the dosing funnel off the portafilter so the basket rim is clear.',
    });
  }

  if (accessories.distributor) {
    steps.push({
      id: 'distribute',
      icon: 'distribute',
      title: 'Level the grounds',
      instruction: 'Set the distributor on the basket and turn it until the grounds are level.',
    });
  }

  if (accessories.selfLevellingTamper) {
    steps.push({
      id: 'tamp',
      icon: 'tamp',
      title: 'Tamp',
      instruction: 'Set the self-levelling tamper on the basket and press until it stops.',
      note: 'It sits level on the basket so the coffee is compressed evenly.',
    });
  } else {
    steps.push({
      id: 'tamp',
      icon: 'tamp',
      title: 'Tamp',
      instruction: 'Tamp straight down so the coffee bed is level and even.',
    });
  }

  if (accessories.puckScreen) {
    steps.push({
      id: 'screen',
      icon: 'screen',
      title: 'Add the puck screen',
      instruction: 'Place the thin metal screen on top of the tamped coffee.',
    });
  }

  steps.push({
    id: 'ready',
    icon: 'ready',
    title: 'Brew',
    highlightLabel: 'Target yield',
    highlight: `${yieldG}g`,
    instruction: `Lock the portafilter in. Brew to about ${yieldG}g, aiming for ${timeMin}–${timeMax} seconds.`,
  });

  return steps;
}
