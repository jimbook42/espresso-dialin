import { writeCachedGlobalSettings } from './settingsLocalCache.js';

const GLOBAL_ID = 'global';

function mergeSettingsPatch(base, patch) {
  const merged = { ...base, ...patch };
  if (patch.grindUiByBeanGrinder) {
    merged.grindUiByBeanGrinder = {
      ...(base.grindUiByBeanGrinder || {}),
      ...patch.grindUiByBeanGrinder,
    };
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'customGrinder') && patch.customGrinder === undefined) {
    delete merged.customGrinder;
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'customGrinderSetupDraft')
    && patch.customGrinderSetupDraft === undefined
  ) {
    delete merged.customGrinderSetupDraft;
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'grinderPickerSelection')
    && patch.grinderPickerSelection === undefined
  ) {
    delete merged.grinderPickerSelection;
  }
  return merged;
}

/**
 * Atomically merge a partial patch into the global settings row (read-merge-write in one transaction).
 * Pass a function to build the patch from the latest row (avoids stale get-then-put across tabs).
 */
export async function patchGlobalSettings(database, patchOrUpdater) {
  const merged = await database.transaction('rw', database.settings, async () => {
    const row = await database.settings.get(GLOBAL_ID);
    const base = row ?? { id: GLOBAL_ID };
    const patch =
      typeof patchOrUpdater === 'function' ? patchOrUpdater(base) : patchOrUpdater;
    if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
      return base;
    }
    const next = mergeSettingsPatch(base, patch);
    await database.settings.put(next);
    return next;
  });
  if (merged?.id === GLOBAL_ID) {
    writeCachedGlobalSettings(merged);
  }
  return merged;
}
