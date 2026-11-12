import { Link } from 'react-router';
import StoreGiftCardBalanceForm from './StoreGiftCardBalanceForm';
import { useStorePracticeId } from './useStorePracticeId';
import './Store.css';

export default function StoreGiftCardBalance() {
  const { practiceId } = useStorePracticeId();

  return (
    <div className="vayd-store__gift-balance">
      <Link className="vayd-store__pdp-nav" to="/store">
        ← Back to the store
      </Link>
      <h1>Check a gift card balance</h1>
      <StoreGiftCardBalanceForm practiceId={practiceId} />
    </div>
  );
}
