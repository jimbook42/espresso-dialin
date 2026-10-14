import { readCachedGlobalSettings } from '../settings/settingsLocalCache.js';
import {
  isSetteGrinderModel,
  resolveActiveGrinderModel,
} from './grinderRegistry.js';
import { getGrindUiForBeanGrinder } from './grindDialByBean.js';

/**
 * Synchronous grind + grinder bootstrap from the settings localStorage mirror.
 * Avoids flashing factory defaults before Dexie hydrates on reload.
 */
export function readCachedGrindBootstrapState() {
  const settings = readCachedGlobalSettings();
  if (!settings) return null;

  const grinderModel = resolveActiveGrinderModel(settings);
  if (!grinderModel) return null;

  const beanId = settings.lastSelectedBeanId;
  let grindUi = null;
  if (beanId) {
    grindUi = getGrindUiForBeanGrinder(settings, beanId, grinderModel);
  }

  if (!grindUi && isSetteGrinderModel(grinderModel) && settings.lastSetteMacro != null) {
    grindUi = {
      setteMacro: settings.lastSetteMacro,
      setteMicro: settings.lastSetteMicro || 'E',
    };
  }

  return { grinderModel, grindUi };
}
