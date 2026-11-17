const MiB = 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 512 * MiB;
const MAX_JSON_BYTES = 64 * MiB;
const MAX_MANIFEST_BYTES = MiB;
const CHUNK_BYTES = 4 * MiB;
export const DATASETS = ['beans', 'recipes', 'shots', 'settings', 'replay', 'preferences'];
export const BACKUP_EXTENSION = '.dialinbackup';
export const BACKUP_MIME = 'application/octet-stream';
const magic = new TextEncoder().encode('DIALIN01');
const decoder = new TextDecoder('utf-8', { fatal: true });
const headerBytes = magic.length + 4 + 32;
const sha256 = async (buffer) => new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const fail = (message) => { throw new Error(message); };
const requireValue = (ok, message = 'Invalid backup structure.') => { if (!ok) fail(message); };
const safeFilename = (name) => typeof name === 'string' && name.length > 0 && name.length <= 255
  && !['/', '\\', ':'].some((separator) => name.includes(separator))
  && !Array.from(name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  && !['.', '..'].includes(name);
const integer = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;

async function digestBlob(blob) {
  const digests = new Uint8Array(Math.max(1, Math.ceil(blob.size / CHUNK_BYTES)) * 32);
  for (let i = 0; i < digests.length / 32; i++) {
    const block = await blob.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).arrayBuffer();
    digests.set(await sha256(block), i * 32);
  }
  return hex(await sha256(digests));
}

// Canonical, tagged structured values. Object keys are sorted. No reviver can
// execute code, and no filename from the input is used as a storage path.
function encode(value, assets, ancestors = new Set(), depth = 0) {
  requireValue(depth < 100, 'A record is nested too deeply.');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return ['number', '-0'];
    return Number.isFinite(value) ? value : ['number', String(value)];
  }
  if (value === undefined) return ['undefined'];
  if (typeof value === 'bigint') return ['bigint', String(value)];
  if (value instanceof Date) return ['date', Number.isFinite(+value) ? value.toISOString() : null];
  if (value instanceof Blob) {
    const index = assets.push(value) - 1;
    if (typeof File !== 'undefined' && value instanceof File) {
      requireValue(safeFilename(value.name), 'A stored file has an unsafe filename.');
      return ['file', index, value.type, value.name, value.lastModified];
    }
    return ['blob', index, value.type];
  }
  if (value instanceof ArrayBuffer) return ['buffer', assets.push(new Blob([value])) - 1];
  requireValue(value && typeof value === 'object' && !ancestors.has(value), 'A stored value cannot be backed up.');
  ancestors.add(value);
  const entries = () => Object.keys(value).sort().map((key) => [key, encode(value[key], assets, ancestors, depth + 1)]);
  let result;
  if (Array.isArray(value)) result = ['array', value.length, entries()];
  else {
    requireValue(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
      'A stored value uses an unsupported type.');
    result = ['object', entries()];
  }
  ancestors.delete(value);
  return result;
}

async function decode(value, assets, used, depth = 0) {
  requireValue(depth < 100, 'A record is nested too deeply.');
  if (!Array.isArray(value)) {
    requireValue(value === null || ['string', 'boolean'].includes(typeof value) || Number.isFinite(value));
    return value;
  }
  const [tag, first, second, third, fourth] = value;
  if (tag === 'undefined' && value.length === 1) return undefined;
  if (tag === 'number' && value.length === 2 && ['-0', 'NaN', 'Infinity', '-Infinity'].includes(first)) return Number(first);
  if (tag === 'bigint' && value.length === 2 && /^-?\d+$/.test(first) && typeof first === 'string') return BigInt(first);
  if (tag === 'date' && value.length === 2 && (first === null || (typeof first === 'string' && Number.isFinite(Date.parse(first))))) {
    return new Date(first === null ? NaN : first);
  }
  if (['blob', 'file', 'buffer'].includes(tag)) {
    requireValue(integer(first, assets.length - 1) && !used.has(first));
    requireValue(value.length === ({ blob: 3, file: 5, buffer: 2 })[tag]);
    used.add(first);
    const data = assets[first];
    if (tag === 'buffer') return data.arrayBuffer();
    requireValue(typeof second === 'string' && second.length <= 256);
    if (tag === 'file') {
      requireValue(safeFilename(third) && Number.isSafeInteger(fourth), 'Unsafe backup asset filename.');
      return new File([data], third, { type: second, lastModified: fourth });
    }
    return data.slice(0, data.size, second);
  }
  const array = tag === 'array';
  requireValue(array ? value.length === 3 && integer(first, 1_000_000) : tag === 'object' && value.length === 2);
  const result = array ? new Array(first) : {};
  const entries = array ? second : first;
  requireValue(Array.isArray(entries));
  let previous;
  for (const pair of entries) {
    requireValue(Array.isArray(pair) && pair.length === 2);
    const [key, item] = pair;
    requireValue(typeof key === 'string' && (previous === undefined || previous < key)
      && !['__proto__', 'constructor', 'prototype'].includes(key));
    if (array) requireValue(key !== 'length' && (!/^\d+$/.test(key) || Number(key) < first));
    previous = key;
    Object.defineProperty(result, key, {
      value: await decode(item, assets, used, depth + 1), enumerable: true, writable: true, configurable: true,
    });
  }
  return result;
}

