import { useCallback, useEffect } from 'react';

/**
 * @param {() => void} onClose
 * @returns {() => void} cleanup — sync history when overlay closes without back
 */
export function bindOverlayHistoryClose(onClose) {
  let historyPushed = true;
  window.history.pushState({ overlay: 'weighing-view' }, '');

  const handlePopState = () => {
    historyPushed = false;
    onClose();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && historyPushed) {
      window.history.back();
    }
  };

  window.addEventListener('popstate', handlePopState);
  window.addEventListener('keydown', handleKeyDown);

  return () => {
    window.removeEventListener('popstate', handlePopState);
    window.removeEventListener('keydown', handleKeyDown);
    if (historyPushed) {
      historyPushed = false;
      window.history.back();
    }
  };
}

/**
 * Push history on open; close via back, Escape, or programmatic onClose.
 *
 * @param {boolean} isOpen
 * @param {() => void} onClose
 * @returns {() => void} requestClose — use for close buttons
 */
export function useOverlayHistoryClose(isOpen, onClose) {
  useEffect(() => {
    if (!isOpen) return undefined;
    return bindOverlayHistoryClose(onClose);
  }, [isOpen, onClose]);

  return useCallback(() => {
    window.history.back();
  }, []);
}
