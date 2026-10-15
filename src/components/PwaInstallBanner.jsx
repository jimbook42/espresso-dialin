import { useCallback, useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import {
  isIosSafariInstallContext,
  isPwaInstalled,
  readPwaInstallDismissedAtMs,
  shouldOfferPwaInstallBanner,
  writePwaInstallDismissedAtMs,
} from '../pwa/pwaInstallState.js';

export function PwaInstallBanner({ ui, darkMode }) {
  const [visible, setVisible] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  const refreshVisibility = useCallback(() => {
    const installed = isPwaInstalled();
    const dismissedAtMs = readPwaInstallDismissedAtMs();
    const canPrompt = Boolean(deferredPrompt);
    const isIosSafari = isIosSafariInstallContext();
    setIosHint(isIosSafari && !canPrompt);
    setVisible(
      shouldOfferPwaInstallBanner({
        installed,
        dismissedAtMs,
        canPromptInstall: canPrompt,
        isIosSafari,
      })
    );
  }, [deferredPrompt]);

  useEffect(() => {
    refreshVisibility();
  }, [refreshVisibility]);

  useEffect(() => {
    const onBeforeInstall = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setVisible(false);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    refreshVisibility();
  }, [deferredPrompt, refreshVisibility]);

  const dismiss = () => {
    writePwaInstallDismissedAtMs();
    setVisible(false);
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch {
      // ignore
    }
    setDeferredPrompt(null);
    refreshVisibility();
  };

  if (!visible) return null;

  const surface = darkMode
    ? 'bg-[#1a1815]/95 border-[#2e2b26] text-[#f5f2eb]'
    : 'bg-[#f5f0e8]/95 border-[#d9d0c4] text-[#2a261f]';
  const sub = darkMode ? 'text-[#a09880]' : 'text-[#5c5549]';

  return (
    <div
      className={`mx-auto max-w-xl px-3 pt-3 safe-area-pt`}
      role="region"
      aria-label="Install app"
    >
      <div className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 shadow-sm backdrop-blur ${surface}`}>
        <Download className={`w-4 h-4 mt-0.5 shrink-0 ${ui?.accentText || 'text-[#c88a4b]'}`} aria-hidden />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-xs font-semibold leading-snug">Install Espresso Dial-In</p>
          {iosHint ? (
            <p className={`text-[11px] leading-snug ${sub}`}>
              Tap Share, then Add to Home Screen.
            </p>
          ) : (
            <p className={`text-[11px] leading-snug ${sub}`}>
              Add a home-screen shortcut for faster dial-in.
            </p>
          )}
          {deferredPrompt && (
            <button
              type="button"
              onClick={() => { void handleInstall(); }}
              className={`mt-1 inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold ${ui?.primary || 'bg-[#c88a4b] text-[#121110]'}`}
            >
              Install
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className={`shrink-0 p-1 rounded-md ${ui?.ghostBtn || 'text-[#6b6457] hover:text-[#f5f2eb]'}`}
          aria-label="Dismiss install suggestion"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
