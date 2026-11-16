import { createPortableShots, PORTABLE_SHOT_FORMAT, PORTABLE_SHOT_VERSION } from './portableShots.js';
import { canReferenceShot, readShotSelections, SHOT_SELECTIONS_ID } from './shotSelections.js';

export const MAX_PORTABLE_SHOT_BYTES = 64 * 1024 * 1024;

const object = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const id = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
const string = (value) => typeof value === 'string';
const boolean = (value) => typeof value === 'boolean';
const number = Number.isFinite;
const scalar = (value) => string(value) || number(value);

export function isShotTimestamp(value, maxFractionDigits = Infinity) {
  if (!string(value)) return false;
  const parts = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts || (parts[2]?.length ?? 0) > maxFractionDigits || !number(Date.parse(value))) return false;
  const day = new Date(parts[1]);
  return number(day.getTime()) && day.toISOString().slice(0, 10) === parts[1];
}

function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

function safeJson(value, depth = 0) {
  requireValid(depth <= 32, 'The backup contains data nested too deeply.');
  if (Array.isArray(value)) {
    for (const item of value) safeJson(item, depth + 1);
  } else if (object(value)) {
    for (const [key, child] of Object.entries(value)) {
      requireValid(!['__proto__', 'constructor', 'prototype'].includes(key), 'The backup contains an invalid property.');
      safeJson(child, depth + 1);
    }
  } else {
    requireValid(typeof value !== 'number' || number(value), 'The backup contains an invalid number.');
  }
}

function optionalFields(record, validator, fields) {
  for (const field of fields.split(' ')) {
    requireValid(record[field] == null || validator(record[field]), 'Invalid saved field: ' + field + '.');
  }
}

function validateCurve(curve, key) {
  if (curve == null) return;
  requireValid(Array.isArray(curve), 'A recorded sensor curve is invalid.');
  for (const point of curve) {
    if (point === null) continue;
    requireValid(object(point), 'A recorded sensor sample is invalid.');
    optionalFields(point, number, 'tS ' + key);
    optionalFields(point, boolean, 'confident breakBefore reset gap');
  }
}

function validateShot(record) {
  requireValid(object(record) && id(record.id) && isShotTimestamp(record.timestamp),
    'Each shot must have a valid ID and saved timestamp.');
  optionalFields(record, id, 'beanId');
  optionalFields(record, string, 'recordType shotName grinderModel preparationMethod tasteProfile brewRatio storageType knownIssueReason notes labPressureMissingReason');
  optionalFields(record, scalar, 'setteMacro setteMicro sunbeamSetting nicheZeroSetting customGrindValue');
  optionalFields(record, number, 'actualDoseG actualYieldG actualTimeS actualTime shotRating beanAgeDays targetDoseG targetYieldG targetTimeMinS targetTimeMaxS brewTemperatureC labPressurePeakBar scaleFlowRateGs waterInMl');
  optionalFields(record, boolean, 'wasPurged excludeFromLearning recommendationFollowed');
  optionalFields(record, object, 'shotProfileTiming recommendation flairProfile');
  if (record.recommendation) optionalFields(record.recommendation, string, 'reason');

  const timing = record.shotProfileTiming;
  if (timing) {
    optionalFields(timing, number, 'version pressureOriginMs scaleOriginMs extractionStartMs extractionEndMs stopMs settlementEndMs clockDriftMs');
    optionalFields(timing, string, 'pressureSource scaleSource yieldSource');
    optionalFields(timing, boolean, 'scaleInterrupted');
  }
  optionalFields(record, (jpeg) => string(jpeg) && jpeg.length <= 120_000
    && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(jpeg), 'labGaugeSnapshotJpeg');
  validateCurve(record.labPressureCurve, 'bar');
  validateCurve(record.scaleFlowCurve, 'weightG');
}

function validateBean(bean) {
  requireValid(object(bean) && id(bean.id) && string(bean.name) && bean.name.trim(),
    'Each linked bean must have a valid ID and name.');
  optionalFields(bean, string, 'roaster roastType roastDate storageType postThawStorage freezeDate thawDate createdAt finishedAt');
  optionalFields(bean, scalar, 'rating');
  optionalFields(bean, boolean, 'isFinished isDecaf');
  if (bean.thawHistory != null) {
    requireValid(Array.isArray(bean.thawHistory) && bean.thawHistory.every(object), 'A bean thaw history is invalid.');
  }
}

function uniqueMap(items, key, message) {
  const map = new Map(items.map((item) => [key(item), item]));
  requireValid(map.size === items.length, message);
  return map;
}

function sameJson(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  return keys.length === Object.values(right).filter((value) => value !== undefined).length
    && keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}

