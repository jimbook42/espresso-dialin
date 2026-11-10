const modes = ['brew', 'pressure', 'combined'];
const allowed = {
  onboarding_experience: { choice: modes },
  shot_recorded: { mode: modes, sensors: ['none', 'scale', 'pressure', 'both'] },
  reader_confidence: { band: ['high', 'medium', 'low', 'none'] },
  gauge_unsupported: {},
  share_shot: { method: ['share', 'mailto'] },
};

// Vercel Hobby accepts page views only. Future custom events require approval
// and a supported plan. The wire representation uses at most two properties.
const customEventTransport = null;
let pageViewsAllowed = false;

export function anonymousUsageEnabled(loaded, settings) {
  return loaded && settings?.anonymousUsageStats !== false;
}

export function allowUsagePageViews(allowed) {
  pageViewsAllowed = allowed;
}

// Vercel's injected script can outlive the React component after opt-out.
export function beforeUsagePageView(event) {
  if (!pageViewsAllowed || event.type !== 'pageview') return null;
  const url = new URL(event.url);
  return { ...event, url: url.origin + url.pathname };
}

export function usageEvent(name, properties = {}) {
  if (!Object.hasOwn(allowed, name) || !properties || typeof properties !== 'object') return null;
  const fields = Object.entries(allowed[name]);
  if (fields.length !== Object.keys(properties).length
    || !fields.every(([key, values]) => Object.hasOwn(properties, key) && values.includes(properties[key]))) {
    return null;
  }
  return { name, properties: Object.fromEntries(fields.map(([key]) => [key, properties[key]])) };
}

export function recordUsage(enabled, name, properties) {
  if (!enabled) return false;
  const event = usageEvent(name, properties);
  if (!event || !customEventTransport) return false;
  customEventTransport(event.name, event.properties);
  return true;
}

export function usageSensors(hasScale, hasPressure) {
  if (hasScale && hasPressure) return 'both';
  if (hasScale) return 'scale';
  return hasPressure ? 'pressure' : 'none';
}
