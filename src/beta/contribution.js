import { diagnosticsBuild } from '../scales/shotDeviceDiagnostics.js';
import { describePortableShot } from '../utils/portableShots.js';
import { extractionTiming, physicalShotSources, recordedShotTiming } from '../utils/shotProfile.js';
import { getGrinderDefinitionById } from '../grinders/grinderRegistry.js';
import { canonicalStringify } from '../grinders/canonicalJson.js';
import { isShotTimestamp } from '../utils/portableShotRestore.js';

export const CONTRIBUTION_FORMAT = 'espresso-dial-in/beta-contribution';
export const MAX_CONTRIBUTION_BYTES = 8 * 1024 * 1024;
const number = (value) => Number.isFinite(value) ? value : null;
const bool = (value) => typeof value === 'boolean' ? value : null;
const choice = (value, list) => list.includes(value) ? value : null;
const version = (value) => typeof value === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value) ? value : null;
const dial = (value) => typeof value === 'string' && /^[\d. -]{0,9}[A-I]?[\d. -]{0,9}$/i.test(value) && value.trim()
  ? value : number(value);
const taste = ['very_sour', 'sour', 'good', 'balanced', 'bitter', 'very_bitter'];
const roast = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark', 'light', 'medium-light', 'medium', 'medium-dark', 'dark'];
const machine = ['Flair 58', 'Flair 58+', 'Flair 58 Plus', 'Sunbeam Barista Max', 'Breville Barista Express'];
const prep = ['Espresso', 'espresso', 'Flair', ...machine];
const timingKeys = ['pressureOriginMs', 'scaleOriginMs', 'extractionStartMs', 'extractionEndMs', 'stopMs',
  'settlementEndMs', 'clockDriftMs'];
const flairKeys = ['waterTempC', 'preinfusion', 'preinfusionPressure', 'preinfusionTime',
  'preinfusionEndWeightG', 'extraction', 'rampDown'];
const flairTriggers = ['manual', 'time', 'weight'];
const measurement = (value, source = 'unknown') => ({ value, source: value == null ? 'unavailable' : source });
const pickNumbers = (record, keys) => Object.fromEntries(keys.map((key) => [key, number(record?.[key])]));
const numericInput = (value) => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())
  ? number(Number(value)) : number(value);
