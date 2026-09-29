import assert from 'assert';
import fs from 'fs';
import {
  BREW_ACCESSORIES,
  DEFAULT_BREW_ACCESSORIES,
  brewDialIsReady,
  brewStopYield,
  buildBrewSteps,
  grindSettingChanged,
  normalizeBrewAccessories,
} from './steps.js';
import { runSunbeamGuideTests } from './sunbeam.test.js';

const DIAL = {
  beanName: 'House Espresso',
  doseG: 18,
  yieldG: 36,
  timeMinS: 27,
  timeMaxS: 32,
  brewTemperatureC: 92,
  grinderModel: 'Sunbeam Barista Max',
  grindLabel: '15',
  previousGrindLabel: '15',
};

const CORE = [
  'recipe',
  'warmup',
  'preheat',
  'cup',
  'grindSetting',
  'dose',
  'grind',
  'extract',
  'yield',
  'clean',
  'taste',
];

const FORBIDDEN = {
  dosingCup: /dosing cup/i,
  dosingFunnel: /funnel/i,
  rdt: /\brdt\b|spray|static/i,
  blindShaker: /shaker/i,
  wdt: /clump|\bwdt\b/i,
  distributor: /distributor/i,
  selfLevellingTamper: /tamper|\btamp\b/i,
  puckScreen: /puck screen/i,
};

function none() {
  return { ...DEFAULT_BREW_ACCESSORIES };
}

function ids(accessories, dial = DIAL) {
  return buildBrewSteps(accessories, dial).map((step) => step.id);
}

function stepText(step) {
  const helpText = (step.helps || []).map((item) => `${item.name} ${item.text}`).join(' ');
  const actionText = (step.actions || []).map((item) => `${item.title} ${item.text}`).join(' ');
  return [step.title, step.instruction, actionText, step.note, step.help, helpText, step.highlight, step.highlightLabel, step.stopAt, step.timeLabel, ...(step.metrics || []).map((metric) => `${metric.label} ${metric.value}`)]
    .filter(Boolean)
    .join(' ');
}

