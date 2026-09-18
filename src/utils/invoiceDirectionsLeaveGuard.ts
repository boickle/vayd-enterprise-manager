import { useEffect } from 'react';
import { appAlert } from './appDialog';

const DIRTY_EVENT = 'vayd:invoice-directions-dirty';

let dirtyClientId: string | null = null;

export const INVOICE_DIRECTIONS_LEAVE_MESSAGE =
  'Save or delete the directions on this invoice before leaving the client.';

export function setInvoiceDirectionsDirty(clientId: number | string | null, dirty: boolean): void {
  const next = dirty && clientId != null ? String(clientId) : null;
  if (dirtyClientId === next) return;
  dirtyClientId = next;
  window.dispatchEvent(new Event(DIRTY_EVENT));
}

export function hasUnsavedInvoiceDirections(): boolean {
  return dirtyClientId != null;
}

export function alertAndBlockInvoiceDirectionsLeave(): boolean {
  if (!dirtyClientId) return false;
  void appAlert({
    title: 'Directions not saved',
    message: INVOICE_DIRECTIONS_LEAVE_MESSAGE,
  });
  return true;
}

export function blockInvoiceDirectionsLeave(): boolean {
  return alertAndBlockInvoiceDirectionsLeave();
}

function hrefStaysOnLockedClient(href: string): boolean {
  if (!dirtyClientId) return true;
  try {
    const url = new URL(href, window.location.origin);
    return (
      url.pathname.startsWith('/schedule/clients') &&
      url.searchParams.get('clientId') === dirtyClientId
    );
  } catch {
    return false;
  }
}

/** Blocks navbar links and other in-app anchors while invoice directions are unsaved. */
export function useInvoiceDirectionsNavigationGuard(): void {
  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      if (!dirtyClientId) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-invoice-directions-allow]')) return;

      const anchor = target.closest('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }
      try {
        if (new URL(href, window.location.origin).origin !== window.location.origin) return;
      } catch {
        return;
      }
      if (hrefStaysOnLockedClient(href)) return;
      if (alertAndBlockInvoiceDirectionsLeave()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyClientId) return;
      e.preventDefault();
      e.returnValue = '';
    };

    document.addEventListener('click', onClickCapture, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);
}