function jsonBlob(value) {
  return new Blob([JSON.stringify(value)]);
}

export async function fingerprintRecord(value) {
  const assets = [];
  const row = encode(value, assets);
  const hashes = [];
  for (const asset of assets) hashes.push(await digestBlob(asset));
  return digestBlob(jsonBlob([row, hashes]));
}

export async function buildArchive(snapshot, appVersion, now = new Date()) {
  const datasets = [];
  const payload = [];
  for (const name of DATASETS) {
    const records = snapshot[name];
    const assets = [];
    const structured = jsonBlob(encode(records, assets));
    requireValue(structured.size <= MAX_JSON_BYTES, name + ' exceeds the 64 MiB record limit.');
    const blobs = [structured, ...assets];
    const parts = [];
    for (const blob of blobs) {
      requireValue(blob.size <= MAX_ARCHIVE_BYTES, 'A binary asset exceeds the backup size limit.');
      parts.push({ bytes: blob.size, sha256: await digestBlob(blob) });
      payload.push(blob);
    }
    datasets.push({ name, count: records.length, parts });
  }
  const manifest = { format: 'espresso-dial-in/full-app', version: 1, checksum: 'sha256-blocks-4MiB', appVersion,
    exportedAt: now.toISOString(), datasets };
  const manifestBlob = jsonBlob(manifest);
  requireValue(manifestBlob.size <= MAX_MANIFEST_BYTES, 'Too many binary assets for one backup.');
  const manifestBuffer = await manifestBlob.arrayBuffer();
  const header = new Uint8Array(headerBytes);
  header.set(magic);
  new DataView(header.buffer).setUint32(magic.length, manifestBlob.size, true);
  header.set(await sha256(manifestBuffer), magic.length + 4);
  const file = new Blob([header, manifestBlob, ...payload], { type: BACKUP_MIME });
  requireValue(file.size <= MAX_ARCHIVE_BYTES, 'This backup exceeds the 512 MiB archive limit.');
  return { file, manifest };
}

export async function parseArchive(file) {
  requireValue(file instanceof Blob && file.size >= headerBytes && file.size <= MAX_ARCHIVE_BYTES,
    'Backup is empty, truncated, or larger than 512 MiB.');
  const header = await file.slice(0, headerBytes).arrayBuffer();
  const bytes = new Uint8Array(header);
  requireValue(magic.every((byte, index) => byte === bytes[index]), 'Unsupported backup format.');
  const length = new DataView(header).getUint32(magic.length, true);
  requireValue(integer(length, MAX_MANIFEST_BYTES) && headerBytes + length <= file.size);
  const manifestBuffer = await file.slice(headerBytes, headerBytes + length).arrayBuffer();
  requireValue(hex(await sha256(manifestBuffer)) === hex(bytes.subarray(magic.length + 4)), 'Backup manifest checksum failed.');
  const manifest = JSON.parse(decoder.decode(manifestBuffer));
  requireValue(manifest?.format === 'espresso-dial-in/full-app' && manifest.version === 1
    && manifest.checksum === 'sha256-blocks-4MiB', 'Unsupported backup version.');
  requireValue(typeof manifest.appVersion === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.appVersion)
    && typeof manifest.exportedAt === 'string' && Number.isFinite(Date.parse(manifest.exportedAt))
    && Array.isArray(manifest.datasets) && manifest.datasets.length === DATASETS.length);
  let offset = headerBytes + length;
  const snapshot = {};
  for (const [index, set] of manifest.datasets.entries()) {
    requireValue(set?.name === DATASETS[index] && integer(set.count, 1_000_000)
      && Array.isArray(set.parts) && set.parts.length > 0);
    const blobs = [];
    for (const [partIndex, part] of set.parts.entries()) {
      requireValue(integer(part?.bytes, partIndex ? MAX_ARCHIVE_BYTES : MAX_JSON_BYTES)
        && /^[a-f0-9]{64}$/.test(part.sha256) && offset + part.bytes <= file.size, 'Invalid or truncated backup payload.');
      const blob = file.slice(offset, offset + part.bytes);
      offset += part.bytes;
      requireValue(await digestBlob(blob) === part.sha256, set.name + ' checksum failed.');
      blobs.push(blob);
    }
    const [structured, ...assets] = blobs;
    const used = new Set();
    const decoded = await decode(JSON.parse(decoder.decode(await structured.arrayBuffer())), assets, used);
    requireValue(used.size === assets.length && Array.isArray(decoded) && decoded.length === set.count);
    snapshot[set.name] = decoded;
  }
  requireValue(offset === file.size, 'Backup contains unexpected trailing data.');
  return { snapshot, manifest };
}
