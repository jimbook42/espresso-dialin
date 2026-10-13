import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setteToNumeric } from '../grinders/grinderRegistry.js';
import { calculateRecommendation } from './grinderLogic.js';
import { normalizeTasteProfile } from './tasteProfile.js';

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isaac-b2-sette-shots.csv'
);

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

function parseSetteGrind(setting) {
  const match = /^(\d+)-([A-I])$/i.exec(String(setting).trim());
  if (!match) throw new Error(`Unrecognized Sette grind: ${setting}`);
  return { setteMacro: Number(match[1]), setteMicro: match[2].toUpperCase() };
}

function parseTimestamp(raw) {
  const [datePart, timePart] = String(raw).split(',').map((s) => s.trim());
  const [day, month, year] = datePart.split('/');
  return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}`).toISOString();
}

function parseFixtureShots(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const idx = (name) => header.indexOf(name);

  return lines.slice(1).map((line, lineNo) => {
    let cols = parseCsvLine(line);
    if (cols.length > header.length && header[0] === 'Timestamp') {
      cols = [`${cols[0]}, ${cols[1].trim()}`, ...cols.slice(2)];
    }
    const grind = parseSetteGrind(cols[idx('Grind Setting')]);
    const excludedCol = idx('Excluded') >= 0 ? idx('Excluded') : idx('Excluded From Learning');
    const excluded = String(cols[excludedCol]).toLowerCase() === 'yes';
    const targetMin = cols[idx('Target Time Min (s)')];
    const targetMax = cols[idx('Target Time Max (s)')];
    const targetDose = cols[idx('Target Dose (g)')];
    const targetYield = cols[idx('Target Yield (g)')];
    return {
      id: `isaac-b2-${lineNo}`,
      beanId: 'B2',
      grinderModel: 'Sette 270Wi',
      ...grind,
      wasPurged: String(cols[idx('Purged')]).toLowerCase() === 'yes',
      actualDoseG: Number(cols[idx('Dose(g)')]),
      actualYieldG: Number(cols[idx('Yield(g)')]),
      actualTimeS: Number(cols[idx('Time(s)')]),
      actualTime: Number(cols[idx('Time(s)')]),
      tasteProfile: normalizeTasteProfile(cols[idx('Taste')]),
      timestamp: parseTimestamp(cols[idx('Timestamp')]),
      excludeFromLearning: excluded,
      targetTimeMinS: targetMin !== '' && targetMin != null ? Number(targetMin) : 27,
      targetTimeMaxS: targetMax !== '' && targetMax != null ? Number(targetMax) : 32,
      targetDoseG: targetDose !== '' && targetDose != null ? Number(targetDose) : 18,
      targetYieldG: targetYield !== '' && targetYield != null ? Number(targetYield) : 30,
    };
  });
}

export function runIsaacB2SetteRegressionTests() {
  const csv = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const shotsNewestFirst = parseFixtureShots(csv);
  assert.equal(shotsNewestFirst.length, 35);

  const current = shotsNewestFirst[0];
  const history = shotsNewestFirst.slice(1);
  const recipe = {
    targetTimeMinS: 27,
    targetTimeMaxS: 32,
    targetDoseG: 18,
    targetYieldG: 30,
  };

  const rec = calculateRecommendation(current, recipe, history, false);
  const targetA = setteToNumeric(7, 'A');
  const sevenG = setteToNumeric(7, 'G');
  const recommended = setteToNumeric(rec.recommendedSetting.macro, rec.recommendedSetting.micro);
  const currentNumeric = setteToNumeric(current.setteMacro, current.setteMicro);

  assert.ok(recommended < sevenG, 'should move finer than the old 7G cap (lower numeric = finer)');
  assert.ok(recommended < currentNumeric, 'should move finer from 7-I');
  assert.ok(Math.abs(recommended - targetA) <= 2, `expected within 2 micro steps of 7-A, got ${rec.recommendedSetting.macro}-${rec.recommendedSetting.micro}`);
  assert.match(rec.reason, /FINER/i);

  console.log(
    `Isaac B2 Sette regression: recommends ${rec.recommendedSetting.macro}-${rec.recommendedSetting.micro} (shift ${rec.engineStats?.shift})`
  );
  console.log('Isaac B2 Sette regression tests passed.');
}
