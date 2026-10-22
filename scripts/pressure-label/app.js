const STEPS = [
  { key: 'hub', label: 'Tap gauge hub centre', color: '#38bdf8' },
  { key: 'tip', label: 'Tap needle tip', color: '#4ade80' },
  { key: 'zero', label: "Tap printed '0' pin (if visible)", color: '#fbbf24' },
  { key: 'five', label: "Tap printed '5' on the arc", color: '#fb923c' },
  { key: 'ten', label: "Tap printed '10' on the arc", color: '#f472b6' },
];

const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get('k') || '';
const apiQ = token ? `?k=${encodeURIComponent(token)}` : '';

const frameEl = $('frame');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const promptEl = $('prompt');
const progressEl = $('progress');
const metaEl = $('meta');

let hosted = false;
let storageKey = 'plabel-labels-v1';
let manifest = [];
let labels = { frames: {} };
let frameIdx = 0;
let stepIdx = 0;

let nw = 0;
let nh = 0;
let fitScale = 1;
let zoom = 1;
let panX = 0;
let panY = 0;
let pointers = new Map();
let pinchStart = null;
let lastTap = 0;

function api(path, opts) {
  return fetch(`${path}${apiQ}`, opts);
}

function setHostedUi(on) {
  for (const el of document.querySelectorAll('.hosted-only')) {
    el.classList.toggle('hidden', !on);
  }
}

async function detectHosted() {
  if (window.PLABEL_CONFIG?.hosted) return true;
  try {
    const r = await fetch(`/api/labels${apiQ}`, { method: 'GET' });
    if (r.ok) return false;
  } catch {
    /* no local labels API */
  }
  return true;
}

async function loadAll() {
  hosted = await detectHosted();
  setHostedUi(hosted);
  if (hosted) {
    storageKey = window.PLABEL_CONFIG?.storageKey || storageKey;
    const manifestPath = window.PLABEL_CONFIG?.manifestPath || 'manifest.json';
    const mRes = await fetch(manifestPath);
    if (!mRes.ok) throw new Error('manifest load failed');
    manifest = await mRes.json();
    try {
      labels = JSON.parse(localStorage.getItem(storageKey) || '{"frames":{}}');
    } catch {
      labels = { frames: {} };
    }
    if (!labels.frames) labels.frames = {};
  } else {
    const [mRes, lRes] = await Promise.all([
      api('/api/manifest'),
      api('/api/labels'),
    ]);
    if (!mRes.ok || !lRes.ok) throw new Error('API failed (check token)');
    manifest = await mRes.json();
    labels = await lRes.json();
    if (!labels.frames) labels.frames = {};
  }
  resumePosition();
  await showFrame(frameIdx);
}

function logTapFireAndForget(frameId, record) {
  fetch('./api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'tap', frameId, record }),
  }).catch(() => {});
}

function emptyRecord(entry) {
  return {
    clip: entry.clip,
    t: entry.t,
    phase: entry.phase,
    hub: null,
    tip: null,
    zero: null,
    five: null,
    ten: null,
    unclear: false,
    updatedAt: null,
  };
}

function frameRecord(entry) {
  const r = labels.frames[entry.id];
  if (!r) return emptyRecord(entry);
  return r;
}

function resumePosition() {
  for (let i = 0; i < manifest.length; i++) {
    const entry = manifest[i];
    const r = labels.frames[entry.id];
    if (!r) {
      frameIdx = i;
      stepIdx = 0;
      return;
    }
    if (r.unclear) continue;
    const nextStep = STEPS.findIndex((s) => r[s.key] === undefined);
    if (nextStep >= 0) {
      frameIdx = i;
      stepIdx = nextStep;
      return;
    }
  }
  frameIdx = Math.max(0, manifest.length - 1);
  stepIdx = 0;
}

async function persist(frameId) {
  const id = frameId || currentEntry()?.id;
  const record = id ? labels.frames[id] : null;
  if (hosted) {
    localStorage.setItem(storageKey, JSON.stringify(labels));
    if (id && record) logTapFireAndForget(id, record);
    return;
  }
  await api('/api/labels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(labels),
  });
}

