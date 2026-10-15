export const PWA_INSTALL_DISMISS_STORAGE_KEY = 'espresso-dialin.pwa-install-dismissed-at';
export const PWA_INSTALL_DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function isPwaInstalled() {
  if (typeof window === 'undefined') return false;
  if (window.navigator?.standalone === true) return true;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    // ignore
  }
  return false;
}

export function isIosSafariInstallContext() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iphone|ipad|ipod/i.test(ua);
  if (!isIos) return false;
  const isOtherBrowser = /crios|fxios|edgios|opios/i.test(ua);
  return !isOtherBrowser;
}

export function readPwaInstallDismissedAtMs() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PWA_INSTALL_DISMISS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writePwaInstallDismissedAtMs(atMs = Date.now()) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PWA_INSTALL_DISMISS_STORAGE_KEY, String(atMs));
  } catch {
    // ignore quota / private mode
  }
}

export function isPwaInstallDismissalActive(dismissedAtMs, nowMs = Date.now()) {
  if (dismissedAtMs == null) return false;
  return nowMs - dismissedAtMs < PWA_INSTALL_DISMISS_TTL_MS;
}

export function shouldOfferPwaInstallBanner({
  installed,
  dismissedAtMs,
  canPromptInstall,
  isIosSafari,
  nowMs = Date.now(),
}) {
  if (installed) return false;
  if (isPwaInstallDismissalActive(dismissedAtMs, nowMs)) return false;
  if (canPromptInstall) return true;
  if (isIosSafari) return true;
  return false;
}
