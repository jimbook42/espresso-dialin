import { describe, expect, it } from 'vitest';
import { allowUsagePageViews, anonymousUsageEnabled, beforeUsagePageView, recordUsage, usageEvent, usageSensors } from './anonymousUsage.js';

describe('anonymous usage stats', () => {
  it('defaults on only after IndexedDB resolves and honours saved Off', () => {
    expect(anonymousUsageEnabled(false, null)).toBe(false);
    expect(anonymousUsageEnabled(true, null)).toBe(true);
    expect(anonymousUsageEnabled(true, { anonymousUsageStats: false })).toBe(false);
  });

  it('blocks page views while off even if the injected script is still alive', () => {
    const event = { type: 'pageview', url: 'https://example.com/?note=private#user-content' };
    expect(beforeUsagePageView(event)).toBeNull();
    allowUsagePageViews(true);
    expect(beforeUsagePageView(event)).toEqual({ type: 'pageview', url: 'https://example.com/' });
    expect(beforeUsagePageView({ ...event, type: 'event' })).toBeNull();
    allowUsagePageViews(false);
    expect(beforeUsagePageView(event)).toBeNull();
  });

  it('allows only the five reviewed events and exact enumerated properties', () => {
    const events = {
      onboarding_experience: { choice: 'brew' },
      shot_recorded: { mode: 'combined', sensors: 'both' },
      reader_confidence: { band: 'medium' },
      gauge_unsupported: {},
      share_shot: { method: 'share' },
    };
    for (const [name, properties] of Object.entries(events)) {
      expect(usageEvent(name, properties)).toEqual({ name, properties });
      expect(usageEvent(name, { ...properties, shotId: 'private' })).toBeNull();
      expect(recordUsage(true, name, properties)).toBe(false);
      expect(recordUsage(false, name, properties)).toBe(false);
    }
    expect(usageEvent('shot_recorded', { mode: 'notes', sensors: 'both' })).toBeNull();
    expect(usageEvent('share_shot', { method: 'cancelled' })).toBeNull();
    expect(usageEvent('toString')).toBeNull();
    expect([usageSensors(false, false), usageSensors(true, false), usageSensors(false, true), usageSensors(true, true)])
      .toEqual(['none', 'scale', 'pressure', 'both']);
  });
});
