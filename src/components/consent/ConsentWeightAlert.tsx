import { formatWeightLbs, type ConsentWeightChange } from '../../utils/consentWeightAlert';
import './ConsentWeightAlert.css';

export default function ConsentWeightAlert({
  change,
  compact = false,
}: {
  change: ConsentWeightChange;
  compact?: boolean;
}) {
  return (
    <div className={`consent-weight-alert${compact ? ' is-compact' : ''}`} role="alert">
      <strong>Weight changed — confirm before calculating drugs</strong>
      <p>
        Chart had {formatWeightLbs(change.previousLbs)}. Owner entered{' '}
        {formatWeightLbs(change.nextLbs)}.
      </p>
    </div>
  );
}