export async function parsePortableShotFile(file) {
  requireValid(file.size > 0 && file.size <= MAX_PORTABLE_SHOT_BYTES, 'Choose a JSON backup between 1 byte and 64 MiB.');
  let backup;
  try {
    backup = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
  } catch {
    throw new Error('This file is not readable UTF-8 JSON.');
  }
  requireValid(backup?.format === PORTABLE_SHOT_FORMAT && backup.version === PORTABLE_SHOT_VERSION,
    'This JSON backup format or version is unsupported.');
  requireValid(Array.isArray(backup.shots) && backup.shots.length > 0 && Array.isArray(backup.beans)
    && Array.isArray(backup.selections?.favouriteIds) && Array.isArray(backup.selections?.references),
  'The backup is incomplete.');
  safeJson(backup);
  const records = backup.shots.map((entry) => {
    validateShot(entry?.record);
    return entry.record;
  });
  backup.beans.forEach(validateBean);
  const shots = uniqueMap(records, (shot) => shot.id, 'The backup contains duplicate shot IDs.');
  const beans = uniqueMap(backup.beans, (bean) => bean.id, 'The backup contains duplicate bean IDs.');
  const { favouriteIds, references } = backup.selections;
  requireValid(new Set(favouriteIds).size === favouriteIds.length && favouriteIds.every((shotId) => shots.has(shotId)),
    'The backup contains an invalid favourite selection.');
  const referenceBeans = new Set();
  for (const reference of references) {
    const { beanId, shotId } = reference ?? {};
    requireValid(!referenceBeans.has(beanId) && canReferenceShot(shots.get(shotId), beans.get(beanId)),
      'The backup contains an invalid bean reference selection.');
    referenceBeans.add(beanId);
  }
  const canonical = createPortableShots(records, backup.beans, backup.selections);
  requireValid(sameJson(canonical, backup), 'The backup contains inconsistent shot data.');
  return canonical;
}

async function planRestore(db, backup) {
  const records = backup.shots.map(({ record }) => record);
  const [localShots, localBeans, selections] = await Promise.all([
    db.shots.bulkGet(records.map(({ id }) => id)),
    db.beans.bulkGet(backup.beans.map(({ id }) => id)),
    readShotSelections(db),
  ]);
  const newShots = [];
  const identicalIds = [];
  const conflictingIds = [];
  records.forEach((record, index) => {
    const local = localShots[index];
    if (!local) newShots.push(record);
    else if (sameJson(local, record)) identicalIds.push(record.id);
    else conflictingIds.push(record.id);
  });
  const newBeans = backup.beans.filter((_, index) => !localBeans[index]);
  const conflictingBeans = backup.beans.filter((bean, index) => localBeans[index] && !sameJson(localBeans[index], bean));
  const eligible = new Set([...identicalIds, ...newShots.map(({ id }) => id)]);
  const occupiedRefs = new Map(selections.references.map(({ beanId, shotId }) => [beanId, shotId]));
  const localFavourites = new Set(selections.favouriteIds);
  const eligibleFavourites = backup.selections.favouriteIds.filter((shotId) => eligible.has(shotId));
  const favouriteIds = eligibleFavourites.filter((shotId) => !localFavourites.has(shotId));
  const references = backup.selections.references.filter(({ beanId, shotId }) =>
    eligible.has(shotId) && !occupiedRefs.has(beanId));
  const skippedReferences = backup.selections.references.filter(({ beanId, shotId }) =>
    !eligible.has(shotId) || (occupiedRefs.has(beanId) && occupiedRefs.get(beanId) !== shotId));
  const backupBeanIds = new Set(backup.beans.map(({ id }) => id));
  return {
    newShots, newBeans, selections, favouriteIds, references,
    summary: {
      shotsInFile: records.length,
      newShots: newShots.length,
      identicalShots: identicalIds.length,
      conflictingShots: conflictingIds.length,
      newBeans: newBeans.length,
      conflictingBeans: conflictingBeans.length,
      shotsWithoutLinkedBean: records.filter(({ beanId }) => beanId != null && !backupBeanIds.has(beanId)).length,
      ratingsInFile: backup.shots.filter(({ measurements }) => measurements.rating != null).length,
      favouritesAdded: favouriteIds.length,
      referencesAdded: references.length,
      skippedSelections: backup.selections.favouriteIds.length - eligibleFavourites.length + skippedReferences.length,
      signature: JSON.stringify([newShots.map(({ id }) => id), conflictingIds, newBeans.map(({ id }) => id),
        conflictingBeans.map(({ id }) => id), favouriteIds, references, skippedReferences]),
    },
  };
}

export function previewPortableRestore(db, backup) {
  return db.transaction('r', db.shots, db.beans, db.settings, async () =>
    (await planRestore(db, backup)).summary);
}

export function restorePortableShots(db, backup, preview) {
  return db.transaction('rw', db.shots, db.beans, db.settings, async () => {
    const plan = await planRestore(db, backup);
    requireValid(preview?.signature === plan.summary.signature, 'Local data changed. Review the updated preview before restoring.');
    if (plan.newBeans.length) await db.beans.bulkAdd(plan.newBeans);
    if (plan.newShots.length) await db.shots.bulkAdd(plan.newShots);
    if (plan.favouriteIds.length || plan.references.length) {
      await db.settings.put({
        ...plan.selections,
        id: SHOT_SELECTIONS_ID,
        favouriteIds: [...plan.selections.favouriteIds, ...plan.favouriteIds],
        references: [...plan.selections.references, ...plan.references],
      });
    }
    return plan.summary;
  });
}
