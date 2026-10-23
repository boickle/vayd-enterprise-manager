import { useEffect } from 'react';
import { useNavigate } from 'react-router';

const DIRTY_EVENT = 'vayd:invoice-directions-dirty';

let dirtyClientId: string | null = null;
let leaveSave: (() => Promise<void>) | null = null;
let leaveSaveInFlight: Promise<void> | null = null;

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

export function registerInvoiceDirectionsLeaveSave(fn: (() => Promise<void>) | null): void {
  leaveSave = fn;
}

/** Persist listed directions so staff can leave the invoice. Does not approve the script. */
export function flushInvoiceDirectionsOnLeave(): Promise<void> {
  if (!dirtyClientId || !leaveSave) return Promise.resolve();
  if (leaveSaveInFlight) return leaveSaveInFlight;
  leaveSaveInFlight = leaveSave()
    .catch(() => undefined)
    .finally(() => {
      leaveSaveInFlight = null;
      setInvoiceDirectionsDirty(null, false);
    });
  return leaveSaveInFlight;
}

/** Leaving the app is allowed; listed directions are saved in the background. */
export function blockInvoiceDirectionsLeave(): boolean {
  if (dirtyClientId) void flushInvoiceDirectionsOnLeave();
  return false;
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

function destinationFromHref(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Saves listed directions, then lets navbar / in-app links leave the invoice. */
export function useInvoiceDirectionsNavigationGuard(): void {
  const navigate = useNavigate();

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

      const dest = destinationFromHref(href);
      if (!dest) return;
      e.preventDefault();
      e.stopPropagation();
      void flushInvoiceDirectionsOnLeave().then(() => {
        navigate(dest);
      });
    };

    const onPageHide = () => {
      void flushInvoiceDirectionsOnLeave();
    };

    document.addEventListener('click', onClickCapture, true);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [navigate]);
}
