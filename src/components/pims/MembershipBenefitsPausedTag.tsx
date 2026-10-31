import { Link } from 'react-router';
import type { PatientMembership } from '../../api/memberships';
import { membershipBenefitsPausedForPatient } from '../../utils/membershipLineUsage';

type Props = {
  memberships: PatientMembership[];
  patientId: number | null | undefined;
  className?: string;
  /** Opens the pet chart with Membership expanded. */
  linkToChart?: boolean;
};

export default function MembershipBenefitsPausedTag({
  memberships,
  patientId,
  className = 'membership-benefits-paused-tag',
  linkToChart = true,
}: Props) {
  const paused = membershipBenefitsPausedForPatient(memberships, patientId);
  if (!paused) return null;

  const title = [
    paused.reason ?? 'Benefits paused',
    'Charge regular prices until payment or the dispute is settled.',
    linkToChart ? 'Open Membership on the chart to resume or review billing.' : null,
  ]
    .filter(Boolean)
    .join(' ');

  const label = (
    <span className={className} title={title}>
      Benefits paused
    </span>
  );

  if (linkToChart && patientId != null) {
    return (
      <Link
        className={`${className} membership-benefits-paused-tag--link`}
        to={`/schedule/patients?patientId=${encodeURIComponent(String(patientId))}&focus=membership`}
        title={title}
      >
        Benefits paused
      </Link>
    );
  }

  return label;
}