const fingerprint = async (body) => {
  const bytes = new TextEncoder().encode(canonicalStringify(body));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

function sanitizedSeries(samples, description, field, acceptedSource) {
  const points = Array.isArray(samples) && description.source !== 'simulated'
    ? Array.from(samples, (sample) => ({ tS: number(sample?.tS), [field]: number(sample?.[field]),
      confident: bool(sample?.confident), breakBefore: bool(sample?.breakBefore),
      gap: bool(sample?.gap), reset: bool(sample?.reset) }))
    : [];
  const inconsistentTimes = points.some(({ tS }, i) => tS === null || tS < 0
    || (i > 0 && points[i - 1].tS !== null && tS <= points[i - 1].tS));
  const hasObservations = points.length > 0 && description.observedIndices.length > 0;
  return {
    source: description.source === 'simulated' ? 'simulation-excluded'
      : !hasObservations ? 'unavailable' : acceptedSource ?? 'unknown',
    clock: description.alignment,
    originMs: description.originMs,
    points,
    observedIndices: points.length ? description.observedIndices : [],
    gapBeforeIndices: points.length ? description.gapBeforeIndices : [],
    inconsistentTimes,
  };
}

const setting = (record) => ({
  macro: number(record?.macro), micro: choice(record?.micro, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']),
  setting: dial(record?.setting), customGrindValue: dial(record?.customGrindValue), nicheZeroSetting: dial(record?.nicheZeroSetting),
});

export function describeContributionShot(shot, bean) {
  const timing = recordedShotTiming(shot);
  const physical = physicalShotSources(timing);
  const described = describePortableShot(shot);
  const { doseG, yieldG, durationS, ratio, rating } = described.measurements;
  const pressure = sanitizedSeries(shot.labPressureCurve, described.pressure, 'bar', physical.pressure ? 'camera' : null);
  const weight = sanitizedSeries(shot.scaleFlowCurve, described.weight, 'weightG', physical.scale ? timing.scaleSource : null);
  const extraction = extractionTiming(timing);
  const flowIntervals = weight.points.length ? described.flow.intervals : [];
  const yieldSource = timing?.yieldSource === 'manual' ? 'manual'
    : timing?.yieldSource === 'scale' && physical.scale ? 'physically-measured' : 'unknown';
  const simulatedYield = timing?.scaleSource === 'simulated' && timing?.yieldSource === 'scale';
  const measurements = {
    doseG: measurement(doseG), yieldG: measurement(simulatedYield ? null : yieldG, yieldSource), durationS: measurement(durationS),
    ratio: measurement(simulatedYield ? null : ratio, 'calculated'),
    recordedExtractionS: measurement(extraction?.durationS ?? null, 'calculated'),
  };
  const missing = ['doseG', 'yieldG', 'durationS'].filter((key) => measurements[key].value == null);
  const recommendation = shot.recommendation;
  return {
    measurements,
    grinder: { model: getGrinderDefinitionById(shot.grinderModel) ? shot.grinderModel : null,
      ...setting({ macro: shot.setteMacro, micro: shot.setteMicro,
        setting: shot.sunbeamSetting, customGrindValue: shot.customGrindValue, nicheZeroSetting: shot.nicheZeroSetting }) },
    preparation: {
      machine: choice(shot.machineModel, machine), method: choice(shot.preparationMethod, prep),
      wasPurged: bool(shot.wasPurged),
      ...pickNumbers(shot, ['brewTemperatureC', 'targetDoseG', 'targetYieldG', 'targetTimeMinS', 'targetTimeMaxS']),
      flair: shot.flairProfile ? {
        ...Object.fromEntries(flairKeys.map((key) => [key, numericInput(shot.flairProfile[key])])),
        preinfusionEndTrigger: choice(shot.flairProfile.preinfusionEndTrigger, flairTriggers),
      } : null,
    },
    bean: { roast: choice(bean?.roastType, roast), decaf: bool(bean?.isDecaf), ageDays: number(shot.beanAgeDays),
      storage: choice(shot.storageType ?? bean?.storageType, ['bag', 'frozen', 'airtight', 'vacuum', 'jar']) },
    feedback: { rating, taste: choice(shot.tasteProfile, taste), excludeFromLearning: bool(shot.excludeFromLearning) },
    recommendation: {
      // The recommendation saved on this row is the output for the *next* shot.
      nextSetting: recommendation?.recommendedSetting ? setting(recommendation.recommendedSetting) : null,
      previousRecommendationFollowed: bool(shot.recommendationFollowed),
      shift: number(recommendation?.engineStats?.shift),
      estimatedSensitivity: bool(recommendation?.engineStats?.sensitivityIsDefault),
      algorithmVersion: version(shot.algorithmVersion ?? recommendation?.algorithmVersion),
      recordingAppVersion: version(shot.recordingAppVersion),
    },
    sensors: {
      pressure, weight,
      flow: { source: flowIntervals.length ? 'calculated-from-weight' : 'unavailable', intervals: flowIntervals },
      timing: timing ? { ...pickNumbers(timing, timingKeys), scaleInterrupted: bool(timing.scaleInterrupted) } : null,
    },
    quality: { missingMeasurements: missing, incomplete: missing.length > 0,
      savedTimestampValid: isShotTimestamp(shot.timestamp),
      pressureGaps: pressure.gapBeforeIndices.length, weightGaps: weight.gapBeforeIndices.length,
      inconsistentTiming: pressure.inconsistentTimes || weight.inconsistentTimes
        || (Number.isFinite(timing?.extractionStartMs) && Number.isFinite(timing?.extractionEndMs)
          && timing.extractionEndMs < timing.extractionStartMs) },
  };
}

export async function createContribution(shots, beans, { testerId = '' } = {}) {
  const tester = testerId.trim();
  if (tester && !/^[a-z0-9_-]{1,32}$/i.test(tester)) throw new Error('Use up to 32 letters, digits, hyphens or underscores for your tester ID.');
  if (!shots.length) throw new Error('Select at least one saved shot.');
  const byId = new Map(beans.map((bean) => [bean.id, bean]));
  const seen = new Set();
  const records = [];
  let size = 2048;
  const encoder = new TextEncoder();
  for (const shot of shots) {
    const body = describeContributionShot(shot, byId.get(shot.beanId));
    const contentSha256 = await fingerprint(body);
    const entry = { ...body, contentSha256, possibleDuplicateInFile: seen.has(contentSha256) };
    seen.add(contentSha256);
    size += encoder.encode(JSON.stringify(entry, null, 2)).length + 64;
    if (size > MAX_CONTRIBUTION_BYTES) throw new Error('This contribution exceeds 8 MiB. Select a smaller group of shots.');
    records.push(entry);
  }
  return {
    format: CONTRIBUTION_FORMAT, version: 1, dataCompatibilityVersion: 1, exportId: crypto.randomUUID(),
    exportedAt: new Date().toISOString(), exportBuild: diagnosticsBuild, ...(tester && { testerId: tester }), records,
  };
}

const finiteOrNull = (value) => value === null || Number.isFinite(value);
const booleanOrNull = (value) => value === null || typeof value === 'boolean';
const versionOrNull = (value) => value === null || Boolean(version(value));
const knownOrNull = (list) => (value) => value === null || list.includes(value);
const nonnegativeInt = (value) => Number.isSafeInteger(value) && value >= 0;
const isBool = (value) => typeof value === 'boolean';
const exact = (value, fields) => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === Object.keys(fields).length
  && Object.entries(fields).every(([key, check]) => Object.hasOwn(value, key) && check(value[key])));
const numericFields = (fields) => Object.fromEntries(fields.map((key) => [key, finiteOrNull]));
const units = ['doseG', 'yieldG', 'durationS', 'ratio', 'recordedExtractionS'];
const sources = ['physically-measured', 'manual', 'calculated', 'estimated', 'unknown', 'unavailable'];
const storageKinds = ['bag', 'frozen', 'airtight', 'vacuum', 'jar'];
const dialField = (value) => value === null || dial(value) !== null;
const grinderFields = {
  macro: finiteOrNull, micro: knownOrNull(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']),
  setting: dialField, customGrindValue: dialField, nicheZeroSetting: dialField,
};
const settingsCheck = (value) => value === null || exact(value, grinderFields);
const measureCheck = (value) => exact(value, { value: finiteOrNull, source: (source) => sources.includes(source) })
  && (value.value === null) === (value.source === 'unavailable');
const sortedIndices = (values, limit) => Array.isArray(values) && values.every((n, i) =>
  nonnegativeInt(n) && n < limit && (i === 0 || n > values[i - 1]));
const checkSeries = (valueKey, physicalSources) => (value) => {
  const sample = (point) => exact(point, { tS: finiteOrNull, [valueKey]: finiteOrNull,
    confident: booleanOrNull, breakBefore: booleanOrNull, gap: booleanOrNull, reset: booleanOrNull });
  if (!exact(value, {
    source: (source) => [...physicalSources, 'unknown', 'unavailable', 'simulation-excluded'].includes(source),
    clock: (clock) => ['recorded-extraction', 'sensor-local'].includes(clock), originMs: finiteOrNull,
    points: (points) => Array.isArray(points) && points.every(sample),
    observedIndices: (indices) => sortedIndices(indices, value.points?.length),
    gapBeforeIndices: (indices) => sortedIndices(indices, value.points?.length),
    inconsistentTimes: isBool,
  })) return false;
  const observed = new Set(value.observedIndices);
  return value.gapBeforeIndices.every((index) => observed.has(index))
    && value.observedIndices.every((index) => Number.isFinite(value.points[index].tS)
      && Number.isFinite(value.points[index][valueKey]) && value.points[index].confident !== false)
    && (['unavailable', 'simulation-excluded'].includes(value.source) === !observed.size)
    && (value.source !== 'simulation-excluded' || value.points.length === 0);
};

function validBody(body) {
  return exact(body, {
    measurements: (value) => exact(value, Object.fromEntries(units.map((key) => [key, measureCheck]))),
    grinder: (value) => exact(value, { ...grinderFields,
      model: (model) => model === null || (typeof model === 'string' && Boolean(getGrinderDefinitionById(model))) }),
    preparation: (value) => exact(value, { machine: knownOrNull(machine), method: knownOrNull(prep), wasPurged: booleanOrNull,
      ...numericFields(['brewTemperatureC', 'targetDoseG', 'targetYieldG', 'targetTimeMinS', 'targetTimeMaxS']),
      flair: (profile) => profile === null || exact(profile,
        { ...numericFields(flairKeys), preinfusionEndTrigger: knownOrNull(flairTriggers) }) }),
    bean: (value) => exact(value, { roast: knownOrNull(roast), decaf: booleanOrNull, ageDays: finiteOrNull,
      storage: knownOrNull(storageKinds) }),
    feedback: (value) => exact(value, { rating: knownOrNull([1, 2, 3, 4, 5]), taste: knownOrNull(taste), excludeFromLearning: booleanOrNull }),
    recommendation: (value) => exact(value, { nextSetting: settingsCheck, previousRecommendationFollowed: booleanOrNull,
      shift: finiteOrNull, estimatedSensitivity: booleanOrNull, algorithmVersion: versionOrNull, recordingAppVersion: versionOrNull }),
    sensors: (value) => exact(value, {
      pressure: checkSeries('bar', ['camera']), weight: checkSeries('weightG', ['web-bluetooth', 'native-ble']),
      flow: (flow) => exact(flow, {
        source: (source) => source === 'unavailable' || source === 'calculated-from-weight',
        intervals: (items) => Array.isArray(items) && (items.length > 0) === (flow.source === 'calculated-from-weight')
          && items.every((item) => exact(item, { fromTS: Number.isFinite, tS: Number.isFinite,
            flowGs: Number.isFinite, breakBefore: isBool }) && item.tS > item.fromTS),
      }),
      timing: (timing) => timing === null || exact(timing, { ...numericFields(timingKeys), scaleInterrupted: booleanOrNull }),
    }),
    quality: (value) => exact(value, {
      missingMeasurements: (items) => Array.isArray(items)
        && items.join(',') === ['doseG', 'yieldG', 'durationS']
          .filter((key) => body.measurements[key].value === null).join(',')
        && items.every((item) => typeof item === 'string' && units.includes(item)),
      incomplete: (flag) => flag === (value.missingMeasurements.length > 0),
      savedTimestampValid: isBool, pressureGaps: (count) => count === body.sensors.pressure.gapBeforeIndices.length,
      weightGaps: (count) => count === body.sensors.weight.gapBeforeIndices.length, inconsistentTiming: isBool,
    }),
  });
}

export async function validateContribution(document) {
  const allowedKeys = ['format', 'version', 'dataCompatibilityVersion', 'exportId', 'exportedAt', 'exportBuild', 'testerId', 'records'];
  if (document?.format !== CONTRIBUTION_FORMAT || document.version !== 1 || document.dataCompatibilityVersion !== 1
    || !Object.keys(document).every((key) => allowedKeys.includes(key))
    || typeof document.exportId !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(document.exportId)
    || !isShotTimestamp(document.exportedAt)
    || (document.testerId != null && (typeof document.testerId !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(document.testerId)))
    || !exact(document.exportBuild, { appVersion: versionOrNull, gitSha: (sha) => sha === null
      || (typeof sha === 'string' && /^[\da-f]{40}$/i.test(sha)) })
    || !Array.isArray(document.records) || !document.records.length) throw new Error('Unsupported contribution document.');
  const known = new Set();
  for (const record of document.records) {
    const { contentSha256, possibleDuplicateInFile, ...body } = record ?? {};
    if (!validBody(body)
      || typeof contentSha256 !== 'string' || !/^[\da-f]{64}$/.test(contentSha256)
      || contentSha256 !== await fingerprint(body) || possibleDuplicateInFile !== known.has(contentSha256)) {
      throw new Error('Contribution record structure, checksum or duplicate flag is invalid.');
    }
    known.add(contentSha256);
  }
  return { records: document.records.length, distinctFingerprints: known.size };
}
