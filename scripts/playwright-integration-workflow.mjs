import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const server = startPreviewServer(4192);
const coffee = 'Integration espresso';
const grinder = 'Integration reversed dial';
const logShot = 'Log shot & calculate grind adjustment';

const button = (root, name) => root.getByRole('button', { name, exact: true });
const field = (root, label, tag) => root.getByText(label, { exact: true }).locator('..').locator(tag).first();
const nav = (page, name) => button(page.getByRole('navigation', { name: 'Main navigation' }), name);
const setting = (panel, label) => field(panel, label, 'select');

async function readRows(page, table) {
  return page.evaluate((table) => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction(table).objectStore(table).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }), table);
}

const preferences = async (page) => (await readRows(page, 'settings')).find(({ id }) => id === 'global');
const grindControl = (page) => page.getByText('Dial (10–40, step 1)', { exact: true })
  .locator('..').locator('button[aria-label="Decrease"] + span');
const liveMetric = (page, name) => page.getByTestId('adaptive-shot-screen')
  .locator(`[data-metric="${name}"] .shot-metric-value`);
const readNumber = async (locator) => Number.parseFloat(await locator.textContent());

async function openSettings(page) {
  await page.getByTitle('Settings', { exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Preferences & Settings' });
  await panel.waitFor();
  return panel;
}

async function closeSettings(panel) {
  await button(panel, 'Close settings').click();
  await panel.waitFor({ state: 'hidden' });
}

async function configureGrinder(page) {
  let panel = await openSettings(page);
  const name = () => panel.getByPlaceholder('e.g. DF64', { exact: true });
  const save = () => button(panel, 'Save custom grinder');
  const close = () => button(panel, 'Close settings');
  const original = await preferences(page);
  await setting(panel, 'Primary grinder').selectOption('__custom_grinder__');
  await name().fill(grinder);
  await field(panel, 'Min', 'input').fill('10');
  const finer = panel.getByText('Lower number is finer', { exact: true }).locator('../..').getByRole('switch');
  await finer.uncheck();
  assert.equal(await close().textContent(), 'Close');
  assert.deepEqual(await preferences(page), original);
  await save().click();
  await close().and(panel.getByText('Done', { exact: true })).waitFor();
  const saved = await preferences(page);
  assert.equal(saved.grinderModel, grinder);
  assert.deepEqual(saved.customGrinder, { name: grinder, dialType: 'stepped', min: 10, max: 40, step: 1, lowerIsFiner: false });
  await closeSettings(panel);

  panel = await openSettings(page);
  await name().fill('Uncommitted grinder');
  await field(panel, 'Max', 'input').fill('5');
  assert.equal(await save().isDisabled(), true);
  assert.equal(await button(panel, 'Save & Close').isDisabled(), true);
  assert.deepEqual(await preferences(page), saved);
  await page.goBack();
  await panel.waitFor({ state: 'hidden' });
  assert.deepEqual(await preferences(page), saved);

  panel = await openSettings(page);
  assert.equal(await name().inputValue(), grinder);
  assert.equal(await field(panel, 'Max', 'input').inputValue(), '40');
  await field(panel, 'Step', 'input').fill('2');
  await button(panel, 'Save & Close').click();
  await panel.waitFor({ state: 'hidden' });
  assert.deepEqual((await preferences(page)).customGrinder, { ...saved.customGrinder, step: 2 });
  await page.reload();
  panel = await openSettings(page);
  assert.equal(await field(panel, 'Step', 'input').inputValue(), '2');
  await field(panel, 'Step', 'input').fill('1');
  await button(panel, 'Save & Close').click();
  await panel.waitFor({ state: 'hidden' });
  assert.deepEqual((await preferences(page)).customGrinder, saved.customGrinder);
}

async function createCoffee(page) {
  const panel = await openSettings(page);
  const brewGuide = panel.getByRole('switch', { name: 'Brew Guide', exact: true });
  if (!(await brewGuide.isChecked())) await brewGuide.check();
  await setting(panel, 'Brew guidance on Dial-In').selectOption('quick');
  await setting(panel, 'Shot start countdown').selectOption('off');
  await closeSettings(panel);
  assert.equal((await preferences(page)).shotStartCountdown, 'off');

  await nav(page, 'Beans').click();
  const form = page.locator('form').filter({ has: page.getByPlaceholder('e.g. House Espresso Blend') });
  await form.getByPlaceholder('e.g. House Espresso Blend').fill(coffee);
  const roastDate = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 8);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  });
  await form.locator('input[type="date"]').first().fill(roastDate);
  for (const [name, value] of Object.entries({
    targetDoseG: '18.5', targetYieldG: '36', targetTimeMinS: '27', targetTimeMaxS: '32', brewTemperatureC: '93',
  })) await form.locator(`[name="${name}"]`).fill(value);
  await button(page, 'Save Coffee Profile').click();
  await page.getByText('Start here, then log your first shot to begin dialling in.', { exact: true }).waitFor();
  const [bean, recipe] = await Promise.all([
    readRows(page, 'beans').then(([bean]) => bean),
    readRows(page, 'recipes').then(([recipe]) => recipe),
  ]);
  assert.equal(bean.name, coffee);
  assert.equal(bean.roastDate, roastDate);
  assert.equal(recipe.beanId, bean.id);
  assert.deepEqual([recipe.targetDoseG, recipe.targetYieldG, recipe.targetTimeMinS, recipe.targetTimeMaxS], [18.5, 36, 27, 32]);
  return bean;
}

