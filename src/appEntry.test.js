import assert from 'assert';
import { resolveAppEntry } from './appEntry.js';

export function runAppEntryTests() {
  assert.deepEqual(resolveAppEntry({ hash: '', pressureLabEnabled: false }), { entry: 'app' });
  assert.deepEqual(resolveAppEntry({ hash: '#/flair-pressure-lab', pressureLabEnabled: true }), {
    entry: 'flair-pressure-lab',
  });
  assert.deepEqual(resolveAppEntry({ hash: '#/flair-pressure-lab', pressureLabEnabled: false }), {
    entry: 'app',
    clearHash: true,
  });
  assert.deepEqual(resolveAppEntry({ hash: '#/flair-pressure-lab?x=1', pressureLabEnabled: true }), {
    entry: 'flair-pressure-lab',
  });

  console.log('App entry routing tests passed.');
}
