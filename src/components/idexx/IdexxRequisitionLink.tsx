import { useState } from 'react';
import { FileText } from 'lucide-react';
import { syncIdexxOrder, type IdexxOrder, type IdexxSyncResult } from '../../api/idexx';
import './Idexx.css';

type Props = {
  order: Pick<IdexxOrder, 'id' | 'status' | 'pdfUrl'>;
  /** Re-reads the order from IDEXX; defaults to a plain sync. */
  onSync?: (orderId: number) => Promise<IdexxSyncResult>;
};

/**
 * The IDEXX requisition PDF for a submitted order. The stored link carries an IDEXX token
 * that can expire, so a fresh one is fetched on click (falling back to the stored one).
 */
export default function IdexxRequisitionLink({ order, onSync = syncIdexxOrder }: Props) {
  const [busy, setBusy] = useState(false);
  if (order.status !== 'SUBMITTED' || !order.pdfUrl) return null;

  async function open() {
    // Open the tab now, while the click still counts, so the browser doesn't block it.
    const tab = window.open('', '_blank');
    setBusy(true);
    let url = order.pdfUrl!;
    try {
      url = (await onSync(order.id)).order.pdfUrl ?? url;
    } catch {
      // The stored link may still work.
    } finally {
      setBusy(false);
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  return (
    <button
      type="button"
      className="idexx-requisition-link"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        void open();
      }}
    >
      <FileText size={12} aria-hidden /> {busy ? 'Opening…' : 'Requisition form'}
    </button>
  );
}
