import type { HoldListItem } from '../api/holds';
import { HOLD_SOURCE_LABELS } from '../api/holds';
import {
  holdHouseholdPatientNames,
  type HoldHouseholdGroup,
} from './holdsHousehold';
import {
  holdDescriptionHaystack,
  holdHouseholdSupplementalNotes,
  holdPatientInlineNotes,
  resolveHoldClientLabel,
  resolveHoldPatientLabel,
} from './holdsDisplay';

function employeeName(
  e: { firstName: string | null; lastName: string | null } | null | undefined,
): string {
  if (!e) return '';
  return `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim();
}

function employeeSearchTerms(
  e: { firstName: string | null; lastName: string | null } | null | undefined,
): string[] {
  if (!e) return [];
  const first = e.firstName?.trim() ?? '';
  const last = e.lastName?.trim() ?? '';
  const full = [first, last].filter(Boolean).join(' ');
  return [first, last, full].filter(Boolean);
}

function holdOwnerSearchTerms(hold: HoldListItem): string[] {
  const terms = [
    ...employeeSearchTerms(hold.holdOwner),
    ...employeeSearchTerms(hold.createdByEmployee),
  ];
  if (hold.ownerBucket === 'owned') {
    terms.push('owned', 'owner');
    if (hold.ownerIsCurrentUser) terms.push('mine', 'my');
  }
  if (hold.ownerBucket === 'unassigned') {
    terms.push('unassigned');
  }
  if (hold.ownerBucket === 'non_cl_unassigned') {
    terms.push('unassigned', 'field');
  }
  const ownerName = employeeName(hold.holdOwner ?? hold.createdByEmployee);
  if (ownerName) terms.push(`owner ${ownerName}`, `owner: ${ownerName}`);
  return terms;
}

function holdSearchHaystack(hold: HoldListItem): string {
  const typeLabel =
    hold.appointmentType?.prettyName?.trim() ||
    hold.appointmentType?.name?.trim() ||
    '';
  const parts = [
    resolveHoldClientLabel(hold),
    resolveHoldPatientLabel(hold),
    hold.client?.phone1,
    hold.client?.email,
    typeLabel,
    employeeName(hold.primaryProvider),
    ...holdOwnerSearchTerms(hold),
    HOLD_SOURCE_LABELS[hold.source],
    hold.source.replace(/_/g, ' '),
    holdDescriptionHaystack(hold),
    hold.instructions,
    hold.forwardBooking?.bookingNotes,
    hold.forwardBooking?.note,
    hold.pimsId,
    hold.id ? String(hold.id) : '',
    hold.appointmentRequestSubmissionId
      ? String(hold.appointmentRequestSubmissionId)
      : '',
    ...holdPatientInlineNotes(hold),
  ];
  return parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function holdHouseholdGroupSearchHaystack(
  group: HoldHouseholdGroup,
  contactLogDraft?: string,
): string {
  const holds = group.holds;
  const parts = [
    ...holds.map(holdSearchHaystack),
    ...holdHouseholdPatientNames(holds),
    ...holdHouseholdSupplementalNotes(holds),
    contactLogDraft,
  ];
  return parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function holdHouseholdGroupMatchesSearch(
  group: HoldHouseholdGroup,
  query: string,
  contactLogDraft?: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return holdHouseholdGroupSearchHaystack(group, contactLogDraft).includes(q);
}
