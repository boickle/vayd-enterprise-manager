import { useEffect } from 'react';
import StoreGiftCardBalanceForm from './StoreGiftCardBalanceForm';

export default function StoreGiftCardBalanceModal({
  practiceId,
  onClose,
}: {
  practiceId: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="vayd-store__modal-overlay" onClick={onClose}>
      <div
        className="vayd-store__modal"
        role="dialog"
        aria-labelledby="gift-balance-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vayd-store__modal-head">
          <h2 id="gift-balance-title">Check gift card balance</h2>
          <button type="button" className="vayd-store__modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <StoreGiftCardBalanceForm practiceId={practiceId} />
      </div>
    </div>
  );
}