function frameSrc(entry) {
  if (hosted) {
    const base = window.PLABEL_CONFIG?.framesPath || 'frames';
    return `${base}/${entry.file}`;
  }
  return `/frames/${entry.file}${apiQ}`;
}

function currentEntry() {
  return manifest[frameIdx];
}

function ensureRecord(entry) {
  if (!labels.frames[entry.id]) {
    labels.frames[entry.id] = emptyRecord(entry);
  }
  const r = labels.frames[entry.id];
  r.clip = entry.clip;
  r.t = entry.t;
  r.phase = entry.phase;
  return r;
}

function updateMeta() {
  const e = currentEntry();
  if (!e) return;
  progressEl.textContent = `${frameIdx + 1}/${manifest.length}`;
  metaEl.textContent = `${e.clip} · ${e.phase} · ${e.t.toFixed(1)}s`;
}

function updatePrompt() {
  const e = currentEntry();
  if (!e) return;
  const r = frameRecord(e);
  if (r.unclear) {
    promptEl.textContent = 'Frame marked unclear — use Next';
    return;
  }
  const step = STEPS[stepIdx];
  promptEl.textContent = step
    ? `Step ${stepIdx + 1}/5: ${step.label}`
    : 'Frame complete';
}

function layout() {
  const stage = $('stage');
  const vw = stage.clientWidth;
  const vh = stage.clientHeight;
  if (!nw || !nh) return;
  fitScale = Math.min(vw / nw, vh / nh);
  applyTransform();
  drawOverlay();
}

