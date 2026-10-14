import assert from 'assert';
import { readCachedGrindBootstrapState } from './grindControlBootstrap.js';
import { writeCachedGlobalSettings } from '../settings/settingsLocalCache.js';
import { SETTE_GRINDER_ID } from './grinderRegistry.js';
import { patchGrindUiForBeanGrinder } from './grindDialByBean.js';

export function runGrindControlBootstrapTests() {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    };
  }

  const beanId = 'bean-bootstrap';
  const grindPatch = patchGrindUiForBeanGrinder(
    { id: 'global' },
    beanId,
    SETTE_GRINDER_ID,
    { setteMacro: 17, setteMicro: 'F' }
  );
  const base = {
    id: 'global',
    grinderModel: SETTE_GRINDER_ID,
    lastSelectedBeanId: beanId,
    ...grindPatch,
  };
  writeCachedGlobalSettings(base);
  const boot = readCachedGrindBootstrapState();
  assert.equal(boot.grinderModel, SETTE_GRINDER_ID);
  assert.equal(boot.grindUi.setteMacro, 17);
  assert.equal(boot.grindUi.setteMicro, 'F');
  console.log('Grind control bootstrap tests passed.');
}
