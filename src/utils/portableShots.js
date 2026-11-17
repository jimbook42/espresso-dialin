import { PRESSURE_CURVE_GAP_MS } from '../flairPressureLab/pressureCurveFilter.js';
import { instantaneousFlowGs, SCALE_FLOW_MAX_SAMPLE_GAP_S } from '../scales/flowMetrics.js';
import { extractionTiming, recordedShotTiming, savedShotMeasurements } from './shotProfile.js';
import { shotTasteRating } from './shotRatings.js';
import { canReferenceShot, readShotSelections } from './shotSelections.js';

export const PORTABLE_SHOT_FORMAT = 'espresso-dial-in/shots';
export const PORTABLE_SHOT_VERSION = 1;

const finite = Number.isFinite;
const jsonCopy = (record) => JSON.parse(JSON.stringify(record));

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function describeSeries(samples, key, maxGapS, source, originMs, extraction) {
  const observedIndices = [];
  const gapBeforeIndices = [];
  let previous;
  for (const [index, point] of (samples ?? []).entries()) {
    if (!finite(point?.tS) || !finite(point[key]) || point.confident === false) continue;
    if (previous != null && (index !== previous + 1 || point.tS <= samples[previous].tS
      || point.tS - samples[previous].tS > maxGapS + 1e-9 || point.breakBefore || point.gap || point.reset)) {
      gapBeforeIndices.push(index);
    }
    observedIndices.push(index);
    previous = index;
  }
  return {
    source: source ?? null,
    originMs: finite(originMs) ? originMs : null,
    alignment: extraction && finite(originMs) ? 'recorded-extraction' : 'sensor-local',
    observedIndices,
    gapBeforeIndices,
  };
}

function describeShot(record) {
  const timing = recordedShotTiming(record);
  const extraction = extractionTiming(timing);
  const pressure = describeSeries(record.labPressureCurve, 'bar', PRESSURE_CURVE_GAP_MS / 1000,
    timing?.pressureSource, timing?.pressureOriginMs, extraction);
  const weight = describeSeries(record.scaleFlowCurve, 'weightG', SCALE_FLOW_MAX_SAMPLE_GAP_S,
    timing?.scaleSource, timing?.scaleOriginMs, extraction);
  const gaps = new Set(weight.gapBeforeIndices);
  const intervals = [];
  let previous;
  let breakBefore = true;
  for (const index of weight.observedIndices) {
    const point = record.scaleFlowCurve[index];
    const flowGs = gaps.has(index) ? null : instantaneousFlowGs(previous, point);
    if (finite(flowGs)) {
      intervals.push({ fromTS: previous.tS, tS: point.tS, flowGs, breakBefore });
    }
    breakBefore = !finite(flowGs);
    previous = point;
  }
  return {
    record,
    measurements: {
      ...savedShotMeasurements(record),
      ...(record.actualDoseG === 0 ? { doseG: 0 } : {}),
      rating: shotTasteRating(record),
    },
    pressure,
    weight,
    flow: { method: 'weight-change-per-second', intervals },
  };
}

export function createPortableShots(records, beans, selections) {
  const shots = new Map(records.map((record) => [record.id, record]));
  const beanIds = new Set(records.map(({ beanId }) => beanId));
  const linkedBeans = beans.filter(({ id }) => beanIds.has(id));
  const beansById = new Map(linkedBeans.map((bean) => [bean.id, bean]));
  return freeze({
    format: PORTABLE_SHOT_FORMAT,
    version: PORTABLE_SHOT_VERSION,
    shots: records.map((record) => describeShot(jsonCopy(record))),
    beans: linkedBeans.map(jsonCopy),
    selections: {
      favouriteIds: selections.favouriteIds.filter((id) => shots.has(id)),
      references: selections.references.filter(({ beanId, shotId }) =>
        canReferenceShot(shots.get(shotId), beansById.get(beanId))).map(jsonCopy),
    },
  });
}

export function readPortableShots(db, shotId) {
  return db.transaction('r', db.shots, db.beans, db.settings, async () => {
    const [records, beans, selections] = await Promise.all([
      shotId == null ? db.shots.toArray() : db.shots.get(shotId).then((shot) => shot ? [shot] : []),
      db.beans.toArray(),
      readShotSelections(db),
    ]);
    return createPortableShots(records, beans, selections);
  });
}

export function readShotForSharing(db, shotId) {
  return db.transaction('r', db.shots, db.beans, db.settings, async () => {
    const [record, selections] = await Promise.all([
      db.shots.get(shotId),
      readShotSelections(db),
    ]);
    if (!record) return null;

    const referenceId = selections.references.find(({ beanId }) => beanId === record.beanId)?.shotId;
    const [bean, reference] = await Promise.all([
      record.beanId == null ? undefined : db.beans.get(record.beanId),
      referenceId == null || referenceId === shotId ? undefined : db.shots.get(referenceId),
    ]);
    return {
      snapshot: createPortableShots([record], bean ? [bean] : [], selections),
      referenceShot: canReferenceShot(record, bean) && canReferenceShot(reference, bean) ? reference : null,
    };
  });
}
