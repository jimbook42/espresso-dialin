import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { formatShotGrindForHistory } from '../grinders/grinderRegistry.js';
import { db } from './grinderLogic.js';
import { buildShotsCsvContent, buildShotsCsvRows, SHOT_CSV_HEADERS } from './csvExport.js';
import { importShotsFromCsv } from './csvImport.js';
import { saveShotTasteRating, shotTasteRating } from './shotRatings.js';

const bean = { id: 'bean', name: 'Test coffee' };
const shot = {
  id: 'shot', beanId: bean.id, timestamp: '2026-10-15T00:00:00.000Z',
  grinderModel: 'Sette 270Wi', setteMacro: 7, setteMicro: 'C',
  actualTimeS: 28, actualDoseG: 18, actualYieldG: 36, notes: 'Keep this note',
};

async function resetShots() {
  await db.transaction('rw', db.beans, db.shots, db.recipes, async () => {
    await db.beans.clear();
    await db.shots.clear();
    await db.recipes.clear();
  });
}

beforeEach(async () => {
  await resetShots();
  await db.beans.add(bean);
  await db.shots.add(shot);
});
afterAll(() => db.close());

describe('saved taste ratings', () => {
  it('keeps older and invalid ratings unrated', () => {
    for (const rating of [undefined, null, 0, 6, 2.5, '4', NaN]) {
      expect(shotTasteRating({ shotRating: rating })).toBeNull();
    }
  });

  it('adds, edits and clears only the rating, including across reopening', async () => {
    expect(await saveShotTasteRating(db, shot.id, 1)).toBe(1);
    expect(await db.shots.get(shot.id)).toEqual({ ...shot, shotRating: 1 });
    await saveShotTasteRating(db, shot.id, 5);
    db.close();
    await db.open();
    expect(shotTasteRating(await db.shots.get(shot.id))).toBe(5);
    expect(() => saveShotTasteRating(db, shot.id, 0)).toThrow(RangeError);
    await saveShotTasteRating(db, shot.id, null);
    db.close();
    await db.open();
    expect(await db.shots.get(shot.id)).toStrictEqual(shot);
    expect(shotTasteRating(await db.shots.get(shot.id))).toBeNull();
  });

  it('never recreates a shot deleted alone or along with its bean', async () => {
    await saveShotTasteRating(db, shot.id, 4);
    await db.shots.delete(shot.id);
    expect(await saveShotTasteRating(db, shot.id, 3)).toBe(0);
    await db.shots.add(shot);
    await db.transaction('rw', db.beans, db.shots, async () => {
      await db.beans.delete(bean.id);
      await db.shots.where('beanId').equals(bean.id).delete();
    });
    expect(await saveShotTasteRating(db, shot.id, null)).toBe(0);
    expect(await db.shots.count()).toBe(0);
  });

  it('restores rated and cleared shots through the existing CSV format', async () => {
    await db.shots.add({ ...shot, id: 'cleared', timestamp: '2026-10-16T00:00:00.000Z' });
    await saveShotTasteRating(db, shot.id, 4);
    await saveShotTasteRating(db, 'cleared', 2);
    await saveShotTasteRating(db, 'cleared', null);
    const rows = buildShotsCsvRows(await db.shots.orderBy('timestamp').toArray(), {
      beans: [bean], formatShotGrindForHistory, normalizeTasteProfile: () => 'balanced',
      formatRecFollowedForCsv: () => '',
    });
    expect(rows.map((row) => row[SHOT_CSV_HEADERS.indexOf('Rating')])).toEqual([4, '']);
    const csv = buildShotsCsvContent(SHOT_CSV_HEADERS, rows);
    expect(await importShotsFromCsv(db, csv)).toMatchObject({ imported: 0, skipped: 2, errors: [] });
    await resetShots();
    expect(await importShotsFromCsv(db, csv)).toMatchObject({ imported: 2, skipped: 0, errors: [] });
    expect((await db.shots.orderBy('timestamp').toArray()).map(shotTasteRating)).toEqual([4, null]);
  });
});
