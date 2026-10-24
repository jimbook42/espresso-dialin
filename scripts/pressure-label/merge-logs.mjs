#!/usr/bin/env node
/**
 * Rebuild labels.json from Vercel runtime log dump (stdin).
 * Usage: node merge-logs.mjs < logs.txt
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = '/workspace/pl-state/labels.json';

function parseLines(text) {
  const events = [];
  const chunkParts = new Map();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.includes('PLABEL_CHUNK ')) {
      const m = trimmed.match(/PLABEL_CHUNK (\S+) (\d+)\/(\d+) (.*)$/);
      if (!m) continue;
      const [, sendId, i, n, data] = m;
      if (!chunkParts.has(sendId)) {
        chunkParts.set(sendId, { n: Number(n), parts: new Map() });
      }
      const bag = chunkParts.get(sendId);
      bag.parts.set(Number(i), data);
      if (bag.parts.size === bag.n) {
        let joined = '';
        for (let k = 1; k <= bag.n; k++) joined += bag.parts.get(k) || '';
        try {
          events.push(JSON.parse(joined));
        } catch {
          /* skip bad chunk group */
        }
        chunkParts.delete(sendId);
      }
      continue;
    }

    const idx = trimmed.indexOf('PLABEL ');
    if (idx < 0) continue;
    const json = trimmed.slice(idx + 'PLABEL '.length);
    try {
      events.push(JSON.parse(json));
    } catch {
      /* skip */
    }
  }

  return events;
}

function merge(events) {
  let labels = { frames: {} };
  const taps = [];

  for (const ev of events) {
    if (ev.type === 'all' && ev.labels?.frames) {
      labels = ev.labels;
    } else if (ev.type === 'tap' && ev.frameId && ev.record) {
      taps.push({ frameId: ev.frameId, record: ev.record });
    }
  }

  for (const { frameId, record } of taps) {
    const prev = labels.frames[frameId];
    const prevAt = prev?.updatedAt ? Date.parse(prev.updatedAt) : 0;
    const nextAt = record?.updatedAt ? Date.parse(record.updatedAt) : 0;
    if (!prev || nextAt >= prevAt) {
      labels.frames[frameId] = record;
    }
  }

  return labels;
}

const input = fs.readFileSync(0, 'utf8');
const events = parseLines(input);
const labels = merge(events);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(labels, null, 2)}\n`);
console.log(`Wrote ${OUT} (${Object.keys(labels.frames).length} frames from ${events.length} log events)`);
