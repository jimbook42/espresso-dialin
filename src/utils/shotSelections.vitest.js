import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './grinderLogic.js';
import { readShotSelections, removeDeletedShotSelections, setReferenceShot, toggleFavouriteShot } from './shotSelections.js';

const shots = [
  { id: 'a1', beanId: 'a', actualYieldG: 36 },
  { id: 'a2', beanId: 'a', actualYieldG: 38 },
  { id: 'b1', beanId: 'b' },
  { id: 'orphan', beanId: 'deleted' },
  { id: 'pressure', beanId: 'a', recordType: 'standalone-pressure' },
];

beforeEach(async () => {
  await db.transaction('rw', db.beans, db.shots, db.settings, async () => {
    await db.settings.clear();
    await db.settings.put({ id: 'global', grinderModel: 'Sette 270Wi' });
    await db.beans.clear();
    await db.beans.bulkAdd([{ id: 'a' }, { id: 'b' }]);
    await db.shots.clear();
    await db.shots.bulkAdd(shots);
  });
});

describe('History shot selections', () => {
  it('starts empty, persists favourites and a reference across reopen, and leaves saved records intact', async () => {
    expect(await readShotSelections(db)).toMatchObject({ favouriteIds: [], references: [] });
    await Promise.all([toggleFavouriteShot(db, 'a1'), toggleFavouriteShot(db, 'a2')]);
    await setReferenceShot(db, 'a', 'a1', true);
    db.close();
    await db.open();
    expect(await readShotSelections(db)).toMatchObject({
      favouriteIds: ['a1', 'a2'], references: [{ beanId: 'a', shotId: 'a1' }],
    });
    await toggleFavouriteShot(db, 'a1');
    expect((await readShotSelections(db)).favouriteIds).toEqual(['a2']);
    expect(await db.shots.toArray()).toEqual(shots);
    expect(await db.settings.get('global')).toEqual({ id: 'global', grinderModel: 'Sette 270Wi' });
  });

  it('replaces and removes one reference without affecting another bean', async () => {
    await setReferenceShot(db, 'a', 'a1', true);
    await setReferenceShot(db, 'b', 'b1', true);
    await setReferenceShot(db, 'a', 'a2', true);
    await setReferenceShot(db, 'a', 'a1', false); // An outdated remove action cannot clear the replacement.
    expect((await readShotSelections(db)).references).toEqual([
      { beanId: 'b', shotId: 'b1' }, { beanId: 'a', shotId: 'a2' },
    ]);
    await setReferenceShot(db, 'a', 'a2', false);
    expect((await readShotSelections(db)).references).toEqual([{ beanId: 'b', shotId: 'b1' }]);
  });

  it('rejects invalid references and favourites for absent shots', async () => {
    await Promise.all([
      toggleFavouriteShot(db, 'missing'),
      setReferenceShot(db, 'a', 'b1', true),
      setReferenceShot(db, 'a', 'pressure', true),
      setReferenceShot(db, 'a', 'missing', true),
      setReferenceShot(db, 'deleted', 'orphan', true),
    ]);
    expect(await readShotSelections(db)).toMatchObject({ favouriteIds: [], references: [] });
  });

  it('clears selections for deleted shots and beans without promoting another shot', async () => {
    await toggleFavouriteShot(db, 'a1');
    await toggleFavouriteShot(db, 'a2');
    await toggleFavouriteShot(db, 'b1');
    await setReferenceShot(db, 'a', 'a1', true);
    await setReferenceShot(db, 'b', 'b1', true);
    await db.transaction('rw', db.shots, db.settings, async () => {
      await db.shots.delete('a1');
      await removeDeletedShotSelections(db, ['a1']);
    });
    expect(await readShotSelections(db)).toMatchObject({
      favouriteIds: ['a2', 'b1'], references: [{ beanId: 'b', shotId: 'b1' }],
    });
    await db.transaction('rw', db.beans, db.shots, db.settings, async () => {
      await db.beans.delete('b');
      await db.shots.delete('b1');
      await removeDeletedShotSelections(db, ['b1'], 'b');
    });
    expect(await readShotSelections(db)).toMatchObject({ favouriteIds: ['a2'], references: [] });
  });
});
