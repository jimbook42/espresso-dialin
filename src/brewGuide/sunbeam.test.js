import assert from 'assert';
import fs from 'fs';
import { buildBrewSteps } from './steps.js';
import { BREW_TEMPERATURES, PREINFUSION_PROFILES, buildSunbeamGuides } from './sunbeam.js';

function textOf(guide) {
  return guide.steps.map((step) => [step.title, step.instruction, step.note].filter(Boolean).join(' ')).join('\n');
}

function ids(guide) {
  return guide.steps.map((step) => step.id);
}

export function runSunbeamGuideTests() {
  const guides = buildSunbeamGuides();
  const keys = ['temperature', 'preinfusion', 'textureMilk', 'milkDrinks', 'hotChocolate', 'cleaning', 'descale'];
  assert.deepEqual(Object.keys(guides), keys);

  for (const key of keys) {
    const guide = guides[key];
    const stepIds = ids(guide);
    assert.equal(new Set(stepIds).size, stepIds.length);
    assert.ok(guide.steps.length >= 4 && guide.steps.length <= 12, `${key} has ${guide.steps.length} steps`);
    for (const step of guide.steps) {
      assert.ok(step.title.trim());
      assert.ok(step.instruction.trim());
      assert.ok(step.lines.length > 0);
    }
  }

  assert.deepEqual(BREW_TEMPERATURES.map((item) => item.celsius), [96, 94, 92, 90, 88]);
  assert.equal(BREW_TEMPERATURES.find((item) => item.isDefault).celsius, 92);
  const temperature = textOf(guides.temperature);
  assert.match(temperature, /ON\/OFF and ONE CUP together for 4 seconds/);
  assert.match(temperature, /TWO CUP raises it/);
  assert.match(temperature, /MANUAL SHOT lowers it/);
  assert.match(temperature, /Press ON\/OFF/);
  for (const item of BREW_TEMPERATURES) {
    assert.match(temperature, new RegExp(`${item.celsius}°C`));
    assert.match(temperature, new RegExp(item.lights.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.deepEqual(PREINFUSION_PROFILES.map((item) => item.name), ['Gentle', 'Distinct', 'Constant']);
  assert.equal(PREINFUSION_PROFILES.find((item) => item.isDefault).name, 'Gentle');
  const preinfusion = textOf(guides.preinfusion);
  assert.match(preinfusion, /ON\/OFF, ONE CUP, and TWO CUP together for 4 seconds/);
  const choose = guides.preinfusion.steps.find((step) => step.id === 'choose');
  assert.doesNotMatch(choose.instruction, /second/i);
  assert.doesNotMatch(preinfusion, /flair|\bbar\b|pressure|pre-infusion time/i);
  assert.match(choose.instruction, /Gentle \(default\): press ONE CUP/);
  assert.match(choose.instruction, /Distinct: press TWO CUP/);
  assert.match(choose.instruction, /Constant: press MANUAL SHOT/);

  const milkKeys = ['textureMilk', 'milkDrinks', 'hotChocolate'];
  for (const key of milkKeys) {
    const milk = textOf(guides[key]);
    assert.match(milk, /HOT WATER for 1–2 seconds/);
    assert.match(milk, /Wipe the steam wand and tip/);
  }
  assert.match(textOf(guides.milkDrinks), /Flat white/);
  assert.match(textOf(guides.milkDrinks), /Latte/);
  assert.match(textOf(guides.milkDrinks), /Cappuccino/);
  assert.match(textOf(guides.hotChocolate), /drinking chocolate/);
  assert.match(textOf(guides.hotChocolate), /mocha/i);

  const machineOnly = ['temperature', 'preinfusion', 'cleaning', 'descale'].map((key) => textOf(guides[key])).join('\n');
  assert.doesNotMatch(machineOnly, /flat white|hot chocolate|textured milk|wipe the steam wand/i);

  const cleaning = textOf(guides.cleaning);
  assert.match(cleaning, /at least 1 litre/);
  assert.match(cleaning, /cleaning disc/i);
  assert.match(cleaning, /EM0020/);
  assert.match(cleaning, /two cup filter basket/i);
  assert.match(cleaning, /Empty the drip tray/);
  assert.match(cleaning, /ON\/OFF and MANUAL SHOT together for 4 seconds/);
  assert.match(cleaning, /about 7 minutes/);
  assert.match(cleaning, /Press ONE CUP/);
  assert.deepEqual(ids(guides.cleaning), [
    'water', 'tray', 'ready', 'basket', 'tablet', 'lock', 'start', 'run', 'check', 'rinse', 'wash',
  ]);

  const descale = textOf(guides.descale);
  assert.match(descale, /4–6 months/);
  assert.match(descale, /about 10 minutes/);
  assert.match(descale, /EM0010/);
  assert.match(descale, /KE0100/);
  assert.match(descale, /white vinegar/);
  assert.match(descale, /1 litre container under the group head/);
  assert.match(descale, /ON\/OFF and TWO CUP together for 4 seconds/);
  assert.match(descale, /within 1 minute/);
  assert.match(descale, /5 minutes for this step/);
  assert.match(descale, /cold tap water/);
  assert.doesNotMatch(descale, /wipe the steam wand/i);
  assert.deepEqual(ids(guides.descale), [
    'when', 'solution', 'containers', 'ready', 'enter', 'run', 'dialBack', 'rinse', 'purge', 'finish', 'wash',
  ]);

  const espresso = buildBrewSteps({}, {
    beanName: 'House Espresso',
    doseG: 18,
    yieldG: 36,
    timeMinS: 27,
    timeMaxS: 32,
    grinderModel: 'Sunbeam Barista Max',
    grindLabel: '15',
    previousGrindLabel: '15',
  }).map((step) => step.instruction).join('\n');
  assert.doesNotMatch(espresso, /milk|steam wand|gentle|distinct|constant|cleaning disc|descal/i);

  const source = fs.readFileSync(new URL('./sunbeam.js', import.meta.url), 'utf8');
  assert.equal(/dexie|indexedDB|db\.version/i.test(source), false);
  assert.doesNotMatch(source, /flair/i);

  console.log('Sunbeam guide tests passed!');
}
