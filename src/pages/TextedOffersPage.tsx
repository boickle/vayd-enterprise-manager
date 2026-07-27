import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DateTime } from 'luxon';
import { useNavigate, useSearchParams } from 'react-router';
import {
  fetchSlotOfferDetail,
  fetchSlotOffers,
  removeSlotOffer,
  resolveSlotOffer,
  type SlotOfferDetail,
  type SlotOfferListItem,
  type SlotOfferListTab,
  type SlotOfferStatus,
} from '../api/slotOffers';
import { sendClientSms, fetchSchedulingOutreachSmsFrom } from '../api/clientSms';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { CareOutreachPetDetailsButton } from '../components/CareOutreachPetDetailsButton';
import { ClientMessagesHistoryModal } from '../components/ClientMessagesHistoryModal';
import { ClientSmsComposeModal } from '../components/ClientSmsComposeModal';
import { notifySchedulingToolsNavCountsRefresh, SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, useSchedulingToolsNavCounts } from '../hooks/useSchedulingToolsNavCounts';
import SchedulingToolsListPagination, {
  paginateSchedulingToolsList,
  schedulingToolsListTotalPages,
} from '../components/SchedulingToolsListPagination';
import { formatForwardBookingSmsBookedSlot } from '../utils/forwardBookingSmsMessage';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import { resolveQuoFromLine } from '../utils/quoContact';
import {
  buildSchedulerFocusAppointmentUrl,
  writeSchedulerFocusSession,
} from '../utils/schedulerFocusAppointment';
import {
  TEXTED_OFFERS_TO_REVIEW_PATH,
  writeSlotOfferReviewSession,
} from '../utils/slotOfferReviewSession';
import {
  clearSlotOfferReviewReturnSession,
  readSlotOfferReviewReturnSession,
} from '../utils/slotOfferReviewReturnSession';
import './Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const TEXTED_OFFERS_TAB_PARAM = 'tab';
const TEXTED_OFFERS_TAB_KEYS: SlotOfferListTab[] = [
  'active',
  'to_confirm',
  'booked',
  'expired',
  'removed',
];

function parseTextedOffersTabParam(raw: string | null): SlotOfferListTab {
  if (raw && (TEXTED_OFFERS_TAB_KEYS as string[]).includes(raw)) {
    return raw as SlotOfferListTab;
  }
  return 'active';
}

const LIST_TABS: { key: SlotOfferListTab; label: string; description: string }[] = [
  {
    key: 'active',
    label: 'Active',
    description: 'Pending offers, unresolved manual review, and superseded rows with a retry in flight.',
  },
  {
    key: 'to_confirm',
    label: 'To review',
    description: 'Client accepted the offer — verify the visit is on the calendar, then mark reviewed.',
  },
  {
    key: 'booked',
    label: 'Booked',
    description: 'Offers staff reviewed on the calendar, or marked booked after manual follow-up.',
  },
  {
    key: 'expired',
    label: 'Expired',
    description: 'Offers whose arrival window has passed without a booking.',
  },
  {
    key: 'removed',
    label: 'Removed',
    description: 'Offers hidden from active tabs after staff removed them from the queue.',
  },
];

function isRemovedOffer(row: Pick<SlotOfferListItem, 'removedAt'>): boolean {
  return Boolean(row.removedAt?.trim());
}

function isStaffBookedOffer(
  row: Pick<SlotOfferListItem, 'bookedAppointmentId' | 'status' | 'resolved'>
): boolean {
  return row.status === 'manual_review' && row.resolved === true && row.bookedAppointmentId == null;
}

function isToConfirmOffer(
  row: Pick<SlotOfferListItem, 'bookedAppointmentId' | 'staffConfirmedAt' | 'removedAt'>
): boolean {
  return (
    row.bookedAppointmentId != null &&
    !row.staffConfirmedAt?.trim() &&
    !isRemovedOffer(row)
  );
}

function isBookedOffer(
  row: Pick<
    SlotOfferListItem,
    'bookedAppointmentId' | 'status' | 'resolved' | 'staffConfirmedAt'
  >
): boolean {
  if (isStaffBookedOffer(row)) return true;
  if (row.bookedAppointmentId != null && Boolean(row.staffConfirmedAt?.trim())) return true;
  return false;
}

function statusLabel(status: SlotOfferStatus, row: SlotOfferListItem): string {
  const removed = isRemovedOffer(row);
  const booked = isBookedOffer(row);
  const toConfirm = isToConfirmOffer(row);
  if (removed) return 'Removed';
  if (toConfirm) return 'To review';
  if (booked) return 'Booked';
  if (status === 'manual_review') return row.resolved ? 'Booked' : 'Needs follow-up';
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'expired':
      return 'Expired';
    case 'superseded':
      return 'Superseded';
    case 'accepted':
      return toConfirm ? 'To review' : 'Booked';
    default:
      return status;
  }
}

