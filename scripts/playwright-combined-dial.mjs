import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startPreviewServer, waitForServer } from './lib/previewServer.mjs';

const server = startPreviewServer(4188);
const profile = await mkdtemp(join(tmpdir(), 'dialin-combined-'));
const auditBaseline = process.argv.includes('--baseline');
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
let context;

function rows(page, seed = false) {
  return page.evaluate((seed) => new Promise((resolve, reject) => {
    const open = indexedDB.open('EspressoDialDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['settings', 'beans', 'recipes', 'shots'], seed ? 'readwrite' : 'readonly');
      if (seed) {
        tx.objectStore('settings').put({
          id: 'global', experiencePreference: 'combined', grinderModel: 'Sette 270Wi',
          lastSelectedBeanId: 'combined-bean', preInfusionEnabled: false, shotStartCountdown: 0,
        });
        tx.objectStore('beans').put({ id: 'combined-bean', name: 'Combined coffee', roastType: 'Medium' });
        tx.objectStore('recipes').put({
          id: 'combined-recipe', beanId: 'combined-bean', targetTimeMinS: 27,
          targetTimeMaxS: 32, targetDoseG: 18, targetYieldG: 36,
        });
      }
      const shots = tx.objectStore('shots').getAll();
      tx.oncomplete = () => { db.close(); resolve(shots.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), seed);
}

try {
  await waitForServer(server.url);
  const launch = (viewport) => chromium.launchPersistentContext(profile, {
    viewport, isMobile: true, hasTouch: true, acceptDownloads: true,
  });
  context = await launch({ width: 320, height: 640 });
  const [page] = context.pages();
  await page.goto(server.url);
  await page.getByRole('radio', { name: 'Combined', exact: true }).waitFor();
  await rows(page, true);
  await page.reload();
  await page.getByTestId('dial-bean-card').waitFor();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const pressure = nav.getByRole('button', { name: 'Pressure', exact: true });
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await start.click();
  const stop = page.getByRole('button', { name: 'Stop shot', exact: true });
  await stop.waitFor();
  await page.waitForTimeout(1200);
  await stop.evaluate((button) => { button.click(); button.click(); });
  const time = page.getByTestId('dial-time-tile').locator('input');
  const duration = Number(await time.inputValue());
  assert.ok(duration >= 1);
  if (auditBaseline) {
    await pressure.click();
    await page.getByRole('button', { name: 'Start recording' }).waitFor();
    console.log('BASELINE: a stopped Dial shot allows entry to standalone recording');
    await nav.getByRole('button', { name: 'Dial', exact: true }).click();
  } else {
    assert.equal(await pressure.isDisabled(), true);
    assert.equal(await start.isDisabled(), true);
    assert.equal(await page.getByTitle('Settings', { exact: true }).isDisabled(), true);
    await page.getByText('Save or discard this shot before switching workflows.').waitFor();
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Discard shot', exact: true }).click();
    assert.equal(Number(await time.inputValue()), duration);
  }
  await page.getByTestId('dial-yield-tile').locator('input').fill('36');
  await page.getByRole('button', { name: 'Balanced', exact: true }).click();
  if (!auditBaseline) await page.getByRole('button', { name: 'Rate shot 4 out of 5' }).click();
  await page.getByPlaceholder('Notes — puck prep, channeling, batch size…').fill('Combined browser check');
  const save = page.getByRole('button', { name: 'Log shot & calculate grind adjustment', exact: true });
  await save.evaluate((button) => { button.form.requestSubmit(); button.form.requestSubmit(); });
  const history = nav.getByRole('button', { name: 'History', exact: true });
  await history.click();
  const card = page.getByTestId('history-shot-card').filter({ hasText: 'Combined coffee' });
  await card.first().waitFor();
  const saved = await rows(page);
  if (auditBaseline) {
    console.log(`BASELINE: two immediate form submissions produced ${saved.length} History rows`);
    assert.equal(saved.length, 2);
  } else {
    assert.equal(saved.length, 1);
    const [shot] = saved;
    assert.equal(shot.recordType, undefined);
    assert.equal(shot.beanId, 'combined-bean');
    assert.equal(shot.grinderModel, 'Sette 270Wi');
    assert.equal(shot.actualTimeS, duration);
    assert.equal(shot.actualDoseG, 18);
    assert.equal(shot.actualYieldG, 36);
    assert.equal(shot.tasteProfile, 'balanced');
    assert.equal(shot.shotRating, 4);
    assert.equal(shot.notes, 'Combined browser check');
    assert.equal(shot.labPressureCurve, undefined);
    assert.ok(shot.recommendation);
    const download = page.waitForEvent('download');
    await card.getByTestId('history-shot-diagnostics-export').click();
    const diagnostics = JSON.parse(await readFile(await (await download).path(), 'utf8'));
    assert.equal(diagnostics.shotId, shot.id);
    assert.equal(diagnostics.diagnosticsVersion, 2);
    assert.equal(diagnostics.recordingBuild.appVersion, version);
    assert.equal(diagnostics.recordingBuild.gitSha, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
    assert.equal(diagnostics.final.mode, 'manual');
    assert.equal(diagnostics.final.actualTimeS, duration);
    await nav.getByRole('button', { name: 'Dial', exact: true }).click();
    await start.click();
    await stop.click();
    const notes = page.getByPlaceholder('Notes — puck prep, channeling, batch size…');
    await notes.fill('Discarded shot');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Discard shot', exact: true }).click();
    assert.equal(await time.inputValue(), '');
    assert.equal(await notes.inputValue(), '');
    await pressure.click();
    await page.getByRole('button', { name: 'Start recording' }).waitFor();
    assert.deepEqual(await rows(page), saved);
    await context.close();
    context = await launch({ width: 412, height: 915 });
    const [restarted] = context.pages();
    await restarted.goto(server.url);
    await restarted.getByRole('navigation').getByRole('button', { name: 'History', exact: true }).click();
    await restarted.getByTestId('history-shot-card').filter({ hasText: 'Combined coffee' }).waitFor();
    assert.deepEqual(await rows(restarted), saved);
    console.log('PASS Combined manual shot, protected review, one save, diagnostics and browser restart at 320×640 and 412×915');
  }
} finally {
  await context?.close();
  await server.kill();
  await rm(profile, { recursive: true, force: true });
}