const guideGrind = (page, label) => page.getByText(label, { exact: true }).locator('..').locator('p').last();

async function checkStartingGuide(page, dial) {
  await page.getByText(`Starting grind ${dial} — common espresso starting point (app default, not manufacturer guidance). Not from your shot history.`, { exact: true }).waitFor();
  await page.getByText('Pull shot — stop around 32g (target 36g).', { exact: true }).waitFor();
  await nav(page, 'Brew Guide').click();
  const intro = page.getByRole('dialog', { name: 'Welcome to Brew Guide' });
  await button(intro, 'Continue').click();
  await intro.waitFor({ state: 'hidden' });
  await button(page, 'Continue').click();
  await guideGrind(page, 'Current grind').waitFor();
  assert.equal(await guideGrind(page, 'Current grind').textContent(), String(dial));
  assert.equal(await page.getByText('Suggested grind (not applied)', { exact: true }).count(), 0);
  await nav(page, 'Dial').click();
}

async function backWhileRecording(page) {
  const time = liveMetric(page, 'time');
  const before = await readNumber(time);
  await page.goBack();
  await page.waitForFunction(() => history.state?.dialTab === 'dial' && history.state?.shotBackGuard);
  await page.clock.runFor(2000);
  assert.ok(await readNumber(time) > before + 1, 'the same recording continues after Back');
}

async function saveOneShot(page) {
  await button(page, 'Balanced').click();
  await button(page, logShot).click();
  await page.getByTestId('saved-share-shot').waitFor();
  const shots = await readRows(page, 'shots');
  assert.equal(shots.length, 1);
  return shots[0];
}

async function shareAndDelete(page, shot) {
  await nav(page, 'History').click();
  const card = page.getByTestId('history-shot-card');
  await card.getByText(`${coffee} [N/A]`, { exact: true }).waitFor();
  assert.equal(await card.count(), 1);
  await card.getByTestId('history-share-shot').click();
  const share = page.getByRole('dialog', { name: 'Share shot' });
  const download = page.waitForEvent('download');
  await button(share, 'Share').click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  assert.equal(exported.shotId, shot.id);
  await button(share, 'Done').click();
  page.once('dialog', (prompt) => prompt.accept());
  await card.getByRole('button', { name: 'Delete shot', exact: true }).click();
  await card.waitFor({ state: 'hidden' });
  await page.getByTestId('saved-share-shot').waitFor({ state: 'hidden' });
  assert.deepEqual(await readRows(page, 'shots'), []);
  await page.goBack();
  await page.waitForFunction(() => history.state?.dialTab === 'dial' && !history.state?.shotBackGuard);
  assert.equal(await nav(page, 'Dial').getAttribute('aria-current'), 'page');
}

async function manualShot(page, bean, dial) {
  const before = await preferences(page);
  await button(page, 'Start').click();
  await button(page, 'Stop shot').waitFor();
  await page.clock.runFor(18_000);
  await backWhileRecording(page);
  await button(page, 'Stop shot').click();
  const time = page.getByTestId('dial-time-tile').locator('input');
  const elapsed = Number(await time.inputValue());
  assert.ok(elapsed >= 19 && elapsed <= 22, `recorded time: ${elapsed}s`);
  await page.goBack();
  await page.waitForFunction(() => history.state?.dialTab === 'dial' && history.state?.shotBackGuard);
  assert.equal(Number(await time.inputValue()), elapsed);
  assert.deepEqual(await readRows(page, 'shots'), []);
  assert.deepEqual(await preferences(page), before);
  await field(page, 'Dose (g)', 'input').fill('18.5');
  await page.getByTestId('dial-yield-tile').locator('input').fill('37');
  const shot = await saveOneShot(page);
  assert.deepEqual([shot.beanId, shot.grinderModel, shot.customGrindValue, shot.actualDoseG, shot.actualYieldG, shot.actualTimeS],
    [bean.id, grinder, dial, 18.5, 37, elapsed]);
  const suggested = shot.recommendation.recommendedSetting.customGrindValue;
  assert.ok(suggested > dial, `fast shot should move a reversed grinder finer: ${dial} → ${suggested}`);
  await page.getByText(`Suggested: ${suggested} (not applied). Apply on Dial to use it.`, { exact: true }).waitFor();
  const beforeGuide = await preferences(page);
  await nav(page, 'Brew Guide').click();
  assert.equal(await guideGrind(page, 'Current grind').textContent(), String(dial));
  assert.equal(await guideGrind(page, 'Suggested grind (not applied)').textContent(), String(suggested));
  await nav(page, 'Dial').click();
  assert.deepEqual(await preferences(page), beforeGuide);
  await button(page, 'Apply rec').click();
  assert.equal(await readNumber(grindControl(page)), suggested);
  await nav(page, 'Brew Guide').click();
  assert.equal(await guideGrind(page, 'Current grind').textContent(), String(suggested));
  assert.equal(await page.getByText('Suggested grind (not applied)', { exact: true }).count(), 0);
  await nav(page, 'Dial').click();
  await shareAndDelete(page, shot);
  console.log(`PASS manual workflow: ${elapsed}s, 18.5g → 37g, reversed grind ${dial} → ${suggested}, correct share and delete`);
}

