import { Heart } from 'lucide-react';
import type { ReactNode } from 'react';
import { BookPatientChartButton } from './BookPatientChartButton';

type Membership = {
  isMember: boolean;
  membershipName: string | null;
};

type Props = {
  patientId: string;
  patientName: string;
  practiceId: number;
  practiceTz: string;
  membership?: Membership | null;
  excludeAppointmentId?: string | number | null;
  isAnchor?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  checkboxDisabled?: boolean;
  showCheckbox?: boolean;
  rowClassName?: string;
  badges?: ReactNode;
  trailingMeta?: ReactNode;
};

export function SchedulerHouseholdPetRow({
  patientId,
  patientName,
  practiceId,
  practiceTz,
  membership = null,
  excludeAppointmentId = null,
  isAnchor = false,
  checked = false,
  onCheckedChange,
  checkboxDisabled = false,
  showCheckbox = true,
  rowClassName = '',
  badges = null,
  trailingMeta = null,
}: Props) {
  const displayName = patientName.trim() || `Pet ${patientId}`;
  const isMember = membership?.isMember === true;
  const membershipLabel = membership?.membershipName?.trim() || 'Member';

  const rowClasses = [
    'scheduler-household-pet-row',
    isAnchor ? 'scheduler-household-pet-row--anchor' : '',
    rowClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {showCheckbox ? (
        <input
          type="checkbox"
          checked={checked}
          disabled={checkboxDisabled}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
        />
      ) : null}
      <span className="scheduler-household-pet-row-main">
        <span className="scheduler-household-pet-row-name">
          {isMember ? (
            <Heart
              size={11}
              fill="#dc2626"
              color="#dc2626"
              strokeWidth={1.75}
              aria-hidden
              className="scheduler-household-pet-row-heart"
            />
          ) : null}
          <strong>{displayName}</strong>
          {badges}
          {isMember ? (
            <span className="scheduler-household-pet-row-membership" title={membershipLabel}>
              {membershipLabel}
            </span>
          ) : null}
          {trailingMeta}
        </span>
        <BookPatientChartButton
          patientId={patientId}
          patientName={displayName}
          practiceId={practiceId}
          practiceTz={practiceTz}
          excludeAppointmentId={excludeAppointmentId}
          isMember={isMember}
          membershipName={membership?.membershipName ?? null}
          label="View details"
          showAlerts
        />
      </span>
    </>
  );

  if (showCheckbox) {
    return (
      <label className={rowClasses}>
        {content}
      </label>
    );
  }

  return <div className={rowClasses}>{content}</div>;
}
