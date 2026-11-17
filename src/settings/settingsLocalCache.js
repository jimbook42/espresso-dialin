const CACHE_KEY = 'espresso-dialin.global-settings-v1';

export function readCachedGlobalSettings() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedGlobalSettings(settingsRow) {
  if (typeof localStorage === 'undefined' || !settingsRow || settingsRow.id !== 'global') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(settingsRow));
  } catch {
    // Quota or private mode — ignore; live query still loads settings.
  }
}

export function installSettingsLocalCacheHook(database) {
  if (!database?.settings?.put || database.settings.__localCacheHookInstalled) return;
  const originalPut = database.settings.put.bind(database.settings);
  database.settings.put = async (item, ...rest) => {
    const result = await originalPut(item, ...rest);
    if (item?.id === 'global') writeCachedGlobalSettings(item);
    return result;
  };
  database.settings.__localCacheHookInstalled = true;
}

export function rebuildGlobalSettingsCache(storage, row) {
  let serialized;
  try {
    if (row) serialized = JSON.stringify(row);
  } catch {
    // The IndexedDB row is authoritative. A cycle or BigInt cannot be cached as JSON.
  }
  if (serialized === undefined) storage.removeItem(CACHE_KEY);
  else storage.setItem(CACHE_KEY, serialized);
}
