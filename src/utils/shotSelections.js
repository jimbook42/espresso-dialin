import { isStandalonePressureShot } from '../flairPressureLab/standalonePressureShot.js';

export const SHOT_SELECTIONS_ID = 'history-shot-selections';
const emptySelections = { id: SHOT_SELECTIONS_ID, favouriteIds: [], references: [] };

export async function readShotSelections(db) {
  return (await db.settings.get(SHOT_SELECTIONS_ID)) ?? emptySelections;
}

export function canReferenceShot(shot, bean) {
  return Boolean(shot && bean && shot.beanId === bean.id && !isStandalonePressureShot(shot));
}

export async function toggleFavouriteShot(db, shotId) {
  return db.transaction('rw', db.shots, db.settings, async () => {
    if (!await db.shots.get(shotId)) return;
    const selections = await readShotSelections(db);
    const favouriteIds = selections.favouriteIds.includes(shotId)
      ? selections.favouriteIds.filter((id) => id !== shotId)
      : [...selections.favouriteIds, shotId];
    await db.settings.put({ ...selections, favouriteIds });
  });
}

export async function setReferenceShot(db, beanId, shotId, selected) {
  return db.transaction('rw', db.beans, db.shots, db.settings, async () => {
    const [bean, shot, selections] = await Promise.all([
      db.beans.get(beanId), db.shots.get(shotId), readShotSelections(db),
    ]);
    if (!canReferenceShot(shot, bean)) return;
    const current = selections.references.find((entry) => entry.beanId === beanId);
    if (!selected && current?.shotId !== shotId) return;
    const references = selections.references.filter((entry) => entry.beanId !== beanId);
    if (selected) references.push({ beanId, shotId });
    await db.settings.put({ ...selections, references });
  });
}

// Run in the same transaction as the record deletion.
export async function removeDeletedShotSelections(db, shotIds, beanId) {
  const selections = await readShotSelections(db);
  const deleted = new Set(shotIds);
  const favouriteIds = selections.favouriteIds.filter((id) => !deleted.has(id));
  const references = selections.references.filter((entry) =>
    entry.beanId !== beanId && !deleted.has(entry.shotId));
  if (favouriteIds.length !== selections.favouriteIds.length || references.length !== selections.references.length) {
    await db.settings.put({ ...selections, favouriteIds, references });
  }
}
