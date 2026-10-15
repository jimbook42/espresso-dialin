export const BEANS_FINISHED_SECTION_OPEN_KEY = 'espresso-dialin.beans-finished-section-open';

export function readBeansFinishedSectionOpen() {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(BEANS_FINISHED_SECTION_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeBeansFinishedSectionOpen(open) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(BEANS_FINISHED_SECTION_OPEN_KEY, open ? '1' : '0');
  } catch {
    // ignore quota / private mode
  }
}
