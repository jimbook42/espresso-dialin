export const MANUAL_SHOT_DRAFT_KEY = 'espresso-dialin.manual-shot-draft.v1';
const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

export function readManualShotDraft() {
  try {
    const draft = JSON.parse(window.localStorage.getItem(MANUAL_SHOT_DRAFT_KEY));
    if (!draft) return null;
    const age = Date.now() - draft.updatedAt;
    if (!Number.isFinite(age) || age < 0 || age >= MAX_DRAFT_AGE_MS
      || typeof draft.id !== 'string' || !draft.id || draft.beanId == null
      || typeof draft.time !== 'string' || typeof draft.yieldG !== 'string'
      || (!draft.time && !draft.yieldG) || typeof draft.dose !== 'string'
      || typeof draft.taste !== 'string' || typeof draft.notes !== 'string'
      || (draft.rating !== null && ![1, 2, 3, 4, 5].includes(draft.rating))
      || typeof draft.excludeFromLearning !== 'boolean' || typeof draft.knownIssueReason !== 'string') {
      window.localStorage.removeItem(MANUAL_SHOT_DRAFT_KEY);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function writeManualShotDraft(draft) {
  try {
    window.localStorage.setItem(MANUAL_SHOT_DRAFT_KEY, JSON.stringify({ ...draft, updatedAt: Date.now() }));
  } catch {
    // Storage can be unavailable. Leave the in-memory form usable.
  }
}

export function clearManualShotDraft(id) {
  if (!id) return;
  try {
    const draft = JSON.parse(window.localStorage.getItem(MANUAL_SHOT_DRAFT_KEY));
    if (draft?.id === id) window.localStorage.removeItem(MANUAL_SHOT_DRAFT_KEY);
  } catch {
    // Storage can be unavailable. Leave the in-memory form usable.
  }
}
