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
const views = Object.fromEntries([
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
  Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView, globalThis.Float16Array,
].filter(Boolean).map((type) => [type.name, type]));
class NeedsGraphEncoding extends Error {}
const legacyObjectKey = (key) => !['__proto__', 'constructor', 'prototype'].includes(key);
const arrayIndex = (key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < 0xffffffff;

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
function encode(value, assets, seen, graph, depth = 0) {
  requireValue(depth < 100, 'A record is nested too deeply.');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return ['number', '-0'];
    return Number.isFinite(value) ? value : ['number', String(value)];
  }
  if (value === undefined) return ['undefined'];
  if (typeof value === 'bigint') return ['bigint', String(value)];
  requireValue(value && typeof value === 'object', 'A stored value cannot be backed up.');
  if (seen.has(value)) {
    if (!graph) throw new NeedsGraphEncoding();
    return ['ref', seen.get(value)];
  }
  const id = seen.size;
  seen.set(value, id);
  const child = (item) => encode(item, assets, seen, graph, depth + 1);
  let result;
  if (value instanceof Date) result = ['date', Number.isFinite(+value) ? value.toISOString() : null];
  else if (value instanceof Blob) {
    const index = assets.push(value) - 1;
    if (typeof File !== 'undefined' && value instanceof File) {
      requireValue(safeFilename(value.name), 'A stored file has an unsafe filename.');
      result = ['file', index, value.type, value.name, value.lastModified];
    } else result = ['blob', index, value.type];
  } else if (value instanceof ArrayBuffer) result = ['buffer', assets.push(new Blob([value])) - 1];
  else if (ArrayBuffer.isView(value) || value instanceof Map || value instanceof Set || value instanceof RegExp) {
    if (!graph) throw new NeedsGraphEncoding();
    if (ArrayBuffer.isView(value)) {
      const type = Object.getPrototypeOf(value).constructor.name;
      requireValue(Object.hasOwn(views, type), 'Unsupported binary view.');
      result = ['view', type, child(value.buffer), value.byteOffset, value.byteLength];
    } else if (value instanceof Map) result = ['map', [...value].map(([key, item]) => [child(key), child(item)])];
    else if (value instanceof Set) result = ['set', [...value].map(child)];
    else result = ['regexp', value.source, value.flags];
  } else {
    const keys = Object.keys(value).sort();
    if (!graph && keys.some((key) => !legacyObjectKey(key))) throw new NeedsGraphEncoding();
    const entries = keys.map((key) => [key, child(value[key])]);
    if (Array.isArray(value)) result = ['array', value.length, entries];
    else {
      requireValue(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
        'A stored value uses an unsupported type.');
      result = ['object', entries];
    }
  }
  return graph ? ['node', id, result] : result;
}

function encodeDataset(value) {
  const assets = [];
  try {
    return { value: encode(value, assets, new Map(), false), assets, graph: false };
  } catch (error) {
    if (!(error instanceof NeedsGraphEncoding)) throw error;
    assets.length = 0;
    return { value: encode(value, assets, new Map(), true), assets, graph: true };
  }
}

