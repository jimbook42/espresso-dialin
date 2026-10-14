import {
  isCustomGrinderModel,
  isNicheZeroGrinderModel,
  isPresetGrinderModel,
  isSetteGrinderModel,
  isSunbeamGrinderModel,
} from './grinderRegistry.js';
import { getGrindUiForBeanGrinder } from './grindDialByBean.js';
import { resolveGrindControlUiState } from './grindControlUiState.js';

export function pendingGrindSessionKey(beanId, grinderModel) {
  if (!beanId || !grinderModel) return '';
  return `${beanId}::${grinderModel}`;
}

const GRIND_UI_SNAPSHOT_KEYS = [
  'setteMacro',
  'setteMicro',
  'sunbeamSetting',
  'nicheZeroSetting',
  'customGrindValue',
];

/** @param {object|null|undefined} a @param {object|null|undefined} b */
export function grindUiSnapshotsEqual(a, b) {
  if (!a || !b) return false;
  for (const key of GRIND_UI_SNAPSHOT_KEYS) {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) continue;
    if (av == null || bv == null) return false;
    if (typeof av === 'number' && typeof bv === 'number') {
      if (av !== bv) return false;
      continue;
    }
    if (String(av) !== String(bv)) return false;
  }
  return true;
}

/**
 * Drop in-memory pending dial when storage caught up or another tab wrote a newer value.
 * @param {{ pending: object, persisted: object|null, lastSeenPersisted?: object|null }} input
 */
export function shouldDropPendingGrind({ pending, persisted, lastSeenPersisted = null }) {
  if (!pending) return false;
  if (!persisted || Object.keys(persisted).length === 0) return false;
  if (grindUiSnapshotsEqual(pending, persisted)) return true;
  if (
    lastSeenPersisted
    && !grindUiSnapshotsEqual(persisted, lastSeenPersisted)
    && !grindUiSnapshotsEqual(pending, persisted)
  ) {
    return true;
  }
  return false;
}

/**
 * @param {object} params
 * @param {Record<string, object>} params.pendingGrindByKey — mutated when pending is reconciled
 * @param {Record<string, object>} [params.lastSeenPersistedGrindByKey] — mutated with latest persisted UI
 */
export function reconcilePendingGrindForContext({
  pendingGrindByKey,
  lastSeenPersistedGrindByKey = null,
  settings,
  activeBean,
  grinderModel,
}) {
  const key = pendingGrindSessionKey(activeBean?.id, grinderModel);
  if (!key) return;
  const persisted = getGrindUiForBeanGrinder(settings, activeBean?.id, grinderModel);
  const pending = pendingGrindByKey[key];
  if (
    pending
    && shouldDropPendingGrind({
      pending,
      persisted,
      lastSeenPersisted: lastSeenPersistedGrindByKey?.[key] ?? null,
    })
  ) {
    delete pendingGrindByKey[key];
  }
  if (lastSeenPersistedGrindByKey && persisted && Object.keys(persisted).length > 0) {
    lastSeenPersistedGrindByKey[key] = { ...persisted };
  }
}

/** Snapshot grind control fields for in-memory session restore (per bean + grinder). */
export function capturePendingGrindState(grinderModel, {
  setteMacro,
  setteMicro,
  sunbeamSetting,
  nicheZeroSetting,
  customGrindValue,
}, settings = null) {
  if (!grinderModel) return null;
  if (isSetteGrinderModel(grinderModel)) {
    return { setteMacro, setteMicro };
  }
  if (isSunbeamGrinderModel(grinderModel)) {
    return { sunbeamSetting };
  }
  if (isNicheZeroGrinderModel(grinderModel)) {
    return { nicheZeroSetting };
  }
  if (isPresetGrinderModel(grinderModel)) {
    return { customGrindValue };
  }
  if (isCustomGrinderModel(grinderModel, settings)) {
    return { customGrindValue };
  }
  return null;
}

/**
 * Grind UI when bean/grinder context changes: pending applied dial wins over last logged shot
 * until persisted storage catches up or another tab updates the dial.
 * @param {object} params — same as resolveGrindControlUiState, plus pendingGrindByKey map
 */
export function resolveGrindControlUiStateWithPending({
  pendingGrindByKey = {},
  lastSeenPersistedGrindByKey = null,
  grinderModel,
  shots,
  activeBean,
  recipes,
  beans,
  mockDate,
  flairEnabled,
  settings = null,
}) {
  reconcilePendingGrindForContext({
    pendingGrindByKey,
    lastSeenPersistedGrindByKey,
    settings,
    activeBean,
    grinderModel,
  });

  const key = pendingGrindSessionKey(activeBean?.id, grinderModel);
  const pending = key ? pendingGrindByKey[key] : null;
  if (pending) return pending;

  return resolveGrindControlUiState({
    grinderModel,
    shots,
    activeBean,
    recipes,
    beans,
    mockDate,
    flairEnabled,
    settings,
  });
}
