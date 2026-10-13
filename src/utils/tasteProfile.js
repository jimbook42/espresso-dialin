/** Canonical stored value for a balanced extraction taste (replaces legacy `good`). */
export const BALANCED_TASTE_PROFILE = 'balanced';

/** Legacy persisted taste value — normalize on read, never write on new saves. */
export const LEGACY_GOOD_TASTE_PROFILE = 'good';

export function normalizeTasteProfile(taste) {
  if (taste === LEGACY_GOOD_TASTE_PROFILE) return BALANCED_TASTE_PROFILE;
  return taste;
}

export function isBalancedTaste(taste) {
  return normalizeTasteProfile(taste) === BALANCED_TASTE_PROFILE;
}

/** Value written when logging a new shot from the taste selector. */
export function tasteProfileForSave(selectedTaste) {
  return normalizeTasteProfile(selectedTaste);
}

export function tasteProfileDisplayLabel(taste) {
  const normalized = normalizeTasteProfile(taste);
  if (!normalized) return '—';
  return normalized.replace(/_/g, ' ');
}

export function tasteProfilesMatch(a, b) {
  return normalizeTasteProfile(a) === normalizeTasteProfile(b);
}
