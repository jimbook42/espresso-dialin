import { buildShotProfile } from './shotProfile.js';

export const CARD_WIDTH = 1200;
export const CARD_BRAND = 'ESPRESSO DIAL-IN';

// The same canvas is used for the preview and the exported PNG.
export function drawShotCard(canvas, { shot, bean, grind, referenceShot, options }) {
  const entries = [{ shot, bean, grind, title: referenceShot ? 'YOUR SHOT' : 'SHOT PROFILE' },
    ...(referenceShot ? [{ shot: referenceShot, bean, grind: referenceShot.grinderModel, title: 'BEAN REFERENCE' }] : [])];
  const profiles = entries.map(({ shot: item }) => buildShotProfile({
    ...item,
    labPressureCurve: item.labPressureCurve?.map((point) => point?.gap ? { ...point, breakBefore: true } : point),
    scaleFlowCurve: item.scaleFlowCurve?.map((point) => point?.gap ? { ...point, breakBefore: true } : point),
  }));
  const tracks = profiles.map((p) => [
    { label: 'PRESSURE', unit: 'bar', points: p.pressure, key: 'bar', color: '#cf8250' },
    { label: 'WEIGHT', unit: 'g', points: p.weight, key: 'weightG', color: '#739c82' },
    { label: 'FLOW (SMOOTHED)', unit: 'g/s', points: p.flow, key: 'flowGs', color: '#8294bd' },
  ].filter((t) => t.points.length));
  const sectionHeight = (i) => 340 + tracks[i].length * 180 + (options.notes && entries[i].shot.notes ? 100 : 0);
  canvas.width = CARD_WIDTH;
  canvas.height = 170 + entries.reduce((sum, _, i) => sum + sectionHeight(i), 0) + 65;
  const ctx = canvas.getContext('2d');
  const text = (s, x, y, size, color = '#f9f4eb', weight = 400, max = 1060) => {
    ctx.font = `${weight} ${size}px sans-serif`; ctx.fillStyle = color;
    let value = String(s ?? '');
    while (ctx.measureText(value).width > max && value.length > 1) value = value.slice(0, -2) + '…';
    ctx.fillText(value, x, y);
  };
  ctx.fillStyle = '#171b19'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#d3925b'; ctx.fillRect(70, 65, 52, 5);
  text(options.brand ? CARD_BRAND : 'ESPRESSO', 70, 115, 25, '#d6a77e', 700);
  text(referenceShot ? 'A shot & its reference' : 'A moment in the cup', 70, 158, 40, '#fff9f1', 700);
  let y = 210;
  entries.forEach((entry, i) => {
    const p = profiles[i];
    ctx.fillStyle = '#242b27'; ctx.fillRect(50, y - 20, 1100, sectionHeight(i) - 15);
    text(entry.title, 80, y + 20, 22, '#d6a77e', 700);
    text(options.bean && entry.bean?.name ? entry.bean.name : 'Espresso shot', 80, y + 65, 36, '#fff9f1', 700, 1030);
    const details = [];
    if (options.grinder && entry.grind) details.push(entry.grind);
    if (options.date && entry.shot.timestamp) {
      const d = new Date(entry.shot.timestamp); if (!Number.isNaN(d.valueOf())) details.push(d.toLocaleDateString());
    }
    text(details.join('  ·  '), 80, y + 101, 21, '#c7cfc8');
    const metrics = [['DOSE', p.doseG, 'g'], ['YIELD', p.yieldG, 'g'], ['TIME', p.durationS, 's'], ['RATIO', p.ratio, '']];
    metrics.forEach(([label, value, unit], n) => {
      const x = 80 + n * 260;
      text(label, x, y + 150, 19, '#9eaea3', 700);
      text(value == null ? '—' : label === 'RATIO' ? `1:${value.toFixed(1)}` : `${value.toFixed(1)} ${unit}`, x, y + 188, 30, '#fff9f1', 700, 230);
    });
    let chartY = y + 230;
    tracks[i].forEach((track) => {
      const left = 165, right = 1080, top = chartY + 20, bottom = chartY + 125;
      const origin = p.aligned ? p.extractionStartS : 0;
      const comparable = referenceShot && profiles.every((profile) => profile.aligned);
      const matching = comparable ? tracks.flatMap((group, j) => group.filter((item) => item.key === track.key)
        .map((item) => ({ points: item.points, origin: profiles[j].extractionStartS }))) : [{ points: track.points, origin }];
      const minT = Math.min(0, ...matching.map((item) => item.points[0].tS - item.origin));
      const maxT = Math.max(minT + 1, ...matching.map((item) => item.points.at(-1).tS - item.origin));
      const [minV, maxV] = track.points.reduce(([low, high], point) =>
        [Math.min(low, point[track.key]), Math.max(high, point[track.key])], [0, 1]);
      text(track.label, 80, chartY + 10, 15, track.color, 700, 1000);
      text(`${maxV.toFixed(1)} ${track.unit}`, 80, chartY + 53, 16, '#c7cfc8');
      text(`${minV.toFixed(1)}`, 80, bottom, 16, '#c7cfc8');
      ctx.strokeStyle = '#516057'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
      ctx.strokeStyle = track.color; ctx.fillStyle = track.color; ctx.lineWidth = 4; ctx.beginPath();
      track.points.forEach((point, n) => {
        const x = left + (point.tS - origin - minT) / (maxT - minT) * (right - left);
        const py = bottom - (point[track.key] - minV) / (maxV - minV) * (bottom - top);
        if (!n || point.breakBefore) ctx.moveTo(x, py); else ctx.lineTo(x, py);
      });
      ctx.stroke();
      // Dots preserve isolated observations, including zero-valued samples.
      track.points.forEach((point) => { const x = left + (point.tS - origin - minT) / (maxT - minT) * (right - left); const py = bottom - (point[track.key] - minV) / (maxV - minV) * (bottom - top); ctx.beginPath(); ctx.arc(x, py, 3, 0, Math.PI * 2); ctx.fill(); });
      text(`${minT.toFixed(1)} s`, left, bottom + 26, 16, '#c7cfc8');
      text(`${maxT.toFixed(1)} s`, right - 65, bottom + 26, 16, '#c7cfc8');
      chartY += 180;
    });
    if (!tracks[i].length) text('Manual shot · no sensor curves recorded', 80, chartY + 30, 21, '#c7cfc8');
    if (tracks[i].length) text(p.aligned ? 'Time from extraction start' : 'Sensor recording time · alignment uncertain', 80, chartY + 15, 17, '#c7cfc8');
    if (options.notes && entry.shot.notes) text(`Notes: ${entry.shot.notes.replace(/\s+/g, ' ')}`, 80, chartY + 60, 20, '#c7cfc8');
    y += sectionHeight(i);
  });
  if (options.brand) text(CARD_BRAND, 70, canvas.height - 35, 18, '#9eaea3', 700);
  return canvas;
}
