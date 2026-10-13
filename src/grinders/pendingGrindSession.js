import {
  isCustomGrinderModel,
  isNicheZeroGrinderModel,
  isSetteGrinderModel,
  isSunbeamGrinderModel,
} from './grinderRegistry.js';
import { resolveGrindControlUiState } from './grindControlUiState.js';

export function pendingGrindSessionKey(beanId, grinderModel) {
  if (!beanId || !grinderModel) return '';
  return `${beanId}::${grinderModel}`;
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
  if (isCustomGrinderModel(grinderModel, settings)) {
    return { customGrindValue };
  }
  return null;
}

/**
 * Grind UI when bean/grinder context changes: pending applied dial wins over last logged shot.
 * @param {object} params — same as resolveGrindControlUiState, plus pendingGrindByKey map
 */
export function resolveGrindControlUiStateWithPending({
  pendingGrindByKey = {},
  grinderModel,
  shots,
  activeBean,
  recipes,
  beans,
  mockDate,
  flairEnabled,
  settings = null,
}) {
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
