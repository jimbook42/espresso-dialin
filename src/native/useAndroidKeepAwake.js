import { useEffect, useRef } from 'react';
import { AndroidShell, isAndroidApp } from './androidShell.js';

const PREPARATION_IDLE_MS = 5 * 60 * 1000;

export function useAndroidKeepAwake({ active, preparationKey, canPrepare }) {
  const lastPreparationKey = useRef(null);
  useEffect(() => {
    if (!isAndroidApp) return undefined;
    let preparing = false;
    let timeout;
    let requested = false;
    const sync = () => {
      const enabled = !document.hidden && (active || preparing);
      if (requested === enabled) return;
      requested = enabled;
      void AndroidShell.keepAwake({ enabled }).catch(() => {});
    };
    const resumePreparation = () => {
      if (document.hidden) return;
      clearTimeout(timeout);
      preparing = true;
      sync();
      timeout = setTimeout(() => { preparing = false; sync(); }, PREPARATION_IDLE_MS);
    };
    if (canPrepare) {
      if (lastPreparationKey.current !== preparationKey) resumePreparation();
      document.addEventListener('pointerdown', resumePreparation);
      document.addEventListener('keydown', resumePreparation);
    }
    lastPreparationKey.current = preparationKey;
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('pointerdown', resumePreparation);
      document.removeEventListener('keydown', resumePreparation);
      document.removeEventListener('visibilitychange', sync);
      if (requested) void AndroidShell.keepAwake({ enabled: false }).catch(() => {});
    };
  }, [active, preparationKey, canPrepare]);
}
