const KEY = 'espresso-dialin.beta-diagnostics.v1';
export const MAX_EVENTS = 120;
export const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Only these codes can reach persistent storage or a report.
const allowed = {
  app: ['started', 'hidden', 'visible', 'page-hidden', 'page-restored', 'launch-failed'],
  javascript: ['error', 'rejection'],
  camera: ['idle', 'requesting', 'live', 'interrupted', 'error', 'permission-denied', 'unavailable'],
  tracking: ['inactive', 'loading', 'ready', 'uncertain', 'reader-error', 'reading'],
  ble: ['pairing', 'reconnecting', 'connected', 'disconnected', 'failed', 'cancelled',
    'permission-unavailable', 'initialization-failed', 'disabled', 'peripheral-selected'],
};
const errorNames = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'AbortError',
  'NotAllowedError', 'NotFoundError', 'NotReadableError', 'SecurityError', 'InvalidStateError', 'QuotaExceededError'];

function filterEvent(event, now) {
  if (typeof event?.area !== 'string' || !Object.hasOwn(allowed, event.area) || !allowed[event.area].includes(event.code)
    || !Number.isSafeInteger(event.at) || event.at < now - EVENT_TTL_MS || event.at > now) return null;
  return { at: event.at, area: event.area, code: event.code,
    ...(event.area === 'javascript' && { kind: errorNames.includes(event.kind) ? event.kind : 'unknown' }) };
}

export function redactDiagnosticEvents(events) {
  return (Array.isArray(events) ? events : []).slice(-MAX_EVENTS).flatMap((event) => {
    const { ageSeconds, area, code, kind } = event ?? {};
    if (!Number.isSafeInteger(ageSeconds) || ageSeconds < 0 || ageSeconds > EVENT_TTL_MS / 1000) return [];
    const safe = filterEvent({ at: 0, area, code, kind }, 0);
    if (!safe) return [];
    return [{ area: safe.area, code: safe.code, ...(safe.kind && { kind: safe.kind }), ageSeconds }];
  });
}

export function createDiagnosticLog(storage, clock = Date.now) {
  let entries = [];
  let canStore = Boolean(storage);
  const read = (now) => {
    try {
      const raw = canStore ? storage.getItem(KEY) : null;
      // Ignore corrupt or oversized legacy storage without parsing it.
      if (raw && raw.length <= 24_000) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) entries = saved;
      }
    } catch { /* Storage is optional. */ }
    entries = entries.map((event) => filterEvent(event, now)).filter(Boolean).slice(-MAX_EVENTS);
    return entries;
  };
  const write = () => {
    try { if (canStore) storage.setItem(KEY, JSON.stringify(entries)); } catch { canStore = false; }
  };
  return {
    record(area, code, kind) {
      const now = clock();
      const item = filterEvent({ at: now, area, code, kind }, now);
      if (!item) return;
      const recent = read(now);
      const last = recent.at(-1);
      if (last?.area === area && last.code === code && last.kind === item.kind && now - last.at < 2000) return;
      entries = [...recent, item].slice(-MAX_EVENTS);
      write();
    },
    snapshot() {
      const now = clock();
      read(now);
      write(); // Prune expired on inspection as well as on each event.
      return entries.map(({ at, ...item }) => ({ ...item, ageSeconds: Math.floor((now - at) / 1000) }));
    },
    clear() {
      entries = [];
      write();
    },
  };
}

let log;
function getLog() {
  if (!log) {
    let storage;
    try { storage = globalThis.localStorage; } catch { /* Private browsing. */ }
    log = createDiagnosticLog(storage);
  }
  return log;
}

export const recordDiagnostic = (area, code, kind) => getLog().record(area, code, kind);
export const recentDiagnostics = () => getLog().snapshot();
export const clearDiagnostics = () => getLog().clear();

export function observeDiagnosticLifecycle(win, doc, record = recordDiagnostic) {
  const error = (event) => record('javascript', 'error', event.error?.name);
  const rejection = (event) => record('javascript', 'rejection', event.reason?.name);
  const visibility = () => record('app', doc.hidden ? 'hidden' : 'visible');
  const hide = () => record('app', 'page-hidden');
  const show = (event) => { if (event.persisted) record('app', 'page-restored'); };
  const listeners = [[win, 'error', error], [win, 'unhandledrejection', rejection],
    [doc, 'visibilitychange', visibility], [win, 'pagehide', hide], [win, 'pageshow', show]];
  for (const [target, name, listener] of listeners) target.addEventListener(name, listener);
  record('app', 'started');
  return () => {
    for (const [target, name, listener] of listeners) target.removeEventListener(name, listener);
  };
}
