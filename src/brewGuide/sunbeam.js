/** Sunbeam Barista Max EM5300 / EM5300K guides, from the official user guide. */

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

export const BREW_TEMPERATURES = Object.freeze([
  { celsius: 96, lights: 'TWO CUP light' },
  { celsius: 94, lights: 'ONE CUP and TWO CUP lights' },
  { celsius: 92, lights: 'ONE CUP light', isDefault: true },
  { celsius: 90, lights: 'MANUAL SHOT and TWO CUP lights' },
  { celsius: 88, lights: 'MANUAL SHOT light' },
]);

export const PREINFUSION_PROFILES = Object.freeze([
  {
    id: 'gentle',
    name: 'Gentle',
    button: 'ONE CUP',
    isDefault: true,
    summary: 'Small amounts of water wet the coffee, then a steady flow starts. This is the balanced profile.',
  },
  {
    id: 'distinct',
    name: 'Distinct',
    button: 'TWO CUP',
    summary: 'One dose of water, a brief rest, then a steady flow. This is the brighter profile.',
  },
  {
    id: 'constant',
    name: 'Constant',
    button: 'MANUAL SHOT',
    summary: 'A steady flow from start to finish. This is the sharper profile.',
  },
]);

const READY = 'Plug the machine in and switch it on. Leave the dial vertical. The machine should be on and in the READY state.';

