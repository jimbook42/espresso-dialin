import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsvLine } from './csvImport.js';
import { SHOT_CSV_HEADERS, buildShotsCsvContent, buildShotsCsvRows } from './csvExport.js';
import { MAX_PORTABLE_SHOT_BYTES, parsePortableShotFile, previewPortableRestore, restorePortableShots } from './portableShotRestore.js';
import { createPortableShots, readPortableShots } from './portableShots.js';
import { beanconquerorBatch, beanconquerorBrew, buildSepShotFile, shotSummaryCsv } from './shotExportFormats.js';
import { readShotSelections, setReferenceShot, toggleFavouriteShot } from './shotSelections.js';

const sourceCsv = readFileSync(new URL('./fixtures/visualizer-sep-profitec-excerpt.csv', import.meta.url), 'utf8');
const [sepHeader, ...knownRows] = sourceCsv.trim().split('\n');

function readMoments(rows) {
  const samples = { pressure: [], weight: [] };
  for (const row of rows) {
    const [type, elapsed, pressure, weight, , , , , , , , comment] = parseCsvLine(row);
    if (type !== 'moment') continue;
    if (comment === 'sample: pressure' && pressure !== '') samples.pressure.push({ tS: Number(elapsed), bar: Number(pressure) });
    if (comment === 'sample: weight' && weight !== '') samples.weight.push({ tS: Number(elapsed), weightG: Number(weight) });
  }
  return samples;
}

const observed = readMoments(knownRows);
const bean = { id: 'bean', name: 'Brasil Cerrado Mineiro', roaster: 'Kavekalmar' };
const shot = {
  id: 'tracked', beanId: bean.id, timestamp: '2023-03-24T09:38:52.463Z',
  grinderModel: 'Eureka Atom Specialty', actualDoseG: 18.6, actualYieldG: 38.35, actualTimeS: 58.536, shotRating: 4,
  labPressureCurve: observed.pressure, scaleFlowCurve: observed.weight,
  shotProfileTiming: { version: 1, pressureOriginMs: 0, scaleOriginMs: 0, extractionStartMs: 0,
    extractionEndMs: 58536, clockDriftMs: 0, pressureSource: 'camera', scaleSource: 'web-bluetooth' },
};
const manual = { id: 'manual', beanId: bean.id, timestamp: '2026-10-12T04:00:00.123Z', actualYieldG: 0 };
const selections = { favouriteIds: [shot.id], references: [{ beanId: bean.id, shotId: shot.id }] };
const makeBackup = (shots = [shot, manual]) => createPortableShots(shots, [bean], selections);
const file = (contents) => new Blob([JSON.stringify(contents)]);
const opened = [];
function database() {
  const db = new Dexie('portable-shots-' + crypto.randomUUID());
  db.version(17).stores({ shots: 'id,beanId,timestamp', beans: 'id', settings: 'id' });
  opened.push(db);
  return db;
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.delete()));
});

