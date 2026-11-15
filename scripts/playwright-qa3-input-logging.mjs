import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const server = startPreviewServer(4189);
const bean = { id: 'qa3-bean', name: 'QA coffee', roastType: 'Medium', roastDate: '2020-01-01' };
const recipe = {
  id: 'qa3-recipe', beanId: bean.id, targetDoseG: 18, targetYieldG: 36,
  targetTimeMinS: 25, targetTimeMaxS: 30, brewTemperatureC: 93,
};
const custom = { name: 'QA custom', dialType: 'stepped', min: 10, max: 40, step: 1, lowerIsFiner: true };
const shotButton = 'Log shot & calculate grind adjustment';

function rows(page, table, records) {
  return page.evaluate(({ table, records }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(table, records ? 'readwrite' : 'readonly');
      const store = tx.objectStore(table);
      const read = store.getAll();
      for (const record of records ?? []) store.put(record);
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { table, records });
}

async function until(read, predicate) {
  for (let i = 0; i < 30; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(40);
  }
  return read();
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
const field = (root, label) => root.getByText(label, { exact: true }).locator('..').locator('input').first();
const settings = async (page) => (await rows(page, 'settings')).find((row) => row.id === 'global');

async function seed(page, overrides = {}) {
  await page.goto(server.url);
  await page.getByText(/choose|experience|grinder/i).first().waitFor();
  await rows(page, 'settings', [{
    id: 'global', grinderModel: 'Sette 270Wi', experiencePreference: 'brew',
    lastSelectedBeanId: bean.id, brewGuideEnabled: false, ...overrides,
  }]);
  await rows(page, 'beans', [bean]);
  await rows(page, 'recipes', [recipe]);
  await page.reload();
  await button(page, 'Dial').click();
  await button(page, shotButton).waitFor();
}

async function openSettings(page) {
  await page.getByTitle('Settings', { exact: true }).click();
  return page.getByRole('dialog', { name: 'Preferences & Settings' });
}

function customInputs(panel) {
  return {
    name: panel.getByPlaceholder('e.g. DF64'),
    min: field(panel, 'Min'),
    max: field(panel, 'Max'),
  };
}

async function enterShot(page, { dose = '18', yieldG = '36', time = '28' } = {}) {
  await field(page, 'Dose (g)').fill(dose);
  await page.getByTestId('dial-yield-tile').locator('input').fill(yieldG);
  await page.getByTestId('dial-time-tile').locator('input').fill(time);
  await button(page, 'Balanced').click();
  await button(page, shotButton).click();
}

async function savedShots(page, count) {
  return until(() => rows(page, 'shots'), (shots) => shots.length >= count);
}

async function testFirstCustomShot(page) {
  const panel = await openSettings(page);
  await panel.getByText('Primary grinder', { exact: true }).locator('..').locator('select').first()
    .selectOption('__custom_grinder__');
  const inputs = customInputs(panel);
  await inputs.min.fill('10');
  await inputs.name.fill(custom.name);
  await button(page, 'Save & Close').click();
  const dial = page.getByText(/^Dial \(10–40, step 1\)$/).locator('..');
  const dialValue = () => dial.locator('button[aria-label="Decrease"] + span').textContent();
  const displayed = Number(await dialValue());
  await enterShot(page, { time: '20' });
  let shots = await savedShots(page, 1);
  assert.equal(shots[0]?.customGrindValue, displayed, 'first shot saves displayed custom setting');

  await button(page, 'Increase').click();
  const explicit = Number(await dialValue());
  assert.notEqual(explicit, displayed);
  await enterShot(page, { time: '20' });
  shots = await savedShots(page, 2);
  assert.equal(shots.find((shot) => shot.customGrindValue === explicit)?.customGrindValue, explicit);

  await page.getByRole('button', { name: /apply rec/i }).click();
  const applied = Number(await dialValue());
  assert.notEqual(applied, explicit);
  await enterShot(page, { time: '28' });
  shots = await savedShots(page, 3);
  assert.equal(shots.find((shot) => shot.actualTimeS === 28)?.customGrindValue, applied);

  await page.reload();
  await button(page, 'Dial').click();
  assert.equal(Number(await dialValue()), applied);
  await button(page, 'History').click();
  assert.equal(await page.getByTestId('history-shot-card').count(), 3);
  assert.deepEqual(await rows(page, 'shots'), shots);
}

async function testManualTime(page) {
  await enterShot(page, { time: '28.9' });
  const [shot] = await savedShots(page, 1);
  assert.equal(shot?.actualTimeS, 29, '28.9 s submits and rounds to 29 s');
  assert.ok(shot.setteMacro > 0 && /^[A-I]$/.test(shot.setteMicro));
  assert.equal(shot.recommendation.engineStats.timeDelta, 1.5);
  assert.equal(shot.recommendation.shotOutcome.isTimeInRange, true);
  assert.equal(await page.getByTestId('perfect-shot-cameo-slot').count(), 0);
}

async function testInvalidShot(page) {
  const before = await rows(page, 'shots');
  const global = await settings(page);
  const dose = field(page, 'Dose (g)');
  const yieldInput = page.getByTestId('dial-yield-tile').locator('input');
  const time = page.getByTestId('dial-time-tile').locator('input');
  for (const [values, invalid] of [
    [{ dose: '0', yieldG: '-3', time: '0' }, dose],
    [{ dose: '1000', yieldG: '36', time: '28' }, dose],
    [{ dose: '18', yieldG: '99999', time: '28' }, yieldInput],
    [{ dose: '18', yieldG: '0', time: '28' }, yieldInput],
    [{ dose: '18', yieldG: '36', time: '' }, time],
    [{ dose: '18', yieldG: '36', time: '-5' }, time],
    [{ dose: '18', yieldG: '36', time: '9999' }, time],
  ]) {
    await enterShot(page, values);
    await delay(250);
    assert.deepEqual(await rows(page, 'shots'), before);
    assert.deepEqual(await settings(page), global);
    assert.equal(await invalid.evaluate((input) => input === document.activeElement), true);
    assert.equal(await invalid.getAttribute('aria-invalid'), 'true');
  }
}

async function testBeanForm(page) {
  await button(page, 'Beans').click();
  const form = page.locator('form').filter({ has: page.getByPlaceholder('e.g. House Espresso Blend') });
  const name = form.getByPlaceholder('e.g. House Espresso Blend');
  const date = form.locator('input[type="date"]').first();
  const yieldInput = field(form, 'Yield');
  const low = field(form, 'Min time');
  const temp = field(form, 'Brew temp');
  const priorBeans = await rows(page, 'beans');
  const priorRecipes = await rows(page, 'recipes');
  await date.fill('2020-01-02');
  await name.fill('   ');
  await yieldInput.fill('36');
  await button(page, 'Save Coffee Profile').click();
  await delay(250);
  assert.deepEqual(await rows(page, 'beans'), priorBeans, 'whitespace bean name does not write');
  assert.deepEqual(await rows(page, 'recipes'), priorRecipes);

  await name.fill('  QA second coffee  ');
  await yieldInput.fill('0');
  await low.fill('32');
  await temp.fill('110');
  await date.fill('2099-01-01');
  await button(page, 'Save Coffee Profile').click();
  assert.deepEqual(await rows(page, 'beans'), priorBeans);
  assert.deepEqual(await rows(page, 'recipes'), priorRecipes);
  await form.getByText('Enter a target yield greater than 0 g.').waitFor();
  await form.getByText('Maximum extraction time must be greater than the minimum.').waitFor();
  await form.getByText('Choose today or an earlier roast date.').waitFor();
  await form.getByText(/Enter a brew temperature between/).waitFor();

  await date.fill('2020-01-02');
  await yieldInput.fill('4.1');
  await low.fill('25');
  await temp.fill('93');
  await button(page, 'Save Coffee Profile').click();
  const created = (await until(() => rows(page, 'beans'), (beans) => beans.length === 2))
    .find((item) => item.name === 'QA second coffee');
  assert.ok(created, 'bean name is trimmed');
  assert.equal((await rows(page, 'recipes')).find((item) => item.beanId === created.id)?.targetYieldG, 4.1);

  await button(page, 'Beans').click();
  if (!(await page.getByTitle('Edit Bean').first().isVisible())) {
    await page.getByText('Past logged beans & profiles').click();
  }
  await page.getByText(bean.name, { exact: true }).locator('xpath=ancestor::div[.//button[@title="Edit Bean"]][1]')
    .getByTitle('Edit Bean').click();
  const edit = button(page, 'Update Coffee Profile');
  await name.fill('  Updated QA coffee  ');
  await yieldInput.fill('-1');
  await edit.click();
  await delay(250);
  assert.deepEqual((await rows(page, 'beans')).find((item) => item.id === bean.id), bean);
  assert.deepEqual((await rows(page, 'recipes')).find((item) => item.id === recipe.id), recipe);
  await yieldInput.fill('42');
  await edit.click();
  const updated = await until(() => rows(page, 'beans'), (beans) => beans.some((item) => item.name === 'Updated QA coffee'));
  assert.equal(updated.find((item) => item.id === bean.id)?.name, 'Updated QA coffee');
  assert.equal((await rows(page, 'recipes')).find((item) => item.id === recipe.id)?.targetYieldG, 42);
}

async function testGrinderDraft(page) {
  const original = await settings(page);
  let panel = await openSettings(page);
  let { max } = customInputs(panel);
  await max.fill('45');
  const intermediate = await until(() => settings(page), (row) => row.customGrinder.max === 45);
  await max.fill('5');
  const invalid = await until(() => settings(page), (row) => Number(row.customGrinderSetupDraft?.max) === 5);
  console.log('F12 IndexedDB', JSON.stringify([original, intermediate, invalid].map((row) => ({
    grinderModel: row.grinderModel, customGrinder: row.customGrinder, draft: row.customGrinderSetupDraft,
  }))));
  assert.equal(await button(page, 'Save & Close').isDisabled(), true);
  assert.deepEqual(intermediate, original);
  assert.deepEqual(invalid, original);
  await page.getByText(/max must be above min/i).waitFor();
  await button(panel, 'Dark').click();
  const appearance = await until(() => settings(page), (row) => row.darkMode === false);
  assert.equal(appearance.darkMode, false, 'unrelated settings still auto-save');
  assert.equal(await max.inputValue(), '5', 'unrelated saves leave the open draft intact');
  assert.deepEqual(appearance.customGrinder, original.customGrinder);

  await page.reload();
  panel = await openSettings(page);
  ({ max } = customInputs(panel));
  assert.equal(await max.inputValue(), '40');
  await max.fill('45');
  await button(page, 'Save & Close').click();
  assert.equal((await until(() => settings(page), (row) => row.customGrinder.max === 45)).customGrinder.max, 45);
  await page.reload();
  panel = await openSettings(page);
  assert.equal(await customInputs(panel).max.inputValue(), '45');
}

async function testLegacyHistory(page) {
  const historic = {
    id: 'historic-shot', beanId: bean.id, grinderModel: 'Sette 270Wi', setteMacro: 14, setteMicro: 'E',
    timestamp: '2020-02-01T00:00:00.000Z', notes: 'Original QA history',
    actualDoseG: 18, actualYieldG: 36, actualTimeS: 28.9, tasteProfile: 'balanced',
  };
  await rows(page, 'shots', [historic]);
  await page.reload();
  await button(page, 'History').click();
  const card = page.getByTestId('history-shot-card');
  await card.waitFor();
  assert.match(await card.textContent(), /28\.9/);
  assert.deepEqual(await rows(page, 'shots'), [historic]);
}

async function testSingleAxisGrinder(page) {
  const decrease = button(page, 'Decrease');
  const displayed = () => decrease.locator('xpath=following-sibling::span[1]').textContent();
  const previous = await displayed();
  await button(page, 'Increase').click();
  const updated = Number(await displayed());
  assert.notEqual(updated, Number(previous));
  await enterShot(page, { time: '20' });
  const [shot] = await savedShots(page, 1);
  const key = shot.grinderModel === 'Sunbeam Barista Max' ? 'sunbeamSetting' : 'customGrindValue';
  assert.equal(shot[key], updated);
}

const cases = [
  ['F3 first, explicit, applied and reloaded custom shots', testFirstCustomShot],
  ['F4 manual decimal time', testManualTime],
  ['F5 invalid shots and focus', testInvalidShot],
  ['F6 bean and recipe add/edit', testBeanForm],
  ['F12 grinder draft settings and reload', testGrinderDraft, { grinderModel: custom.name, customGrinder: custom }],
  ['Sunbeam dial saves the displayed setting', testSingleAxisGrinder, { grinderModel: 'Sunbeam Barista Max' }],
  ['Preset dial saves the displayed setting', testSingleAxisGrinder, { grinderModel: 'Breville Barista Express (BES870/875)' }],
  ['Legacy shot history is readable and unchanged', testLegacyHistory],
];
let browser;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  for (const [name, run, overrides] of cases) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(4000);
    try {
      await seed(page, overrides);
      await run(page);
      console.log('PASS', name);
    } catch (error) {
      process.exitCode = 1;
      console.error('FAIL', name, error.stack);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.kill();
}
