import assert from 'assert';
import { patchGrindUiForBeanGrinder } from './grindDialByBean.js';
import {
  pendingGrindSessionKey,
  resolveGrindControlUiStateWithPending,
} from './pendingGrindSession.js';

const bean = { id: 'bean-sync', roastType: 'Medium' };
const recipes = [];
const beans = [bean];

function settingsWithNicheDial(setting) {
  let settings = { id: 'global', grinderModel: 'Niche Zero' };
  settings = {
    ...settings,
    ...patchGrindUiForBeanGrinder(settings, bean.id, 'Niche Zero', { nicheZeroSetting: setting }),
  };
  return settings;
}

export function runPendingGrindSessionTwoTabTests() {
  const key = pendingGrindSessionKey(bean.id, 'Niche Zero');

  const pendingGrindByKey = { [key]: { nicheZeroSetting: 20 } };
  const lastSeenPersistedGrindByKey = { [key]: { nicheZeroSetting: 20 } };

  const uiRemote = resolveGrindControlUiStateWithPending({
    pendingGrindByKey,
    lastSeenPersistedGrindByKey,
    grinderModel: 'Niche Zero',
    shots: [],
    activeBean: bean,
    recipes,
    beans,
    mockDate: null,
    flairEnabled: false,
    settings: settingsWithNicheDial(18),
  });
  assert.equal(uiRemote.nicheZeroSetting, 18, 'other tab dial must replace stale pending');
  assert.equal(pendingGrindByKey[key], undefined, 'pending must clear after remote persist');

  const inFlightPending = { [key]: { nicheZeroSetting: 20 } };
  const inFlightLastSeen = { [key]: { nicheZeroSetting: 17 } };
  const uiInFlight = resolveGrindControlUiStateWithPending({
    pendingGrindByKey: inFlightPending,
    lastSeenPersistedGrindByKey: inFlightLastSeen,
    grinderModel: 'Niche Zero',
    shots: [],
    activeBean: bean,
    recipes,
    beans,
    mockDate: null,
    flairEnabled: false,
    settings: settingsWithNicheDial(17),
  });
  assert.equal(uiInFlight.nicheZeroSetting, 20, 'local dial must stay visible until persist lands');
  assert.deepEqual(inFlightPending[key], { nicheZeroSetting: 20 });

  const caughtUpPending = { [key]: { nicheZeroSetting: 20 } };
  const caughtUpLastSeen = { [key]: { nicheZeroSetting: 17 } };
  const uiCaughtUp = resolveGrindControlUiStateWithPending({
    pendingGrindByKey: caughtUpPending,
    lastSeenPersistedGrindByKey: caughtUpLastSeen,
    grinderModel: 'Niche Zero',
    shots: [],
    activeBean: bean,
    recipes,
    beans,
    mockDate: null,
    flairEnabled: false,
    settings: settingsWithNicheDial(20),
  });
  assert.equal(uiCaughtUp.nicheZeroSetting, 20);
  assert.equal(caughtUpPending[key], undefined, 'pending clears once storage matches local dial');

  console.log('Pending grind two-tab session tests passed.');
}