describe('portable shot backup', () => {
  it('reads one immutable snapshot and round-trips historical records, favourites, references and ratings into fresh storage', async () => {
    const source = database();
    await source.shots.bulkAdd([shot, manual]);
    await source.beans.add(bean);
    await toggleFavouriteShot(source, shot.id);
    await setReferenceShot(source, bean.id, shot.id, true);
    const snapshot = await readPortableShots(source);
    expect(Object.isFrozen(snapshot.shots[1].record.labPressureCurve[0])).toBe(true);
    expect(() => { snapshot.shots[1].record.labPressureCurve[0].bar = 0; }).toThrow(TypeError);
    expect(Object.isFrozen(shot.labPressureCurve)).toBe(false);
    expect(await source.shots.toArray()).toEqual([manual, shot]);
    expect((await readPortableShots(source, manual.id)).selections).toEqual({ favouriteIds: [], references: [] });

    const parsed = await parsePortableShotFile(file(snapshot));
    const target = database();
    const plan = await previewPortableRestore(target, parsed);
    expect(plan).toMatchObject({ newShots: 2, newBeans: 1, ratingsInFile: 1, favouritesAdded: 1, referencesAdded: 1 });
    expect(await target.shots.count()).toBe(0);
    expect(await target.beans.count()).toBe(0);
    expect(await target.settings.count()).toBe(0);
    await restorePortableShots(target, parsed, plan);
    expect(await readPortableShots(target)).toEqual(snapshot);
  });

  it('skips identical and conflicting IDs, keeps the local rating and occupied reference, and adds safe favourites', async () => {
    const target = database();
    const incoming = createPortableShots([shot, manual], [bean], { ...selections, favouriteIds: [shot.id, manual.id] });
    await target.beans.add({ ...bean, name: 'Edited locally' });
    await target.shots.bulkAdd([{ ...shot, shotRating: 2 }, manual]);
    await setReferenceShot(target, bean.id, manual.id, true);
    const plan = await previewPortableRestore(target, incoming);
    expect(plan).toMatchObject({ identicalShots: 1, conflictingShots: 1, conflictingBeans: 1,
      newShots: 0, favouritesAdded: 1, skippedSelections: 2 });
    await restorePortableShots(target, incoming, plan);
    expect((await target.shots.get(shot.id)).shotRating).toBe(2);
    expect((await target.beans.get(bean.id)).name).toBe('Edited locally');
    expect(await readShotSelections(target)).toMatchObject({
      favouriteIds: [manual.id], references: [{ beanId: bean.id, shotId: manual.id }],
    });
  });

  it('rejects a stale preview and rolls back a restore if a write fails midway', async () => {
    const target = database();
    const backup = makeBackup();
    const preview = await previewPortableRestore(target, backup);
    await target.shots.add(manual);
    await expect(restorePortableShots(target, backup, preview)).rejects.toThrow(/Local data changed/);
    expect(await target.beans.count()).toBe(0);
    const updated = await previewPortableRestore(target, backup);
    target.settings.hook('creating', () => { throw new Error('Storage write failed'); });
    await expect(restorePortableShots(target, backup, updated)).rejects.toThrow(/Storage write failed/);
    expect(await target.beans.count()).toBe(0);
    expect(await target.shots.toArray()).toEqual([manual]);
  });

  it('rejects malformed UTF-8 and JSON, unsupported versions, oversized and incomplete files', async () => {
    await expect(parsePortableShotFile(new Blob([new Uint8Array([255])]))).rejects.toThrow(/UTF-8/);
    await expect(parsePortableShotFile(new Blob(['{']))).rejects.toThrow(/UTF-8 JSON/);
    await expect(parsePortableShotFile(file({ ...makeBackup(), version: 42 }))).rejects.toThrow(/unsupported/);
    await expect(parsePortableShotFile(file({ ...makeBackup(), shots: undefined }))).rejects.toThrow(/incomplete/);
    await expect(parsePortableShotFile({ size: MAX_PORTABLE_SHOT_BYTES + 1 })).rejects.toThrow(/64 MiB/);
    await expect(parsePortableShotFile(new Blob(['{"format":"espresso-dial-in/shots","version":1,"shots":[{}],"beans":[],"selections":{"favouriteIds":[],"references":[]},"__proto__":{}}'])))
      .rejects.toThrow(/invalid property/);
  });

  it('rejects duplicates, invalid dates, tampered observations and dangling or ineligible selections', async () => {
    const backup = makeBackup();
    await expect(parsePortableShotFile(file({ ...backup, shots: [...backup.shots, backup.shots[0]] }))).rejects.toThrow(/duplicate shot IDs/);
    await expect(parsePortableShotFile(file(createPortableShots([{ ...shot, timestamp: '2026-02-30T00:00:00Z' }], [bean], selections)))).rejects.toThrow(/timestamp/);
    const corrupt = structuredClone(backup);
    corrupt.shots[0].flow.intervals = [];
    await expect(parsePortableShotFile(file(corrupt))).rejects.toThrow(/inconsistent/);
    const invalidRef = { ...backup, selections: { favouriteIds: [], references: [{ beanId: 'wrong', shotId: shot.id }] } };
    await expect(parsePortableShotFile(file(invalidRef))).rejects.toThrow(/invalid bean reference/);
    const pressureOnly = createPortableShots([{ ...shot, recordType: 'standalone-pressure' }], [bean], selections);
    await expect(parsePortableShotFile(file({ ...pressureOnly, selections }))).rejects.toThrow(/invalid bean reference/);
    await expect(parsePortableShotFile(file({ ...backup, selections: { favouriteIds: ['missing'], references: [] } }))).rejects.toThrow(/invalid favourite/);
  });

  it('preserves original timestamps, missing samples, gaps and measured zeros without filling or smoothing', async () => {
    const withGaps = { ...shot, timestamp: '2023-03-24T09:38:52.463123Z',
      labPressureCurve: [...observed.pressure.slice(0, 3), { tS: null, bar: null }, observed.pressure.at(-1)] };
    const backup = await parsePortableShotFile(file(makeBackup([withGaps, manual, {
      id: 'unobserved', timestamp: manual.timestamp, actualYieldG: 0,
      shotProfileTiming: { version: 1, yieldSource: 'unobserved-scale' },
    }])));
    const [tracked, zero, unobserved] = backup.shots;
    expect(tracked.record.timestamp).toBe(withGaps.timestamp);
    expect(tracked.record.labPressureCurve).toEqual(withGaps.labPressureCurve);
    expect(tracked.pressure).toMatchObject({ observedIndices: [0, 1, 2, 4], gapBeforeIndices: [4], alignment: 'recorded-extraction', originMs: 0 });
    expect(tracked.weight.gapBeforeIndices).toEqual([2]);
    expect(tracked.flow.intervals).toEqual([{ fromTS: 0.34, tS: 0.347, flowGs: 0, breakBefore: true }]);
    expect(zero.measurements).toMatchObject({ doseG: null, yieldG: 0, rating: null });
    expect(unobserved.measurements.yieldG).toBeNull();
    expect(unobserved.record.actualYieldG).toBe(0);
  });
});

