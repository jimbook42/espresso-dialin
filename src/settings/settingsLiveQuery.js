/** useLiveQuery default until Dexie resolves; distinct from a missing settings row (undefined). */
export const SETTINGS_QUERY_PENDING = Symbol.for('espresso-dialin.settings-query-pending');

export function resolveSettingsFromLiveQuery(queryResult) {
  if (queryResult === SETTINGS_QUERY_PENDING) {
    return { settingsLoaded: false, settings: null };
  }
  return { settingsLoaded: true, settings: queryResult ?? null };
}
