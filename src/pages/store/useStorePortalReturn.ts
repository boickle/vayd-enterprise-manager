import { useSyncExternalStore } from 'react';
import {
  readStorePortalReturn,
  STORE_PORTAL_RETURN_EVENT,
  type StorePortalReturn,
} from './storeCartState';

function subscribe(cb: () => void) {
  window.addEventListener(STORE_PORTAL_RETURN_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(STORE_PORTAL_RETURN_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

// Snapshot must be referentially stable between reads when nothing changed,
// so compare on the raw string rather than re-parsing each time.
let lastRaw: string | null = null;
let lastValue: StorePortalReturn | null = null;
function getSnapshot(): StorePortalReturn | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem('vayd_store_from_portal');
  } catch {
    raw = null;
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastValue = readStorePortalReturn();
  }
  return lastValue;
}

/** Where (and whether) the shopper came from the client portal this session. */
export function useStorePortalReturn(): StorePortalReturn | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