describe('shot file adapters', () => {
  it('matches SEP headers and observations from the Visualizer parser fixture and is deterministic', async () => {
    const snapshot = makeBackup();
    const options = { bean, grind: '2.4' };
    const first = buildSepShotFile(snapshot.shots[0], options);
    expect(first.csv).toBe(buildSepShotFile(snapshot.shots[0], options).csv);
    expect(first.tracks).toEqual(['weight', 'pressure']);
    const [header, ...rows] = first.csv.trim().split('\n');
    expect(header).toBe(sepHeader);
    expect(readMoments(rows)).toEqual(observed);
    expect(rows.map(parseCsvLine)).toContainEqual(['meta', '', '', '', '', '', '', '', '', 'Date', shot.timestamp, 'ISO8601 formatted date']);
    const multipart = new FormData();
    multipart.append('file', first.blob, 'shot-sep.csv');
    expect(await multipart.get('file').text()).toBe(first.csv);
    expect(first.csv.startsWith('information_type,')).toBe(true);
  });

  it('uses recorded origins, declines unaligned pairs and excludes unsupported provenance', () => {
    const timing = shot.shotProfileTiming;
    const withOffset = makeBackup([{ ...shot, shotProfileTiming: { ...timing, scaleOriginMs: 500 } }]).shots[0];
    const csv = buildSepShotFile(withOffset).csv;
    expect(readMoments(csv.trim().split('\n').slice(1)).weight).toEqual(observed.weight.map((point) => ({ ...point, tS: point.tS + 0.5 })));
    expect(buildSepShotFile(makeBackup([{ ...shot, shotProfileTiming: { ...timing, clockDriftMs: 300 } }]).shots[0]).reason).toMatch(/aligned/);
    const simulated = makeBackup([{ ...shot, shotProfileTiming: { ...timing, pressureSource: 'simulated', scaleSource: undefined } }]).shots[0];
    expect(buildSepShotFile(simulated).reason).toMatch(/physical sensor/);
    expect(buildSepShotFile(makeBackup([manual]).shots[0]).csv).toBeUndefined();
  });

  it('preserves legacy-compatible shot-summary CSV columns and output for a complete shot', () => {
    const record = { ...shot, brewRatio: '1:2.1', notes: 'quoted, "tasting note"' };
    const helpers = { formatShotGrindForHistory: () => '2.4', normalizeTasteProfile: (value) => value,
      formatRecFollowedForCsv: () => '', knownIssueReasonLabel: () => '' };
    const existing = buildShotsCsvContent(SHOT_CSV_HEADERS, buildShotsCsvRows([record], { ...helpers, beans: [bean] }));
    expect(shotSummaryCsv(makeBackup([record]), helpers)).toBe(existing);
  });

  it('matches the documented Beanconqueror envelope and rejects incompatible batches without inventing water or beverage', () => {
    const documented = createPortableShots([{
      id: 'documented', timestamp: '2026-09-20T12:00:00.000Z', waterInMl: 300, actualYieldG: 240,
      actualTimeS: 210, preparationMethod: 'xBloom Studio',
    }], [], { favouriteIds: [], references: [] });
    const single = beanconquerorBrew(documented.shots[0]);
    expect(single.envelope).toEqual({
      v: 1, app: { name: 'Espresso Dial-In' },
      brew: { date: '2026-09-20T12:00:00.000Z', waterIn: { value: 300, unit: 'ml' },
        beverageOut: { value: 240, unit: 'g' }, brewTime: 210, preparationMethod: 'xBloom Studio' },
      imported: { source: 'espresso-dial-in', sourceName: 'Espresso Dial-In', schema: 1 },
    });
    expect(beanconquerorBatch(documented)).toEqual({ envelope: { v: 1, brews: [single.envelope] } });
    const pressureOnly = makeBackup([{ ...manual, recordType: 'standalone-pressure', actualYieldG: undefined }]);
    expect(beanconquerorBatch(pressureOnly)).toEqual({ incompatible: [{
      id: manual.id, missing: ['recorded water input', 'recorded beverage output', 'extraction time', 'preparation method'],
    }] });
    const [unobserved] = makeBackup([{ ...shot, waterInMl: 0, actualYieldG: 0,
      preparationMethod: 'Espresso', shotProfileTiming: { version: 1, yieldSource: 'unobserved-scale' } }]).shots;
    expect(beanconquerorBrew(unobserved)).toEqual({ missing: ['recorded beverage output'] });
  });
});