function applyTransform() {
  const scale = fitScale * zoom;
  const tx = panX;
  const ty = panY;
  const t = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${scale})`;
  frameEl.style.transform = t;
  overlay.style.width = `${nw}px`;
  overlay.style.height = `${nh}px`;
  overlay.style.transform = t;
  overlay.style.left = '50%';
  overlay.style.top = '50%';
  overlay.style.position = 'absolute';
  overlay.width = nw;
  overlay.height = nh;
}

function drawOverlay() {
  ctx.clearRect(0, 0, nw, nh);
  const e = currentEntry();
  if (!e) return;
  const r = frameRecord(e);
  for (const step of STEPS) {
    const pt = r[step.key];
    if (!pt || !Array.isArray(pt)) continue;
    const [x, y] = pt;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(8, nw * 0.008), 0, Math.PI * 2);
    ctx.fillStyle = step.color;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(2, nw * 0.002);
    ctx.strokeStyle = step.color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
}

function clientToImage(clientX, clientY) {
  const stage = $('stage');
  const rect = stage.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const scale = fitScale * zoom;
  const x = (clientX - cx - panX) / scale + nw / 2;
  const y = (clientY - cy - panY) / scale + nh / 2;
  return [x, y];
}

async function showFrame(idx) {
  frameIdx = Math.max(0, Math.min(manifest.length - 1, idx));
  const entry = currentEntry();
  zoom = 1;
  panX = 0;
  panY = 0;
  frameEl.src = frameSrc(entry);
  await new Promise((res, rej) => {
    frameEl.onload = () => res();
    frameEl.onerror = () => rej(new Error('image load failed'));
  });
  nw = frameEl.naturalWidth;
  nh = frameEl.naturalHeight;
  layout();
  updateMeta();
  updatePrompt();
  drawOverlay();
}

function advanceStepOrFrame() {
  const entry = currentEntry();
  const r = ensureRecord(entry);
  if (r.unclear) return;
  if (stepIdx < STEPS.length - 1) {
    stepIdx += 1;
    updatePrompt();
    return;
  }
  if (frameIdx < manifest.length - 1) {
    frameIdx += 1;
    stepIdx = 0;
    showFrame(frameIdx);
  } else {
    updatePrompt();
  }
}

async function placePoint(ix, iy) {
  const entry = currentEntry();
  const r = ensureRecord(entry);
  if (r.unclear) return;
  const step = STEPS[stepIdx];
  if (!step) return;
  const x = Math.round(ix);
  const y = Math.round(iy);
  if (x < 0 || y < 0 || x >= nw || y >= nh) return;
  r[step.key] = [x, y];
  r.updatedAt = new Date().toISOString();
  r.unclear = false;
  await persist(entry.id);
  drawOverlay();
  advanceStepOrFrame();
}

async function skipStep() {
  const entry = currentEntry();
  const r = ensureRecord(entry);
  if (r.unclear) return;
  const step = STEPS[stepIdx];
  if (!step) return;
  r[step.key] = null;
  r.updatedAt = new Date().toISOString();
  await persist(entry.id);
  advanceStepOrFrame();
}

async function undoStep() {
  const entry = currentEntry();
  const r = ensureRecord(entry);
  const step = STEPS[stepIdx];
  if (step && r[step.key] !== undefined && r[step.key] !== null) {
    r[step.key] = undefined;
  } else if (stepIdx > 0) {
    stepIdx -= 1;
    const prev = STEPS[stepIdx];
    if (r[prev.key] !== undefined) r[prev.key] = undefined;
  }
  r.updatedAt = new Date().toISOString();
  await persist(entry.id);
  updatePrompt();
  drawOverlay();
}

async function markUnclear() {
  const entry = currentEntry();
  const r = ensureRecord(entry);
  r.unclear = true;
  r.updatedAt = new Date().toISOString();
  await persist(entry.id);
  updatePrompt();
  if (frameIdx < manifest.length - 1) {
    frameIdx += 1;
    stepIdx = 0;
    await showFrame(frameIdx);
  }
}

async function sendAllLabels() {
  const status = $('send-status');
  status.textContent = 'Sending…';
  status.className = 'send-status';
  try {
    const r = await fetch('./api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'all', labels }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!j.ok) throw new Error('server rejected');
    status.textContent = 'Labels sent successfully';
    status.className = 'send-status send-ok';
  } catch (err) {
    status.textContent = `Send failed (${err.message}). Data kept in browser — tap Send again.`;
    status.className = 'send-status send-err';
  }
}

$('btn-skip-step').addEventListener('click', () => skipStep());
$('btn-undo').addEventListener('click', () => undoStep());
$('btn-unclear').addEventListener('click', () => markUnclear());
$('btn-prev').addEventListener('click', () => {
  if (frameIdx > 0) {
    stepIdx = 0;
    showFrame(frameIdx - 1);
  }
});
$('btn-next').addEventListener('click', () => {
  if (frameIdx < manifest.length - 1) {
    stepIdx = 0;
    showFrame(frameIdx + 1);
  }
});
$('btn-send').addEventListener('click', () => sendAllLabels());

const stage = $('stage');

stage.addEventListener('pointerdown', (ev) => {
  stage.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    pinchStart = { dist, zoom };
  }
});

stage.addEventListener('pointermove', (ev) => {
  if (!pointers.has(ev.pointerId)) return;
  const prev = pointers.get(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2 && pinchStart) {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    zoom = Math.min(6, Math.max(1, pinchStart.zoom * (dist / pinchStart.dist)));
    applyTransform();
    drawOverlay();
    return;
  }
  if (pointers.size === 1 && zoom > 1) {
    panX += ev.clientX - prev.x;
    panY += ev.clientY - prev.y;
    applyTransform();
    drawOverlay();
  }
});

stage.addEventListener('pointerup', (ev) => {
  const was = pointers.get(ev.pointerId);
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0 && was) {
    const moved = Math.hypot(ev.clientX - was.x, ev.clientY - was.y);
    const now = Date.now();
    if (moved < 12) {
      if (now - lastTap < 300) {
        zoom = zoom > 1.25 ? 1 : 2.5;
        if (zoom === 1) {
          panX = 0;
          panY = 0;
        }
        applyTransform();
        drawOverlay();
        lastTap = 0;
      } else {
        lastTap = now;
        const [ix, iy] = clientToImage(ev.clientX, ev.clientY);
        placePoint(ix, iy);
      }
    }
  }
  try {
    stage.releasePointerCapture(ev.pointerId);
  } catch {
    /* ignore */
  }
});

stage.addEventListener('pointercancel', (ev) => {
  pointers.delete(ev.pointerId);
  pinchStart = null;
});

window.addEventListener('resize', () => layout());

loadAll().catch((err) => {
  promptEl.textContent = String(err.message || err);
});
