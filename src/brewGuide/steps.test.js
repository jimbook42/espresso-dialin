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

const DIAL = {
  beanName: 'House Espresso',
  doseG: 18,
  yieldG: 36,
  timeMinS: 27,
  timeMaxS: 32,
  brewTemperatureC: 93,
  grinderModel: 'Sunbeam Barista Max',
  grindLabel: '15',
  previousGrindLabel: '15',
};

const CORE = [
  'recipe',
  'power',
  'water',
  'warmCup',
  'emptyCup',
  'dryCup',
  'portafilter',
  'grindSetting',
  'weigh',
  'loadHopper',
  'grind',
  'verifyDose',
  'preheat',
  'extract',
  'knockPuck',
  'rinsePortafilter',
  'rinseGroup',
  'readyMachine',
  'logShot',
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
  return [step.title, step.instruction, step.note, step.help, step.highlight, step.highlightLabel, step.stopAt, step.timeLabel, ...(step.metrics || []).map((metric) => `${metric.label} ${metric.value}`)]
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

function assertWorkflow(accessories, dial) {
  const steps = buildBrewSteps(accessories, dial);
  const stepIds = steps.map((item) => item.id);
  assert.equal(new Set(stepIds).size, stepIds.length, `duplicate ids ${stepIds.join(' → ')}`);
  const text = steps.map(stepText).join('\n');
  assertNo(text, /cup warmer|steam|wand|milk|10\s*[–-]\s*15\s*kg/i);

  for (const item of steps) {
    assert.ok(item.title.trim().length > 0);
    assert.ok(item.instruction.trim().length > 0);
  }

  for (const [key, pattern] of Object.entries(FORBIDDEN)) {
    if (!accessories[key]) assertNo(text, pattern);
  }

  assertOrder(stepIds, CORE);

  const changed = grindSettingChanged(dial);
  if (changed) {
    assertOrder(stepIds, ['grindSetting', 'purge', 'discardPurge', 'weigh', 'loadHopper', 'grind']);
    const purge = steps.find((item) => item.id === 'purge');
    const doseLabel = String(dial.doseG);
    assert.match(purge.instruction, /do not use the dose/i);
    assert.doesNotMatch(`${purge.instruction} ${purge.help || ''}`, new RegExp(`\\b${doseLabel}\\s*g\\b`, 'i'));
    assert.match(steps.find((item) => item.id === 'loadHopper').instruction, /do not fill the hopper/i);
  } else {
    assert.equal(stepIds.includes('purge'), false);
    assert.equal(stepIds.includes('discardPurge'), false);
  }

  if (accessories.rdt) assertOrder(stepIds, ['weigh', 'rdt', 'loadHopper']);
  else assert.equal(stepIds.includes('rdt'), false);

  const external = Boolean(accessories.dosingCup || accessories.blindShaker);
  const grind = steps.find((item) => item.id === 'grind');
  if (accessories.dosingCup) assert.match(grind.instruction, /dosing cup/i);
  else if (accessories.blindShaker) assert.match(grind.instruction, /blind shaker/i);
  else assert.match(grind.instruction, /basket/i);

  if (accessories.blindShaker) assertOrder(stepIds, ['verifyDose', 'shake']);
  else assert.equal(stepIds.includes('shake'), false);

  if (external) {
    assertOrder(stepIds, ['verifyDose', 'transfer']);
    const transfer = steps.find((item) => item.id === 'transfer');
    if (accessories.dosingFunnel) assert.match(transfer.instruction, /dosing funnel/i);
    else assert.match(transfer.instruction, /carefully/i);
    assert.equal(stepIds.includes('prepFunnel'), false);
  } else {
    assert.equal(stepIds.includes('transfer'), false);
    assert.equal(stepIds.includes('shake'), false);
  }

  if (accessories.dosingFunnel && !external) {
    assertOrder(stepIds, ['prepFunnel', 'grind', 'verifyDose', 'removeFunnel']);
  }

  if (accessories.dosingFunnel) {
    if (accessories.wdt) assertOrder(stepIds, ['wdt', 'removeFunnel']);
    if (accessories.distributor) assertOrder(stepIds, ['removeFunnel', 'distribute']);
    if (accessories.selfLevellingTamper) assertOrder(stepIds, ['removeFunnel', 'tamp']);
  } else {
    assert.equal(stepIds.includes('prepFunnel'), false);
    assert.equal(stepIds.includes('removeFunnel'), false);
  }

  const puck = [];
  if (external) puck.push('transfer');
  if (accessories.wdt) puck.push('wdt');
  if (accessories.dosingFunnel) puck.push('removeFunnel');
  if (accessories.distributor) puck.push('distribute');
  if (accessories.selfLevellingTamper) puck.push('tamp');
  if (accessories.puckScreen) puck.push('screen');
  if (puck.length) assertOrder(stepIds, puck);

  assert.equal(stepIds.includes('wdt'), Boolean(accessories.wdt));
  assert.equal(stepIds.includes('distribute'), Boolean(accessories.distributor));
  assert.equal(stepIds.includes('tamp'), Boolean(accessories.selfLevellingTamper));
  assert.equal(stepIds.includes('screen'), Boolean(accessories.puckScreen));

  const extract = steps.find((item) => item.id === 'extract');
  assert.equal(extract.kind, 'timer');
  assert.equal(extract.stopAt, brewStopYield(dial.yieldG));
  assert.equal(steps.at(-1).kind, 'handoff');
  assert.match(steps.find((item) => item.id === 'weigh').instruction, new RegExp(`${dial.doseG}`));
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
    ...CORE.slice(0, CORE.indexOf('verifyDose') + 1),
    'transfer',
    'wdt',
    'distribute',
    ...CORE.slice(CORE.indexOf('preheat')),
  ]);

  const careful = buildBrewSteps({ ...none(), dosingCup: true }, DIAL).find((item) => item.id === 'transfer');
  assert.match(careful.instruction, /carefully/i);
  assertNo(careful.instruction, /funnel/i);

  const withFunnel = buildBrewSteps({ ...none(), dosingCup: true, dosingFunnel: true }, DIAL).find((item) => item.id === 'transfer');
  assert.match(withFunnel.instruction, /dosing funnel/i);

  const direct = blob(none());
  assertNo(direct, /funnel|dosing cup|shaker|clump|distributor|tamper|puck screen|spray|static|\brdt\b/i);
  assert.match(direct, /do not fill the hopper/i);
  assertNo(direct, /purge the grinder/i);

  const funnelOnBasket = ids({ ...none(), dosingFunnel: true, wdt: true, distributor: true });
  assertOrder(funnelOnBasket, ['prepFunnel', 'grind', 'wdt', 'removeFunnel', 'distribute']);
  assert.equal(funnelOnBasket.includes('transfer'), false);
  assert.equal(funnelOnBasket.includes('tamp'), false);

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
    'power',
    'water',
    'warmCup',
    'emptyCup',
    'dryCup',
    'portafilter',
    'grindSetting',
    'purge',
    'discardPurge',
    'weigh',
    'rdt',
    'loadHopper',
    'grind',
    'verifyDose',
    'shake',
    'transfer',
    'wdt',
    'removeFunnel',
    'distribute',
    'tamp',
    'screen',
    'preheat',
    'extract',
    'knockPuck',
    'rinsePortafilter',
    'rinseGroup',
    'readyMachine',
    'logShot',
  ]);

  const shakerOnly = buildBrewSteps({ ...none(), blindShaker: true }, DIAL);
  assert.match(shakerOnly.find((item) => item.id === 'grind').instruction, /blind shaker/i);
  assert.match(shakerOnly.find((item) => item.id === 'transfer').instruction, /carefully/i);
  assertNo(blob({ ...none(), blindShaker: true }), /dosing cup|funnel/);

  const purge = buildBrewSteps(none(), changedDial).find((item) => item.id === 'purge');
  assert.match(purge.help, /1–2 second/);
  assert.match(purge.help, /beans/);
  assert.match(purge.instruction, /do not use the dose/i);
  assert.doesNotMatch(`${purge.instruction} ${purge.help}`, /18\s*g/i);
  const settePurge = buildBrewSteps(none(), { ...changedDial, grinderModel: 'Sette 270Wi', grindLabel: '13-E', previousGrindLabel: '12-A' }).find((item) => item.id === 'purge');
  assertNo(settePurge.help, /sunbeam manual/i);

  const sunbeam = blob(none(), DIAL).toLowerCase();
  assert.match(sunbeam, /house espresso/);
  assert.match(sunbeam, /sunbeam barista max/);
  assert.match(sunbeam, /18g/);
  assert.match(sunbeam, /36g/);
  assert.match(sunbeam, /27/);
  assert.match(sunbeam, /32/);
  assert.match(sunbeam, /93/);
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
  assertNo(updated, /93/);

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

  console.log('Brew Guide tests passed!');
}
