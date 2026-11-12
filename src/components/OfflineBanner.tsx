import { useSyncExternalStore } from 'react';
import { isOffline, subscribeNetworkStatus } from '../api/http';

export const OFFLINE_BANNER_TEXT =
  'Offline — not saved. Your changes are kept on this page and will save when the connection returns.';

/** App-wide notice for weak or lost signal. Driven by navigator.onLine and failed (network-level) requests. */
export default function OfflineBanner() {
  const offline = useSyncExternalStore(subscribeNetworkStatus, isOffline, () => false);
  if (!offline) return null;
  return (
    <div
      role="alert"
      data-testid="offline-banner"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 2000,
        background: '#92400e',
        color: '#fff',
        padding: '8px 12px',
        fontSize: 14,
        textAlign: 'center',
      }}
    >
      {OFFLINE_BANNER_TEXT}
    </div>
  );
}