function statusBadgeStyle(status: SlotOfferStatus, row: SlotOfferListItem): CSSProperties {
  const removed = isRemovedOffer(row);
  const booked = isBookedOffer(row);
  const toConfirm = isToConfirmOffer(row);
  if (removed) {
    return { background: '#f3f4f6', color: '#6b7280', border: '1px solid #d1d5db' };
  }
  if (toConfirm) {
    return { background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd' };
  }
  if (booked || status === 'accepted') {
    return { background: '#059669', color: '#fff', border: '1px solid #047857' };
  }
  if (status === 'manual_review' && !row.resolved) {
    return { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' };
  }
  switch (status) {
    case 'pending':
      return { background: '#ecfdf5', color: '#047857', border: '1px solid #6ee7b7' };
    case 'expired':
      return { background: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db' };
    case 'superseded':
      return { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #93c5fd' };
    case 'manual_review':
      return { background: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db' };
    default:
      return { background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb' };
  }
}

function formatSentAt(iso: string | null | undefined, practiceTz: string): string {
  const raw = iso?.trim();
  if (!raw) return '—';
  const dt = DateTime.fromISO(raw, { zone: 'utc' }).setZone(practiceTz);
  const resolved = dt.isValid ? dt : DateTime.fromISO(raw, { setZone: true });
  return resolved.isValid ? resolved.toFormat('MM/dd/yyyy h:mm a') : raw;
}

function formatOfferSlot(
  row: Pick<
    SlotOfferListItem,
    'offeredSlotDatetime' | 'arrivalWindowStart' | 'arrivalWindowEnd' | 'slotDate'
  >,
  practiceTz: string
): string {
  const start = row.arrivalWindowStart?.trim();
  const end = row.arrivalWindowEnd?.trim();
  if (start && end) {
    const window = formatForwardBookingSmsBookedSlot(
      start,
      end,
      practiceTz,
      row.slotDate?.trim() || undefined
    );
    return `${window.dateLabel} · ${window.windowStart} – ${window.windowEnd}`;
  }
  const sched = row.offeredSlotDatetime?.trim();
  if (!sched) return '—';
  const dt = DateTime.fromISO(sched, { zone: 'utc' }).setZone(practiceTz);
  const resolved = dt.isValid ? dt : DateTime.fromISO(sched, { setZone: true });
  return resolved.isValid ? resolved.toFormat('EEE, MMM d · h:mm a') : sched;
}

function petLabel(row: SlotOfferListItem): string {
  const names = row.petNames?.filter(Boolean);
  if (names?.length) return names.join(', ');
  const ids = row.petIds?.filter((id) => Number.isFinite(id));
  if (ids?.length) return ids.map((id) => `#${id}`).join(', ');
  return '—';
}

function needsFollowUp(row: SlotOfferListItem): boolean {
  return row.status === 'manual_review' && row.resolved !== true;
}

function canMarkBooked(row: SlotOfferListItem): boolean {
  if (isRemovedOffer(row)) return false;
  if (isBookedOffer(row) || isToConfirmOffer(row)) return false;
  return (
    row.status === 'pending' ||
    row.status === 'expired' ||
    row.status === 'superseded' ||
    needsFollowUp(row)
  );
}

function canStaffConfirm(row: SlotOfferListItem): boolean {
  return isToConfirmOffer(row);
}

function formatDurationMinutes(mins: number | null | undefined): string | null {
  if (mins == null || !Number.isFinite(mins) || mins <= 0) return null;
  return `${Math.round(mins)} min`;
}

function resolveOfferBookVisits(detail: SlotOfferDetail): SlotOfferDetail['bookVisits'] {
  if (detail.bookVisits?.length) return detail.bookVisits;
  const petIds = detail.petIds?.filter((id) => Number.isFinite(id)) ?? [];
  const petNames = detail.petNames?.filter(Boolean) ?? [];
  if (petIds.length === 0 && petNames.length === 0) return undefined;
  const ids = petIds.length > 0 ? petIds : petNames.map((_, idx) => idx);
  return ids.map((patientId, idx) => ({
    patientId: Number.isFinite(patientId) ? patientId : idx,
    petName: petNames[idx]?.trim() || (Number.isFinite(patientId) ? `Pet #${patientId}` : 'Pet'),
    appointmentTypeId: detail.appointmentTypeId ?? 0,
    appointmentTypeName: detail.appointmentTypeName,
    durationMinutes: null,
    description: detail.bookDescription,
    instructions: detail.bookInstructions,
  }));
}

function OfferBookingDetails({
  detail,
  practiceTz,
}: {
  detail: SlotOfferDetail;
  practiceTz: string;
}) {
  const visits = resolveOfferBookVisits(detail) ?? [];
  const totalSlot = detail.serviceMinutes;
  const hasContent =
    visits.length > 0 ||
    totalSlot != null ||
    detail.appointmentTypeName ||
    detail.bookDescription ||
    detail.bookInstructions;
  if (!hasContent) return null;

  const perPetDurationTotal = visits.reduce((sum, visit) => sum + (visit.durationMinutes ?? 0), 0);

  return (
    <div>
      <strong>Visit details</strong>
      {totalSlot != null ? (
        <p className="settings-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          Total slot duration: {formatDurationMinutes(totalSlot) ?? `${totalSlot} min`}
          {visits.length > 1 &&
          perPetDurationTotal > 0 &&
          perPetDurationTotal !== totalSlot
            ? ` · ${formatDurationMinutes(perPetDurationTotal)} across pets`
            : null}
        </p>
      ) : null}
      {visits.length > 0 ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {visits.map((visit) => (
            <div
              key={`${visit.patientId}-${visit.appointmentTypeId}`}
              style={{
                padding: '8px 10px',
                background: '#fff',
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontWeight: 600 }}>{visit.petName}</div>
                {Number.isFinite(visit.patientId) && visit.patientId > 0 ? (
                  <CareOutreachPetDetailsButton
                    patientId={visit.patientId}
                    patientName={visit.petName}
                    practiceTz={practiceTz}
                  />
                ) : null}
              </div>
              <div style={{ marginTop: 4, display: 'grid', gap: 4, fontSize: 13 }}>
                {visit.appointmentTypeName ? (
                  <div>
                    <span className="settings-muted">Type: </span>
                    {visit.appointmentTypeName}
                  </div>
                ) : null}
                {visit.durationMinutes != null ? (
                  <div>
                    <span className="settings-muted">Duration: </span>
                    {formatDurationMinutes(visit.durationMinutes)}
                  </div>
                ) : null}
                {visit.description?.trim() ? (
                  <div>
                    <span className="settings-muted">Appt notes: </span>
                    <span style={{ whiteSpace: 'pre-wrap' }}>{visit.description.trim()}</span>
                  </div>
                ) : null}
                {visit.instructions?.trim() ? (
                  <div>
                    <span className="settings-muted">Staff notes: </span>
                    <span style={{ whiteSpace: 'pre-wrap' }}>{visit.instructions.trim()}</span>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type TextedOffersProviderOption = {
  id: string;
  label: string;
};

function buildTextedOffersProviderOptions(rows: readonly SlotOfferListItem[]): TextedOffersProviderOption[] {
  const byId = new Map<string, string>();
  for (const row of rows) {
    const name = row.doctorName?.trim();
    const id =
      row.doctorId != null && Number.isFinite(Number(row.doctorId))
        ? String(row.doctorId)
        : name
          ? `name:${name.toLowerCase()}`
          : null;
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, name || `Doctor #${row.doctorId}`);
  }
  return [...byId.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

function resolveSlotOfferSmsFromLine(
  detail: Pick<SlotOfferDetail, 'doctorId' | 'smsFrom'>,
  providers: readonly Provider[],
  practiceMainPhone: string | null
): string | null {
  const fromApi = detail.smsFrom?.trim();
  if (fromApi) return fromApi;
  if (practiceMainPhone?.trim()) return practiceMainPhone.trim();
  const doctorId = detail.doctorId;
  if (doctorId != null && Number.isFinite(Number(doctorId))) {
    const fromDoctor = resolveQuoFromLine({
      appointmentPrimaryProvider: { id: doctorId },
      providers,
    });
    if (fromDoctor) return fromDoctor;
  }
  return null;
}

function textedOfferProviderFilterId(row: SlotOfferListItem): string | null {
  const name = row.doctorName?.trim();
  if (row.doctorId != null && Number.isFinite(Number(row.doctorId))) {
    return String(row.doctorId);
  }
  return name ? `name:${name.toLowerCase()}` : null;
}

function textedOfferMatchesSearch(row: SlotOfferListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const clientName = row.clientName?.trim().toLowerCase() ?? '';
  const clientId = row.clientId != null ? String(row.clientId) : '';
  const petNames = (row.petNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean);
  const petIds = (row.petIds ?? []).map(String);
  return (
    clientName.includes(q) ||
    clientId.includes(q) ||
    petNames.some((name) => name.includes(q)) ||
    petIds.some((id) => id.includes(q))
  );
}

function sortOffers(rows: SlotOfferListItem[], tab: SlotOfferListTab): SlotOfferListItem[] {
  return [...rows].sort((a, b) => {
    if (tab === 'removed') {
      const aRemoved = a.removedAt ? DateTime.fromISO(a.removedAt).toMillis() : 0;
      const bRemoved = b.removedAt ? DateTime.fromISO(b.removedAt).toMillis() : 0;
      if (aRemoved !== bRemoved) return bRemoved - aRemoved;
      const aSlot = a.offeredSlotDatetime ? DateTime.fromISO(a.offeredSlotDatetime).toMillis() : 0;
      const bSlot = b.offeredSlotDatetime ? DateTime.fromISO(b.offeredSlotDatetime).toMillis() : 0;
      return bSlot - aSlot;
    }
    if (tab === 'booked' || tab === 'to_confirm') {
      const aResponded = a.respondedAt ? DateTime.fromISO(a.respondedAt).toMillis() : 0;
      const bResponded = b.respondedAt ? DateTime.fromISO(b.respondedAt).toMillis() : 0;
      if (aResponded !== bResponded) return bResponded - aResponded;
      const aSlot = a.offeredSlotDatetime ? DateTime.fromISO(a.offeredSlotDatetime).toMillis() : 0;
      const bSlot = b.offeredSlotDatetime ? DateTime.fromISO(b.offeredSlotDatetime).toMillis() : 0;
      return bSlot - aSlot;
    }
    const aFollow = needsFollowUp(a) ? 0 : 1;
    const bFollow = needsFollowUp(b) ? 0 : 1;
    if (aFollow !== bFollow) return aFollow - bFollow;
    const aSent = a.sentAt ? DateTime.fromISO(a.sentAt).toMillis() : 0;
    const bSent = b.sentAt ? DateTime.fromISO(b.sentAt).toMillis() : 0;
    return bSent - aSent;
  });
}

function slotOfferAppointmentDateHint(
  detail: Pick<
    SlotOfferDetail,
    'offeredSlotDatetime' | 'arrivalWindowStart' | 'arrivalWindowEnd' | 'slotDate'
  >,
  practiceTz: string
): string | null {
  for (const raw of [detail.slotDate, detail.offeredSlotDatetime, detail.arrivalWindowStart]) {
    if (!raw?.trim()) continue;
    const trimmed = raw.trim();
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? DateTime.fromISO(trimmed, { zone: practiceTz })
      : trimmed.includes('T')
        ? DateTime.fromISO(trimmed, { zone: 'utc' }).setZone(practiceTz)
        : DateTime.fromISO(trimmed, { zone: practiceTz });
    if (dt.isValid) return dt.toISODate();
  }
  return null;
}

function OfferDetailPanel({
  detail,
  practiceTz,
  smsFromLine,
  resolving,
  resolveError,
  removing,
  removeError,
  showRemove,
  onResolve,
  onRemove,
  onTextClient,
  onViewAppointment,
  onReviewAppointment,
}: {
  detail: SlotOfferDetail;
  practiceTz: string;
  smsFromLine: string | null;
  resolving: boolean;
  resolveError: string | null;
  removing: boolean;
  removeError: string | null;
  showRemove: boolean;
  onResolve: () => void;
  onRemove: () => void;
  onTextClient: () => void;
  onViewAppointment: () => void;
  onReviewAppointment: () => void;
}) {
  const hasBookedAppointment =
    detail.bookedAppointmentId != null && Number(detail.bookedAppointmentId) > 0;
  const needsReview = canStaffConfirm(detail);
  return (
    <div
      style={{
        padding: '12px 16px',
        background: '#fafafa',
        borderTop: '1px solid var(--border, #e5e7eb)',
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: 'grid', gap: 8, maxWidth: 720 }}>
        {detail.smsBody?.trim() ? (
          <div>
            <strong>Text sent</strong>
            {smsFromLine ? (
              <p className="settings-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                From {smsFromLine}
              </p>
            ) : null}
            <div
              style={{
                marginTop: 4,
                whiteSpace: 'pre-wrap',
                padding: '8px 10px',
                background: '#fff',
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 8,
              }}
            >
              {detail.smsBody.trim()}
            </div>
          </div>
        ) : null}
        <OfferBookingDetails detail={detail} practiceTz={practiceTz} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px' }}>
          {detail.offeredSlotScore != null ? (
            <span>
              <strong>Offer score:</strong> {detail.offeredSlotScore}
            </span>
          ) : null}
          {detail.tapScore != null ? (
            <span>
              <strong>Tap score:</strong> {detail.tapScore}
            </span>
          ) : null}
          {detail.respondedAt ? (
            <span>
              <strong>Link opened:</strong>{' '}
              {DateTime.fromISO(detail.respondedAt, { zone: 'utc' })
                .setZone(practiceTz)
                .toFormat('MMM d, yyyy · h:mm a')}
            </span>
          ) : null}
          {detail.attemptNumber != null ? (
            <span>
              <strong>Attempt:</strong> {detail.attemptNumber}
            </span>
          ) : null}
        </div>
        {detail.manualReviewReason?.trim() ? (
          <div>
            <strong>Manual review reason:</strong> {detail.manualReviewReason.trim()}
          </div>
        ) : null}
        {detail.clientDeclineNote?.trim() ? (
          <div>
            <strong>Client preferred times:</strong>
            <div
              style={{
                marginTop: 4,
                whiteSpace: 'pre-wrap',
                padding: '8px 10px',
                background: '#fff',
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 8,
              }}
            >
              {detail.clientDeclineNote.trim()}
            </div>
          </div>
        ) : null}
        {detail.clientId != null ||
        hasBookedAppointment ||
        canMarkBooked(detail) ||
        canStaffConfirm(detail) ||
        showRemove ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 4 }}>
            {detail.clientId != null ? (
              <button type="button" className="btn secondary" onClick={onTextClient}>
                Text client
              </button>
            ) : null}
            {needsReview ? (
              <button type="button" className="btn primary" onClick={onReviewAppointment}>
                Review appointment
              </button>
            ) : hasBookedAppointment ? (
              <button type="button" className="btn secondary" onClick={onViewAppointment}>
                View appointment
              </button>
            ) : null}
            {canMarkBooked(detail) ? (
              <>
                <button type="button" className="btn secondary" disabled={resolving} onClick={onResolve}>
                  {resolving ? 'Saving…' : 'Mark booked'}
                </button>
                {resolveError ? (
                  <span style={{ color: '#b91c1c', fontSize: 13 }}>{resolveError}</span>
                ) : null}
              </>
            ) : null}
            {showRemove ? (
              <>
                <button type="button" className="btn secondary" disabled={removing} onClick={onRemove}>
                  {removing ? 'Removing…' : 'Remove'}
                </button>
                {removeError ? (
                  <span style={{ color: '#b91c1c', fontSize: 13 }}>{removeError}</span>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {needsReview ? (
          <p className="settings-muted" style={{ margin: 0, fontSize: 13 }}>
            Client accepted this offer and a visit was created — open Review appointment to verify
            on the calendar, then mark reviewed.
          </p>
        ) : null}
        {isBookedOffer(detail) ? (
          <p className="settings-muted" style={{ margin: 0, fontSize: 13 }}>
            {isStaffBookedOffer(detail)
              ? 'Marked booked by staff after follow-up.'
              : 'Staff reviewed this offer on the calendar.'}
          </p>
        ) : null}
        {isRemovedOffer(detail) ? (
          <p className="settings-muted" style={{ margin: 0, fontSize: 13 }}>
            Removed from the active queue
            {detail.removedAt ? ` on ${formatSentAt(detail.removedAt, practiceTz)}` : ''}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function textedOffersTabLabel(
  key: SlotOfferListTab,
  label: string,
  counts: { textedOffersActive: number; textedOffersToConfirm: number },
  countsLoading: boolean
): string {
  if (countsLoading) return label;
  if (key === 'active') return `${label} (${counts.textedOffersActive})`;
  if (key === 'to_confirm') return `${label} (${counts.textedOffersToConfirm})`;
  return label;
}

export default function TextedOffersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const practiceTz = practiceTimeZoneOrDefault(undefined);
  const tab = parseTextedOffersTabParam(searchParams.get(TEXTED_OFFERS_TAB_PARAM));

  const setTab = useCallback(
    (next: SlotOfferListTab) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'active') {
            params.delete(TEXTED_OFFERS_TAB_PARAM);
          } else {
            params.set(TEXTED_OFFERS_TAB_PARAM, next);
          }
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const [rows, setRows] = useState<SlotOfferListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, SlotOfferDetail | null>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [detailError, setDetailError] = useState<Record<string, string | null>>({});
  const [resolving, setResolving] = useState<Record<string, boolean>>({});
  const [resolveError, setResolveError] = useState<Record<string, string | null>>({});
  const [removing, setRemoving] = useState<Record<string, boolean>>({});
  const [removeError, setRemoveError] = useState<Record<string, string | null>>({});
  const [search, setSearch] = useState('');
  const [listPage, setListPage] = useState(1);
  const [providerFilterId, setProviderFilterId] = useState<string>('all');
  const [smsTarget, setSmsTarget] = useState<{
    clientId: number;
    clientLabel: string;
    fromLine: string | null;
  } | null>(null);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [messagesClientId, setMessagesClientId] = useState<number | null>(null);
  const [messagesClientLabel, setMessagesClientLabel] = useState('');
  const [messagesFromLine, setMessagesFromLine] = useState<string | null>(null);
  const [practiceMainPhone, setPracticeMainPhone] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [reviewExitOfferId, setReviewExitOfferId] = useState<string | null>(null);
  const pendingReviewReturnRef = useRef<string | null>(null);
  const { counts: navCounts, loading: navCountsLoading } = useSchedulingToolsNavCounts(true);

  const load = useCallback(async () => {
    const pendingReturn = readSlotOfferReviewReturnSession();
    if (pendingReturn) {
      clearSlotOfferReviewReturnSession();
      pendingReviewReturnRef.current = pendingReturn.offerId;
    }

    setLoading(true);
    setError(null);
    try {
      const list = await fetchSlotOffers({ practiceId: PRACTICE_ID, tab });
      setRows(sortOffers(list, tab));

      const reviewedOfferId = pendingReviewReturnRef.current;
      if (reviewedOfferId) {
        pendingReviewReturnRef.current = null;
        setReviewExitOfferId(reviewedOfferId);
        window.setTimeout(() => setReviewExitOfferId(null), 1100);
        notifySchedulingToolsNavCountsRefresh();
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not load texted offers.';
      setError(String(msg));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setExpandedId(null);
    setDetailById({});
    void load();
  }, [load]);

  useEffect(() => {
    const onPageRefresh = () => {
      setExpandedId(null);
      setDetailById({});
      void load();
    };
    window.addEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onPageRefresh);
    return () => window.removeEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onPageRefresh);
  }, [load]);

  const activeTabMeta = useMemo(() => LIST_TABS.find((t) => t.key === tab), [tab]);

  const providerOptions = useMemo(() => buildTextedOffersProviderOptions(rows), [rows]);

  useEffect(() => {
    if (providerFilterId === 'all') return;
    const valid = providerOptions.some((option) => option.id === providerFilterId);
    if (!valid) setProviderFilterId('all');
  }, [providerFilterId, providerOptions]);

  const filteredRows = useMemo(() => {
    const q = search.trim();
    return sortOffers(
      rows.filter((row) => {
        if (providerFilterId !== 'all' && textedOfferProviderFilterId(row) !== providerFilterId) {
          return false;
        }
        return textedOfferMatchesSearch(row, q);
      }),
      tab
    );
  }, [rows, search, providerFilterId, tab]);

  const rowsForDisplay = useMemo(
    () => paginateSchedulingToolsList(filteredRows, listPage),
    [filteredRows, listPage],
  );

  useEffect(() => {
    setListPage(1);
  }, [search, providerFilterId, tab]);

  useEffect(() => {
    const totalPages = schedulingToolsListTotalPages(filteredRows.length);
    if (listPage > totalPages) setListPage(totalPages);
  }, [listPage, filteredRows.length]);

  const changeListPage = useCallback((page: number) => {
    setListPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    setExpandedId(null);
  }, [search, providerFilterId, tab]);

  const toggleExpand = useCallback(
    async (offerId: string) => {
      if (expandedId === offerId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(offerId);
      if (detailById[offerId] !== undefined || detailLoading[offerId]) return;
      setDetailLoading((prev) => ({ ...prev, [offerId]: true }));
      setDetailError((prev) => ({ ...prev, [offerId]: null }));
      try {
        const detail = await fetchSlotOfferDetail(offerId, PRACTICE_ID);
        setDetailById((prev) => ({ ...prev, [offerId]: detail }));
        if (!detail) {
          setDetailError((prev) => ({ ...prev, [offerId]: 'Could not load offer details.' }));
        }
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not load offer details.';
        setDetailError((prev) => ({ ...prev, [offerId]: String(msg) }));
        setDetailById((prev) => ({ ...prev, [offerId]: null }));
      } finally {
        setDetailLoading((prev) => ({ ...prev, [offerId]: false }));
      }
    },
    [detailById, detailLoading, expandedId]
  );

  useEffect(() => {
    void fetchSchedulingOutreachSmsFrom().then((phone) => {
      if (phone) setPracticeMainPhone(phone);
    });
    void fetchPrimaryProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  const closeSmsModal = useCallback(() => {
    setSmsTarget(null);
    setSmsMessage('');
    setSmsError(null);
  }, []);

  const openTextClientModal = useCallback(
    (detail: SlotOfferDetail, fromLine: string | null) => {
      if (detail.clientId == null) return;
      const clientLabel =
        detail.clientName?.trim() ||
        (detail.clientId != null ? `Client #${detail.clientId}` : 'client');
      setSmsError(null);
      setSmsMessage('');
      setSmsTarget({ clientId: detail.clientId, clientLabel, fromLine });
    },
    []
  );

  const handleSendSms = useCallback(
    async (opts: { overrideNonProd: boolean }) => {
      if (!smsTarget || !smsMessage.trim()) return;
      setSmsSending(true);
      setSmsError(null);
      try {
        await sendClientSms(smsTarget.clientId, {
          message: smsMessage.trim(),
          useRemindersFrom: true,
          source: 'slot_offer',
          ...(opts.overrideNonProd ? { overrideNonProd: true } : {}),
        });
        closeSmsModal();
      } catch (e: unknown) {
        const ax = e as { response?: { data?: { message?: string } }; message?: string };
        setSmsError(ax?.response?.data?.message ?? ax?.message ?? 'Failed to send text message.');
      } finally {
        setSmsSending(false);
      }
    },
    [closeSmsModal, smsMessage, smsTarget]
  );

  const onMarkBooked = useCallback(
    async (offerId: string) => {
      setResolving((prev) => ({ ...prev, [offerId]: true }));
      setResolveError((prev) => ({ ...prev, [offerId]: null }));
      try {
        await resolveSlotOffer(offerId, PRACTICE_ID);
        await load();
        notifySchedulingToolsNavCountsRefresh();
        if (expandedId === offerId) {
          setExpandedId(null);
        }
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not mark booked.';
        setResolveError((prev) => ({ ...prev, [offerId]: String(msg) }));
      } finally {
        setResolving((prev) => ({ ...prev, [offerId]: false }));
      }
    },
    [expandedId, load]
  );

  const onReviewAppointment = useCallback(
    (detail: SlotOfferDetail, offerId: string) => {
      const apptId = detail.bookedAppointmentId;
      if (apptId == null || !Number.isFinite(Number(apptId)) || Number(apptId) <= 0) return;
      const appointmentId = Number(apptId);
      const dateKey = slotOfferAppointmentDateHint(detail, practiceTz);
      const providerId =
        detail.doctorId != null && detail.doctorId > 0 ? String(detail.doctorId) : undefined;
      const clientLabel =
        detail.clientName?.trim() ||
        (detail.clientId != null ? `Client #${detail.clientId}` : null);
      writeSlotOfferReviewSession({
        offerId,
        bookedAppointmentId: appointmentId,
        clientLabel,
        returnPath: TEXTED_OFFERS_TO_REVIEW_PATH,
      });
      writeSchedulerFocusSession({
        appointmentId,
        dateHint: dateKey,
        providerHint: providerId ?? null,
      });
      navigate(
        buildSchedulerFocusAppointmentUrl(appointmentId, {
          date: dateKey ?? undefined,
          providerId,
        })
      );
    },
    [navigate, practiceTz]
  );

  const onViewAppointment = useCallback(
    (detail: SlotOfferDetail) => {
      const apptId = detail.bookedAppointmentId;
      if (apptId == null || !Number.isFinite(Number(apptId)) || Number(apptId) <= 0) return;
      const appointmentId = Number(apptId);
      const dateKey = slotOfferAppointmentDateHint(detail, practiceTz);
      const providerId =
        detail.doctorId != null && detail.doctorId > 0 ? String(detail.doctorId) : undefined;
      writeSchedulerFocusSession({
        appointmentId,
        dateHint: dateKey,
        providerHint: providerId ?? null,
      });
      navigate(
        buildSchedulerFocusAppointmentUrl(appointmentId, {
          date: dateKey ?? undefined,
          providerId,
        })
      );
    },
    [navigate, practiceTz]
  );

  const onRemove = useCallback(
    async (offerId: string) => {
      setRemoving((prev) => ({ ...prev, [offerId]: true }));
      setRemoveError((prev) => ({ ...prev, [offerId]: null }));
      try {
        await removeSlotOffer(offerId, PRACTICE_ID);
        await load();
        notifySchedulingToolsNavCountsRefresh();
        if (expandedId === offerId) {
          setExpandedId(null);
        }
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not remove offer.';
        setRemoveError((prev) => ({ ...prev, [offerId]: String(msg) }));
      } finally {
        setRemoving((prev) => ({ ...prev, [offerId]: false }));
      }
    },
    [expandedId, load]
  );

  return (
    <div>
      <h2 className="settings-card-title" style={{ marginTop: 0 }}>
        Texted offers
      </h2>
      <p className="settings-section-description" style={{ marginBottom: 16 }}>
        SMS appointment offers sent from care outreach or schedule loader. Expand a row for the message,
        scores, and follow-up actions.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {LIST_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`btn${tab === t.key ? '' : ' secondary'}`}
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
          >
            {textedOffersTabLabel(t.key, t.label, navCounts, navCountsLoading)}
          </button>
        ))}
      </div>
      {activeTabMeta?.description ? (
        <p className="settings-muted" style={{ marginTop: 0, marginBottom: 16 }}>
          {activeTabMeta.description}
        </p>
      ) : null}

      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'flex-end',
        }}
      >
        <div style={{ flex: '0 1 220px', minWidth: 180 }}>
          <label
            htmlFor="texted-offers-provider-filter"
            className="settings-muted"
            style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}
          >
            Provider
          </label>
          <select
            id="texted-offers-provider-filter"
            className="settings-input"
            value={providerFilterId}
            onChange={(e) => setProviderFilterId(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="all">All</option>
            {providerOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
          <label
            htmlFor="texted-offers-search"
            className="settings-muted"
            style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}
          >
            Search
          </label>
          <input
            id="texted-offers-search"
            type="search"
            className="settings-input"
            placeholder="Client or patient name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search texted offers by client or patient"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {error ? (
        <p style={{ color: '#b91c1c' }} role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="settings-muted">Loading…</p>
      ) : filteredRows.length === 0 ? (
        <p className="settings-muted">
          {rows.length === 0
            ? tab === 'active'
              ? 'No active texted offers.'
              : tab === 'to_confirm'
                ? 'No offers waiting for staff review.'
                : tab === 'booked'
                  ? 'No booked texted offers.'
                  : tab === 'removed'
                    ? 'No removed texted offers.'
                    : 'No expired texted offers.'
            : 'No texted offers match the current filters.'}
        </p>
      ) : (
        <>
          <SchedulingToolsListPagination
            listPage={listPage}
            totalItems={filteredRows.length}
            onPageChange={changeListPage}
            itemLabel="offers"
          />
        <div className="settings-table-container">
          <table className="settings-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} aria-label="Expand" />
                <th>Client</th>
                <th>Pets</th>
                <th>Doctor</th>
                <th>Offered slot</th>
                <th>Status</th>
                <th>Attempt</th>
                <th>Sent</th>
                <th>CL</th>
              </tr>
            </thead>
            <tbody>
              {rowsForDisplay.map((row) => {
                const expanded = expandedId === row.id;
                const highlight = needsFollowUp(row);
                const toConfirm = isToConfirmOffer(row);
                const removed = isRemovedOffer(row);
                const rowExiting = reviewExitOfferId === row.id;
                const showRemove = tab !== 'removed' && tab !== 'booked' && !removed;
                const clientName = row.clientName?.trim() || (row.clientId ? `Client #${row.clientId}` : '—');
                const detail = detailById[row.id];
                return (
                  <Fragment key={row.id}>
                    <tr
                      style={
                        rowExiting
                          ? { background: '#ecfdf5' }
                          : highlight
                          ? { background: '#fffbeb' }
                          : toConfirm
                            ? { background: '#eff6ff' }
                            : expanded
                              ? { background: '#f9fafb' }
                              : undefined
                      }
                    >
                      <td>
                        <button
                          type="button"
                          className="btn secondary"
                          style={{ padding: '2px 8px', minWidth: 0 }}
                          aria-expanded={expanded}
                          aria-label={expanded ? 'Collapse details' : 'Expand details'}
                          onClick={() => void toggleExpand(row.id)}
                        >
                          {expanded ? '−' : '+'}
                        </button>
                      </td>
                      <td>{clientName}</td>
                      <td>{petLabel(row)}</td>
                      <td>{row.doctorName?.trim() || '—'}</td>
                      <td>{formatOfferSlot(row, practiceTz)}</td>
                      <td>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 600,
                            ...statusBadgeStyle(row.status, row),
                          }}
                        >
                          {statusLabel(row.status, row)}
                        </span>
                      </td>
                      <td>{row.attemptNumber ?? '—'}</td>
                      <td>{formatSentAt(row.sentAt, practiceTz)}</td>
                      <td>{row.clFirstName?.trim() || '—'}</td>
                    </tr>
                    {expanded ? (
                      <tr>
                        <td colSpan={9} style={{ padding: 0 }}>
                          {detailLoading[row.id] ? (
                            <div style={{ padding: 16 }} className="settings-muted">
                              Loading details…
                            </div>
                          ) : detailError[row.id] ? (
                            <div style={{ padding: 16, color: '#b91c1c' }}>{detailError[row.id]}</div>
                          ) : detail ? (
                            <OfferDetailPanel
                              detail={detail}
                              practiceTz={practiceTz}
                              smsFromLine={resolveSlotOfferSmsFromLine(
                                detail,
                                providers,
                                practiceMainPhone
                              )}
                              resolving={Boolean(resolving[row.id])}
                              resolveError={resolveError[row.id] ?? null}
                              removing={Boolean(removing[row.id])}
                              removeError={removeError[row.id] ?? null}
                              showRemove={showRemove}
                              onResolve={() => void onMarkBooked(row.id)}
                              onRemove={() => void onRemove(row.id)}
                              onTextClient={() => {
                                const fromLine = resolveSlotOfferSmsFromLine(
                                  detail,
                                  providers,
                                  practiceMainPhone
                                );
                                openTextClientModal(detail, fromLine);
                              }}
                              onViewAppointment={() => onViewAppointment(detail)}
                              onReviewAppointment={() => onReviewAppointment(detail, row.id)}
                            />
                          ) : (
                            <div style={{ padding: 16 }} className="settings-muted">
                              No details available.
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
          <SchedulingToolsListPagination
            listPage={listPage}
            totalItems={filteredRows.length}
            onPageChange={changeListPage}
            itemLabel="offers"
          />
        </>
      )}

      {smsTarget ? (
        <ClientSmsComposeModal
          open
          clientLabel={smsTarget.clientLabel}
          fromLineLabel={smsTarget.fromLine}
          message={smsMessage}
          onMessageChange={setSmsMessage}
          onClose={closeSmsModal}
          onSend={(opts) => void handleSendSms(opts)}
          onOpenMessagesHistory={() => {
            setMessagesClientId(smsTarget.clientId);
            setMessagesClientLabel(smsTarget.clientLabel);
            setMessagesFromLine(smsTarget.fromLine);
          }}
          sending={smsSending}
          sendError={smsError}
        />
      ) : null}

      <ClientMessagesHistoryModal
        open={messagesClientId != null}
        clientId={messagesClientId}
        clientLabel={messagesClientLabel}
        openPhoneLine={messagesFromLine}
        onClose={() => {
          setMessagesClientId(null);
          setMessagesClientLabel('');
          setMessagesFromLine(null);
        }}
      />
    </div>
  );
}
