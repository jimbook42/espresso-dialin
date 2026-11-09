export const PRESSURE_SHOT_TYPE = 'standalone-pressure';

export function isStandalonePressureShot(shot) {
  return shot?.recordType === PRESSURE_SHOT_TYPE;
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function buildStandalonePressureShot({ id, timestamp, durationS, pressure, scale, details }) {
  const curve = pressure?.labPressureCurve?.filter(({ tS, bar }) =>
    Number.isFinite(tS) && tS >= 0 && Number.isFinite(bar));
  if (!curve?.length || !Number.isFinite(durationS) || durationS < 0) return null;
  const dose = positiveNumber(details.dose);
  const weight = details.yield === '' ? null : Number(details.yield);
  const yieldG = Number.isFinite(weight) && weight >= 0 ? weight : null;
  const rating = Number(details.rating);
  const name = details.name.trim();
  const notes = details.notes.trim();
  return {
    id,
    timestamp,
    recordType: PRESSURE_SHOT_TYPE,
    actualTimeS: durationS,
    labPressureCurve: curve,
    labPressurePeakBar: curve.reduce((peak, { bar }) => Math.max(peak, bar), curve[0].bar),
    ...(pressure.labGaugeSnapshotJpeg ? { labGaugeSnapshotJpeg: pressure.labGaugeSnapshotJpeg } : {}),
    ...(scale?.scaleFlowCurve?.length ? {
      scaleFlowCurve: scale.scaleFlowCurve,
      scaleFlowRateGs: scale.scaleFlowRateGs,
    } : {}),
    ...(name ? { shotName: name } : {}),
    ...(notes ? { notes } : {}),
    ...(dose != null ? { actualDoseG: dose } : {}),
    ...(yieldG != null ? { actualYieldG: yieldG } : {}),
    ...(dose != null && yieldG > 0 ? { brewRatio: `1:${(yieldG / dose).toFixed(1)}` } : {}),
    ...(Number.isInteger(rating) && rating >= 1 && rating <= 5 ? { shotRating: rating } : {}),
  };
}
