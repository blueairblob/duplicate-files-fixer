import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard behaviour for a modal dialog. Put the returned ref on the dialog
 * panel (with role="dialog" aria-modal="true").
 *  - focus moves into the dialog when it opens, and back to where it was on close
 *  - Escape closes it
 *  - Tab / Shift+Tab stay inside it
 */
export function useDialog(onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const panel = ref.current;
    const focusables = () => (panel ? Array.from(panel.querySelectorAll(FOCUSABLE)) : []);
    (focusables()[0] || panel)?.focus?.();

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current && closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, []);

  return ref;
}
