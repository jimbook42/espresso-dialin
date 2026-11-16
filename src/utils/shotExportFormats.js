import { buildShotsCsvContent, buildShotsCsvRows, formatCsvRow, SHOT_CSV_HEADERS } from './csvExport.js';
import { isShotTimestamp } from './portableShotRestore.js';

const SEP_HEADER = 'information_type,elapsed,pressure,current_total_shot_weight,flow_in,flow_out,water_temperature_boiler,water_temperature_in,water_temperature_basket,metatype,metadata,comment';
const finite = Number.isFinite;

export function shotSummaryCsv(snapshot, helpers) {
  const rows = buildShotsCsvRows(snapshot.shots.map(({ record, measurements }) => ({
    ...record,
    actualDoseG: measurements.doseG,
    actualYieldG: measurements.yieldG,
    actualTimeS: measurements.durationS,
    brewRatio: measurements.ratio == null ? '' : record.brewRatio || '1:' + measurements.ratio,
  })), { ...helpers, beans: snapshot.beans });
  return buildShotsCsvContent(SHOT_CSV_HEADERS, rows);
}

export function buildSepShotFile(shot, { bean, grind } = {}) {
  const { record, measurements, pressure, weight } = shot;
  const tracks = [
    { info: weight, samples: record.scaleFlowCurve, valueKey: 'weightG', source: 'web-bluetooth', label: 'weight' },
    { info: pressure, samples: record.labPressureCurve, valueKey: 'bar', source: 'camera', label: 'pressure' },
  ].filter(({ info, source }) => info.source === source && info.observedIndices.length);
  if (!isShotTimestamp(record.timestamp)) return { reason: 'The saved shot date is unavailable.' };
  if (!tracks.length) return { reason: 'No pressure or weight samples with confirmed physical sensor provenance.' };
  const aligned = tracks.every(({ info }) => info.alignment === 'recorded-extraction');
  if (tracks.length > 1 && !aligned) {
    return { reason: 'The pressure and scale clocks could not be aligned.' };
  }
  const baseMs = aligned
    ? Math.min(record.shotProfileTiming.extractionStartMs, ...tracks.map(({ info }) => info.originMs))
    : 0;
  const series = tracks.map(({ info, samples, valueKey, label }) => {
    const offsetS = aligned ? (info.originMs - baseMs) / 1000 : 0;
    return info.observedIndices.map((index) => {
      const sample = samples[index];
      return { elapsed: sample.tS + offsetS, value: sample[valueKey], label };
    }).sort((left, right) => left.elapsed - right.elapsed);
  });
  const points = series.flat().sort((left, right) => left.elapsed - right.elapsed);
  if (points[0].elapsed < 0 || points.some(({ elapsed }) => !finite(elapsed))) {
    return { reason: 'Some recorded sample times cannot be represented in SEP CSV.' };
  }
  if (series.some((items) => items.some((point, index) => point.elapsed === items[index - 1]?.elapsed))) {
    return { reason: 'Repeated timestamps would discard samples in the Visualizer parser.' };
  }
  // Visualizer's SEP parser uses the densest track to choose a step and rejects zero or oversized grids.
  const primary = series.reduce((longest, items) => items.length > longest.length ? items : longest);
  const step = (primary.at(-1).elapsed - primary[0].elapsed) / primary.length;
  if (!step || (points.at(-1).elapsed - points[0].elapsed) / step > 20_000) {
    return { reason: 'The recording is too sparse for the Visualizer SEP parser.' };
  }

  const metadata = [
    ['Name', record.shotName, 'text'],
    ['Date', record.timestamp, 'ISO8601 formatted date'],
    ['Roastery', bean?.roaster, 'text'],
    ['Beans', bean?.name, 'text'],
    ['Roasting Date', bean?.roastDate, 'text'],
    ['Grinder Model', record.grinderModel, 'text'],
    ['Grinder Setting', grind, 'text'],
    ['Dose', measurements.doseG, 'grounds weight in g'],
    ['Weight', measurements.yieldG, 'beverage weight in g'],
    ['Extraction time', measurements.durationS, 'sec'],
    ['Unit system', 'metric', 'metric or imperial'],
    ['Software', 'Espresso Dial-In', 'text'],
  ].filter(([, value]) => value != null && value !== '')
    .map(([name, value, comment]) => formatCsvRow(['meta', '', '', '', '', '', '', '', '', name, value, comment]));
  const rows = points.map(({ elapsed, value, label }) => formatCsvRow([
    'moment', elapsed, label === 'pressure' ? value : '', label === 'weight' ? value : '',
    '', '', '', '', '', '', '', 'sample: ' + label,
  ]));
  const csv = [SEP_HEADER, ...metadata, ...rows].join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  if (blob.size > 10_000_000) return { reason: 'The CSV exceeds the Visualizer upload file limit.' };
  return { csv, blob, tracks: tracks.map(({ label }) => label) };
}

const inRange = (value, max) => finite(value) && value >= 0 && value <= max;

export function beanconquerorBrew(shot, bean) {
  const { record, measurements } = shot;
  const missing = [];
  if (!inRange(record.waterInMl, 100_000)) missing.push('recorded water input');
  if (!inRange(measurements.yieldG, 100_000)) missing.push('recorded beverage output');
  if (!inRange(measurements.durationS, 86_400)) missing.push('extraction time');
  if (!isShotTimestamp(record.timestamp, 3)) missing.push('compatible brew date');
  const preparationMethod = record.preparationMethod?.trim();
  if (!preparationMethod || preparationMethod.length > 512) missing.push('preparation method');
  if (missing.length) return { missing };
  const name = bean?.name?.trim();
  return {
    envelope: {
      v: 1,
      app: { name: 'Espresso Dial-In' },
      brew: {
        date: record.timestamp,
        ...(inRange(measurements.doseG, 200) ? { doseIn: { value: measurements.doseG, unit: 'g' } } : {}),
        waterIn: { value: record.waterInMl, unit: 'ml' },
        beverageOut: { value: measurements.yieldG, unit: 'g' },
        brewTime: measurements.durationS,
        preparationMethod,
      },
      ...(name && name.length <= 512 ? { bean: { name } } : {}),
      imported: { source: 'espresso-dial-in', sourceName: 'Espresso Dial-In', schema: 1 },
    },
  };
}

export function beanconquerorBatch(snapshot) {
  if (snapshot.shots.length < 1 || snapshot.shots.length > 50) {
    return { reason: 'Beanconqueror batches require 1 to 50 brews.' };
  }
  const beans = new Map(snapshot.beans.map((bean) => [bean.id, bean]));
  const brews = [];
  const incompatible = [];
  for (const shot of snapshot.shots) {
    const result = beanconquerorBrew(shot, beans.get(shot.record.beanId));
    if (result.envelope) brews.push(result.envelope);
    else incompatible.push({ id: shot.record.id, missing: result.missing });
  }
  return incompatible.length ? { incompatible } : { envelope: { v: 1, brews } };
}
