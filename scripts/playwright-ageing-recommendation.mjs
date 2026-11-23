import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const bean = { id: 'age-bean', name: 'Ageing regression', roastType: 'Medium', roastDate: '2026-11-04' };
const recipe = {
  id: 'age-recipe', beanId: bean.id, targetDoseG: 18, targetYieldG: 36,
  targetTimeMinS: 27, targetTimeMaxS: 32,
};
const grinderModel = 'Sette 270Wi';
const shot = {
  ...recipe,
  id: 'age-shot', timestamp: '2026-11-14T12:00:00Z', grinderModel, beanAgeDays: 10,
  setteMacro: 8, setteMicro: 'A', actualTimeS: 30, actualDoseG: 18, actualYieldG: 36,
  tasteProfile: 'balanced', wasPurged: true,
  recommendation: { recommendedSetting: { macro: 8, micro: 'A' }, reason: 'KEEP GRIND — Balanced and in range.' },
};

const server = startPreviewServer(4196);
let browser;
try {
  await waitForServer(server.url);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, timezoneId: 'UTC' });
  await page.clock.setFixedTime(new Date('2026-11-24T12:00:00Z'));
  await page.goto(server.url);
  await page.getByText(/choose|experience|grinder/i).first().waitFor();
  await page.evaluate((records) => new Promise((resolve, reject) => {
    const request = indexedDB.open('EspressoDialDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(Object.keys(records), 'readwrite');
      for (const [table, record] of Object.entries(records)) tx.objectStore(table).put(record);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), {
    settings: {
      id: 'global', grinderModel, experiencePreference: 'brew',
      lastSelectedBeanId: bean.id, brewGuideEnabled: false,
      recommendationCardDisplayByBeanGrinder: { [`${bean.id}::${grinderModel}`]: '8-A' },
    },
    beans: bean,
    recipes: recipe,
    shots: shot,
  });
  const reloadDial = async () => {
    await page.reload();
    await page.getByRole('button', { name: 'Dial', exact: true }).click();
  };
  await reloadDial();
  const card = page.getByTestId('grind-adjustment-card');
  const applyRec = card.getByRole('button', { name: /apply rec/i });
  const verifyApplied = async (setting) => {
    await applyRec.click();
    await card.getByRole('status').getByText(`Grind set to ${setting}.`).waitFor();
    await page.getByTestId('grind-card-last-shot-note').getByText(new RegExp(`logging ${setting}`)).waitFor();
  };
  await card.getByText(/10 days older/).waitFor();
  const actual = await card.innerText();
  assert.equal(await card.getByText('7-H', { exact: true }).count(), 1, actual);
  assert.match(actual, /Grind finer · Adjusted for bean ageing\. · Target setting: 7-H/);
  assert.doesNotMatch(actual, /Keep the same grind/);
  await verifyApplied('7-H');

  await card.getByRole('button', { name: 'Changed basket' }).click();
  await page.getByRole('button', { name: /Fewer holes/ }).click();
  await card.getByText('8-A', { exact: true }).waitFor();
  await card.getByText(/Keep the same grind.*Target setting: 8-A/).waitFor();
  await card.getByText('Adjusted for basket change').waitFor();
  await verifyApplied('8-A');
  await reloadDial();
  await card.getByText('8-A', { exact: true }).waitFor();
  await card.getByText('Adjusted for basket change').waitFor();
  await verifyApplied('8-A');
  console.log('Dial ageing, stale applied label, and basket-adjusted Apply Rec after reload passed.');
} finally {
  await browser?.close();
  await server.kill();
}
