import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './grinderLogic.js';
import {
  nextActiveBeanIdAfterFinish,
  persistBeanFinished,
  restoreBeanFromSnapshot,
  snapshotBeanRecord,
} from './beanFinishActions.js';

const BEAN_A = {
  id: 'bean-a',
  name: 'Ethiopia',
  roaster: 'Local',
  roastType: 'Light',
  roastDate: '2026-09-01',
  storageType: 'bag',
  rating: 8.5,
  isFinished: false,
  thawHistory: [{ thawDate: '2026-09-10' }],
  createdAt: '2026-09-01T00:00:00.000Z',
};

const BEAN_B = {
  id: 'bean-b',
  name: 'House',
  roaster: 'Cafe',
  roastType: 'Medium',
  roastDate: '2026-09-15',
  storageType: 'vacuum',
  isFinished: false,
  createdAt: '2026-09-15T00:00:00.000Z',
};

describe('bean finish undo', () => {
  beforeEach(async () => {
    await db.open();
    await db.transaction('rw', db.beans, async () => {
      await db.beans.clear();
      await db.beans.bulkAdd([BEAN_A, BEAN_B]);
    });
  });

  it('finish then undo restores identical bean record and selection intent', async () => {
    const beans = await db.beans.toArray();
    const snapshot = snapshotBeanRecord(beans.find((b) => b.id === 'bean-a'));
    expect(snapshot).not.toBeNull();

    const wasSelected = true;
    const nextId = nextActiveBeanIdAfterFinish(beans, 'bean-a');
    expect(nextId).toBe('bean-b');

    await persistBeanFinished(db, 'bean-a');
    const afterFinish = await db.beans.get('bean-a');
    expect(afterFinish.isFinished).toBe(true);

    await restoreBeanFromSnapshot(db, snapshot);
    const restored = await db.beans.get('bean-a');
    expect(restored).toEqual(snapshot);
    expect(restored.isFinished).toBe(false);
    expect(restored.rating).toBe(8.5);
    expect(restored.thawHistory).toEqual([{ thawDate: '2026-09-10' }]);

    const selectionAfterUndo = wasSelected ? snapshot.id : nextId;
    expect(selectionAfterUndo).toBe('bean-a');
  });

  it('next active bean skips finished bags', async () => {
    const beans = await db.beans.toArray();
    expect(nextActiveBeanIdAfterFinish(beans, 'bean-a')).toBe('bean-b');
    await persistBeanFinished(db, 'bean-b');
    const updated = await db.beans.toArray();
    expect(nextActiveBeanIdAfterFinish(updated, 'bean-a')).toBe('');
  });
});