async function decode(value, assets, used, graph, depth = 0, nodeId = null) {
  requireValue(depth < 100, 'A record is nested too deeply.');
  if (!Array.isArray(value)) {
    requireValue(value === null || ['string', 'boolean'].includes(typeof value) || Number.isFinite(value));
    return value;
  }
  const [tag, first, second, third, fourth] = value;
  if (tag === 'undefined' && value.length === 1) return undefined;
  if (tag === 'number' && value.length === 2 && ['-0', 'NaN', 'Infinity', '-Infinity'].includes(first)) return Number(first);
  if (tag === 'bigint' && value.length === 2 && /^-?\d+$/.test(first) && typeof first === 'string') return BigInt(first);
  if (graph && tag === 'ref') {
    requireValue(value.length === 2 && graph.has(first) && graph.get(first) !== undefined);
    return graph.get(first);
  }
  if (graph && tag === 'node') {
    requireValue(value.length === 3 && first === graph.size && Array.isArray(second)
      && !['node', 'ref', 'undefined', 'number', 'bigint'].includes(second[0]));
    graph.set(first, undefined);
    return decode(second, assets, used, graph, depth, first);
  }
  const remember = (item) => {
    if (graph) {
      requireValue(nodeId !== null && graph.get(nodeId) === undefined);
      graph.set(nodeId, item);
    }
    return item;
  };
  const child = (item) => decode(item, assets, used, graph, depth + 1);
  if (tag === 'date' && value.length === 2 && (first === null || (typeof first === 'string' && Number.isFinite(Date.parse(first))))) {
    return remember(new Date(first === null ? NaN : first));
  }
  if (graph && (tag === 'map' || tag === 'set')) {
    requireValue(value.length === 2 && Array.isArray(first));
    const output = remember(tag === 'map' ? new Map() : new Set());
    for (const entry of first) {
      if (tag === 'map') {
        requireValue(Array.isArray(entry) && entry.length === 2);
        const key = await child(entry[0]);
        requireValue(!output.has(key));
        output.set(key, await child(entry[1]));
      } else {
        const item = await child(entry);
        requireValue(!output.has(item));
        output.add(item);
      }
    }
    return output;
  }
  if (graph && tag === 'regexp') {
    requireValue(value.length === 3 && typeof first === 'string' && typeof second === 'string');
    return remember(new RegExp(first, second));
  }
  if (graph && tag === 'view') {
    requireValue(value.length === 5 && typeof first === 'string' && Object.hasOwn(views, first));
    const buffer = await child(second);
    requireValue(buffer instanceof ArrayBuffer && integer(third, buffer.byteLength) && integer(fourth, buffer.byteLength - third));
    const type = views[first];
    const length = type === DataView ? fourth : fourth / type.BYTES_PER_ELEMENT;
    requireValue(Number.isInteger(length));
    return remember(new type(buffer, third, length));
  }
  if (['blob', 'file', 'buffer'].includes(tag)) {
    requireValue(integer(first, assets.length - 1) && !used.has(first));
    requireValue(value.length === ({ blob: 3, file: 5, buffer: 2 })[tag]);
    used.add(first);
    const data = assets[first];
    if (tag === 'buffer') return remember(await data.arrayBuffer());
    requireValue(typeof second === 'string' && second.length <= 256);
    if (tag === 'file') {
      requireValue(safeFilename(third) && Number.isSafeInteger(fourth), 'Unsafe backup asset filename.');
      return remember(new File([data], third, { type: second, lastModified: fourth }));
    }
    return remember(data.slice(0, data.size, second));
  }
  const array = tag === 'array';
  requireValue(array ? value.length === 3 && integer(first, 1_000_000) : tag === 'object' && value.length === 2);
  const result = remember(array ? new Array(first) : {});
  const entries = array ? second : first;
  requireValue(Array.isArray(entries));
  let previous;
  for (const pair of entries) {
    requireValue(Array.isArray(pair) && pair.length === 2);
    const [key, item] = pair;
    requireValue(typeof key === 'string' && (previous === undefined || previous < key)
      && (graph || legacyObjectKey(key)));
    if (array) requireValue(key !== 'length' && (!arrayIndex(key) || Number(key) < first));
    previous = key;
    Object.defineProperty(result, key, {
      value: await child(item), enumerable: true, writable: true, configurable: true,
    });
  }
  return result;
}

function jsonBlob(value) {
  return new Blob([JSON.stringify(value)]);
}

export async function fingerprintRecord(value) {
  const { assets, value: row } = encodeDataset(value);
  const hashes = [];
  for (const asset of assets) hashes.push(await digestBlob(asset));
  return digestBlob(jsonBlob([row, hashes]));
}

export async function buildArchive(snapshot, appVersion, now = new Date()) {
  const datasets = [];
  const payload = [];
  for (const name of DATASETS) {
    const records = snapshot[name];
    const { assets, value, graph } = encodeDataset(records);
    const structured = jsonBlob(value);
    requireValue(structured.size <= MAX_JSON_BYTES, name + ' exceeds the 64 MiB record limit.');
    const blobs = [structured, ...assets];
    const parts = [];
    for (const blob of blobs) {
      requireValue(blob.size <= MAX_ARCHIVE_BYTES, 'A binary asset exceeds the backup size limit.');
      parts.push({ bytes: blob.size, sha256: await digestBlob(blob) });
      payload.push(blob);
    }
    datasets.push({ name, count: records.length, parts, ...(graph ? { encoding: 'graph' } : {}) });
  }
  const manifest = { format: 'espresso-dial-in/full-app', version: datasets.some((set) => set.encoding === 'graph') ? 2 : 1, checksum: 'sha256-blocks-4MiB', appVersion,
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
  requireValue(manifest?.format === 'espresso-dial-in/full-app' && (manifest.version === 1 || (manifest.version === 2 && Array.isArray(manifest.datasets)
      && manifest.datasets.some((set) => set?.encoding === 'graph')))
    && manifest.checksum === 'sha256-blocks-4MiB', 'Unsupported backup version.');
  requireValue(typeof manifest.appVersion === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.appVersion)
    && typeof manifest.exportedAt === 'string' && Number.isFinite(Date.parse(manifest.exportedAt))
    && Array.isArray(manifest.datasets) && manifest.datasets.length === DATASETS.length);
  let offset = headerBytes + length;
  const snapshot = {};
  for (const [index, set] of manifest.datasets.entries()) {
    requireValue(set?.name === DATASETS[index] && integer(set.count, 1_000_000)
      && Array.isArray(set.parts) && set.parts.length > 0
      && (set.encoding === undefined || (manifest.version === 2 && set.encoding === 'graph')));
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
    const decoded = await decode(JSON.parse(decoder.decode(await structured.arrayBuffer())), assets, used,
      set.encoding === 'graph' ? new Map() : null);
    requireValue(used.size === assets.length && Array.isArray(decoded) && decoded.length === set.count);
    snapshot[set.name] = decoded;
  }
  requireValue(offset === file.size, 'Backup contains unexpected trailing data.');
  return { snapshot, manifest };
}
