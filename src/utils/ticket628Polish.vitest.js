import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, generateId } from './grinderLogic.js';
import { formatBeanDisplayName, formatBeanRoasterRoastLine } from './beanDisplayName.js';
import {
  formatHistoryShotUserNoteLine,
  formatLastShotUserNoteSuffix,
  userShotNoteFromStoredNotes,
} from './shotNotesDisplay.js';

describe('formatBeanDisplayName', () => {
  it('omits empty parentheses when roaster is blank', () => {
    expect(formatBeanDisplayName({ name: 'House', roaster: '' })).toBe('House');
    expect(formatBeanDisplayName({ name: 'House', roaster: '   ' })).toBe('House');
  });

  it('includes roaster when present', () => {
    expect(formatBeanDisplayName({ name: 'Ethiopia', roaster: 'Local' })).toBe('Ethiopia (Local)');
  });

  it('formats roaster roast line without empty roaster segment', () => {
    expect(formatBeanRoasterRoastLine({ roaster: '', roastType: 'Medium' })).toBe('Medium Roast');
    expect(formatBeanRoasterRoastLine({ roaster: 'Cafe', roastType: 'Dark' })).toBe('Cafe • Dark Roast');
  });
});

describe('shot user notes display', () => {
  it('strips pre-infusion prefix from stored notes', () => {
    expect(userShotNoteFromStoredNotes('Pre-infusion: 5s. Puck prep issue')).toBe('Puck prep issue');
    expect(userShotNoteFromStoredNotes('channel check')).toBe('channel check');
  });

  it('formats dial last-shot suffix and history line', () => {
    expect(formatLastShotUserNoteSuffix('Puck prep issue')).toBe(' · “Puck prep issue”');
    expect(formatHistoryShotUserNoteLine('Pre-infusion: 3s. Channeling')).toBe('Channeling');
    expect(formatLastShotUserNoteSuffix('Pre-infusion: 3s.')).toBe('');
  });
});

describe('shot note persistence in Dexie', () => {
  beforeEach(async () => {
    await db.open();
    await db.transaction('rw', db.shots, db.beans, async () => {
      await db.shots.clear();
      await db.beans.clear();
      await db.beans.add({
        id: 'b1',
        name: 'Test',
        roaster: '',
        roastType: 'Medium',
        roastDate: '2026-10-01',
        storageType: 'bag',
        createdAt: '2026-10-01T00:00:00.000Z',
      });
    });
  });

  it('persists user notes on shot records', async () => {
    const id = generateId();
    await db.shots.add({
      id,
      beanId: 'b1',
      timestamp: '2026-10-15T12:00:00.000Z',
      grinderModel: 'Sette 270Wi',
      actualTimeS: 30,
      actualDoseG: 18,
      actualYieldG: 36,
      tasteProfile: 'balanced',
      notes: 'Puck prep issue',
    });
    const saved = await db.shots.get(id);
    expect(saved.notes).toBe('Puck prep issue');
    expect(formatHistoryShotUserNoteLine(saved.notes)).toBe('Puck prep issue');
    expect(formatLastShotUserNoteSuffix(saved.notes)).toContain('Puck prep issue');
  });
});