function blob(accessories, dial = DIAL) {
  return buildBrewSteps(accessories, dial).map(stepText).join('\n');
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

function needsPuck(accessories) {
  return Boolean(
    accessories.dosingCup
    || accessories.blindShaker
    || accessories.wdt
    || accessories.distributor
    || accessories.selfLevellingTamper
    || accessories.puckScreen
  );
}

function assertWorkflow(accessories, dial) {
  const steps = buildBrewSteps(accessories, dial);
  const stepIds = steps.map((item) => item.id);
  assert.equal(new Set(stepIds).size, stepIds.length, `duplicate ids ${stepIds.join(' → ')}`);
  const text = steps.map(stepText).join('\n');
  assertNo(text, /cup warmer|steam|wand|milk|machine stopped|10\s*[–-]\s*15\s*kg/i);
  assert.ok(stepIds.length <= 13, `too many steps: ${stepIds.join(' → ')}`);

  for (const item of steps) {
    assert.ok(item.title.trim().length > 0);
    assert.ok(item.instruction.trim().length > 0);
  }

  for (const [key, pattern] of Object.entries(FORBIDDEN)) {
    if (!accessories[key]) assertNo(text, pattern);
  }

  const helpIds = steps.flatMap((item) => (item.helps || []).map((help) => help.id));
  for (const item of BREW_ACCESSORIES) {
    if (accessories[item.id]) assert.ok(helpIds.includes(item.id), `missing help for ${item.id}`);
    else assert.equal(helpIds.includes(item.id), false, `unexpected help for ${item.id}`);
  }

  assertOrder(stepIds, CORE);

  const grindSetting = steps.find((item) => item.id === 'grindSetting');
  const dose = steps.find((item) => item.id === 'dose');
  const changed = grindSettingChanged(dial);
  const doseLabel = String(dial.doseG);
  if (changed) {
    assert.match(grindSetting.instruction, /purge a small amount of fresh beans/i);
    assert.match(grindSetting.instruction, /separate from the dose/i);
    assert.doesNotMatch(grindSetting.instruction, new RegExp(`\\b${doseLabel}\\s*g\\b`, 'i'));
    assert.ok(stepIds.indexOf('grindSetting') < stepIds.indexOf('dose'));
  } else if (!dial.previousGrindLabel) {
    assert.match(grindSetting.instruction, /if the grind setting changed, purge/i);
  } else {
    assertNo(grindSetting.instruction, /purge/i);
  }
  assert.match(dose.instruction, /do not fill the hopper/i);
  assert.match(dose.instruction, new RegExp(`${doseLabel}`));
  if (accessories.rdt) assert.match(dose.instruction, /use rdt/i);

  const grind = steps.find((item) => item.id === 'grind');
  if (accessories.dosingCup) assert.match(grind.instruction, /dosing cup/i);
  else if (accessories.blindShaker) assert.match(grind.instruction, /blind shaker/i);
  else assert.match(grind.instruction, /basket/i);

  const puck = steps.find((item) => item.id === 'puck');
  if (needsPuck(accessories)) {
    assert.ok(puck, `expected a puck step in ${stepIds.join(' → ')}`);
    assertOrder(stepIds, ['grind', 'puck', 'extract']);
    if (accessories.dosingFunnel && (accessories.dosingCup || accessories.blindShaker)) {
      assert.match(puck.instruction, /dosing funnel/i);
    }
    if (!accessories.dosingFunnel && (accessories.dosingCup || accessories.blindShaker)) {
      assertNo(puck.instruction, /funnel/i);
    }
    if (accessories.wdt) {
      assert.match(puck.instruction, /use the wdt/i);
      assert.match(puck.instruction, /clumps/i);
    }
    if (accessories.distributor) assert.match(puck.instruction, /use the distributor/i);
    if (accessories.dosingFunnel && (accessories.wdt || accessories.distributor || accessories.selfLevellingTamper || accessories.puckScreen || accessories.dosingCup || accessories.blindShaker)) {
      assert.match(puck.instruction, /lift the dosing funnel/i);
    }
  } else {
    assert.equal(puck, undefined);
    if (accessories.dosingFunnel) assert.match(grind.instruction, /lift the dosing funnel/i);
  }

  const extract = steps.find((item) => item.id === 'extract');
  assert.equal(extract.kind, 'timer');
  assert.equal(extract.stopAt, brewStopYield(dial.yieldG));
  assert.equal(steps.find((item) => item.id === 'yield').kind, 'yield');
  assert.equal(steps.at(-1).id, 'taste');
  assert.equal(steps.at(-1).kind, 'handoff');
  assert.match(steps.at(-1).instruction, /dial-in/i);
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
  assert.equal(brewDialIsReady({ ...DIAL, yieldG: '' }), false);
  assert.equal(grindSettingChanged(DIAL), false);
  assert.equal(grindSettingChanged({ ...DIAL, previousGrindLabel: '12' }), true);
  assert.equal(grindSettingChanged({ ...DIAL, previousGrindLabel: '' }), false);

  assert.equal(brewStopYield(36), '32');
  assert.equal(brewStopYield(40), '36');
  assert.equal(brewStopYield(36.5), '32.5');
  assert.equal(brewStopYield(3), null);
  assert.equal(brewStopYield(''), null);

  assert.deepEqual(ids(none()), CORE);

  const withPrep = { ...none(), dosingCup: true, wdt: true, distributor: true };
  assert.deepEqual(ids(withPrep), [
    ...CORE.slice(0, CORE.indexOf('grind') + 1),
    'puck',
    ...CORE.slice(CORE.indexOf('extract')),
  ]);
  const prepPuck = buildBrewSteps(withPrep, DIAL).find((item) => item.id === 'puck');
  assert.match(prepPuck.instruction, /dosing cup/i);
  assert.match(prepPuck.instruction, /clumps/i);
  assert.match(prepPuck.instruction, /distributor/i);
  assertNo(prepPuck.instruction, /funnel/i);

  const direct = blob(none());
  assertNo(direct, /funnel|dosing cup|shaker|clump|distributor|tamper|puck screen|spray|static|\brdt\b/i);
  assert.match(direct, /do not fill the hopper/i);
  assertNo(direct, /purge/i);

  const unknown = blob(none(), { ...DIAL, previousGrindLabel: '' });
  assert.match(unknown, /if the grind setting changed, purge/i);

  const funnelOnBasket = ids({ ...none(), dosingFunnel: true, wdt: true, distributor: true });
  assertOrder(funnelOnBasket, ['grind', 'puck', 'extract']);
  assert.match(buildBrewSteps({ ...none(), dosingFunnel: true, wdt: true }, DIAL).find((item) => item.id === 'puck').instruction, /lift the dosing funnel/i);

  const changedDial = { ...DIAL, previousGrindLabel: '12' };
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
  }, changedDial);
  assert.deepEqual(cupShakerFunnel, [
    'recipe',
    'warmup',
    'preheat',
    'cup',
    'grindSetting',
    'dose',
    'grind',
    'puck',
    'extract',
    'yield',
    'clean',
    'taste',
  ]);
  assert.match(buildBrewSteps({
    ...none(),
    dosingCup: true,
    dosingFunnel: true,
    blindShaker: true,
    wdt: true,
    distributor: true,
    selfLevellingTamper: true,
    puckScreen: true,
    rdt: true,
  }, changedDial).find((item) => item.id === 'grindSetting').instruction, /purge a small amount of fresh beans/i);

  const shakerOnly = buildBrewSteps({ ...none(), blindShaker: true }, DIAL);
  assert.match(shakerOnly.find((item) => item.id === 'grind').instruction, /blind shaker/i);
  assert.match(shakerOnly.find((item) => item.id === 'puck').instruction, /shaker/i);
  assertNo(blob({ ...none(), blindShaker: true }), /dosing cup|funnel/);

  const purgeStep = buildBrewSteps(none(), changedDial).find((item) => item.id === 'grindSetting');
  assert.match(purgeStep.instruction, /fresh beans/i);
  assert.match(purgeStep.instruction, /separate from the dose/i);
  assert.doesNotMatch(purgeStep.instruction, /18\s*g/i);
  const settePurge = buildBrewSteps(none(), { ...changedDial, grinderModel: 'Sette 270Wi', grindLabel: '13-E', previousGrindLabel: '12-A' }).find((item) => item.id === 'grindSetting');
  assertNo(settePurge.instruction, /sunbeam manual|hopper empty/i);

  const sunbeam = blob(none(), DIAL).toLowerCase();
  assert.match(sunbeam, /house espresso/);
  assert.match(sunbeam, /sunbeam barista max/);
  assert.match(sunbeam, /18g/);
  assert.match(sunbeam, /36g/);
  assert.match(sunbeam, /27/);
  assert.match(sunbeam, /32/);
  assert.match(sunbeam, /92/);
  assert.match(sunbeam, /dial setting/);
  assert.match(sunbeam, /\b15\b/);

  const updatedDial = {
    ...DIAL,
    doseG: 19,
    yieldG: 42,
    timeMinS: 25,
    timeMaxS: 30,
    grindLabel: '9',
    beanName: 'Kenya',
    grinderModel: 'Sette 270Wi',
    previousGrindLabel: '9',
    brewTemperatureC: '',
  };
  const updated = blob(none(), updatedDial).toLowerCase();
  assert.match(updated, /kenya/);
  assert.match(updated, /sette 270wi/);
  assert.match(updated, /19g/);
  assert.match(updated, /42g/);
  assert.match(updated, /38g/);
  assert.match(updated, /25/);
  assert.match(updated, /30/);
  assert.match(updated, /grind setting/);
  assert.match(updated, /\b9\b/);
  assertNo(updated, /18g/);
  assertNo(updated, /36g/);
  assertNo(updated, /dial setting/);
  assertNo(updated, /92/);

  const keys = BREW_ACCESSORIES.map((item) => item.id);
  for (let mask = 0; mask < 256; mask += 1) {
    const accessories = {};
    keys.forEach((key, bit) => {
      accessories[key] = Boolean(mask & (1 << bit));
    });
    assertWorkflow(accessories, DIAL);
    assertWorkflow(accessories, changedDial);
  }

  const source = fs.readFileSync(new URL('./steps.js', import.meta.url), 'utf8');
  assert.equal(/18\.5/.test(source), false);
  assert.equal(/30\s*[–-]\s*35/.test(source), false);
  assert.equal(/cup warmer/i.test(source), false);
  assert.equal(/dexie|indexedDB|db\.version/i.test(source), false);

  const schema = fs.readFileSync(new URL('../utils/grinderLogic.js', import.meta.url), 'utf8');
  assert.match(schema, /db\.version\(17\)/);
  assert.equal(/db\.version\(18\)/.test(schema), false);

  runSunbeamGuideTests();
  console.log('Brew Guide tests passed!');
}
