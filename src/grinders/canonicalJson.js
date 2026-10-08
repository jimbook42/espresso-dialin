/**
 * Canonical JSON serializer for engine snapshot goldens (v1).
 *
 * Rules:
 * - Object keys are sorted lexicographically at every depth.
 * - Arrays keep element order.
 * - null is preserved as JSON null.
 * - undefined becomes the sentinel string "__undefined__".
 * - NaN becomes the sentinel string "__nan__".
 * - Infinity / -Infinity become "__infinity__" / "__negative_infinity__".
 * - Date instances become ISO-8601 strings.
 * - No other types (functions, symbols, etc.) — throws.
 */
const UNDEFINED = '__undefined__';
const NAN = '__nan__';
const INFINITY = '__infinity__';
const NEG_INFINITY = '__negative_infinity__';

export function canonicalize(value) {
  if (value === undefined) return UNDEFINED;
  if (value === null) return null;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return NAN;
    if (value === Infinity) return INFINITY;
    if (value === -Infinity) return NEG_INFINITY;
    return value;
  }
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  throw new TypeError(`canonicalize: unsupported type ${typeof value}`);
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value), null, 2);
}

/** Parse golden JSON. Sentinel strings stay as strings (JSON.parse must not revive undefined — that drops keys). */
export function parseCanonicalJson(text) {
  return JSON.parse(text, (key, val) => {
    if (val === NAN) return NaN;
    if (val === INFINITY) return Infinity;
    if (val === NEG_INFINITY) return -Infinity;
    return val;
  });
}

export const CANONICAL_JSON_VERSION = 1;
