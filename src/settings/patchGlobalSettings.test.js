import assert from 'assert';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { patchGlobalSettings } from './patchGlobalSettings.js';

function makeTestDb() {
  const database = new Dexie('PatchGlobalSettingsTestDB');
  database.version(1).stores({ settings: 'id' });
  return database;
}

export async function runPatchGlobalSettingsTests() {
  const database = makeTestDb();
  await database.open();
  await database.settings.clear();

  await patchGlobalSettings(database, { grinderModel: 'Sette 270Wi', flairEnabled: true });

  const concurrent = await Promise.all([
    patchGlobalSettings(database, { grinderModel: 'Niche Zero' }),
    patchGlobalSettings(database, { flairEnabled: false, darkMode: true }),
  ]);
  assert.equal(concurrent.length, 2);

  const finalRow = await database.settings.get('global');
  assert.equal(finalRow.grinderModel, 'Niche Zero');
  assert.equal(finalRow.flairEnabled, false);
  assert.equal(finalRow.darkMode, true);

  await patchGlobalSettings(database, (current) => ({
    grindUiByBeanGrinder: {
      'bean-a::Sette 270Wi': { setteMacro: 12, setteMicro: 'C' },
    },
  }));
  await patchGlobalSettings(database, (current) => ({
    grindUiByBeanGrinder: {
      'bean-b::Sunbeam Barista Max': { sunbeamSetting: 18 },
    },
  }));

  const withGrind = await database.settings.get('global');
  assert.equal(withGrind.grindUiByBeanGrinder['bean-a::Sette 270Wi'].setteMacro, 12);
  assert.equal(withGrind.grindUiByBeanGrinder['bean-b::Sunbeam Barista Max'].sunbeamSetting, 18);

  await database.delete();
  console.log('patchGlobalSettings tests passed.');
}