function readFlowChart(page) {
  return page.getByTestId('live-shot-chart').evaluate((chart) => {
    const axis = chart.querySelector('.shot-chart-axis-labels').textContent;
    const scale = Number(axis.match(/Flow · 0–([\d.]+) g\/s/)?.[1]);
    const path = chart.querySelector('path[stroke="#e0a660"]').getAttribute('d');
    const points = Array.from(path.matchAll(/([ML])([\d.]+),([\d.]+)/g), ([, command, x, y]) => ({
      command,
      x: Number(x),
      flow: (55 - Number(y)) * scale / 50,
    }));
    const metric = chart.closest('[data-testid="adaptive-shot-screen"]')
      .querySelector('[data-metric="flow"] .shot-metric-value');
    return { points, displayedFlow: Number.parseFloat(metric.textContent) };
  });
}

async function simulatedShot(page, bean) {
  const panel = await openSettings(page);
  await setting(panel, 'Smart scale').selectOption('timemore-dot');
  await panel.getByRole('switch', { name: 'Track pre-infusion time' }).check();
  await closeSettings(panel);
  await page.getByRole('combobox', { name: 'Scale transport' }).selectOption('sim');
  await button(page, 'Connect scale').click();
  await button(page, 'Disconnect').waitFor();
  const before = await preferences(page);
  await button(page, 'Start').click();
  await button(page, 'End pre-infusion').waitFor();
  await page.clock.runFor(2100);
  await button(page, 'End pre-infusion').click();
  await button(page, 'Stop shot').waitFor();
  await page.clock.runFor(5000);
  const beforeBack = await readFlowChart(page);
  assert.ok(beforeBack.points.some(({ command }) => command === 'L'));
  await backWhileRecording(page);
  const afterBack = await readFlowChart(page);
  assert.ok(afterBack.points.length > beforeBack.points.length, 'the flow chart keeps recording across Back');
  // The time axis expands as the shot gets longer. Compare the original window
  // under the new horizontal scale, with tolerance for the SVG's 0.1px rounding.
  const xScale = afterBack.points[beforeBack.points.length - 1].x / beforeBack.points.at(-1).x;
  for (const [index, before] of beforeBack.points.entries()) {
    const after = afterBack.points[index];
    assert.equal(after.command, before.command);
    assert.ok(Math.abs(after.x - before.x * xScale) <= 0.2, `flow sample ${index} retains its place in time`);
    assert.ok(Math.abs(after.flow - before.flow) <= 0.02, `flow sample ${index} retains its measured value`);
  }
  const flow = afterBack.displayedFlow;
  assert.ok(flow > 0 && flow < 4, `simulated display flow: ${flow} g/s`);
  assert.ok(Math.abs(flow - afterBack.points.at(-1).flow) <= 0.02, 'the live flow readout matches the chart');
  await button(page, 'Stop shot').click();
  await page.clock.runFor(2200);
  await page.getByText('Reading final weight…', { exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual(await preferences(page), before);
  const yieldG = Number(await page.getByTestId('dial-yield-tile').locator('input').inputValue());
  assert.ok(yieldG > 0 && yieldG < 36, `measured simulated yield: ${yieldG}g`);
  const shot = await saveOneShot(page);
  assert.equal(shot.beanId, bean.id);
  assert.equal(shot.actualYieldG, yieldG);
  assert.match(shot.notes, /^Pre-infusion: [\d.]+s\./);
  assert.ok(shot.scaleFlowCurve.length > 10);
  assert.ok(shot.scaleFlowRateGs > 0);
  await shareAndDelete(page, shot);
  console.log(`PASS simulated pre-infusion and flow: chart ${beforeBack.points.length} → ${afterBack.points.length} points across Back, ${yieldG}g saved, ${shot.scaleFlowCurve.length} curve samples`);
}

let browser;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true }));
  await page.goto(server.url);
  await page.getByRole('radio', { name: 'Brew & Dial-In', exact: true }).check();
  await button(page, 'Continue').click();
  await nav(page, 'Dial').waitFor();
  await configureGrinder(page);
  const bean = await createCoffee(page);
  const dial = await readNumber(grindControl(page));
  assert.ok(Number.isInteger(dial) && dial > 10 && dial < 40);
  await checkStartingGuide(page, dial);
  await page.clock.install();
  await manualShot(page, bean, dial);
  await simulatedShot(page, bean);
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server.kill();
}
