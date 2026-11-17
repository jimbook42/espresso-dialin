import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level regression checks for intentionally tiny UI fixes, without
// importing App (which mounts the entire camera/scale application).
const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');

describe('v4.15.2 compact UI regressions', () => {
  it('offers a break after the Dose/Yield slash and permits long values to wrap', () => {
    expect(source).toContain("{doseG ?? '—'}/<wbr />{yieldG ?? '—'}g");
    expect(source).toContain('max-w-full break-words');
  });

  it('accurately labels the saved-shot diagnostic action', () => {
    const toast = source.split('const savedShotNotice =')[1].split('\n  return (')[0];
    expect(toast).toContain('openShotShare(lastSavedShotId)');
    expect(toast).toContain('>Report issue</button>');
    expect(toast).not.toContain('>Share shot</button>');
  });

  it('describes the explicit timer controls, not tap-anywhere behaviour', () => {
    expect(source).toContain('Fullscreen timer: use End pre-infusion, then Stop shot.');
    expect(source).toContain('Fullscreen timer: use Stop shot to finish.');
    expect(source).not.toContain('tap anywhere to end pre-infusion');
  });
});
