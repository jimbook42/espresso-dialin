/**
 * Last Lab shot replay clip + tracker samples — separate IndexedDB (not EspressoDialDB).
 */

const DB_NAME = 'EspressoDialLabReplay';
const DB_VERSION = 1;
const STORE = 'lastReplay';
const RECORD_KEY = 'last';

/**
 * @typedef {{
 *   shotId: string,
 *   mimeType: string,
 *   videoW: number,
 *   videoH: number,
 *   durationS: number,
 *   byteSize: number,
 *   samples: import('./shotReplaySampleLogger.js').ShotReplaySample[],
 *   savedAt: string,
 * }} LabShotReplayMeta
 */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error('replay db open failed'));
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * @param {{ shotId: string, blob: Blob, mimeType: string, videoW: number, videoH: number, durationS: number, samples: import('./shotReplaySampleLogger.js').ShotReplaySample[] }} payload
 */
export async function saveLastLabShotReplay(payload) {
  const { shotId, blob, mimeType, videoW, videoH, durationS, samples } = payload;
  const db = await openDb();
  const record = {
    shotId,
    mimeType,
    videoW,
    videoH,
    durationS,
    byteSize: blob.size,
    samples,
    savedAt: new Date().toISOString(),
    blob,
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record, RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** @returns {Promise<LabShotReplayMeta | null>} */
export async function loadLastLabShotReplayMeta() {
  const db = await openDb();
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(RECORD_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!record?.shotId) return null;
  return {
    shotId: record.shotId,
    mimeType: record.mimeType,
    videoW: record.videoW,
    videoH: record.videoH,
    durationS: record.durationS,
    byteSize: record.byteSize,
    samples: record.samples || [],
    savedAt: record.savedAt,
  };
}

/** @returns {Promise<{ meta: LabShotReplayMeta, blob: Blob } | null>} */
export async function loadLastLabShotReplayWithBlob() {
  const db = await openDb();
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(RECORD_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!record?.blob || !record.shotId) return null;
  const meta = {
    shotId: record.shotId,
    mimeType: record.mimeType,
    videoW: record.videoW,
    videoH: record.videoH,
    durationS: record.durationS,
    byteSize: record.byteSize,
    samples: record.samples || [],
    savedAt: record.savedAt,
  };
  return { meta, blob: record.blob };
}

export async function deleteLastLabShotReplay() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
