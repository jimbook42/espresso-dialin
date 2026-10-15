import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './grinderLogic.js';
import {
  nextActiveBeanIdAfterFinish,
  partitionBeansByFinished,
  persistBeanActive,
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

describe('partitionBeansByFinished', () => {
  it('splits active and finished beans with correct count', () => {
    const beans = [
      { id: '1', isFinished: false },
      { id: '2', isFinished: true },
      { id: '3', isFinished: false },
      { id: '4', isFinished: true },
    ];
    const { activeBeans, finishedBeans, finishedCount } = partitionBeansByFinished(beans);
    expect(activeBeans.map((b) => b.id)).toEqual(['1', '3']);
    expect(finishedBeans.map((b) => b.id)).toEqual(['2', '4']);
    expect(finishedCount).toBe(2);
  });
});

describe('persistBeanActive', () => {
  beforeEach(async () => {
    await db.open();
    await db.transaction('rw', db.beans, async () => {
      await db.beans.clear();
      await db.beans.bulkAdd([BEAN_A, BEAN_B]);
    });
  });

  it('sets only isFinished to false and leaves other fields unchanged', async () => {
    await persistBeanFinished(db, 'bean-a');
    const finished = await db.beans.get('bean-a');
    expect(finished.isFinished).toBe(true);

    await persistBeanActive(db, 'bean-a');
    const reactivated = await db.beans.get('bean-a');
    expect(reactivated.isFinished).toBe(false);
    expect(reactivated).toEqual({ ...finished, isFinished: false });
  });
});
