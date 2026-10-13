/** Machine-agnostic Brew Guide reference (pump espresso machines). */

function guideStep({ id, title, lines, note }) {
  const clean = lines.filter(Boolean);
  return {
    id,
    title,
    lines: clean,
    note,
    instruction: clean.join(' '),
  };
}

function guide(id, title, steps) {
  return { id, title, steps: steps.map(guideStep) };
}

export function buildGenericMachineGuides() {
  const temperature = guide('temperature', 'Brew temperature', [
    {
      id: 'ready',
      title: 'Get ready',
      lines: [
        'Switch your espresso machine on and let it heat until it is ready to brew.',
        'Check the water tank has enough water.',
      ],
    },
    {
      id: 'find',
      title: 'Open temperature settings',
      lines: [
        'Use your machine’s menu or controls to adjust brew temperature.',
        'If you are unsure where this lives, check the manual for “brew temperature” or “coffee temperature”.',
      ],
    },
    {
      id: 'set',
      title: 'Choose a temperature',
      lines: [
        'Many home machines default around 90–93°C.',
        'Higher temperatures can increase bitterness; lower temperatures can increase acidity.',
        'Change in small steps and taste the results.',
      ],
    },
    {
      id: 'save',
      title: 'Brew and note it',
      lines: [
        'Pull a test shot at the new temperature.',
        'Log the shot in Dial-In so grind advice stays tied to what you actually brewed.',
      ],
    },
  ]);

  const preinfusion = guide('preinfusion', 'Pre-infusion', [
    {
      id: 'ready',
      title: 'What pre-infusion does',
      lines: [
        'Pre-infusion gently wets the coffee puck before full pressure.',
        'It can help even extraction on many pump machines.',
      ],
    },
    {
      id: 'find',
      title: 'Find the setting',
      lines: [
        'Look for pre-infusion, pre-brew, or a low-pressure first phase in your machine’s menu.',
        'Not every machine has this — skip this guide if yours does not.',
      ],
    },
    {
      id: 'choose',
      title: 'Pick a profile',
      lines: [
        'Start with the gentlest option your machine offers.',
        'If shots taste sharp or uneven, try a longer or softer pre-infusion phase.',
      ],
    },
    {
      id: 'save',
      title: 'Taste and log',
      lines: [
        'Brew with the new profile and log the shot in Dial-In.',
      ],
    },
  ]);

  const textureMilk = guide('textureMilk', 'Texture milk', [
    {
      id: 'purge',
      title: 'Purge the wand',
      lines: [
        'Briefly open the steam wand into a cloth or drip tray to clear condensation.',
      ],
    },
    {
      id: 'position',
      title: 'Position the pitcher',
      lines: [
        'Fill a pitcher with cold milk to about one-third full.',
        'Submerge the steam tip just below the surface at an angle.',
      ],
    },
    {
      id: 'texture',
      title: 'Stretch and roll',
      lines: [
        'Introduce air briefly, then lower the pitcher to heat and spin the milk.',
        'Stop when the pitcher is too hot to hold comfortably.',
      ],
    },
    {
      id: 'clean',
      title: 'Clean the wand',
      lines: [
        'Wipe the steam wand and tip immediately.',
        'Purge again to clear milk from inside the wand.',
      ],
    },
  ]);

  const milkDrinks = guide('milkDrinks', 'Milk drinks', [
    {
      id: 'texture',
      title: 'Texture the milk',
      lines: [
        'Texture milk as in the steam wand guide — silky microfoam, not large bubbles.',
      ],
    },
    {
      id: 'pour',
      title: 'Pour the drink',
      lines: [
        'Pour espresso first, then milk.',
        'Flat white: thin foam. Latte: more milk, light foam. Cappuccino: more foam.',
      ],
    },
  ]);

  const hotChocolate = guide('hotChocolate', 'Hot chocolate', [
    {
      id: 'mix',
      title: 'Mix the chocolate',
      lines: [
        'Warm milk and whisk in drinking chocolate until smooth.',
      ],
    },
    {
      id: 'espresso',
      title: 'Add espresso (optional)',
      lines: [
        'For a mocha, pour a shot of espresso into the chocolate milk.',
      ],
    },
  ]);

  const cleaning = guide('cleaning', 'Cleaning cycle', [
    {
      id: 'when',
      title: 'When to clean',
      lines: [
        'Run a cleaning cycle when your machine asks for it, or on a regular schedule from the manual.',
      ],
    },
    {
      id: 'prepare',
      title: 'Prepare',
      lines: [
        'Use the cleaning tablet or powder your manufacturer recommends.',
        'Empty the drip tray and place a container under the group if the manual says to.',
      ],
    },
    {
      id: 'run',
      title: 'Run the programme',
      lines: [
        'Start the cleaning cycle from the machine menu and let it finish.',
        'Rinse thoroughly afterward so no cleaner remains in the brew path.',
      ],
    },
  ]);

  const descale = guide('descale', 'Descale', [
    {
      id: 'when',
      title: 'When to descale',
      lines: [
        'Descale when prompted or every few months, depending on water hardness and use.',
      ],
    },
    {
      id: 'solution',
      title: 'Mix descaler',
      lines: [
        'Follow your manual for descaling solution strength and water volume.',
      ],
    },
    {
      id: 'run',
      title: 'Run and rinse',
      lines: [
        'Run the descale programme completely.',
        'Rinse with fresh water until the machine no longer smells of descaler.',
      ],
    },
  ]);

  return {
    temperature,
    preinfusion,
    textureMilk,
    milkDrinks,
    hotChocolate,
    cleaning,
    descale,
  };
}

export const GENERIC_MACHINE_SETTINGS_DETAIL =
  'General espresso machine settings. Use your machine’s manual for exact button names.';
