import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}/`;
const LAB_URL = `${PREVIEW_URL}#/flair-pressure-lab`;

async function isServerUp(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

function waitForServer(url, attempts = 40) {
  return (async () => {
    for (let i = 0; i < attempts; i += 1) {
      if (await isServerUp(url)) return;
      await delay(250);
    }
    throw new Error(`Preview server did not become ready at ${url}`);
  })();
}

async function waitForRootContent(page, timeout = 30_000) {
  await page.waitForFunction(
    () => {
      const root = document.getElementById('root');
      return Boolean(root && root.childElementCount > 0 && root.textContent.trim().length > 0);
    },
    { timeout }
  );
}

async function seedExistingProfileSettings(page) {
  await page.goto(PREVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const seed = () => {
          const req = indexedDB.open('EspressoDialDB', 17);
          req.onupgradeneeded = (event) => {
            const idb = event.target.result;
            for (const [name, keyPath] of [
              ['settings', 'id'],
              ['beans', 'id'],
              ['shots', 'id'],
              ['recipes', 'id'],
            ]) {
              if (!idb.objectStoreNames.contains(name)) {
                idb.createObjectStore(name, { keyPath });
              }
            }
          };
          req.onsuccess = (event) => {
            const idb = event.target.result;
            const tx = idb.transaction('settings', 'readwrite');
            tx.objectStore('settings').put({
              id: 'global',
              grinderModel: 'Sette 270Wi',
              flairEnabled: false,
            });
            tx.oncomplete = () => {
              idb.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        };
        const del = indexedDB.deleteDatabase('EspressoDialDB');
        del.onsuccess = seed;
        del.onerror = seed;
        del.onblocked = () => setTimeout(seed, 50);
      })
  );
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
}

async function main() {
  let preview = null;
  if (!(await isServerUp(PREVIEW_URL))) {
    preview = spawn(
      'npm',
      ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort'],
      { stdio: 'inherit', env: { ...process.env, BROWSER: 'none' } }
    );
  }

  let browser;
  try {
    await waitForServer(PREVIEW_URL);
    browser = await chromium.launch({ headless: true });

    const freshContext = await browser.newContext();
    const fresh = await freshContext.newPage();
    await fresh.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 60_000 });
    await waitForRootContent(fresh);
    const freshSnippet = await fresh.evaluate(() =>
      (document.getElementById('root')?.textContent || '').trim().slice(0, 120)
    );
    if (!freshSnippet.includes('Welcome')) {
      throw new Error('fresh profile: expected first-launch wizard welcome copy');
    }
    console.log(`fresh profile: ok (${freshSnippet.replace(/\s+/g, ' ').slice(0, 80)}…)`);

    const existingContext = await browser.newContext();
    const existing = await existingContext.newPage();
    await seedExistingProfileSettings(existing);
    await waitForRootContent(existing);
    const existingText = await existing.evaluate(() => document.body.textContent || '');
    if (existingText.includes('WelcomeSet up grinder')) {
      throw new Error('existing profile: first-launch wizard should not appear after settings seed');
    }
    console.log('existing profile: ok (main shell, no onboarding flash)');

    const labContext = await browser.newContext();
    const lab = await labContext.newPage();
    await lab.goto(LAB_URL, { waitUntil: 'networkidle', timeout: 60_000 });
    await waitForRootContent(lab);
    console.log('lab route: ok (#root has content)');

    console.log('Built app render verification passed.');
  } finally {
    if (browser) await browser.close();
    if (preview) preview.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
