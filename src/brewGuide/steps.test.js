import assert from 'assert';
import fs from 'fs';
import {
  BREW_ACCESSORIES,
  DEFAULT_BREW_ACCESSORIES,
  buildBrewSteps,
  brewDialIsReady,
  normalizeBrewAccessories,
} from './steps.js';

const DIAL = {
  beanName: 'House Espresso',
  doseG: 18,
  yieldG: 36,
  timeMinS: 27,
  timeMaxS: 32,
  brewTemperatureC: 93,
  grinderModel: 'Sunbeam Barista Max',
  grindLabel: '15',
};

function none() {
  return { ...DEFAULT_BREW_ACCESSORIES };
}

function ids(accessories, dial = DIAL) {
  return buildBrewSteps(accessories, dial).map((step) => step.id);
}

function blob(accessories, dial = DIAL) {
  return buildBrewSteps(accessories, dial)
    .map((step) => [step.title, step.instruction, step.note, step.highlight, step.highlightLabel, ...(step.metrics || []).map((m) => `${m.label} ${m.value}`)].filter(Boolean).join(' '))
    .join('\n')
    .toLowerCase();
}

function assertNo(text, pattern) {
  assert.equal(pattern.test(text), false, `did not expect ${pattern} in:\n${text}`);
}

function assertOrder(stepIds, sequence) {
  let last = -1;
  for (const id of sequence) {
    const idx = stepIds.indexOf(id);
    assert.notEqual(idx, -1, `missing ${id} in ${stepIds.join(' → ')}`);
    assert.ok(idx > last, `${id} out of order in ${stepIds.join(' → ')}`);
    last = idx;
  }
}

export function runBrewGuideTests() {
  const normalized = normalizeBrewAccessories({ wdt: true, milkFrother: true, dosingCup: 0 });
  assert.equal(normalized.wdt, true);
  assert.equal(normalized.dosingCup, false);
  assert.equal(normalized.distributor, false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'milkFrother'), false);
  assert.equal(Object.keys(normalized).length, BREW_ACCESSORIES.length);

  assert.equal(brewDialIsReady(DIAL), true);
  assert.equal(brewDialIsReady({ ...DIAL, doseG: '' }), false);
  assert.equal(brewDialIsReady({ ...DIAL, beanName: '' }), false);

  assert.deepEqual(ids(none()), ['recipe', 'grind', 'tamp', 'ready']);

  const withPrep = { ...none(), dosingCup: true, wdt: true, distributor: true };
  assert.deepEqual(ids(withPrep), ['recipe', 'grind', 'transfer', 'wdt', 'distribute', 'tamp', 'ready']);
  assert.deepEqual(ids({ ...withPrep, wdt: false }), ['recipe', 'grind', 'transfer', 'distribute', 'tamp', 'ready']);
  assert.deepEqual(ids({ ...withPrep, distributor: false }), ['recipe', 'grind', 'transfer', 'wdt', 'tamp', 'ready']);

  const careful = buildBrewSteps({ ...none(), dosingCup: true }, DIAL).find((step) => step.id === 'transfer');
  assert.match(careful.instruction, /carefully/i);
  assertNo(careful.instruction, /funnel/i);

  const withFunnel = buildBrewSteps({ ...none(), dosingCup: true, dosingFunnel: true }, DIAL).find((step) => step.id === 'transfer');
  assert.match(withFunnel.instruction, /dosing funnel/i);
  assertNo(withFunnel.instruction, /carefully/i);

  const direct = blob(none());
  assertNo(direct, /funnel|dosing cup|shaker|needle|distributor|self-levelling|screen|spray|static/);

  const funnelOnBasket = ids({ ...none(), dosingFunnel: true, wdt: true, distributor: true });
  assertOrder(funnelOnBasket, ['grind', 'wdt', 'removeFunnel', 'distribute', 'tamp']);
  assert.equal(funnelOnBasket.includes('transfer'), false);

  const cupShakerFunnel = ids({
    ...none(),
    dosingCup: true,
    dosingFunnel: true,
    blindShaker: true,
    wdt: true,
    distributor: true,
    selfLevellingTamper: true,
    puckScreen: true,
    rdt: true,
  });
  assert.deepEqual(cupShakerFunnel, [
    'recipe',
    'rdt',
    'grind',
    'shake',
    'transfer',
    'wdt',
    'removeFunnel',
    'distribute',
    'tamp',
    'screen',
    'ready',
  ]);

  const shakerOnly = buildBrewSteps({ ...none(), blindShaker: true }, DIAL);
  assert.match(shakerOnly.find((step) => step.id === 'grind').instruction, /blind shaker/i);
  assert.match(shakerOnly.find((step) => step.id === 'transfer').instruction, /carefully/i);
  assertNo(blob({ ...none(), blindShaker: true }), /dosing cup|funnel/);

  const sunbeam = blob(none(), DIAL);
  assert.match(sunbeam, /house espresso/);
  assert.match(sunbeam, /sunbeam barista max/);
  assert.match(sunbeam, /18g/);
  assert.match(sunbeam, /36g/);
  assert.match(sunbeam, /27/);
  assert.match(sunbeam, /32/);
  assert.match(sunbeam, /93/);
  assert.match(sunbeam, /dial setting/);
  assert.match(sunbeam, /\b15\b/);

  const updated = blob(none(), { ...DIAL, doseG: 20, yieldG: 42, timeMinS: 25, timeMaxS: 30, grindLabel: '9', beanName: 'Kenya', grinderModel: 'Sette 270Wi' });
  assert.match(updated, /kenya/);
  assert.match(updated, /sette 270wi/);
  assert.match(updated, /20g/);
  assert.match(updated, /42g/);
  assert.match(updated, /25/);
  assert.match(updated, /30/);
  assert.match(updated, /grind setting/);
  assert.match(updated, /\b9\b/);
  assertNo(updated, /18g/);
  assertNo(updated, /dial setting/);

  for (const step of buildBrewSteps({ ...none(), dosingCup: true, wdt: true, distributor: true, puckScreen: true }, DIAL)) {
    assert.ok(step.title.trim().length > 0);
    assert.ok(step.instruction.trim().length > 0);
  }

  const schema = fs.readFileSync(new URL('../utils/grinderLogic.js', import.meta.url), 'utf8');
  assert.match(schema, /db\.version\(17\)/);
  assert.equal(/db\.version\(18\)/.test(schema), false);

  console.log('Brew Guide tests passed!');
}