export function buildSunbeamGuides() {
  const temperature = guide('temperature', 'Brew temperature', [
    {
      id: 'ready',
      title: 'Get ready',
      lines: [READY],
    },
    {
      id: 'enter',
      title: 'Open temperature mode',
      lines: [
        'Press and hold ON/OFF and ONE CUP together for 4 seconds.',
        'The machine beeps and the ON/OFF light flashes.',
      ],
      note: 'If you press nothing for 1 minute, the machine leaves this mode and returns to READY.',
    },
    {
      id: 'set',
      title: 'Choose the temperature',
      lines: [
        'TWO CUP raises it. MANUAL SHOT lowers it.',
        ...BREW_TEMPERATURES.map((item) => (
          `${item.celsius}°C — ${item.lights}${item.isDefault ? '. This is the default.' : '.'}`
        )),
      ],
      note: 'A higher temperature increases bitterness and decreases acidity. A lower temperature does the opposite.',
    },
    {
      id: 'save',
      title: 'Save',
      lines: [
        'Press ON/OFF.',
        'The machine beeps and returns to READY.',
      ],
    },
  ]);

  const preinfusion = guide('preinfusion', 'Pre-infusion', [
    {
      id: 'ready',
      title: 'Get ready',
      lines: ['The machine should be on and in the READY state.'],
    },
    {
      id: 'enter',
      title: 'Open pre-infusion mode',
      lines: [
        'Press and hold ON/OFF, ONE CUP, and TWO CUP together for 4 seconds.',
        'The machine beeps and the ON/OFF light flashes.',
      ],
      note: 'If you press nothing for 1 minute, the machine leaves this mode and returns to READY.',
    },
    {
      id: 'choose',
      title: 'Choose a profile',
      lines: PREINFUSION_PROFILES.map((item) => (
        `${item.name}${item.isDefault ? ' (default)' : ''}: press ${item.button}. The ${item.button} light comes on. ${item.summary}`
      )),
    },
    {
      id: 'save',
      title: 'Save',
      lines: [
        'Press ON/OFF.',
        'The machine beeps and returns to READY.',
      ],
    },
  ]);

  const textureMilk = guide('textureMilk', 'Texture milk', [
    {
      id: 'fill',
      title: 'Fill the jug',
      lines: [
        'Add cold milk, about 4°C, to a chilled stainless steel jug.',
        'Fill to the bottom of the spout.',
      ],
      note: 'The milk will stretch, so do not overfill the jug. Non-dairy milk can need a small change in technique.',
    },
    {
      id: 'heat',
      title: 'Heat the steam',
      lines: [
        'Turn the dial to STEAM.',
        'Wait until the STEAM light stays on and you hear the pump.',
        'Turn the dial back to vertical to pause.',
      ],
      note: 'Some water may come out of the steam wand.',
    },
    {
      id: 'position',
      title: 'Position the wand',
      lines: [
        'Put the steam wand arm in the jug spout at 12 o’clock.',
        'Put the tip in the milk at 3 o’clock, a finger width from the edge, just under the surface.',
      ],
    },
    {
      id: 'start',
      title: 'Start texturing',
      lines: [
        'Turn the dial back to STEAM.',
        'The milk should spin in a whirlpool.',
        'A smooth hiss is the sound you want. Gurgling means raise the jug. Screeching means lower it.',
      ],
    },
    {
      id: 'follow',
      title: 'Follow the milk',
      lines: [
        'As the milk rises, lower the jug so the tip stays just under the surface.',
        'Cappuccinos use more foam than flat whites.',
      ],
    },
    {
      id: 'blend',
      title: 'Blend the milk',
      lines: [
        'When you have enough foam, put the tip about halfway into the milk.',
        'This heats the milk and mixes the foam through.',
      ],
    },
    {
      id: 'heatCheck',
      title: 'Stop the steam',
      lines: [
        'Stop when the base of the jug is too hot to hold for about 3 seconds.',
        'Turn the dial to vertical and take the jug off the wand.',
      ],
      note: 'Full and skim milk are ready around 60–65°C. Milk boiled around 72°C tastes burnt and loses its texture.',
    },
    {
      id: 'purge',
      title: 'Purge the steam wand',
      lines: [
        'Hold the steam wand over the drip tray.',
        'Turn the dial to HOT WATER for 1–2 seconds, then back to vertical.',
      ],
      note: 'Milky water comes out. This clears milk from the tip.',
    },
    {
      id: 'wipe',
      title: 'Wipe the steam wand',
      lines: ['Wipe the steam wand and tip with a clean damp cloth.'],
    },
    {
      id: 'finish',
      title: 'Finish the milk',
      lines: [
        'Tap the jug on the bench to pop large bubbles.',
        'Swirl it, then pour in one steady motion.',
      ],
    },
  ]);

  const milkDrinks = guide('milkDrinks', 'Flat white', [
    {
      id: 'cup',
      title: 'Choose the cup',
      lines: [
        'Flat white: a wide cup, about 190mL, so the foam stays thin.',
        'Latte: a narrower glass or cup, about 220mL, with about a finger of foam.',
        'Cappuccino: a 190–240mL cup, about one third textured milk and one third foam.',
      ],
    },
    {
      id: 'espresso',
      title: 'Pull the espresso',
      lines: ['Pull a single or double shot, about 30–60mL, into the cup.'],
    },
    {
      id: 'milk',
      title: 'Texture the milk',
      lines: [
        'Fill a chilled jug with cold milk to the bottom of the spout.',
        'Heat the steam until the STEAM light stays on, then pause the dial.',
        'Texture with the tip just under the surface. Keep the foam thin for a flat white.',
      ],
    },
    {
      id: 'pour',
      title: 'Pour',
      lines: [
        'Tap and swirl the jug.',
        'Pour the milk and thin foam in one steady motion.',
      ],
    },
    {
      id: 'purge',
      title: 'Purge the steam wand',
      lines: [
        'Hold the steam wand over the drip tray.',
        'Turn the dial to HOT WATER for 1–2 seconds, then back to vertical.',
      ],
    },
    {
      id: 'wipe',
      title: 'Wipe the steam wand',
      lines: ['Wipe the steam wand and tip with a clean damp cloth.'],
    },
  ]);

  const hotChocolate = guide('hotChocolate', 'Hot chocolate', [
    {
      id: 'cup',
      title: 'Set the cup',
      lines: ['Use a cup or tall glass, about 190–240mL.'],
      note: 'The manual makes this as a mocha.',
    },
    {
      id: 'espresso',
      title: 'Pull the espresso',
      lines: ['Pull a single or double shot, about 30–60mL.'],
    },
    {
      id: 'chocolate',
      title: 'Add the chocolate',
      lines: ['Stir drinking chocolate into the espresso.'],
    },
    {
      id: 'milk',
      title: 'Texture the milk',
      lines: [
        'Fill a chilled jug with cold milk to the bottom of the spout.',
        'Heat the steam until the STEAM light stays on, then texture the milk.',
        'Aim for about one third textured milk and one third foam, as with a cappuccino.',
      ],
    },
    {
      id: 'pour',
      title: 'Pour',
      lines: ['Pour the textured milk and foam onto the chocolate espresso.'],
    },
    {
      id: 'purge',
      title: 'Purge the steam wand',
      lines: [
        'Hold the steam wand over the drip tray.',
        'Turn the dial to HOT WATER for 1–2 seconds, then back to vertical.',
      ],
    },
    {
      id: 'wipe',
      title: 'Wipe the steam wand',
      lines: ['Wipe the steam wand and tip with a clean damp cloth.'],
    },
  ]);

  const cleaning = guide('cleaning', 'Cleaning cycle', [
    {
      id: 'water',
      title: 'Fill the reservoir',
      lines: ['Put at least 1 litre of water in the reservoir.'],
      note: 'The CLEAN light turns blue when the machine wants a cleaning cycle. The cycle takes about 7 minutes.',
    },
    {
      id: 'tray',
      title: 'Empty the drip tray',
      lines: ['Empty the drip tray and put it back. Water from the cycle goes into it.'],
    },
    {
      id: 'ready',
      title: 'Check the machine',
      lines: ['The machine should be on and in the READY state.'],
    },
    {
      id: 'basket',
      title: 'Fit the basket and disc',
      lines: ['Put the two cup filter basket and the cleaning disc into the group handle.'],
    },
    {
      id: 'tablet',
      title: 'Add the tablet',
      lines: ['Put one Sunbeam espresso machine cleaning tablet (EM0020) in the middle of the cleaning disc, in the space provided.'],
    },
    {
      id: 'lock',
      title: 'Lock in the handle',
      lines: ['Insert the group handle into the group head.'],
    },
    {
      id: 'start',
      title: 'Start the cycle',
      lines: [
        'Press and hold ON/OFF and MANUAL SHOT together for 4 seconds.',
        'The machine beeps and the cycle starts.',
      ],
    },
    {
      id: 'run',
      title: 'Let it run',
      lines: [
        'The ON/OFF and CLEAN lights flash.',
        'Water purges into the drip tray, and a little pours from the group handle spouts.',
        'Tap Done when the machine beeps, the lights stop flashing, and it returns to READY.',
      ],
      note: 'Press ON/OFF if you need to leave the cycle early.',
    },
    {
      id: 'check',
      title: 'Check the tablet',
      lines: [
        'Remove the group handle.',
        'Check that the tablet has dissolved.',
      ],
      note: 'If it has not, lock the handle back in, empty the drip tray and replace it, then start the cycle again.',
    },
    {
      id: 'rinse',
      title: 'Rinse the group head',
      lines: [
        'Press ONE CUP.',
        'Let the water run until it stops.',
      ],
    },
    {
      id: 'wash',
      title: 'Wash the parts',
      lines: [
        'Wash the drip tray, group handle, and cleaning disc in warm water with a mild detergent.',
        'Rinse and dry them.',
      ],
    },
  ]);

  const descale = guide('descale', 'Descale', [
    {
      id: 'when',
      title: 'Before you start',
      lines: [
        'The manual suggests descaling about every 4–6 months. It depends on your water and how often you use the machine.',
        'The cycle takes about 10 minutes.',
      ],
      note: 'If you stop part way, start again from the beginning. Press ON/OFF to leave the cycle. The ON/OFF light flashes until it finishes.',
    },
    {
      id: 'solution',
      title: 'Mix the solution',
      lines: [
        'Either fill the reservoir with 1 litre of warm water and add one Sunbeam descaling tablet (EM0010). Let it dissolve.',
        'Or add half a cap full of Sunbeam Liquid Descaler (KE0100) to an empty reservoir, fill with 1 litre of warm water, and mix.',
        'Or add 1½ tablespoons of white vinegar to an empty reservoir, fill with 1 litre of warm water, and mix.',
        'Put the reservoir back.',
      ],
    },
    {
      id: 'containers',
      title: 'Place two containers',
      lines: [
        'Put a 1 litre container under the group head.',
        'Put another 1 litre container under the steam wand.',
      ],
    },
    {
      id: 'ready',
      title: 'Check the machine',
      lines: [READY],
    },
    {
      id: 'enter',
      title: 'Open descale mode',
      lines: [
        'Press and hold ON/OFF and TWO CUP together for 4 seconds.',
        'The machine beeps. The ON/OFF and STEAM lights flash.',
      ],
    },
    {
      id: 'run',
      title: 'Run the solution',
      lines: [
        'Turn the dial to STEAM. The STEAM light stays on.',
        'Hot water runs from the group head and the steam wand for about 2 minutes. The pump may change sound.',
        'Tap Done when the water stops, the machine beeps, the STEAM light goes out, and the DIAL light flashes.',
      ],
      note: 'Start this within 1 minute of opening descale mode, or the machine returns to READY.',
    },
    {
      id: 'dialBack',
      title: 'Return the dial',
      lines: ['Turn the dial to vertical. The DIAL light stays on.'],
    },
    {
      id: 'rinse',
      title: 'Rinse and refill',
      lines: [
        'Take the reservoir out and rinse it until the descaling solution is gone.',
        'Fill it to the 1 litre line with cold tap water and put it back.',
        'Empty both containers and put them back.',
      ],
      note: 'The manual allows 5 minutes for this step. After that the cycle can exit.',
    },
    {
      id: 'purge',
      title: 'Rinse the machine',
      lines: [
        'Turn the dial to STEAM.',
        'Hot water runs from the group head and the steam wand for about 2 minutes.',
        'Tap Done when the water stops. The machine beeps and the ON/OFF light stops flashing.',
      ],
    },
    {
      id: 'finish',
      title: 'Finish',
      lines: [
        'The DIAL light flashes. Turn the dial to vertical.',
        'The machine returns to READY.',
      ],
    },
    {
      id: 'wash',
      title: 'Wash the containers',
      lines: ['Empty the containers and wash them so no descaling solution is left.'],
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
