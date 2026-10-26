import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  addMailApprovalNote,
  buyMailLabel,
  createStaffMailOrder,
  fetchMailRates,
  listMailOrders,
  refundMailLabel,
  resolveMailOrderCancellation,
  formatBackInStock,
  mailCancelPending,
  mailLinePassedThrough,
  type MailFulfillmentSource,
  MAIL_CANCEL_REASON_LABELS,
  type MailCancelResolution,
  type MailParcelType,
  type MailRateQuote,
  patchMailOrder,
  pharmacyMailAction,
  sendMailApprovalTask,
  overrideMailLineApproval,
  splitMailOrder,
  type MailOrder,
  type MailOrderLine,
  type MailPharmacyStage,
} from '../api/onlineStore';
import { sendClientSms } from '../api/clientSms';
import { createClientPayLink, getInvoice, type VisitInvoice } from '../api/visitWorkflow';
import { fetchAppointmentById } from '../api/appointments';
import { appConfirm } from '../utils/appDialog';
import { searchClientsStaff, type ClientSearchRow } from '../api/clientsStaff';
import {
  extractPatientListFromSearchResponse,
  searchPatients,
  searchPatientsStaff,
  type PatientSearchRow,
} from '../api/patients';
import { fetchAllEmployees, type Employee } from '../api/appointmentSettings';
import { formatEmployeeDisplayName } from '../utils/employeeDisplayName';
import { formatAutoshipFrequency } from './store/storeCartState';
import MailOrderFillLabels, { mailLabelDoctor } from '../components/soap/MailOrderFillLabels';
import EditAutoshipModal from '../components/soap/EditAutoshipModal';
import MailOrderClientCommsPanel from '../components/soap/MailOrderClientCommsPanel';
import MailOrderRejectModal from '../components/soap/MailOrderRejectModal';
import MailOrderPayTextModal from '../components/soap/MailOrderPayTextModal';
import { ClientEmailComposeModal } from '../components/ClientEmailComposeModal';
import { recordScoutChartCommunication } from '../api/scoutChart';
import {
  defaultMailOrderRejectBodyText,
  defaultMailOrderPartialRejectBodyText,
  defaultMailOrderRejectSubject,
  mailOrderRejectEmailBodyHtml,
  mailOrderRejectedLines,
  mailOrderRefundAmount,
  mailOrderClientItemName,
  mailOrderContactBodyHtml,
  mailOrderContactSmsText,
  mailOrderContactSubject,
  mailOrderRegardingPatients,
  mailOrderPayAmount,
  mailOrderPayBodyHtml,
  mailOrderPayInvoiceNeedsWait,
  mailOrderPaySmsText,
  mailOrderPaySubject,
  mailOrderPayUsesFullInvoice,
  mailOrderMailedInvoiceAmount,
  type MailOrderLinkedInvoice,
} from '../utils/mailOrderClientMessages';
import MailRxDecisionFields, {
  initialMailRxDecisionFromLine,
  mailRxDecisionMissing,
  parsedMailRefills,
  type MailRxDecisionDraft,
} from '../components/soap/MailRxDecisionFields';
import { BookPatientChartButton } from '../components/BookPatientChartButton';
import { clampRefillExpiration, refillExpirationCapNote } from '../utils/printRxLabel';
import MailShipAddressPicker, {
  saveMailingAddressOnFile,
  shipBodyFromFields,
  type MailShipChoice,
} from '../components/soap/MailShipAddressPicker';
import {
  listInventoryBranchLocations,
  listPracticeBranches,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../api/branchInventory';
import StockLotPicker from '../components/inventory/StockLotPicker';
import InventoryItemDetailModal from '../components/inventory/InventoryItemDetailModal';
import {
  getPracticeSettings,
  parseMailOrderRxLinePhone,
  parseOnlineStoreFulfillmentBranchId,
  parseOnlineStoreFulfillmentLocationId,
} from '../api/practiceSettings';
import {
  clientIdFromPatientRow,
  clientNameFromPatientRow,
  patientDisplayName,
} from '../utils/briefDisplay';
import { smsAllowsProductionOverride } from '../utils/smsEnvironment';
import { useCan } from '../permissions/PermissionContext';
import './Settings.css';
import './MailOrders.css';
import { currentPracticeId } from '../utils/practiceIdFromToken';

const MAIL_PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

function practiceIdFromToken(token: string | null): number {
  try {
    if (!token) return currentPracticeId();
    const p = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return Number(p.practiceId ?? p.practice_id) || 1;
  } catch {
    return 1;
  }
}

const ORIGIN_LABEL: Record<MailOrder['origin'], string> = {
  online_store: 'Online store',
  staff_mail: 'Staff mail',
  office_pickup: 'Office pickup',
  kit: 'Kit',
};

function invoiceLineIdFromNotes(notes: string | null | undefined): string | null {
  return notes?.match(/invoiceLine:([0-9a-f-]{36})/i)?.[1] ?? null;
}

function mailOrderOriginLabel(order: MailOrder): string {
  if (order.origin === 'staff_mail') {
    if (invoiceLineIdFromNotes(order.notes)) return 'Staff mail from visit';
    if (linkedInvoiceId(order)) return 'Staff mail via direct invoice';
  }
  return ORIGIN_LABEL[order.origin];
}

type MailSynopsisPetItems = {
  key: string;
  patientId: number | null;
  patientName: string;
  lines: Array<{ key: string; label: string }>;
};

function mailSynopsisItemsByPet(order: MailOrder): MailSynopsisPetItems[] {
  const groups = new Map<string, MailSynopsisPetItems>();
  for (const line of order.lines || []) {
    const patientName = line.patientName || 'Household';
    const patientId = line.patientId ?? null;
    const groupKey = patientId != null ? `p-${patientId}` : `n-${patientName}`;
    const group =
      groups.get(groupKey) ??
      ({
        key: groupKey,
        patientId,
        patientName,
        lines: [],
      } satisfies MailSynopsisPetItems);
    const label = clientItemName(line.name || 'Item');
    group.lines.push({
      key: `${line.id}-${label}`,
      label: `${label} × ${Number(line.quantity)}`,
    });
    groups.set(groupKey, group);
  }
  return [...groups.values()];
}

const STAGE_LABEL: Record<MailPharmacyStage, string> = {
  needs_approval: 'Needs approval',
  pending_client: 'Pending client',
  needs_payment: 'Needs payment',
  fill: 'Fill',
  check: 'Check',
  rtg: 'RTG',
  ship: 'Ship',
  ready_for_pickup: 'Ready for pickup',
  contacted: 'Contacted',
  done: 'Done',
  rejected: 'Rejected',
};

const MAIL_ORDERS_SCROLL_KEY = 'mailOrders.returnScroll';

type MailOrdersScrollState = {
  orderId: number;
  filter: string;
  scrollY: number;
};

type QueueFilter =
  | 'open'
  | 'cancel_requests'
  | MailPharmacyStage
  | 'ready'
  | 'all';

function matchesMailSearch(order: MailOrder, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) return true;
  if (/^\d+$/.test(q)) return String(order.id) === q;
  if ((order.customerName || '').toLowerCase().includes(q)) return true;
  if ((order.customerEmail || '').toLowerCase().includes(q)) return true;
  if ((order.patientName || '').toLowerCase().includes(q)) return true;
  for (const pet of order.patients || []) {
    if ((pet.name || '').toLowerCase().includes(q)) return true;
  }
  for (const line of order.lines || []) {
    if ((line.name || '').toLowerCase().includes(q)) return true;
    if ((line.strength || '').toLowerCase().includes(q)) return true;
    if ((line.patientName || '').toLowerCase().includes(q)) return true;
  }
  return false;
}

function matchesQueueFilter(order: MailOrder, filter: QueueFilter): boolean {
  const stage = pharmacyStageOf(order);
  if (filter === 'all') return true;
  // A cancellation request stays in front of the team until they decide, even on a finished order.
  if (filter === 'cancel_requests') return mailCancelPending(order);
  if (filter === 'open') return mailCancelPending(order) || (stage !== 'done' && stage !== 'rejected');
  if (filter === 'ready') return stage === 'ship' || stage === 'ready_for_pickup';
  // Partial rejects stay in Open, and also appear here until the client is contacted.
  if (filter === 'rejected') {
    return stage === 'rejected' || (anyMailLinesRejected(order) && !mailContactedDone(order));
  }
  return stage === filter;
}

function mailFillDone(order: MailOrder): boolean {
  const process = order.processStatus || 'queued';
  return Boolean(
    order.filledAt ||
      order.fillerEmployeeId ||
      ['filled', 'first_check', 'second_check', 'packaged', 'rtg', 'shipped'].includes(process),
  );
}

/** Every line was ordered on another site, so nothing ships or gets picked up from us. */
function mailAllPassedThrough(order: MailOrder): boolean {
  const lines = order.lines || [];
  return lines.length > 0 && lines.every(mailLinePassedThrough);
}

function passedThroughSummary(line: MailOrderLine): string {
  return `Ordered on ${line.externalVendor || 'another site'}${
    line.externalOrderRef ? ` #${line.externalOrderRef}` : ''
  }`;
}

function mailShipDone(order: MailOrder): boolean {
  if (mailAllPassedThrough(order)) return true;
  if (isPickupOrder(order)) {
    return Boolean(
      order.packagedAt ||
        ['packaged', 'rtg', 'second_check', 'shipped'].includes(order.processStatus || ''),
    );
  }
  return Boolean(order.labelUrl);
}

function mailCheckDone(order: MailOrder): boolean {
  const lines = order.lines || [];
  if (lines.length > 0) {
    return lines.every(
      (line) => Boolean(line.checkedAt) || Boolean(order.secondCheckedAt),
    );
  }
  return Boolean(
    order.secondCheckedAt ||
      order.secondCheckerEmployeeId ||
      order.processStatus === 'second_check' ||
      order.processStatus === 'shipped',
  );
}

function isRejectOutreachNote(note: { kind?: string; notes?: string | null }): boolean {
  return /reject-outreach|Rejected item outreach/i.test(note.notes || '');
}

function mailRejectOutreachDone(order: MailOrder): boolean {
  return (order.approvalNotes || []).some(isRejectOutreachNote);
}

function mailFulfillmentContacted(order: MailOrder): boolean {
  return (order.approvalNotes || []).some(
    (note) => note.kind === 'contacted' && !isRejectOutreachNote(note),
  );
}

/** Shipped / pickup / skip-contact for remaining items — not a rejection-only email. */
function mailContactedDone(order: MailOrder): boolean {
  const remaining = (order.lines || []).filter((line) => line.lineStatus !== 'rejected');
  if (!remaining.length) {
    return mailRejectOutreachDone(order) || mailFulfillmentContacted(order);
  }
  if (order.processStatus === 'shipped' && mailFulfillmentContacted(order)) return true;
  return mailFulfillmentContacted(order);
}

function anyMailLinesRejected(order: MailOrder): boolean {
  return (order.lines || []).some((line) => line.lineStatus === 'rejected');
}

function allMailLinesRejected(order: MailOrder): boolean {
  const lines = order.lines || [];
  return lines.length > 0 && lines.every((line) => line.lineStatus === 'rejected');
}

/** Rejected order (or a rejected line) the client has not been told about yet. */
function mailRejectedNeedsClientContact(order: MailOrder): boolean {
  if (mailRejectOutreachDone(order)) return false;
  return pharmacyStageOf(order) === 'rejected' || anyMailLinesRejected(order);
}

function rejectedLineRefundTotal(order: MailOrder): number {
  return (order.lines || [])
    .filter((line) => line.lineStatus === 'rejected')
    .reduce(
      (sum, line) =>
        sum + (Number(line.unitPrice) || 0) * Math.max(1, Number(line.quantity) || 1),
      0,
    );
}

function lineRefundLogged(order: MailOrder, lineId: number): boolean {
  const marker = `refund:line:${lineId}`;
  return (order.approvalNotes || []).some((note) => (note.notes || '').includes(marker));
}

function rejectedRefundStillDue(order: MailOrder): number {
  if (order.rejectedRefundDue != null && Number(order.rejectedRefundDue) >= 0) {
    return Math.round((Number(order.rejectedRefundDue) || 0) * 100) / 100;
  }
  return (order.lines || [])
    .filter((line) => line.lineStatus === 'rejected' && !lineRefundLogged(order, line.id))
    .reduce(
      (sum, line) =>
        sum + (Number(line.unitPrice) || 0) * Math.max(1, Number(line.quantity) || 1),
      0,
    );
}

function lineIsApproved(line: MailOrderLine): boolean {
  return line.lineStatus === 'ok_to_mail';
}

function lineNeedsApproval(line: MailOrderLine): boolean {
  return (
    line.lineStatus === 'awaiting_doctor_approval' ||
    line.lineStatus === 'send_back' ||
    line.lineStatus === 'rejected'
  );
}

/**
 * Passed-through lines are filled once ordered on the other site; lot-tracked lines once a
 * lot is picked; others follow the order fill stamp.
 */
function lineIsFilled(line: MailOrderLine, order: MailOrder): boolean {
  if (mailLinePassedThrough(line)) return Boolean(line.externalOrderedAt);
  if (line.trackLots) {
    return Boolean(line.inventoryLotBalanceId || line.lotNumber);
  }
  return mailFillDone(order);
}

function lineIsChecked(line: MailOrderLine, order: MailOrder): boolean {
  return Boolean(line.checkedAt) || Boolean(order.secondCheckedAt);
}

function linesAllApproved(lines: MailOrderLine[]): boolean {
  return lines.length > 0 && lines.every(lineIsApproved);
}

function linesAllFilled(lines: MailOrderLine[], order: MailOrder): boolean {
  return lines.length > 0 && lines.every((line) => lineIsFilled(line, order));
}

function linesAllChecked(lines: MailOrderLine[], order: MailOrder): boolean {
  return lines.length > 0 && lines.every((line) => lineIsChecked(line, order));
}

function thanksAlreadySent(order: MailOrder): boolean {
  return (order.approvalNotes || []).some(
    (note) =>
      note.kind === 'thanks' || /thanks-for-your-order/i.test(note.notes || ''),
  );
}

function pharmacyStageOf(order: MailOrder): MailPharmacyStage {
  if (order.pharmacyStage) return order.pharmacyStage;
  if (order.status === 'cancelled' || allMailLinesRejected(order)) return 'rejected';
  if (order.clientQuestionPendingAt) return 'pending_client';
  if (
    order.approvalStatus === 'needs_doctor_approval' ||
    order.approvalStatus === 'approval_pending' ||
    order.approvalStatus === 'send_back'
  ) {
    return 'needs_approval';
  }
  const paid = (order.paymentStatus || 'awaiting_payment') === 'paid';
  const allowUnpaid = Boolean(order.sendWithoutPayment);
  if (!paid && !allowUnpaid) return 'needs_payment';
  if (!mailFillDone(order)) return 'fill';
  if (!mailShipDone(order)) return isPickupOrder(order) ? 'ready_for_pickup' : 'ship';
  if (!mailCheckDone(order)) return 'check';
  if (!mailContactedDone(order)) return 'contacted';
  if (!paid) return 'needs_payment';
  return 'done';
}

function badgeClass(kind: 'go' | 'wait' | 'warn' | 'stop' | 'plain'): string {
  return `mail-queue__badge${kind === 'plain' ? '' : ` is-${kind}`}`;
}

function mailPharmacySteps(order: MailOrder): MailPharmacyStage[] {
  const lastStep: MailPharmacyStage = isPickupOrder(order) ? 'ready_for_pickup' : 'ship';
  return ['needs_approval', 'needs_payment', 'fill', lastStep, 'check', 'contacted'];
}

function mailOrderStepDone(order: MailOrder, step: MailPharmacyStage): boolean {
  if (step === 'needs_approval') {
    const lines = order.lines || [];
    if (lines.length) return linesAllApproved(lines);
    return !['needs_doctor_approval', 'approval_pending', 'send_back'].includes(
      order.approvalStatus || '',
    );
  }
  if (step === 'needs_payment') return (order.paymentStatus || 'awaiting_payment') === 'paid';
  if (step === 'fill') {
    const lines = order.lines || [];
    if (lines.some((line) => line.trackLots)) {
      return linesAllFilled(lines, order) && mailFillDone(order);
    }
    return mailFillDone(order);
  }
  if (step === 'ship' || step === 'ready_for_pickup') return mailShipDone(order);
  if (step === 'check') return mailCheckDone(order);
  if (step === 'contacted') return mailContactedDone(order);
  return pharmacyStageOf(order) === 'done';
}

function mailOrderStepCompletedLabel(order: MailOrder, step: MailPharmacyStage): string {
  const stage = pharmacyStageOf(order);
  if (stage === 'rejected' && step === 'needs_approval') return 'Rejected';
  if (step === 'needs_approval') return 'Approved';
  if (step === 'needs_payment') return 'Paid';
  if (step === 'fill') return 'Filled';
  if (step === 'ship' || step === 'ready_for_pickup') {
    if (mailAllPassedThrough(order)) return 'Drop-shipped';
    return isPickupOrder(order) ? 'Pickup ready' : 'Label printed';
  }
  if (step === 'check') return 'Checked';
  if (step === 'contacted') {
    return order.clientContactKind === 'none' ? 'Do not contact' : 'Contacted';
  }
  return STAGE_LABEL[step];
}

type MailSynopsisBadge = { label: string; completed: boolean; kind: 'go' | 'wait' | 'warn' | 'stop' };

function mailQueueSynopsisBadges(order: MailOrder): MailSynopsisBadge[] {
  const stage = pharmacyStageOf(order);
  if (stage === 'rejected') {
    const badges: MailSynopsisBadge[] = [{ label: 'Rejected', completed: false, kind: 'stop' }];
    if (!mailContactedDone(order)) {
      badges.push({ label: 'Contact client', completed: false, kind: 'warn' });
    }
    return badges;
  }
  if (stage === 'done') {
    return [{ label: 'Done', completed: true, kind: 'go' }];
  }

  const badges: MailSynopsisBadge[] = [];
  for (const step of mailPharmacySteps(order)) {
    if (mailOrderStepDone(order, step)) {
      badges.push({
        label: mailOrderStepCompletedLabel(order, step),
        completed: true,
        kind: 'go',
      });
    }
  }

  if (stage === 'pending_client') {
    badges.push({ label: STAGE_LABEL.pending_client, completed: false, kind: 'wait' });
    return badges;
  }

  if (!mailOrderStepDone(order, stage)) {
    badges.push({
      label: STAGE_LABEL[stage],
      completed: false,
      kind: stageBadgeKind(stage),
    });
  }

  if (anyMailLinesRejected(order)) {
    badges.push({ label: 'Item rejected', completed: false, kind: 'stop' });
    if (!mailContactedDone(order)) {
      badges.push({ label: 'Contact client', completed: false, kind: 'warn' });
    }
  }

  return badges;
}

function stageBadgeKind(stage: MailPharmacyStage): 'go' | 'wait' | 'warn' | 'stop' {
  if (stage === 'done') return 'go';
  if (stage === 'rejected') return 'stop';
  if (
    stage === 'needs_approval' ||
    stage === 'needs_payment' ||
    stage === 'pending_client'
  ) {
    return 'wait';
  }
  if (stage === 'ship' || stage === 'ready_for_pickup' || stage === 'contacted') return 'go';
  return 'warn';
}

function formatPatientWeight(
  weightLbs?: number | null,
  weightDate?: string | null,
): string | null {
  if (weightLbs == null || !Number.isFinite(Number(weightLbs))) return null;
  const n = Number(weightLbs);
  const lbs = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  const iso = weightDate?.slice(0, 10);
  const date = iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
      })
    : null;
  return date ? `${lbs} lb · ${date}` : `${lbs} lb`;
}

function petNames(order: MailOrder): Array<{
  id: number | null;
  name: string;
  weightLabel: string | null;
}> {
  if (order.patients?.length) {
    return order.patients
      .map((pet) => ({
        id: pet.id ?? null,
        name: pet.name || '',
        weightLabel: formatPatientWeight(pet.weightLbs, pet.weightDate),
      }))
      .filter((pet) => pet.name);
  }
  if (order.patientName) {
    const line = (order.lines || []).find((row) => row.patientId === order.patientId);
    return [
      {
        id: order.patientId ?? null,
        name: order.patientName,
        weightLabel: formatPatientWeight(line?.weightLbs, line?.weightDate),
      },
    ];
  }
  const fromLines = new Map<
    string,
    { id: number | null; name: string; weightLabel: string | null }
  >();
  for (const line of order.lines || []) {
    if (!line.patientName) continue;
    fromLines.set(`${line.patientId || line.patientName}`, {
      id: line.patientId ?? null,
      name: line.patientName,
      weightLabel: formatPatientWeight(line.weightLbs, line.weightDate),
    });
  }
  return [...fromLines.values()];
}

function firstName(name?: string | null): string {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

type LinkedInvoiceAmount = MailOrderLinkedInvoice;

/** Orders sent from an invoice carry no prices of their own; the invoice holds what's owed. */
function linkedInvoiceId(order: MailOrder): string | null {
  return order.notes?.match(/(?:^|\s)invoice:([0-9a-f-]{36})/i)?.[1] ?? null;
}

function mailedInvoiceAmount(order: MailOrder, linked?: LinkedInvoiceAmount | null): number {
  return mailOrderMailedInvoiceAmount(order, linked);
}

function orderAmount(order: MailOrder, linked?: LinkedInvoiceAmount | null): number {
  if (Number(order.total) > 0.009) return Number(order.total) || 0;
  const mailed = mailedInvoiceAmount(order, linked);
  if (mailed > 0.009) return mailed;
  const fromLines = (order.lines || []).reduce(
    (sum, line) => sum + (Number(line.unitPrice) || 0) * (Number(line.quantity) || 1),
    0,
  );
  return Math.round((fromLines + (Number(order.shipping) || 0)) * 100) / 100;
}

function clientItemName(name: string): string {
  return mailOrderClientItemName(name);
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Pets on the order, e.g. "Roux" or "Roux and Milo". */
function orderPetNames(order: MailOrder): string {
  const names = [
    ...new Set(
      [...(order.lines || []).map((line) => line.patientName), order.patientName]
        .flatMap((name) => (name || '').split(/\s*&\s*/))
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  return joinList(names);
}

/** What's in the order by pet, e.g. "Roux's Bravecto Feline Medium, 6.2 -13.8 lb (3-month dose)". */
function orderContents(order: MailOrder): string {
  const byPet = new Map<string, string[]>();
  for (const line of order.lines || []) {
    const pet = (line.patientName || '').trim();
    const item = clientItemName(line.name || '');
    if (!item) continue;
    byPet.set(pet, [...(byPet.get(pet) || []), item]);
  }
  const parts = [...byPet.entries()].map(([pet, items]) =>
    pet ? `${pet}’s ${joinList(items)}` : joinList(items),
  );
  return joinList(parts) || `order #${order.id}`;
}

function orderSubjectFor(order: MailOrder): string {
  const pets = orderPetNames(order);
  return pets ? `${pets}’s order #${order.id}` : `Your order #${order.id}`;
}

function payMessageFor(order: MailOrder, linked?: LinkedInvoiceAmount | null): string {
  return mailOrderPaySmsText(
    order,
    firstName(order.customerName),
    mailOrderPayAmount(order, linked),
    null,
    linked,
  );
}

function notifySubjectFor(order: MailOrder, pickup: boolean): string {
  return mailOrderContactSubject(order, pickup);
}

function carrierName(carrier?: string | null): string {
  const c = (carrier || '').trim();
  if (/^usps$/i.test(c)) return 'USPS';
  if (/^ups$/i.test(c)) return 'UPS';
  if (/fedex/i.test(c)) return 'FedEx';
  if (/dhl/i.test(c)) return 'DHL';
  return c;
}

function trackingUrl(carrier?: string | null, code?: string | null): string | null {
  const tracking = (code || '').trim();
  if (!tracking) return null;
  const q = encodeURIComponent(tracking);
  switch (carrierName(carrier)) {
    case 'USPS':
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${q}`;
    case 'UPS':
      return `https://www.ups.com/track?tracknum=${q}`;
    case 'FedEx':
      return `https://www.fedex.com/fedextrack/?trknbr=${q}`;
    case 'DHL':
      return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${q}`;
    default:
      return null;
  }
}

function TrackingLink({ order }: { order: MailOrder }) {
  if (!order.trackingCode) return null;
  const url = trackingUrl(order.carrier, order.trackingCode);
  const label = `${carrierName(order.carrier) || 'Tracking'} ${order.trackingCode}`;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    <>{label}</>
  );
}

function notifyMessageFor(order: MailOrder, pickup: boolean): string {
  return mailOrderContactSmsText(order, pickup, firstName(order.customerName));
}

function money(value?: number | null): string {
  return `$${Number(value || 0).toFixed(2)}`;
}

function printCheckSlip(order: MailOrder) {
  const w = window.open('', '_blank', 'width=480,height=700');
  if (!w) return;
  const pets = petNames(order).map((pet) => pet.name).join(' & ') || '—';
  const lines = (order.lines || [])
    .map((line) => {
      const script = line.scriptText || line.refillNote || '';
      return `<p><strong>${line.patientName ? `${line.patientName} · ` : ''}${line.name}</strong> × ${Number(line.quantity)}<br/>${script}</p>`;
    })
    .join('');
  w.document.write(`<!doctype html><html><head><title>Check slip #${order.id}</title>
    <style>body{font:16px/1.4 system-ui,sans-serif;padding:24px;color:#0f172a} h1{font-size:20px;margin:0 0 8px} .muted{color:#64748b}</style>
    </head><body>
    <h1>Pharmacy check slip #${order.id}</h1>
    <p>${order.customerName || 'Client'} · ${pets}</p>
    <p class="muted">Filled by ${order.fillerName || '—'} · Check notes below</p>
    ${lines}
    <p><strong>Notes for checker</strong><br/>${(order.checkNotes || 'None').replace(/\n/g, '<br/>')}</p>
    </body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

function approvalLabel(status?: MailOrder['approvalStatus']): string {
  if (status === 'approval_pending') return 'Doctor approval pending';
  if (status === 'rejected') return 'Rejected';
  if (status === 'send_back') return 'Sent back';
  if (status === 'needs_doctor_approval') return 'Needs doctor approval';
  return 'Doctor approved';
}

function formatOrderedAt(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isPickupOrder(order: MailOrder): boolean {
  return Boolean(order.pickup) || order.origin === 'office_pickup' || /pick\s*up/i.test(order.shippingChargeName || '');
}

function clientDisplayName(row: ClientSearchRow): string {
  return [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || `Client #${row.id}`;
}

function apiErrorMessage(e: unknown): string {
  const res = (e as { response?: { data?: { message?: string | string[] } } })?.response;
  const message = res?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (message) return message;
  return e instanceof Error ? e.message : 'Request failed';
}

export default function MailOrdersPage() {
  const { token, employeeId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const practiceId = practiceIdFromToken(token);
  const [rows, setRows] = useState<MailOrder[]>([]);
  const [openId, setOpenId] = useState<number | null>(() => {
    const id = Number(searchParams.get('orderId'));
    return Number.isFinite(id) && id > 0 ? id : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [weight, setWeight] = useState('');
  const [rates, setRates] = useState<MailRateQuote>({ rates: [], carriers: [], notes: [] });
  const [staffOpen, setStaffOpen] = useState(false);
  const [filter, setFilter] = useState<QueueFilter>('open');
  const [search, setSearch] = useState('');
  const [rxLinePhone, setRxLinePhone] = useState('');

  const reload = () =>
    listMailOrders(practiceId)
      .then(setRows)
      .catch((e) => setError(apiErrorMessage(e)));

  useEffect(() => {
    void reload();
  }, [practiceId]);

  useEffect(() => {
    void getPracticeSettings(practiceId)
      .then((settings) => setRxLinePhone(parseMailOrderRxLinePhone(settings)))
      .catch(() => setRxLinePhone(''));
  }, [practiceId]);

  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [practiceId]);

  useEffect(() => {
    const id = Number(searchParams.get('orderId'));
    if (Number.isFinite(id) && id > 0) setOpenId(id);
  }, [searchParams]);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(MAIL_ORDERS_SCROLL_KEY);
      if (!raw) return;
      sessionStorage.removeItem(MAIL_ORDERS_SCROLL_KEY);
      const saved = JSON.parse(raw) as MailOrdersScrollState;
      if (saved.filter) setFilter(saved.filter as QueueFilter);
      if (saved.orderId) {
        setOpenId(saved.orderId);
        setSearchParams({ orderId: String(saved.orderId) }, { replace: true });
      }
      requestAnimationFrame(() => {
        window.scrollTo({ top: Number(saved.scrollY) || 0, behavior: 'auto' });
      });
    } catch {
      /* ignore */
    }
  }, [setSearchParams]);

  function rememberMailScroll(orderId: number) {
    try {
      const payload: MailOrdersScrollState = {
        orderId,
        filter,
        scrollY: window.scrollY || 0,
      };
      sessionStorage.setItem(MAIL_ORDERS_SCROLL_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  const visible = useMemo(() => {
    const q = search.trim();
    const matched = rows.filter((row) => {
      if (q) return matchesMailSearch(row, q);
      return matchesQueueFilter(row, filter);
    });
    return [
      ...matched.filter((row) => mailCancelPending(row)),
      ...matched.filter((row) => !mailCancelPending(row)),
    ];
  }, [rows, filter, search]);
  const cancelRequestCount = useMemo(() => rows.filter(mailCancelPending).length, [rows]);
  const rejectedNeedsContactCount = useMemo(
    () => rows.filter(mailRejectedNeedsClientContact).length,
    [rows],
  );

  const [linkedAmounts, setLinkedAmounts] = useState<Record<string, LinkedInvoiceAmount>>({});
  const linkedKey = useMemo(
    () =>
      [
        ...new Set(
          visible
            .filter((row) => !(Number(row.total) > 0.009))
            .map((row) => {
              const id = linkedInvoiceId(row);
              return id ? `${id}:${row.paymentStatus ?? ''}` : null;
            })
            .filter((id): id is string => Boolean(id)),
        ),
      ]
        .sort()
        .join(','),
    [visible],
  );
  useEffect(() => {
    if (!linkedKey) return;
    let cancelled = false;
    const ids = [...new Set(linkedKey.split(',').map((part) => part.split(':')[0]))];
    void Promise.all(
      ids.map((id) =>
        getInvoice(id)
          .then((invoice: VisitInvoice) => {
            const total = Number(invoice.total) || 0;
            const paid = Number(invoice.amountPaid) || 0;
            const due = Math.max(0, total - paid);
            const lines = (invoice.lines || []).map((line) => ({
              id: line.id,
              amount: Number(line.amount) || 0,
              taxAmount: Number(line.taxAmount) || 0,
              tagalongOfLineId: line.tagalongOfLineId,
              removed: line.isDeleted === true || Boolean(line.removedAt),
            }));
            return [
              id,
              {
                total,
                due,
                paid,
                created: invoice.created ?? invoice.finalizedAt ?? null,
                appointmentId: invoice.appointmentId,
                invoice,
                lines,
              },
            ] as const;
          })
          .catch(() => null),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setLinkedAmounts((prev) => {
        const next = { ...prev };
        for (const pair of pairs) if (pair) next[pair[0]] = pair[1];
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [linkedKey]);
  const linkedAmountFor = (row: MailOrder): LinkedInvoiceAmount | null => {
    const id = linkedInvoiceId(row);
    return id ? linkedAmounts[id] ?? null : null;
  };

  const applyFilter = (next: QueueFilter) => {
    setFilter(next);
    const open = rows.find((row) => row.id === openId);
    if (open && !matchesQueueFilter(open, next)) {
      setOpenId(null);
      setRates({ rates: [], carriers: [], notes: [] });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('orderId');
      setSearchParams(nextParams, { replace: true });
    }
  };

  const toggleOpen = (row: MailOrder) => {
    const next = openId === row.id ? null : row.id;
    setOpenId(next);
    setRates({ rates: [], carriers: [], notes: [] });
    setWeight(row.packageWeightOz != null ? String(row.packageWeightOz) : '');
    const nextParams = new URLSearchParams(searchParams);
    if (next) nextParams.set('orderId', String(next));
    else nextParams.delete('orderId');
    setSearchParams(nextParams, { replace: true });
  };

  const replace = (order: MailOrder) => {
    setRows((rs) => {
      const exists = rs.some((r) => r.id === order.id);
      if (exists) return rs.map((r) => (r.id === order.id ? order : r));
      return [order, ...rs];
    });
  };

  const run = async (fn: () => Promise<MailOrder>) => {
    setError(null);
    try {
      const order = await fn();
      const wasDone = pharmacyStageOf(rows.find((row) => row.id === order.id) || order) === 'done';
      replace(order);
      if (!wasDone && pharmacyStageOf(order) === 'done') setFilter('done');
      return true;
    } catch (e) {
      setError(apiErrorMessage(e));
      return false;
    }
  };

  return (
    <div className="settings-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Mail Order Queue</h2>
          <p className="settings-muted" style={{ margin: 0 }}>
            Collapsed row is the synopsis. Expand an order to do the current pharmacy step.
            Approval decisions live on the assigned task, not here.
          </p>
        </div>
        <button
          type="button"
          className="mail-queue__btn is-primary mail-queue__new"
          onClick={() => setStaffOpen(true)}
        >
          + New mail order
        </button>
      </div>

      <label className="settings-label mail-queue__search">
        Search
        <input
          type="search"
          className="settings-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Order #, client, patient, or medication — searches all stages"
        />
      </label>

      <div className="mail-queue__filters" role="tablist" aria-label="Queue stage">
        {(
          [
            ['open', 'Open'],
            ['cancel_requests', `Cancel requests${cancelRequestCount ? ` (${cancelRequestCount})` : ''}`],
            ['needs_approval', 'Needs approval'],
            ['pending_client', 'Pending client'],
            ['needs_payment', 'Needs payment'],
            ['fill', 'Fill'],
            ['ready', 'Ship / pickup'],
            ['check', 'Check'],
            ['contacted', 'Contacted'],
            ['done', 'Done'],
            ['rejected', 'Rejected'],
            ['all', 'All'],
          ] as Array<[QueueFilter, string]>
        ).map(([key, label]) => {
          const rejectedAlert = key === 'rejected' && rejectedNeedsContactCount > 0;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={`mail-queue__filter${filter === key ? ' is-active' : ''}${
                rejectedAlert ? ' has-rejected-alert' : ''
              }`}
              onClick={() => applyFilter(key)}
            >
              {key === 'rejected' ? 'Rejected' : label}
              {rejectedAlert ? (
                <span
                  className="mail-queue__filter-alert"
                  aria-label={`${rejectedNeedsContactCount} rejected — contact client`}
                >
                  {rejectedNeedsContactCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {rejectedNeedsContactCount > 0 && filter !== 'rejected' ? (
        <div className="mail-queue__rejected-banner" role="status">
          <strong>
            {rejectedNeedsContactCount === 1
              ? '1 rejected order'
              : `${rejectedNeedsContactCount} rejected orders`}
          </strong>{' '}
          still need the client contacted (email or text).
          <button type="button" className="mail-queue__rejected-banner-link" onClick={() => applyFilter('rejected')}>
            Open Rejected
          </button>
        </div>
      ) : null}

      {error && (
        <div className="settings-message settings-error-message">
          <span>{error}</span>
          <button type="button" className="btn secondary" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="mail-queue__list">
        {visible.map((row) => {
          const synopsisBadges = mailQueueSynopsisBadges(row);
          const synopsisItems = mailSynopsisItemsByPet(row);
          const open = openId === row.id;
          const pets = petNames(row);
          return (
            <article
              key={row.id}
              className={`mail-queue__card${open ? ' is-open' : ''}${mailCancelPending(row) ? ' is-cancel-requested' : ''}`}
            >
              <div
                className="mail-queue__synopsis"
                role="button"
                tabIndex={0}
                onClick={() => toggleOpen(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleOpen(row);
                  }
                }}
              >
                <div>
                  <div className="mail-queue__id">#{row.id}</div>
                  <div className="mail-queue__when">{formatOrderedAt(row.created)}</div>
                  <div className="mail-queue__origin-label">{mailOrderOriginLabel(row)}</div>
                </div>
                <div>
                  <div>
                    {row.clientId ? (
                      <Link
                        className="mail-queue__pet-link"
                        to={`/schedule/clients?clientId=${encodeURIComponent(String(row.clientId))}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.customerName}
                      </Link>
                    ) : (
                      row.customerName
                    )}
                  </div>
                  <div className="mail-queue__pets">
                    {pets.length
                      ? pets.map((pet, idx) => (
                          <span key={`${pet.id || pet.name}-${idx}`}>
                            {idx > 0 ? ' & ' : ''}
                            {pet.id ? (
                              <Link
                                className="mail-queue__pet-link"
                                to={`/schedule/patients?patientId=${encodeURIComponent(String(pet.id))}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  rememberMailScroll(row.id);
                                }}
                              >
                                {pet.name}
                              </Link>
                            ) : (
                              pet.name
                            )}
                          </span>
                        ))
                      : 'No pet on file'}
                  </div>
                  <div className="mail-queue__meta">
                    {(() => {
                      const name =
                        row.origin === 'online_store'
                          ? (row.lines || []).find((line) => line.scriptPrescriberName)
                              ?.scriptPrescriberName
                          : row.doctorName;
                      return name ? `Dr ${name}` : 'No doctor on script';
                    })()}{' '}
                    · Created by{' '}
                    {row.createdByName || row.customerName || '—'}
                  </div>
                </div>
                <div className="mail-queue__items">
                  {synopsisItems.length
                    ? synopsisItems.map((group) => (
                        <div key={group.key} className="mail-queue__item-group">
                          <div className="mail-queue__item-pet">
                            {group.patientId ? (
                              <Link
                                className="mail-queue__pet-link"
                                to={`/schedule/patients?patientId=${encodeURIComponent(String(group.patientId))}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  rememberMailScroll(row.id);
                                }}
                              >
                                {group.patientName}
                              </Link>
                            ) : (
                              group.patientName
                            )}
                          </div>
                          <ul className="mail-queue__item-list">
                            {group.lines.map((item) => (
                              <li key={item.key}>{item.label}</li>
                            ))}
                          </ul>
                        </div>
                      ))
                    : '—'}
                </div>
                <div className="mail-queue__badges">
                  {mailCancelPending(row) ? (
                    <span className="mail-queue__badge-cancel">Cancellation requested</span>
                  ) : null}
                  {synopsisBadges.map((badge, idx) => (
                    <span
                      key={idx}
                      className={badgeClass(badge.completed ? 'go' : badge.kind)}
                    >
                      {badge.completed ? `✓ ${badge.label}` : badge.label}
                    </span>
                  ))}
                </div>
                <div className="mail-queue__total">
                  <div>{money(orderAmount(row, linkedAmountFor(row)))}</div>
                  {Number(row.otherBalanceDue) > 0.009 ? (
                    <span className="mail-queue__owed" title="Account balance due (not this order)">
                      Acct {money(row.otherBalanceDue)}
                    </span>
                  ) : null}
                </div>
              </div>
              {open ? (
                <OrderDetail
                  open={row}
                  employeeId={employeeId}
                  weight={weight}
                  rates={rates}
                  onWeight={setWeight}
                  onRates={setRates}
                  onRun={run}
                  practiceId={practiceId}
                  rxLinePhone={rxLinePhone}
                  onRememberScroll={() => rememberMailScroll(row.id)}
                  linkedAmount={linkedAmountFor(row)}
                  onOrderUpdated={(next) => {
                    setRows((prev) => {
                      const exists = prev.some((r) => r.id === next.id);
                      if (exists) return prev.map((r) => (r.id === next.id ? next : r));
                      return [next, ...prev];
                    });
                  }}
                />
              ) : null}
            </article>
          );
        })}
        {!visible.length && (
          <p className="settings-muted">
            {search.trim()
              ? 'No mail orders match that search.'
              : 'No mail orders in this filter yet. They appear when someone orders from the store or staff send an item to mail.'}
          </p>
        )}
      </div>

      {staffOpen && (
        <StaffCreate
          practiceId={practiceId}
          createdByEmployeeId={employeeId ? Number(employeeId) : null}
          onClose={() => setStaffOpen(false)}
          onCreate={async (body) => {
            const created = await createStaffMailOrder(practiceId, body);
            setRows((rs) => [created, ...rs]);
            setStaffOpen(false);
            setOpenId(created.id);
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set('orderId', String(created.id));
            setSearchParams(nextParams, { replace: true });
          }}
        />
      )}
    </div>
  );
}

const CANCEL_OUTCOME_LABEL: Record<MailCancelResolution, string> = {
  cancelled: 'resolved: cancelled',
  cancelled_refund: 'resolved: cancelled and refunded',
  already_shipped: 'resolved: already shipped, client follow-up',
  kept: 'resolved: order kept',
};

/**
 * The mail team decides what a cancellation request means for this order.
 * Only outcomes that fit its state are offered.
 */
function MailCancelDecision({
  order,
  paid,
  practiceId,
  onResolved,
}: {
  order: MailOrder;
  paid: boolean;
  practiceId: number;
  onResolved: (order: MailOrder) => void;
}) {
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<MailCancelResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shipped =
    order.status === 'shipped' || order.status === 'picked_up' || order.processStatus === 'shipped';

  const resolve = async (resolution: MailCancelResolution) => {
    setBusy(resolution);
    setError(null);
    try {
      const result = await resolveMailOrderCancellation(practiceId, order.id, {
        resolution,
        note: note.trim() || null,
      });
      onResolved(result.order);
      if (result.refund?.clientId) {
        const params = new URLSearchParams({
          clientId: String(result.refund.clientId),
          tab: 'financial',
          invoice: result.refund.invoiceId,
          returnLine: result.refund.lineId,
        });
        if (result.refund.shippingLineId) {
          params.set('returnShipping', result.refund.shippingLineId);
        }
        navigate(`/schedule/clients?${params.toString()}`);
      }
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const reason = order.cancelRequestReason
    ? MAIL_CANCEL_REASON_LABELS[order.cancelRequestReason]
    : 'No reason given';

  return (
    <section className="mail-queue__cancel-decision" aria-label="Cancellation request">
      <h4>Cancellation requested</h4>
      <p>
        <strong>{order.cancelRequestedByName || 'Staff'}</strong>
        {order.cancelRequestedAt ? ` · ${formatOrderedAt(order.cancelRequestedAt)}` : ''} ·{' '}
        {reason}
      </p>
      {order.cancelRequestNote ? (
        <p className="mail-queue__cancel-note">“{order.cancelRequestNote}”</p>
      ) : null}
      <label className="mail-queue__cancel-field">
        <span>Note (optional, saved with your decision)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error ? <p className="mail-queue__cancel-error">{error}</p> : null}
      <div className="mail-queue__cancel-actions">
        {shipped ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy != null}
            title="Keeps the order and creates a task to call the client about a return"
            onClick={() => void resolve('already_shipped')}
          >
            {busy === 'already_shipped' ? 'Saving…' : 'Already shipped — follow up with client'}
          </button>
        ) : paid ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy != null}
            title="Cancels the order, puts back any stock already pulled, then opens the refund"
            onClick={() => void resolve('cancelled_refund')}
          >
            {busy === 'cancelled_refund' ? 'Cancelling…' : 'Cancel and refund'}
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={busy != null}
            title="Cancels the order, puts back any stock already pulled, and removes it from the invoice"
            onClick={() => void resolve('cancelled')}
          >
            {busy === 'cancelled' ? 'Cancelling…' : 'Cancel order'}
          </button>
        )}
        <button
          type="button"
          className="btn secondary"
          disabled={busy != null}
          onClick={() => void resolve('kept')}
        >
          {busy === 'kept' ? 'Saving…' : 'Keep the order'}
        </button>
      </div>
    </section>
  );
}

function OrderDetail({
  open,
  employeeId,
  weight,
  rates,
  onWeight,
  onRates,
  onRun,
  practiceId,
  rxLinePhone,
  onRememberScroll,
  onOrderUpdated,
  linkedAmount,
}: {
  linkedAmount?: LinkedInvoiceAmount | null;
  open: MailOrder;
  employeeId: string | null;
  weight: string;
  rates: MailRateQuote;
  onWeight: (v: string) => void;
  onRates: (v: MailRateQuote) => void;
  onRun: (fn: () => Promise<MailOrder>) => Promise<boolean>;
  practiceId: number;
  rxLinePhone: string;
  onRememberScroll: () => void;
  onOrderUpdated: (order: MailOrder) => void;
}) {
  const stage = pharmacyStageOf(open);
  const pickup = isPickupOrder(open);
  const lastStep: MailPharmacyStage = pickup ? 'ready_for_pickup' : 'ship';
  const steps: MailPharmacyStage[] = [
    'needs_approval',
    'needs_payment',
    'fill',
    lastStep,
    'check',
    'contacted',
  ];
  const [viewStep, setViewStep] = useState<MailPharmacyStage>(() => {
    if (stage === 'done') return 'contacted';
    if (stage === 'pending_client') return 'needs_approval';
    return stage;
  });
  const [scriptsByLine, setScriptsByLine] = useState<Record<number, string>>(() => {
    const next: Record<number, string> = {};
    for (const line of open.lines || []) next[line.id] = line.scriptText || '';
    return next;
  });
  const [savingScriptId, setSavingScriptId] = useState<number | null>(null);
  const [resendOpen, setResendOpen] = useState<Record<number, boolean>>({});
  /** Mail team approving a line themselves instead of sending a doctor task. */
  const [selfApprove, setSelfApprove] = useState<
    Record<number, MailRxDecisionDraft & { reason: string; error: string | null }>
  >({});

  const clearSelfApproveForLineIds = (lineIds: number[]) => {
    if (!lineIds.length) return;
    setSelfApprove((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of lineIds) {
        if (next[id]) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  };

  const [fillError, setFillError] = useState<string | null>(null);
  const canSelfCheck = useCan('mail_order.check.self_override');
  const [editAutoshipLine, setEditAutoshipLine] = useState<MailOrderLine | null>(null);
  const [autoshipNote, setAutoshipNote] = useState<string | null>(null);
  const [inventoryDetail, setInventoryDetail] = useState<{
    inventoryItemId: number;
    name: string;
    lineId: number;
  } | null>(null);
  const [lotRefreshByLine, setLotRefreshByLine] = useState<Record<number, number>>({});
  const myId = employeeId ? Number(employeeId) : 0;
  const iFilled = Boolean(open.fillerEmployeeId && myId && open.fillerEmployeeId === myId);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [assigneeByLine, setAssigneeByLine] = useState<Record<number, string>>({});
  const [splitIds, setSplitIds] = useState<number[]>([]);
  const [taskNote, setTaskNote] = useState('');
  const [benchNote, setBenchNote] = useState('');
  const [checkNotes, setCheckNotes] = useState(open.checkNotes || '');
  const [sameCheckConfirm, setSameCheckConfirm] = useState<{
    patientId: number | null;
    lineIds: number[];
    label: string;
  } | null>(null);
  const [paySubject, setPaySubject] = useState(() => mailOrderPaySubject(open, linkedAmount));
  const [payMessage, setPayMessage] = useState(() => payMessageFor(open, linkedAmount));
  const [payMessageSeed, setPayMessageSeed] = useState(() => payMessageFor(open, linkedAmount));
  const [payEmailOpen, setPayEmailOpen] = useState(false);
  const [payTextOpen, setPayTextOpen] = useState(false);
  const [payLink, setPayLink] = useState<string | null>(null);
  const [payLinked, setPayLinked] = useState<LinkedInvoiceAmount | null>(linkedAmount ?? null);
  const [payPreparing, setPayPreparing] = useState(false);
  const [payLogClient, setPayLogClient] = useState(true);
  const [payIncludeEmr, setPayIncludeEmr] = useState(false);
  const [payPatientIds, setPayPatientIds] = useState<number[]>(() =>
    mailOrderRegardingPatients(open).map((p) => p.id),
  );
  useEffect(() => {
    setPaySubject(mailOrderPaySubject(open, linkedAmount));
    setPayLink(null);
    setPayEmailOpen(false);
    setPayTextOpen(false);
    setPayPatientIds(mailOrderRegardingPatients(open).map((p) => p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open.id]);
  useEffect(() => {
    const next = payMessageFor(open, linkedAmount);
    if (next === payMessageSeed) return;
    setPayMessage((current) => (current === payMessageSeed ? next : current));
    setPayMessageSeed(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedAmount?.due, linkedAmount?.total, linkedAmount?.paid, open.total]);
  useEffect(() => {
    setPayLinked(linkedAmount ?? null);
    setPaySubject(mailOrderPaySubject(open, linkedAmount));
  }, [linkedAmount, open]);
  const [notifySubject, setNotifySubject] = useState(notifySubjectFor(open, pickup));
  const [notifyMessage, setNotifyMessage] = useState(() => notifyMessageFor(open, pickup));
  const [notifyMessageSeed, setNotifyMessageSeed] = useState(() => notifyMessageFor(open, pickup));
  useEffect(() => {
    setNotifySubject(notifySubjectFor(open, pickup));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open.id, pickup]);
  useEffect(() => {
    const next = notifyMessageFor(open, pickup);
    if (next === notifyMessageSeed) return;
    setNotifyMessage((current) => (current === notifyMessageSeed ? next : current));
    setNotifyMessageSeed(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open.trackingCode, open.carrier, pickup]);
  const [paySent, setPaySent] = useState<string | null>(null);
  const orderPaid = (open.paymentStatus || 'awaiting_payment') === 'paid';
  const rejectWillRefund = mailOrderRefundAmount(open) != null;
  const rejectRegardingPatients = useMemo(() => mailOrderRegardingPatients(open), [open]);
  const [rejectSubject, setRejectSubject] = useState(() => defaultMailOrderRejectSubject(open.id));
  const [rejectMessage, setRejectMessage] = useState(() =>
    defaultMailOrderRejectBodyText(firstName(open.customerName), open),
  );
  const [rejectNotes, setRejectNotes] = useState('');
  const [rejectModal, setRejectModal] = useState<'email' | 'text' | null>(null);
  const [rejectOutreachOnly, setRejectOutreachOnly] = useState(false);
  const [refundRejectedOnSend, setRefundRejectedOnSend] = useState(true);
  const [rejectLogClient, setRejectLogClient] = useState(true);
  const [rejectIncludeEmr, setRejectIncludeEmr] = useState(true);
  const [rejectPatientIds, setRejectPatientIds] = useState<number[]>(() =>
    mailOrderRegardingPatients(open).map((p) => p.id),
  );
  const [fillBranches, setFillBranches] = useState<PracticeBranch[]>([]);
  const [fillLocations, setFillLocations] = useState<InventoryBranchLocation[]>([]);
  const [fillBranchId, setFillBranchId] = useState<number | ''>(open.fillBranchId ?? '');
  const [fillLocationId, setFillLocationId] = useState<number | ''>('');
  const [settingsFulfillment, setSettingsFulfillment] = useState<{
    branchId: number | null;
    locationId: number | null;
  }>({ branchId: null, locationId: null });
  const [fillLots, setFillLots] = useState<
    Record<number, { lotId: number | null; lotNumber: string }>
  >({});
  const [fillSources, setFillSources] = useState<
    Record<number, { source: MailFulfillmentSource; vendor: string; orderRef: string }>
  >({});
  const passesThrough = (line: MailOrderLine) =>
    (fillSources[line.id]?.source ?? line.fulfillmentSource) === 'external';
  const [texting, setTexting] = useState(false);
  const [textedAt, setTextedAt] = useState<string | null>(null);
  const [emailedAt, setEmailedAt] = useState<string | null>(null);
  const [contactEmailOpen, setContactEmailOpen] = useState(false);
  const [contactLogClient, setContactLogClient] = useState(true);
  const [contactIncludeEmr, setContactIncludeEmr] = useState(false);
  const [contactPatientIds, setContactPatientIds] = useState<number[]>(() =>
    mailOrderRegardingPatients(open).map((p) => p.id),
  );
  const [parcelType, setParcelType] = useState<MailParcelType>('mailer');
  const [parcelLength, setParcelLength] = useState('');
  const [parcelWidth, setParcelWidth] = useState('');
  const [parcelHeight, setParcelHeight] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [buyingLabel, setBuyingLabel] = useState(false);
  const [shipError, setShipError] = useState<string | null>(null);
  const [sendingThanks, setSendingThanks] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const shipBlocked = !mailFillDone(open) || !open.fillBranchId
    ? 'Mark this filled before buying a label.'
    : !(Number(weight) > 0)
      ? 'Enter the package weight in ounces to get rates or print a label.'
      : null;

  const parcel = () => ({
    type: parcelType,
    weightOz: Number(weight),
    lengthIn: parcelLength ? Number(parcelLength) : null,
    widthIn: parcelWidth ? Number(parcelWidth) : null,
    heightIn: parcelHeight ? Number(parcelHeight) : null,
  });

  const sentClock = () =>
    new Date().toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });

  useEffect(() => {
    setRejectSubject(defaultMailOrderRejectSubject(open.id));
    setRejectMessage(defaultMailOrderRejectBodyText(firstName(open.customerName), open));
    const pets = mailOrderRegardingPatients(open);
    setRejectPatientIds(pets.map((p) => p.id));
    setRejectLogClient(true);
    setRejectIncludeEmr(pets.length > 0);
    setTextedAt(null);
    setTexting(false);
    setEmailedAt(null);
    setContactEmailOpen(false);
    setContactPatientIds(pets.map((p) => p.id));
    setViewStep(stage === 'done' ? 'contacted' : stage);
    setSameCheckConfirm(null);
    const next: Record<number, string> = {};
    for (const line of open.lines || []) next[line.id] = line.scriptText || '';
    setScriptsByLine(next);
  }, [open.id]);

  useEffect(() => {
    const next = stage === 'done' ? 'contacted' : stage;
    const nextRank = steps.indexOf(next);
    const currentRank = steps.indexOf(viewStep);
    if (nextRank < 0 || currentRank < 0 || nextRank <= currentRank) return;
    setViewStep(next);
    setSameCheckConfirm(null);
  }, [stage]);

  useEffect(() => {
    setCheckNotes(open.checkNotes || '');
  }, [open.id, open.checkNotes]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listPracticeBranches(practiceId),
      getPracticeSettings(practiceId).catch(() => ({})),
    ]).then(([offices, settings]) => {
      if (cancelled) return;
      const active = offices.filter((row) => row.isActive !== false);
      setFillBranches(active);
      const fromSettingsBranch = parseOnlineStoreFulfillmentBranchId(settings);
      const fromSettingsLoc = parseOnlineStoreFulfillmentLocationId(settings);
      setSettingsFulfillment({
        branchId: fromSettingsBranch,
        locationId: fromSettingsLoc,
      });
      if (open.fillBranchId) {
        setFillBranchId(open.fillBranchId);
        return;
      }
      const fallback =
        fromSettingsBranch ||
        active.find((row) => row.isDefault)?.id ||
        active.find((row) => /brunswick/i.test(row.name))?.id ||
        active[0]?.id ||
        '';
      setFillBranchId(fallback || '');
    });
    return () => {
      cancelled = true;
    };
  }, [practiceId, open.id, open.fillBranchId]);

  useEffect(() => {
    if (fillBranchId === '') {
      setFillLocations([]);
      setFillLocationId('');
      return;
    }
    let cancelled = false;
    void listInventoryBranchLocations(practiceId, Number(fillBranchId)).then((locs) => {
      if (cancelled) return;
      const active = locs.filter((l) => l.isActive !== false);
      setFillLocations(active);
      const prefer =
        settingsFulfillment.branchId === Number(fillBranchId) &&
        settingsFulfillment.locationId != null &&
        active.some((l) => l.id === settingsFulfillment.locationId)
          ? settingsFulfillment.locationId
          : active.find((l) => l.isDefault)?.id ??
            active.find((l) => /mail\s*order/i.test(l.name))?.id ??
            active[0]?.id ??
            '';
      setFillLocationId(prefer || '');
    });
    return () => {
      cancelled = true;
    };
  }, [practiceId, fillBranchId, settingsFulfillment.branchId, settingsFulfillment.locationId]);

  useEffect(() => {
    const lots: Record<number, { lotId: number | null; lotNumber: string }> = {};
    for (const line of open.lines || []) {
      lots[line.id] = { lotId: null, lotNumber: '' };
    }
    setFillLots(lots);
  }, [fillBranchId, fillLocationId, open.id]);

  useEffect(() => {
    const next: Record<
      number,
      { source: MailFulfillmentSource; vendor: string; orderRef: string }
    > = {};
    for (const line of open.lines || []) {
      next[line.id] = {
        source:
          line.fulfillmentSource ?? (line.passThroughByDefault ? 'external' : 'stock'),
        vendor: line.externalVendor ?? line.defaultExternalVendor ?? '',
        orderRef: line.externalOrderRef ?? '',
      };
    }
    setFillSources(next);
  }, [open.id]);

  useEffect(() => {
    void fetchAllEmployees().then((rows) => {
      const active = rows.filter((row) => row.isActive !== false && !row.isDeleted);
      setStaff(active);
      const preferred =
        open.doctorEmployeeId ||
        active.find((row) => formatEmployeeDisplayName(row) === open.doctorName)?.id;
      if (!preferred) return;
      setAssigneeByLine((prev) => {
        const next = { ...prev };
        for (const line of open.lines || []) {
          if (!next[line.id]) next[line.id] = String(preferred);
        }
        return next;
      });
    });
  }, [open.id, open.doctorEmployeeId, open.doctorName, open.lines]);

  const ensurePayLink = async (): Promise<string | null> => {
    if (payLink) return payLink;
    if (!open.clientId) return null;
    try {
      const link = await createClientPayLink(open.clientId);
      const url = link.url?.trim() || null;
      if (url) setPayLink(url);
      return url;
    } catch {
      return null;
    }
  };

  const linkedFromVisitInvoice = (invoice: VisitInvoice): LinkedInvoiceAmount => {
    const total = Number(invoice.total) || 0;
    const paid = Number(invoice.amountPaid) || 0;
    return {
      total,
      due: Math.max(0, total - paid),
      paid,
      created: invoice.created ?? invoice.finalizedAt ?? null,
      appointmentId: invoice.appointmentId,
      invoice,
      lines: (invoice.lines || []).map((line) => ({
        id: line.id,
        amount: Number(line.amount) || 0,
        taxAmount: Number(line.taxAmount) || 0,
        tagalongOfLineId: line.tagalongOfLineId,
        removed: line.isDeleted === true || Boolean(line.removedAt),
      })),
    };
  };

  const loadPayLinked = async (): Promise<LinkedInvoiceAmount | null> => {
    const id = linkedInvoiceId(open);
    if (!id) return linkedAmount ?? null;
    try {
      const snapshot = linkedFromVisitInvoice(await getInvoice(id));
      setPayLinked(snapshot);
      return snapshot;
    } catch {
      return linkedAmount ?? payLinked ?? null;
    }
  };

  const confirmPayIfInvoiceFresh = async (
    linked: LinkedInvoiceAmount | null,
  ): Promise<boolean> => {
    let needsWait = mailOrderPayInvoiceNeedsWait({
      invoiceCreated: linked?.created,
    });
    if (!needsWait && linked?.appointmentId) {
      const appt = await fetchAppointmentById(linked.appointmentId);
      needsWait = mailOrderPayInvoiceNeedsWait({
        invoiceCreated: linked?.created,
        appointmentStart: appt?.appointmentStart,
        appointmentEnd: appt?.appointmentEnd,
      });
    }
    if (!needsWait) return true;
    return appConfirm({
      title: 'Invoice may still be in progress',
      message:
        'Wait at least 60 minutes in case this appointment is still going and they have not paid yet. Continue only if you know checkout is finished.',
      confirmLabel: 'Continue anyway',
      cancelLabel: 'Wait',
    });
  };

  const preparePayCompose = async (channel: 'email' | 'sms'): Promise<boolean> => {
    setPaySent(null);
    setPayPreparing(true);
    try {
      const linked = await loadPayLinked();
      const allowed = await confirmPayIfInvoiceFresh(linked);
      if (!allowed) return false;
      const url = await ensurePayLink();
      const amount = mailOrderPayAmount(open, linked);
      setPaySubject(mailOrderPaySubject(open, linked));
      setPayMessage(
        mailOrderPaySmsText(open, firstName(open.customerName), amount, url, linked),
      );
      if (channel === 'email') setPayEmailOpen(true);
      else setPayTextOpen(true);
      return true;
    } finally {
      setPayPreparing(false);
    }
  };

  const sendClientText = async (message: string, typeLabel: string) => {
    if (!open.clientId) throw new Error('This order has no client record to text.');
    const patientIds = [
      ...new Set(
        [open.patientId, ...(open.lines || []).map((line) => line.patientId)].filter(
          (id): id is number => id != null && id > 0,
        ),
      ),
    ];
    await sendClientSms(open.clientId, {
      message,
      source: 'mail_order',
      practiceId,
      patientIds,
      typeLabel,
    });
  };

  const groupedLines = useMemo(() => {
    const groups: Array<{ key: string; petId: number | null; petName: string | null; lines: MailOrder['lines'] }> = [];
    for (const line of open.lines || []) {
      const key = String(line.patientId || line.patientName || 'household');
      const existing = groups.find((group) => group.key === key);
      if (existing) existing.lines.push(line);
      else {
        groups.push({
          key,
          petId: line.patientId ?? null,
          petName: line.patientName ?? null,
          lines: [line],
        });
      }
    }
    return groups;
  }, [open.lines]);

  const shipmentLineCount = (open.lines || []).length;
  const canSplitShipment = shipmentLineCount > 1;

  const stepDone = (step: MailPharmacyStage) => {
    if (step === 'needs_approval') {
      const lines = open.lines || [];
      if (lines.length) return linesAllApproved(lines);
      return !['needs_doctor_approval', 'approval_pending', 'send_back'].includes(
        open.approvalStatus || '',
      );
    }
    if (step === 'needs_payment') return (open.paymentStatus || 'awaiting_payment') === 'paid';
    if (step === 'fill') {
      const lines = open.lines || [];
      if (lines.some((line) => line.trackLots)) {
        return linesAllFilled(lines, open) && mailFillDone(open);
      }
      return mailFillDone(open);
    }
    if (step === 'ship' || step === 'ready_for_pickup') return mailShipDone(open);
    if (step === 'check') return mailCheckDone(open);
    if (step === 'contacted') return mailContactedDone(open);
    return stage === 'done';
  };

  const stepClass = (step: MailPharmacyStage) => {
    if (stage === 'rejected' && step === 'needs_approval') return ' is-stop';
    const viewing = viewStep === step || (step === lastStep && (viewStep === 'ship' || viewStep === 'ready_for_pickup'));
    if (stepDone(step)) return viewing ? ' is-now is-done' : ' is-done';
    if (viewing) return ' is-due';
    return '';
  };

  const stepLabel = (step: MailPharmacyStage) => {
    if (stage === 'rejected' && step === 'needs_approval') return 'Rejected';
    if (stepDone(step) && step === 'needs_approval') return 'Approved';
    if (stepDone(step) && step === 'needs_payment') return 'Paid';
    if (stepDone(step) && step === 'fill') return 'Filled';
    if (stepDone(step) && (step === 'ship' || step === 'ready_for_pickup')) {
      if (mailAllPassedThrough(open)) return 'Drop-shipped';
      return pickup ? 'Pickup ready' : 'Label printed';
    }
    if (stepDone(step) && step === 'check') return 'Checked';
    if (stepDone(step) && step === 'contacted') {
      return open.clientContactKind === 'none' ? 'Do not contact' : 'Contacted';
    }
    return STAGE_LABEL[step];
  };

  const jumpTo = (step: MailPharmacyStage) => {
    if (
      (step === 'check' || step === 'ship' || step === 'ready_for_pickup') &&
      !mailFillDone(open)
    ) {
      return;
    }
    setViewStep(step);
  };

  const voidLabelButton = (compact = false) =>
    open.labelUrl || open.trackingCode ? (
      <div className="mail-queue__void">
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            if (
              !window.confirm(
                'Void this label on EasyPost? Unused USPS postage is refunded in about 15 days, not instantly. If the carrier has already scanned it, EasyPost will refuse and postage is spent.',
              )
            ) {
              return;
            }
            void onRun(() => refundMailLabel(practiceId, open.id));
          }}
        >
          Void / refund this label
        </button>
        {!compact ? (
          <p className="settings-muted">
            This asks EasyPost to refund unused postage. It is not instant — USPS
            usually takes about 15 days. Already scanned or in-transit labels cannot
            be refunded.
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="mail-queue__detail" onClick={(e) => e.stopPropagation()}>
      {mailCancelPending(open) ? (
        <MailCancelDecision
          order={open}
          paid={orderPaid}
          practiceId={practiceId}
          onResolved={onOrderUpdated}
        />
      ) : open.cancelResolution ? (
        <p className="mail-queue__sent" role="status" style={{ marginBottom: 12 }}>
          Cancellation request {CANCEL_OUTCOME_LABEL[open.cancelResolution]}
          {open.cancelResolvedByName ? ` by ${open.cancelResolvedByName}` : ''}
          {open.cancelResolutionNote ? ` — ${open.cancelResolutionNote}` : ''}
        </p>
      ) : null}
      {autoshipNote ? (
        <div className="settings-message" style={{ margin: '0 0 12px' }}>
          <span>{autoshipNote}</span>
          <button type="button" className="btn secondary" onClick={() => setAutoshipNote(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {open.sendWithoutPayment && !orderPaid ? (
        <p className="mail-queue__sent" role="status" style={{ marginBottom: 12 }}>
          Send without payment — pharmacy may proceed; not done until the owner pays.
        </p>
      ) : null}
      {open.payAfterApproval && !orderPaid ? (
        <p className="mail-queue__sent" role="status" style={{ marginBottom: 12 }}>
          Not paid yet — taken before payment so the doctor could approve first. Once approved,
          use <strong>Text to pay</strong> or <strong>Email invoice</strong> on the payment step
          before filling.
        </p>
      ) : null}
      <div className="mail-queue__steps">
        {steps.map((step) => {
          const locked =
            (step === 'check' || step === 'ship' || step === 'ready_for_pickup') &&
            !mailFillDone(open);
          return (
            <button
              key={step}
              type="button"
              className={`mail-queue__step${stepClass(step)}${locked ? ' is-locked' : ''}`}
              disabled={locked}
              title={locked ? 'Mark filled before shipping or checking' : undefined}
              onClick={() => jumpTo(step)}
            >
              {stepDone(step) ? `✓ ${stepLabel(step)}` : stepLabel(step)}
            </button>
          );
        })}
      </div>

      <div>
        <div className="mail-queue__current">
          <h3>{stepLabel(viewStep)}</h3>
          {viewStep === 'needs_approval' && (
            <>
              <p className="settings-muted" style={{ marginTop: 0 }}>
                Use <strong>Split / approvals</strong> under the pet items to send each product to
                a different doctor, override with a reason, or split items onto a separate
                shipment. Doctors only decide the items on their own task.
              </p>
              {open.clientQuestionPendingAt ? (
                <p className="mail-queue__sent" role="status">
                  Pending client question — use Text / email client on the right.
                </p>
              ) : null}
            </>
          )}

          {viewStep === 'needs_payment' && (
            <>
              <p className="settings-muted" style={{ marginTop: 0 }}>
                {open.sendWithoutPayment && !orderPaid
                  ? 'This order was sent without payment. Pharmacy work can finish, but the order is not done until the owner pays.'
                  : mailOrderPayUsesFullInvoice(open, payLinked ?? linkedAmount)
                    ? 'The visit invoice is still unpaid, so the email and text will include every unpaid line on that invoice — not just the mailed item.'
                    : 'Open the email or text modal to review the invoice copy and pay link before anything is sent.'}
              </p>
              {mailOrderPayInvoiceNeedsWait({
                invoiceCreated: (payLinked ?? linkedAmount)?.created,
              }) ? (
                <p className="mail-queue__pay-wait" role="status">
                  This invoice is from the last hour. Wait at least 60 minutes in case the
                  appointment is still going and they have not paid yet.
                </p>
              ) : null}
              {open.sendWithoutPayment && !orderPaid ? (
                <p className="mail-queue__sent" role="status">
                  Send without payment — awaiting owner payment
                </p>
              ) : null}
              <div className="mail-queue__actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={!open.clientId || payPreparing}
                  title={!open.clientId ? 'No client record for Gmail email' : undefined}
                  onClick={() => void preparePayCompose('email')}
                >
                  {payPreparing ? 'Opening…' : 'Email invoice'}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!open.clientId || payPreparing}
                  onClick={() => void preparePayCompose('sms')}
                >
                  Text to pay
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() =>
                    void onRun(() =>
                      patchMailOrder(practiceId, open.id, { paymentStatus: 'paid' }),
                    )
                  }
                >
                  Mark paid
                </button>
              </div>
              {paySent && (
                <p className="settings-muted" style={{ margin: '6px 0 0' }}>
                  {paySent}
                  {smsAllowsProductionOverride() &&
                    paySent.includes('sent.') &&
                    ' Test environment: email goes to the test inbox and texts to the test number, not the client.'}
                </p>
              )}
            </>
          )}

          {viewStep === 'fill' && (
            <>
              <p className="settings-muted" style={{ marginTop: 0 }}>
                Choose where the stock comes from, then work down each item below: pick the
                lot and print its labels. <strong>Mark filled</strong> is at the bottom.
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <label className="settings-label" style={{ marginBottom: 0 }}>
                  Filling from office
                  <select
                    className="settings-input"
                    value={fillBranchId}
                    onChange={(e) =>
                      setFillBranchId(e.target.value ? Number(e.target.value) : '')
                    }
                  >
                    <option value="">Choose office…</option>
                    {fillBranches.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                        {row.isDefault ? ' (default)' : ''}
                        {settingsFulfillment.branchId === row.id
                          ? ' · mail fulfillment'
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-label" style={{ marginBottom: 0 }}>
                  Location
                  <select
                    className="settings-input"
                    value={fillLocationId}
                    disabled={fillBranchId === ''}
                    onChange={(e) =>
                      setFillLocationId(e.target.value ? Number(e.target.value) : '')
                    }
                  >
                    <option value="">Choose location…</option>
                    {fillLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                        {loc.isDefault ? ' (default)' : ''}
                        {settingsFulfillment.locationId === loc.id
                          ? ' · mail order'
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}

          {viewStep === 'check' && (
            <>
              <p style={{ marginTop: 0 }}>
                Filled by <strong>{open.fillerName || '—'}</strong>
                {open.fillBranchName ? (
                  <>
                    {' '}
                    from <strong>{open.fillBranchName}</strong>
                  </>
                ) : null}
              </p>
              <p>
                <strong>Notes from filler</strong>
                <br />
                {open.checkNotes || 'None'}
              </p>
              {open.labelUrl || open.trackingCode ? (
                <p>
                  {open.labelUrl ? (
                    <a href={open.labelUrl} target="_blank" rel="noreferrer">
                      Open shipping label
                    </a>
                  ) : null}
                  {open.trackingCode ? (
                    <>
                      {' · '}
                      <TrackingLink order={open} />
                    </>
                  ) : null}
                </p>
              ) : mailAllPassedThrough(open) ? (
                <p className="settings-muted">
                  Every item was ordered on another site and ships from there — no label from us.
                </p>
              ) : pickup ? (
                <p className="settings-muted">Office pickup — no shipping label.</p>
              ) : null}

              <div className="mail-queue__section" style={{ marginTop: 4 }}>
                <p className="mail-queue__section-label">Check by patient</p>
                {groupedLines.map((group) => {
                  const done = linesAllChecked(group.lines, open);
                  const checker =
                    group.lines.find((line) => line.checkedByName)?.checkedByName ||
                    open.secondCheckerName ||
                    null;
                  const label = group.petName || 'Household';
                  const lineIds = group.lines.map((line) => line.id);
                  const patientId = group.petId;
                  return (
                    <div key={`check-${group.key}`} className="mail-queue__row" style={{ marginBottom: 8 }}>
                      <div style={{ flex: '1 1 160px', minWidth: 120 }}>
                        <strong style={{ fontSize: 13 }}>{label}</strong>
                        <div className="mail-queue__meta-line" style={{ marginTop: 2 }}>
                          {group.lines
                            .map((line) =>
                              mailLinePassedThrough(line)
                                ? `${line.name} (${passedThroughSummary(line)})`
                                : line.name,
                            )
                            .join(' · ')}
                        </div>
                        {done ? (
                          <div className="mail-queue__meta-line" style={{ marginTop: 2 }}>
                            ✓ Checked{checker ? ` by ${checker}` : ''}
                          </div>
                        ) : null}
                      </div>
                      {done ? (
                        <span className="mail-queue__badge is-go">✓ Checked</span>
                      ) : (
                        <button
                          type="button"
                          className="mail-queue__btn is-primary"
                          disabled={!employeeId || !mailFillDone(open)}
                          onClick={() => {
                            if (iFilled) {
                              setSameCheckConfirm({ patientId, lineIds, label });
                              return;
                            }
                            void onRun(async () => {
                              const order = await pharmacyMailAction(practiceId, open.id, {
                                action: 'check',
                                patientId: patientId ?? undefined,
                                lineIds: patientId == null ? lineIds : undefined,
                              });
                              if (mailCheckDone(order)) setViewStep('contacted');
                              return order;
                            });
                          }}
                        >
                          I checked {label}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {mailCheckDone(open) ? (
                <p className="settings-muted">
                  All patients checked. Use Contacted when you are ready to tell the client.
                </p>
              ) : sameCheckConfirm ? (
                <div className="mail-queue__same-check" role="status">
                  <p className="mail-queue__same-check-title">You filled this order</p>
                  <p>
                    A second person should check {sameCheckConfirm.label}. If no one else is
                    available and you are a licensed veterinarian or veterinary technician, you
                    can override and check it yourself. The override is recorded on the order
                    under your name.
                  </p>
                  {!canSelfCheck ? (
                    <p style={{ color: '#b45309' }}>
                      Your account isn’t set up as a licensed veterinarian or technician, so
                      someone else needs to check this.
                    </p>
                  ) : null}
                  <div className="mail-queue__actions">
                    <button
                      type="button"
                      className="mail-queue__btn"
                      onClick={() => setSameCheckConfirm(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="mail-queue__btn is-primary"
                      disabled={!employeeId || !mailFillDone(open) || !canSelfCheck}
                      onClick={() =>
                        void onRun(async () => {
                          const order = await pharmacyMailAction(practiceId, open.id, {
                            action: 'check_override',
                            notes: `Self-check override: the person who filled this order also checked ${sameCheckConfirm.label} (no second person available).`,
                            patientId: sameCheckConfirm.patientId ?? undefined,
                            lineIds:
                              sameCheckConfirm.patientId == null
                                ? sameCheckConfirm.lineIds
                                : undefined,
                          });
                          setSameCheckConfirm(null);
                          if (mailCheckDone(order)) setViewStep('contacted');
                          return order;
                        })
                      }
                    >
                      Override and check {sameCheckConfirm.label}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mail-queue__actions">
                  <button
                    type="button"
                    className="mail-queue__btn"
                    onClick={() => printCheckSlip(open)}
                  >
                    Print check slip
                  </button>
                  {(open.lines || []).some((line) => !lineIsChecked(line, open)) &&
                  (open.lines || []).filter((line) => !lineIsChecked(line, open)).length > 1 ? (
                    <button
                      type="button"
                      className="mail-queue__btn"
                      disabled={!employeeId || !mailFillDone(open)}
                      onClick={() => {
                        if (iFilled) {
                          setSameCheckConfirm({
                            patientId: null,
                            lineIds: (open.lines || [])
                              .filter((line) => !lineIsChecked(line, open))
                              .map((line) => line.id),
                            label: 'all remaining',
                          });
                          return;
                        }
                        void onRun(() =>
                          pharmacyMailAction(practiceId, open.id, { action: 'check' }),
                        ).then((ok) => {
                          if (ok) setViewStep('contacted');
                        });
                      }}
                    >
                      Check all remaining
                    </button>
                  ) : null}
                </div>
              )}
              {voidLabelButton()}
            </>
          )}

          {(viewStep === 'ship' || viewStep === 'ready_for_pickup') && mailAllPassedThrough(open) && (
            <p className="settings-muted" style={{ marginTop: 0 }}>
              Every item was ordered on another site that ships straight to the client, so
              there’s nothing to {viewStep === 'ship' ? 'ship' : 'hand over'} from here.
            </p>
          )}

          {(viewStep === 'ship' || viewStep === 'ready_for_pickup') && !mailAllPassedThrough(open) && (
            <>
              {viewStep === 'ship' && (open.labelUrl || open.trackingCode) && (
                <>
                  <p className="mail-queue__sent" style={{ marginTop: 0 }}>
                    Label already printed — postage was charged. Do not print another
                    unless you void this one first.
                  </p>
                  <p>
                    {open.carrier || 'EasyPost'}
                    {open.service ? ` ${open.service}` : ''}
                    {open.trackingCode ? (
                      <>
                        {' · '}
                        <TrackingLink order={open} />
                      </>
                    ) : null}
                  </p>
                  {open.labelUrl ? (
                    <p>
                      <a href={open.labelUrl} target="_blank" rel="noreferrer">
                        Open shipping label
                      </a>
                    </p>
                  ) : null}
                  {voidLabelButton()}
                </>
              )}
              {viewStep === 'ship' && !(open.labelUrl || open.trackingCode) && (
                <>
                  <p className="settings-muted" style={{ marginTop: 0 }}>
                    Choose the package type before quoting. A 1 oz bottle in a padded
                    mailer is much cheaper than the same weight rated as a box.
                    EasyPost only returns carriers connected on that account — add UPS
                    there if it is missing. These are EasyPost retail/account rates, not
                    Stamps.com negotiated postage.
                    {open.fillBranchName
                      ? ` Quotes ship from ${open.fillBranchName}.`
                      : ' Fill the order first so quotes use that office ZIP.'}
                  </p>
                  {open.labelRefundStatus ? (
                    <p className="settings-muted">
                      Last label refund: {open.labelRefundStatus}. Print a new label if
                      you still need to ship.
                    </p>
                  ) : null}
                  <div className="mail-queue__actions">
                    <label className="settings-label">
                      Package type
                      <select
                        className="settings-input"
                        value={parcelType}
                        onChange={(e) => setParcelType(e.target.value as MailParcelType)}
                      >
                        <option value="letter">Letter / envelope</option>
                        <option value="flat">Large envelope (flat)</option>
                        <option value="mailer">Padded mailer</option>
                        <option value="small_box">Small box</option>
                        <option value="custom">Custom dimensions</option>
                      </select>
                    </label>
                    <label className="settings-label">
                      Package weight (oz)
                      <input
                        className="settings-input"
                        value={weight}
                        onChange={(e) => onWeight(e.target.value)}
                        placeholder="Required"
                      />
                    </label>
                    {(parcelType === 'custom' || parcelType === 'mailer' || parcelType === 'small_box') && (
                      <>
                        <label className="settings-label">
                          L (in)
                          <input
                            className="settings-input"
                            value={parcelLength}
                            onChange={(e) => setParcelLength(e.target.value)}
                            placeholder={parcelType === 'mailer' ? '10' : parcelType === 'small_box' ? '8' : ''}
                          />
                        </label>
                        <label className="settings-label">
                          W (in)
                          <input
                            className="settings-input"
                            value={parcelWidth}
                            onChange={(e) => setParcelWidth(e.target.value)}
                            placeholder={parcelType === 'mailer' ? '7' : parcelType === 'small_box' ? '6' : ''}
                          />
                        </label>
                        <label className="settings-label">
                          H (in)
                          <input
                            className="settings-input"
                            value={parcelHeight}
                            onChange={(e) => setParcelHeight(e.target.value)}
                            placeholder={parcelType === 'mailer' ? '1' : parcelType === 'small_box' ? '4' : ''}
                          />
                        </label>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={Boolean(shipBlocked) || quoting}
                      title={shipBlocked ?? undefined}
                      onClick={() => {
                        setShipError(null);
                        setQuoting(true);
                        void fetchMailRates(practiceId, open.id, parcel())
                          .then(onRates)
                          .catch((e) => setShipError(apiErrorMessage(e)))
                          .finally(() => setQuoting(false));
                      }}
                    >
                      {quoting ? 'Comparing sizes…' : 'Get cheapest rates'}
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={Boolean(shipBlocked) || buyingLabel}
                      title={shipBlocked ?? undefined}
                      onClick={() => {
                        setShipError(null);
                        setBuyingLabel(true);
                        // Open the tab during the click so the browser doesn't block it as a popup.
                        const labelTab = window.open('', '_blank');
                        void onRun(async () => {
                          try {
                            const order = await buyMailLabel(practiceId, open.id, parcel());
                            if (order.labelUrl && labelTab) labelTab.location.href = order.labelUrl;
                            else labelTab?.close();
                            return order;
                          } catch (e) {
                            labelTab?.close();
                            setShipError(apiErrorMessage(e));
                            throw e;
                          }
                        }).finally(() => setBuyingLabel(false));
                      }}
                    >
                      {buyingLabel ? 'Buying label…' : 'Print cheapest label'}
                    </button>
                  </div>
                  {shipBlocked || shipError ? (
                    <p
                      className="settings-muted"
                      role={shipError ? 'alert' : undefined}
                      style={{ margin: '8px 0 0', color: shipError ? '#b91c1c' : '#b45309' }}
                    >
                      {shipError || shipBlocked}
                    </p>
                  ) : null}
                  {rates.shipFrom?.zip ? (
                    <p className="settings-muted">
                      Quoted from {rates.shipFrom.name || rates.shipFrom.city}{' '}
                      {rates.shipFrom.zip}.
                    </p>
                  ) : null}
                  {rates.packHints && rates.packHints.length > 0 ? (
                    <div className="mail-queue__pack-hint">
                      <p>
                        <strong>Cheaper if you can pack smaller.</strong> Same
                        weight, different box. Only print after you actually fit
                        it.
                      </p>
                      <ul>
                        {rates.packHints.map((hint) => (
                          <li key={hint.label}>
                            {hint.label}: {hint.carrier} {hint.service} ${hint.rate}{' '}
                            (${hint.save} less){' '}
                            <button
                              type="button"
                              className="brief-text-btn"
                              disabled={quoting}
                              onClick={() => {
                                setParcelType(hint.type);
                                setParcelLength(String(hint.lengthIn));
                                setParcelWidth(String(hint.widthIn));
                                setParcelHeight(String(hint.heightIn));
                                setQuoting(true);
                                void fetchMailRates(practiceId, open.id, {
                                  type: hint.type,
                                  weightOz: Number(weight),
                                  lengthIn: hint.lengthIn,
                                  widthIn: hint.widthIn,
                                  heightIn: hint.heightIn,
                                })
                                  .then(onRates)
                                  .finally(() => setQuoting(false));
                              }}
                            >
                              Use this size
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : rates.rates.length > 0 ? (
                    <p className="settings-muted">
                      Also quoted a few smaller mailers at this weight — none beat
                      this price.
                    </p>
                  ) : null}
                  {rates.rates.length > 0 && (
                    <ul>
                      {rates.rates.map((r) => (
                        <li key={r.id}>
                          {r.carrier} {r.service} — ${r.rate}{' '}
                          <button
                            type="button"
                            className="brief-text-btn"
                            onClick={() =>
                              void onRun(async () => {
                                const order = await buyMailLabel(practiceId, open.id, {
                                  ...parcel(),
                                  rateId: r.id,
                                });
                                if (order.labelUrl) window.open(order.labelUrl, '_blank');
                                return order;
                              })
                            }
                          >
                            Print this label
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {rates.blockedCarriers?.length ? (
                    <p className="settings-muted">
                      {rates.blockedCarriers.join(' and ')}{' '}
                      {rates.blockedCarriers.length === 1 ? 'is' : 'are'} hidden
                      because an item on this order lists{' '}
                      {rates.blockedCarriers.length === 1 ? 'it' : 'them'} as a
                      prohibited carrier.
                    </p>
                  ) : rates.carriers.length > 0 && !rates.carriers.some((c) => /ups/i.test(c)) ? (
                    <p className="settings-muted">
                      UPS is not on this quote. Connect a UPS carrier account in EasyPost
                      if you want those rates.
                    </p>
                  ) : null}
                </>
              )}
              {viewStep === 'ready_for_pickup' && (
                <p className="settings-muted" style={{ marginTop: 0 }}>
                  Office pickup — no EasyPost label. Send it to check when the bag is ready.
                </p>
              )}
              <div className="mail-queue__actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={!pickup && !open.labelUrl}
                  onClick={() =>
                    void onRun(() =>
                      pharmacyMailAction(practiceId, open.id, { action: 'ready_for_check' }),
                    )
                  }
                >
                  Ready for check
                </button>
              </div>
              {!pickup && !open.labelUrl ? (
                <p className="settings-muted">Print an EasyPost label before sending this to check.</p>
              ) : null}
            </>
          )}

          {viewStep === 'contacted' && (
            <>
              <p className="settings-muted" style={{ marginTop: 0 }}>
                The order is Done only after fill, ship or pickup, check, and this contact step.
              </p>
              {mailContactedDone(open) ? (
                <p className="mail-queue__sent" role="status">
                  {open.clientContactKind === 'none'
                    ? 'Marked do not contact.'
                    : open.clientContactKind === 'sms'
                      ? 'Client was texted.'
                      : 'Client was emailed.'}
                </p>
              ) : (
                <>
                  <p className="settings-muted" style={{ marginTop: 0 }}>
                    Email goes through your shared Gmail send-as (same as other client emails). Text
                    uses the draft below.
                    {anyMailLinesRejected(open)
                      ? ' A rejection email earlier does not complete this step while other items are still in the pharmacy.'
                      : ''}
                  </p>
                  {orderPaid && rejectedRefundStillDue(open) > 0.009 ? (
                    <label className="mail-queue__check" style={{ margin: '0 0 10px' }}>
                      <input
                        type="checkbox"
                        checked={refundRejectedOnSend}
                        onChange={(e) => setRefundRejectedOnSend(e.target.checked)}
                      />
                      Refund {money(rejectedRefundStillDue(open))} for rejected item(s) when contacting
                    </label>
                  ) : null}
                  <div className="mail-queue__compose">
                    <label className="settings-label">
                      Text message
                      <textarea
                        className="settings-input"
                        value={notifyMessage}
                        onChange={(e) => setNotifyMessage(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="mail-queue__actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!open.clientId}
                      title={!open.clientId ? 'No client record for Gmail email' : undefined}
                      onClick={() => {
                        setRefundRejectedOnSend(rejectedRefundStillDue(open) > 0.009);
                        setContactEmailOpen(true);
                      }}
                    >
                      {emailedAt ? 'Emailed' : 'Email client'}
                    </button>
                    <button
                      type="button"
                      className={textedAt ? 'btn primary' : 'btn secondary'}
                      disabled={!open.clientId || texting}
                      onClick={() =>
                        void (async () => {
                          setTexting(true);
                          const ok = await onRun(async () => {
                            await sendClientText(
                              notifyMessage.trim(),
                              pickup ? 'Mail order pickup text' : 'Mail order shipped text',
                            );
                            return pharmacyMailAction(practiceId, open.id, {
                              action: 'complete',
                              notes: pickup ? 'Pickup text sent' : 'Shipped text sent',
                              refundRejected:
                                refundRejectedOnSend && rejectedRefundStillDue(open) > 0.009,
                            });
                          });
                          setTexting(false);
                          if (ok) setTextedAt(sentClock());
                        })()
                      }
                    >
                      {texting ? 'Texting…' : textedAt ? 'Texted' : 'Text client'}
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() =>
                        void onRun(() =>
                          pharmacyMailAction(practiceId, open.id, {
                            action: 'skip_contact',
                            notes: 'Do not contact client',
                          }),
                        )
                      }
                    >
                      Do not contact client
                    </button>
                  </div>
                  {emailedAt ? (
                    <p className="mail-queue__sent" role="status">
                      Email sent to {open.customerName} at {emailedAt}.
                    </p>
                  ) : null}
                  {textedAt ? (
                    <p className="mail-queue__sent" role="status">
                      Text sent to {open.customerName} at {textedAt}.
                    </p>
                  ) : null}
                </>
              )}
              {stage === 'done' ? (
                <p className="settings-muted">
                  {pickup ? 'Ready for pickup / completed.' : 'Shipped.'}
                  {open.trackingCode ? (
                    <>
                      {' Tracking: '}
                      <TrackingLink order={open} />.
                    </>
                  ) : null}
                </p>
              ) : null}
            </>
          )}

          {anyMailLinesRejected(open) && (
            <p className="settings-muted" style={{ marginTop: 0 }}>
              {allMailLinesRejected(open)
                ? 'This order was rejected. Linked auto-ship is cancelled and a refund is issued when a Stripe charge exists.'
                : 'One or more items were rejected by the doctor. Only those lines are refunded; the rest of the order can keep moving.'}
            </p>
          )}

          {!employeeId && (viewStep === 'fill' || viewStep === 'check') && (
            <p className="settings-muted">Sign in as staff so your name is recorded.</p>
          )}
        </div>

        {groupedLines.map((group) => {
          const weightLabel = formatPatientWeight(
            group.lines[0]?.weightLbs,
            group.lines[0]?.weightDate,
          );
          const petApproved = linesAllApproved(group.lines);
          const petFilled = linesAllFilled(group.lines, open);
          const petChecked = linesAllChecked(group.lines, open);
          return (
          <div key={group.key}>
            {group.petName ? (
              <div className="mail-queue__pet-block">
                <p className="mail-queue__pet">
                  {group.petId ? (
                    <Link
                      className="mail-queue__pet-link"
                      to={`/schedule/patients?patientId=${encodeURIComponent(String(group.petId))}`}
                      onClick={() => onRememberScroll()}
                    >
                      {group.petName}
                    </Link>
                  ) : (
                    group.petName
                  )}
                  {weightLabel ? <span className="mail-queue__weight"> · {weightLabel}</span> : null}
                </p>
                <div className="mail-queue__pet-steps" aria-label={`${group.petName} progress`}>
                  <span className={`mail-queue__badge ${petApproved ? 'is-go' : 'is-wait'}`}>
                    {petApproved ? '✓ Approved' : 'Approved'}
                  </span>
                  <span className={`mail-queue__badge ${petFilled ? 'is-go' : ''}`}>
                    {petFilled ? '✓ Fill' : 'Fill'}
                  </span>
                  <span className={`mail-queue__badge ${petChecked ? 'is-go' : ''}`}>
                    {petChecked ? '✓ Check' : 'Check'}
                  </span>
                </div>
              </div>
            ) : null}
            {group.lines.map((line) => {
              const lineBadge =
                line.lineStatus === 'ok_to_mail'
                  ? { label: 'Ready', className: 'is-go' }
                  : line.lineStatus === 'awaiting_doctor_approval'
                    ? line.approvalTaskOpen
                      ? {
                          label: line.approvalTaskAssigneeName
                            ? `Task with ${line.approvalTaskAssigneeName}`
                            : 'Approval task sent',
                          className: 'is-wait',
                        }
                      : { label: 'Needs approval task', className: 'is-warn' }
                    : line.lineStatus === 'rejected'
                      ? { label: 'Rejected', className: 'is-stop' }
                      : line.lineStatus === 'send_back'
                        ? { label: 'Sent back', className: 'is-warn' }
                        : null;
              const currentScript = scriptsByLine[line.id] ?? line.scriptText ?? '';
              const scriptDirty = currentScript.trim() !== (line.scriptText || '').trim();
              const stockItemId = line.stockInventoryItemId ?? line.inventoryItemId ?? null;
              return (
              <div key={line.id} className="mail-queue__line">
                <div className="mail-queue__line-head">
                  <h4>
                    {stockItemId != null ? (
                      <button
                        type="button"
                        className="mail-queue__pet-link"
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          cursor: 'pointer',
                          font: 'inherit',
                          textAlign: 'left',
                        }}
                        title="Open inventory item"
                        onClick={() =>
                          setInventoryDetail({
                            inventoryItemId: stockItemId,
                            name: line.name,
                            lineId: line.id,
                          })
                        }
                      >
                        {line.name}
                      </button>
                    ) : (
                      line.name
                    )}{' '}
                    <span className="mail-queue__qty">× {Number(line.quantity)}</span>
                  </h4>
                  {lineBadge ? (
                    <span className={`mail-queue__badge ${lineBadge.className}`}>
                      {lineBadge.label}
                    </span>
                  ) : null}
                  {passesThrough(line) ? (
                    <span className="mail-queue__badge is-wait">Passed through</span>
                  ) : line.stockFlag === 'out_of_stock' ? (
                    <span
                      className="mail-queue__badge is-warn"
                      title="This item is set to out of stock in the online store."
                    >
                      Out of stock
                      {line.stockBackInStockDate ? ` · back ${formatBackInStock(line.stockBackInStockDate)}` : ''}
                    </span>
                  ) : line.stockFlag === 'short' ? (
                    <span
                      className="mail-queue__badge is-warn"
                      title="The mail order shelf doesn't have enough on hand for every open order."
                    >
                      Short on shelf
                    </span>
                  ) : null}
                </div>
                <ul className="mail-queue__line-facts">
                  <li>
                    {line.autoshipFrequency
                      ? `Auto-ship ${formatAutoshipFrequency(line.autoshipFrequency)}${
                          line.renewalDate ? ` · next ${line.renewalDate}` : ''
                        }${line.subscriptionPaused ? ' · paused' : ''}`
                      : 'One-time fill'}
                    {line.autoshipFrequency ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="mail-queue__pet-link"
                          style={{
                            background: 'none',
                            border: 0,
                            padding: 0,
                            cursor: 'pointer',
                            font: 'inherit',
                          }}
                          onClick={() => setEditAutoshipLine(line)}
                        >
                          Edit
                        </button>
                      </>
                    ) : null}
                  </li>
                  <li>
                    {(() => {
                      const doctor = mailLabelDoctor(open, line);
                      const providers = staff.filter((emp) => emp.isProvider);
                      const options =
                        doctor.employeeId &&
                        !providers.some((emp) => emp.id === doctor.employeeId)
                          ? staff.filter(
                              (emp) => emp.isProvider || emp.id === doctor.employeeId,
                            )
                          : providers;
                      return (
                        <label className="mail-queue__doctor">
                          <span className="settings-muted">Doctor</span>
                          <select
                            className="settings-input"
                            value={doctor.employeeId ? String(doctor.employeeId) : ''}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const nextId = Number(e.target.value);
                              if (!nextId || nextId === doctor.employeeId) return;
                              void onRun(() =>
                                pharmacyMailAction(practiceId, open.id, {
                                  action: 'set_doctor',
                                  lineId: line.id,
                                  doctorEmployeeId: nextId,
                                }),
                              );
                            }}
                          >
                            <option value="">
                              {doctor.name ? doctor.name : 'No doctor on this script'}
                            </option>
                            {options.map((emp) => (
                              <option key={emp.id} value={emp.id}>
                                {formatEmployeeDisplayName(emp)}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })()}
                  </li>
                  {line.authorizedRefills != null ? (
                    <li className="mail-queue__refills">
                      {line.authorizedAcuity
                        ? `${line.authorizedAcuity === 'chronic' ? 'Chronic' : 'Acute'} · `
                        : ''}
                      {line.authorizedRefills} refill{line.authorizedRefills === 1 ? '' : 's'}
                      {line.authorizedRefillExpiration
                        ? `, expire ${line.authorizedRefillExpiration}`
                        : ''}
                    </li>
                  ) : null}
                  <li>
                    {line.refillsRemaining != null
                      ? `${line.refillsRemaining} left on prior Rx`
                      : line.refillNote || 'Prior refill count not on file'}
                    {line.refillExpiresAt
                      ? `, expires ${new Date(line.refillExpiresAt).toLocaleDateString()}`
                      : ''}
                  </li>
                  {mailLinePassedThrough(line) && line.externalOrderedAt ? (
                    <li>
                      {passedThroughSummary(line)}
                      {line.externalOrderedByName ? ` by ${line.externalOrderedByName}` : ''}
                    </li>
                  ) : null}
                </ul>

                <div className="mail-queue__section">
                  <p className="mail-queue__section-label">Approval</p>
                  {lineIsApproved(line) ? (
                    <>
                    <div className="mail-queue__row mail-queue__row--center">
                      <span className="mail-queue__badge is-go">✓ Approved</span>
                      {line.approvalTaskId ? (
                        <Link
                          className="mail-queue__btn"
                          to={`/schedule/tasks?taskId=${encodeURIComponent(String(line.approvalTaskId))}`}
                        >
                          Open task
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        className="mail-queue__btn mail-queue__btn--quiet"
                        aria-expanded={Boolean(resendOpen[line.id])}
                        onClick={() =>
                          setResendOpen((prev) => ({ ...prev, [line.id]: !prev[line.id] }))
                        }
                      >
                        {resendOpen[line.id] ? 'Cancel re-send' : 'Re-send…'}
                      </button>
                    </div>
                    {resendOpen[line.id] ? (
                    <div className="mail-queue__row" style={{ marginTop: 8 }}>
                      <label className="settings-label">
                        Doctor
                        <select
                          className="settings-input"
                          value={assigneeByLine[line.id] || ''}
                          onChange={(e) =>
                            setAssigneeByLine((prev) => ({
                              ...prev,
                              [line.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Choose staff</option>
                          {staff.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {formatEmployeeDisplayName(emp) || emp.email}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="mail-queue__btn"
                        disabled={!assigneeByLine[line.id]}
                        onClick={() =>
                          void onRun(() =>
                            sendMailApprovalTask(practiceId, open.id, {
                              assignedToEmployeeId: Number(assigneeByLine[line.id]),
                              notes: taskNote.trim() || undefined,
                              lineIds: [line.id],
                            }).then((order) => {
                              clearSelfApproveForLineIds([line.id]);
                              onOrderUpdated(order);
                              setViewStep('needs_approval');
                              return order;
                            }),
                          )
                        }
                      >
                        Re-send approval
                      </button>
                    </div>
                    ) : null}
                    </>
                  ) : (
                    <>
                      {line.lineStatus === 'awaiting_doctor_approval' ? (
                        <p className="mail-queue__task-status">
                          {line.approvalTaskOpen && line.approvalTaskAssigneeName ? (
                            <>
                              Approval task sent to <strong>{line.approvalTaskAssigneeName}</strong>
                              {line.approvalTaskWatcherNames?.length
                                ? ` · ${line.approvalTaskWatcherNames.join(', ')} watching`
                                : ''}
                              . Nothing to do here unless it needs to go to someone else.
                            </>
                          ) : (
                            <>No approval task has been sent yet. Choose who should get it.</>
                          )}
                        </p>
                      ) : null}
                      <div className="mail-queue__row">
                        <label className="settings-label">
                          {line.approvalTaskOpen ? 'Reassign to' : 'Send to'}
                          <select
                            className="settings-input"
                            value={assigneeByLine[line.id] || ''}
                            onChange={(e) =>
                              setAssigneeByLine((prev) => ({
                                ...prev,
                                [line.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">Choose staff</option>
                            {staff.map((emp) => (
                              <option key={emp.id} value={emp.id}>
                                {formatEmployeeDisplayName(emp) || emp.email}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className={`mail-queue__btn${line.approvalTaskOpen ? '' : ' is-primary'}`}
                          disabled={!assigneeByLine[line.id]}
                          onClick={() =>
                            void onRun(() =>
                              sendMailApprovalTask(practiceId, open.id, {
                                assignedToEmployeeId: Number(assigneeByLine[line.id]),
                                notes: taskNote.trim() || undefined,
                                lineIds: [line.id],
                              }).then((order) => {
                                clearSelfApproveForLineIds([line.id]);
                                onOrderUpdated(order);
                                setViewStep('needs_approval');
                                return order;
                              }),
                            )
                          }
                        >
                          {line.approvalTaskOpen ? 'Reassign task' : 'Send task'}
                        </button>
                        {line.approvalTaskId ? (
                          <Link
                            className="mail-queue__btn"
                            to={`/schedule/tasks?taskId=${encodeURIComponent(String(line.approvalTaskId))}`}
                          >
                            Open task
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          className="mail-queue__btn"
                          aria-expanded={Boolean(selfApprove[line.id])}
                          onClick={() =>
                            setSelfApprove((prev) => {
                              if (prev[line.id]) {
                                const next = { ...prev };
                                delete next[line.id];
                                return next;
                              }
                              return {
                                ...prev,
                                [line.id]: {
                                  ...initialMailRxDecisionFromLine(line),
                                  reason: '',
                                  error: null,
                                },
                              };
                            })
                          }
                        >
                          {selfApprove[line.id] ? 'Cancel' : 'Approve here…'}
                        </button>
                      </div>
                      {selfApprove[line.id] ? (
                        <div className="mail-queue__self-approve">
                          <p className="mail-queue__meta-line">
                            {line.approvalTaskOpen && line.approvalTaskAssigneeName
                              ? `Approve here and take it back from ${line.approvalTaskAssigneeName}. Their task is removed, with this note, so they cannot also approve it. This still goes on the pet's Rx.`
                              : "Approve without a doctor task (refills on file, chart OK). This goes on the pet's Rx, so fill in all of it."}
                          </p>
                          <MailRxDecisionFields
                            value={selfApprove[line.id]}
                            autoship={Boolean(line.autoshipFrequency)}
                            onChange={(next) =>
                              setSelfApprove((prev) => ({
                                ...prev,
                                [line.id]: { ...prev[line.id], ...next, error: null },
                              }))
                            }
                            onError={(message) =>
                              setSelfApprove((prev) => ({
                                ...prev,
                                [line.id]: { ...prev[line.id], error: message },
                              }))
                            }
                            chartExtra={
                              line.patientId ? (
                                <BookPatientChartButton
                                  patientId={String(line.patientId)}
                                  patientName={line.patientName || group.petName || 'Patient'}
                                  practiceId={practiceId}
                                  practiceTz={MAIL_PRACTICE_TZ}
                                  showAlerts
                                  label="View details"
                                  className="mail-queue__pet-link"
                                  onApplyRefillExpiration={(dateInput) => {
                                    setSelfApprove((prev) => ({
                                      ...prev,
                                      [line.id]: {
                                        ...prev[line.id],
                                        expiration: clampRefillExpiration(dateInput),
                                        expirationCapNote: refillExpirationCapNote(dateInput),
                                        error: null,
                                      },
                                    }));
                                  }}
                                />
                              ) : null
                            }
                          />
                          <label className="settings-label" style={{ marginTop: 10 }}>
                            {line.approvalTaskOpen ? 'Note for the closed task' : 'Why no doctor task?'}
                            <input
                              className="settings-input"
                              value={selfApprove[line.id].reason}
                              placeholder={
                                line.approvalTaskOpen
                                  ? 'e.g. Dr. Frey said OK on Slack'
                                  : 'e.g. Refills on file · chart OK'
                              }
                              onChange={(e) =>
                                setSelfApprove((prev) => ({
                                  ...prev,
                                  [line.id]: {
                                    ...prev[line.id],
                                    reason: e.target.value,
                                    error: null,
                                  },
                                }))
                              }
                            />
                          </label>
                          {selfApprove[line.id].error ? (
                            <p className="mail-queue__error" role="alert">
                              {selfApprove[line.id].error}
                            </p>
                          ) : null}
                          <div className="mail-queue__actions">
                            <button
                              type="button"
                              className="mail-queue__btn is-primary"
                              onClick={() =>
                                void (async () => {
                                  const draft = selfApprove[line.id];
                                  const fail = (message: string) =>
                                    setSelfApprove((prev) => ({
                                      ...prev,
                                      [line.id]: { ...prev[line.id], error: message },
                                    }));
                                  if (!currentScript.trim() || /^use as directed\.?$/i.test(currentScript.trim())) {
                                    fail('Write directions for this item below first.');
                                    return;
                                  }
                                  const missing = mailRxDecisionMissing(draft);
                                  if (missing) {
                                    fail(missing);
                                    return;
                                  }
                                  if (!draft.reason.trim()) {
                                    fail(
                                      line.approvalTaskOpen
                                        ? 'Say why you are approving here, so the task shows why it was closed.'
                                        : 'Say why no doctor task is needed.',
                                    );
                                    return;
                                  }
                                  const refills = parsedMailRefills(draft.refills) ?? 0;
                                  const ok = await onRun(async () => {
                                    if (scriptDirty) {
                                      await pharmacyMailAction(practiceId, open.id, {
                                        action: 'update_script',
                                        lineId: line.id,
                                        scriptText: currentScript.trim(),
                                      });
                                    }
                                    const order = await overrideMailLineApproval(
                                      practiceId,
                                      open.id,
                                      line.id,
                                      draft.reason.trim(),
                                      {
                                        refills,
                                        expiration: refills > 0 ? draft.expiration : null,
                                        acuity: draft.acuity as 'acute' | 'chronic',
                                      },
                                    );
                                    onOrderUpdated(order);
                                    return order;
                                  });
                                  if (ok) {
                                    setSelfApprove((prev) => {
                                      const next = { ...prev };
                                      delete next[line.id];
                                      return next;
                                    });
                                  }
                                })()
                              }
                            >
                              Approve
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {lineNeedsApproval(line) && line.lineStatus === 'send_back' ? (
                        <p className="mail-queue__meta-line">Doctor sent this back for changes.</p>
                      ) : null}
                      {line.lineStatus === 'rejected' ? (
                        <p className="mail-queue__meta-line">This line was rejected.</p>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="mail-queue__section">
                  <p className="mail-queue__section-label">Directions</p>
                  <textarea
                    className="settings-input mail-queue__script"
                    aria-label={`Directions for ${line.name}`}
                    rows={4}
                    value={currentScript}
                    onChange={(e) =>
                      setScriptsByLine((prev) => ({ ...prev, [line.id]: e.target.value }))
                    }
                  />
                  <div className="mail-queue__actions">
                    <button
                      type="button"
                      className="mail-queue__btn"
                      disabled={savingScriptId === line.id || !scriptDirty}
                      onClick={() =>
                        void (async () => {
                          setSavingScriptId(line.id);
                          try {
                            await onRun(() =>
                              pharmacyMailAction(practiceId, open.id, {
                                action: 'update_script',
                                lineId: line.id,
                                scriptText: currentScript.trim(),
                              }),
                            );
                          } finally {
                            setSavingScriptId(null);
                          }
                        })()
                      }
                    >
                      {savingScriptId === line.id ? 'Saving…' : 'Save directions'}
                    </button>
                    {passesThrough(line) || viewStep === 'fill' ? null : (
                      <MailOrderFillLabels
                        className="mail-queue__btn"
                        order={open}
                        line={{
                          ...line,
                          scriptText: currentScript,
                        }}
                        checkNotes={checkNotes}
                      />
                    )}
                  </div>
                </div>

                {viewStep === 'fill' ? (
                  <div className="mail-queue__section">
                    <p className="mail-queue__section-label">Fulfilled by</p>
                    <div className="mail-queue__row mail-queue__row--center">
                      {(
                        [
                          ['stock', 'From our stock'],
                          ['external', 'Ordered on another site'],
                        ] as const
                      ).map(([source, label]) => (
                        <label key={source} className="mail-queue__check">
                          <input
                            type="radio"
                            name={`fulfillment-${line.id}`}
                            checked={(fillSources[line.id]?.source ?? 'stock') === source}
                            onChange={() =>
                              setFillSources((prev) => ({
                                ...prev,
                                [line.id]: {
                                  ...(prev[line.id] ?? {
                                    vendor: line.defaultExternalVendor ?? '',
                                    orderRef: '',
                                  }),
                                  source,
                                },
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    {passesThrough(line) ? (
                      <div className="mail-queue__row" style={{ marginTop: 8 }}>
                        <label className="settings-label">
                          Site / vendor
                          <input
                            className="settings-input"
                            value={fillSources[line.id]?.vendor ?? ''}
                            placeholder="e.g. Royal Canin"
                            onChange={(e) =>
                              setFillSources((prev) => ({
                                ...prev,
                                [line.id]: {
                                  source: 'external',
                                  orderRef: prev[line.id]?.orderRef ?? '',
                                  vendor: e.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <label className="settings-label">
                          Their order #
                          <input
                            className="settings-input"
                            value={fillSources[line.id]?.orderRef ?? ''}
                            placeholder="Required"
                            required
                            onChange={(e) =>
                              setFillSources((prev) => ({
                                ...prev,
                                [line.id]: {
                                  source: 'external',
                                  vendor: prev[line.id]?.vendor ?? '',
                                  orderRef: e.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {viewStep === 'fill' && line.trackLots && !passesThrough(line) ? (
                  <div
                    key={`${fillBranchId}:${fillLocationId}`}
                    className="mail-queue__section mail-queue__lot"
                  >
                    <StockLotPicker
                      practiceId={practiceId}
                      inventoryItemId={stockItemId}
                      branchId={fillBranchId === '' ? null : Number(fillBranchId)}
                      locationId={fillLocationId === '' ? null : Number(fillLocationId)}
                      required
                      selectedLotId={fillLots[line.id]?.lotId ?? null}
                      lotNumber={fillLots[line.id]?.lotNumber ?? ''}
                      label="Lot / expiration"
                      refreshKey={lotRefreshByLine[line.id] ?? 0}
                      onChange={(pick) =>
                        setFillLots((prev) => ({
                          ...prev,
                          [line.id]: { lotId: pick.lotId, lotNumber: pick.lotNumber },
                        }))
                      }
                    />
                  </div>
                ) : null}

                {viewStep === 'fill' && !passesThrough(line) ? (
                  <div className="mail-queue__section">
                    <p className="mail-queue__section-label">Labels</p>
                    <div className="mail-queue__actions">
                      <MailOrderFillLabels
                        className="mail-queue__btn"
                        order={open}
                        line={{ ...line, scriptText: currentScript }}
                        checkNotes={checkNotes}
                      />
                    </div>
                  </div>
                ) : null}

                {canSplitShipment ? (
                  <div className="mail-queue__line-foot">
                    <label className="mail-queue__check">
                      <input
                        type="checkbox"
                        checked={splitIds.includes(line.id)}
                        onChange={(e) =>
                          setSplitIds((prev) =>
                            e.target.checked
                              ? [...prev, line.id]
                              : prev.filter((id) => id !== line.id),
                          )
                        }
                      />
                      Split to new shipment
                    </label>
                  </div>
                ) : null}
              </div>
              );
            })}
          </div>
          );
        })}

        {viewStep === 'fill' ? (
          <div className="mail-queue__fill-finish">
          <p className="mail-queue__fill-finish-title">Finish filling</p>
          <ul className="mail-queue__fill-checklist">
            {(open.lines || []).map((line) => {
              const external = passesThrough(line);
              const ready = external
                ? Boolean(fillSources[line.id]?.orderRef.trim())
                : !line.trackLots || Boolean(fillLots[line.id]?.lotId);
              const status = external
                ? ready
                  ? `Ordered on ${fillSources[line.id]?.vendor.trim() || 'another site'}`
                  : 'Needs the other site’s order #'
                : !line.trackLots
                  ? 'From our stock'
                  : ready
                    ? `Lot ${fillLots[line.id]?.lotNumber || 'picked'}`
                    : 'Needs a lot';
              return (
                <li key={line.id} className={ready ? 'is-ready' : 'is-pending'}>
                  <span className="mail-queue__fill-check">{ready ? '✓' : '•'}</span>
                  <strong>{clientItemName(line.name)}</strong>
                  <span className="settings-muted">{status}</span>
                </li>
              );
            })}
          </ul>
          <label className="settings-label mail-queue__field">
            Notes for the checker
            <textarea
              className="settings-input"
              value={checkNotes}
              onChange={(e) => setCheckNotes(e.target.value)}
              placeholder="Dose, count, anything the checker should see"
            />
          </label>
          {(() => {
            const lines = open.lines || [];
            const fromStock = lines.some((line) => !passesThrough(line));
            const missingLot = lines.some(
              (line) => !passesThrough(line) && line.trackLots && !fillLots[line.id]?.lotId,
            );
            const missingOrderRef = lines.some(
              (line) => passesThrough(line) && !fillSources[line.id]?.orderRef.trim(),
            );
            const fillBlocked = !employeeId
              ? 'Sign in as staff to mark filled.'
              : missingOrderRef
                ? 'Enter the other site’s order number for each item ordered there.'
                : !fromStock
                  ? null
                  : !fillBranchId
                    ? 'Choose the office you filled from.'
                    : !fillLocationId
                      ? 'Choose the location you took stock from.'
                      : missingLot
                        ? 'Choose a lot for each item (or receive stock at this location first).'
                        : null;
            return (
              <div className="mail-queue__actions">
                {fillBlocked ? (
                  <p className="settings-muted" style={{ margin: '0 0 8px', color: '#b45309' }}>
                    {fillBlocked}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="btn primary"
                  disabled={Boolean(fillBlocked)}
                  title={fillBlocked ?? undefined}
                  onClick={() => {
                    setFillError(null);
                    void onRun(() =>
                      pharmacyMailAction(practiceId, open.id, {
                        action: 'fill',
                        checkNotes,
                        fillBranchId: fillBranchId === '' ? undefined : Number(fillBranchId),
                        fillLocationId:
                          fillLocationId === '' ? undefined : Number(fillLocationId),
                        lineLots: lines.map((line) => ({
                          lineId: line.id,
                          inventoryLotBalanceId: fillLots[line.id]?.lotId ?? null,
                          lotNumber: fillLots[line.id]?.lotNumber || null,
                        })),
                        lineSources: lines.map((line) => {
                          const pick = fillSources[line.id];
                          return passesThrough(line)
                            ? {
                                lineId: line.id,
                                fulfillmentSource: 'external' as const,
                                externalVendor: pick?.vendor.trim() || null,
                                externalOrderRef: pick?.orderRef.trim() || null,
                              }
                            : { lineId: line.id, fulfillmentSource: 'stock' as const };
                        }),
                      }).catch((e) => {
                        setFillError(apiErrorMessage(e));
                        throw e;
                      }),
                    );
                  }}
                >
                  Mark filled
                </button>
                {fillError ? (
                  <p className="settings-muted" role="alert" style={{ margin: 0, color: '#b91c1c' }}>
                    {fillError}
                  </p>
                ) : null}
              </div>
            );
          })()}
          </div>
        ) : null}

        {canSplitShipment ? (
        <div
          className="mail-queue__side-card"
          style={{ margin: '12px 0 0', padding: 12 }}
        >
          <h3 style={{ marginTop: 0 }}>Split / approvals</h3>
          <p className="settings-muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
            Check items to move onto a separate shipment, or send each item to a different doctor.
          </p>
          <label className="settings-label">
            Shared task note
            <input
              className="settings-input"
              value={taskNote}
              onChange={(e) => setTaskNote(e.target.value)}
              placeholder="Optional note on the doctor task"
            />
          </label>
          <div className="mail-queue__actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="mail-queue__btn is-primary"
              disabled={
                splitIds.length < 1 || splitIds.length >= (open.lines || []).length
              }
              onClick={() =>
                void onRun(async () => {
                  const result = await splitMailOrder(practiceId, open.id, splitIds);
                  setSplitIds([]);
                  onOrderUpdated(result.original);
                  onOrderUpdated(result.split);
                  return result.original;
                })
              }
            >
              Split selected
              {splitIds.length ? ` (${splitIds.length})` : ''}
            </button>
          </div>
        </div>
        ) : null}
      </div>

      <div className="mail-queue__side">
        <MailOrderClientCommsPanel
          practiceId={practiceId}
          order={open}
          rxLinePhone={rxLinePhone}
          onOrderUpdated={onOrderUpdated}
        />
        {orderPaid && rejectedRefundStillDue(open) > 0.009 && !mailRejectedNeedsClientContact(open) ? (
          <div className="mail-queue__side-card mail-queue__danger">
            <h3>Refund rejected item(s)</h3>
            <p className="settings-muted" style={{ marginTop: 0 }}>
              The client was told about the rejection, but Stripe still needs a refund of{' '}
              {money(rejectedRefundStillDue(open))}.
            </p>
            <div className="mail-queue__actions">
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  void onRun(() =>
                    pharmacyMailAction(practiceId, open.id, { action: 'refund_rejected' }),
                  )
                }
              >
                Refund {money(rejectedRefundStillDue(open))}
              </button>
            </div>
          </div>
        ) : null}
        {mailRejectedNeedsClientContact(open) ? (
          <div className="mail-queue__side-card mail-queue__danger">
            <h3>Rejected — contact client</h3>
            <p className="settings-muted" style={{ marginTop: 0 }}>
              {anyMailLinesRejected(open) && !allMailLinesRejected(open)
                ? 'Tell the client which item(s) were rejected. This does not mark the rest of the order Contacted.'
                : 'This order was rejected. Email or text the client.'}
            </p>
            {orderPaid && rejectedRefundStillDue(open) > 0.009 ? (
              <p className="mail-queue__danger-text" style={{ margin: '0 0 10px' }}>
                Rejected item(s) still need a refund of {money(rejectedRefundStillDue(open))}.
              </p>
            ) : orderPaid && rejectedLineRefundTotal(open) > 0.009 ? (
              <p className="settings-muted" style={{ margin: '0 0 10px' }}>
                Refund of {money(rejectedLineRefundTotal(open))} is already logged.
              </p>
            ) : null}
            {mailOrderRejectedLines(open).length ? (
              <ul className="settings-muted" style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                {mailOrderRejectedLines(open).map((line) => (
                  <li key={line.id}>
                    {line.patientName ? `${line.patientName}: ` : ''}
                    {clientItemName(line.name)} × {Number(line.quantity) || 1}
                  </li>
                ))}
              </ul>
            ) : null}
            {orderPaid && rejectedRefundStillDue(open) > 0.009 ? (
              <label className="mail-queue__check" style={{ margin: '0 0 10px' }}>
                <input
                  type="checkbox"
                  checked={refundRejectedOnSend}
                  onChange={(e) => setRefundRejectedOnSend(e.target.checked)}
                />
                Refund {money(rejectedRefundStillDue(open))} when emailing or texting
              </label>
            ) : null}
            <div className="mail-queue__actions">
              {orderPaid && rejectedRefundStillDue(open) > 0.009 ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() =>
                    void onRun(() =>
                      pharmacyMailAction(practiceId, open.id, { action: 'refund_rejected' }),
                    )
                  }
                >
                  Refund {money(rejectedRefundStillDue(open))} now
                </button>
              ) : null}
              <button
                type="button"
                className="btn secondary"
                disabled={!open.clientId}
                title={!open.clientId ? 'No client record for Gmail email' : undefined}
                onClick={() => {
                  setRejectOutreachOnly(true);
                  setRefundRejectedOnSend(rejectedRefundStillDue(open) > 0.009);
                  setRejectMessage(
                    mailOrderRejectedLines(open).length
                      ? defaultMailOrderPartialRejectBodyText(firstName(open.customerName), open)
                      : defaultMailOrderRejectBodyText(firstName(open.customerName), open),
                  );
                  setRejectModal('email');
                }}
              >
                Email client
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={!open.clientId}
                onClick={() => {
                  setRejectOutreachOnly(true);
                  setRefundRejectedOnSend(rejectedRefundStillDue(open) > 0.009);
                  setRejectMessage(
                    mailOrderRejectedLines(open).length
                      ? defaultMailOrderPartialRejectBodyText(firstName(open.customerName), open)
                      : defaultMailOrderRejectBodyText(firstName(open.customerName), open),
                  );
                  setRejectModal('text');
                }}
              >
                Text client
              </button>
            </div>
          </div>
        ) : null}
        <div className="mail-queue__side-card">
          <h3>Ship to</h3>
          {Number(open.otherBalanceDue) > 0.009 ? (
            <p className="mail-queue__owed-detail" role="status">
              Account balance due {money(open.otherBalanceDue)} (outside this mail order)
            </p>
          ) : null}
          <p style={{ margin: '0 0 6px' }}>
            {open.clientId ? (
              <Link
                className="mail-queue__pet-link"
                to={`/schedule/clients?clientId=${encodeURIComponent(String(open.clientId))}`}
              >
                {open.customerName}
              </Link>
            ) : (
              open.customerName
            )}
          </p>
          {pickup ? (
            <p className="settings-muted" style={{ margin: '0 0 6px' }}>
              {open.shipLine1 || 'Office pickup'}
              {open.shipCity ? `, ${open.shipCity}` : ''} {open.shipState} {open.shipPostal}
            </p>
          ) : (
            <ShipToAddress
              key={open.id}
              order={open}
              practiceId={practiceId}
              locked={Boolean(open.labelUrl || open.trackingCode)}
              onRun={onRun}
            />
          )}
          <p className="settings-muted" style={{ margin: 0 }}>
            Doctor {open.doctorName || '—'}
            <br />
            Created by {open.createdByName || open.customerName || '—'}
            <br />
            Filled by {open.fillerName || '—'}
            {open.fillBranchName ? ` at ${open.fillBranchName}` : ''}
            {open.secondCheckerName ? ` · Checked by ${open.secondCheckerName}` : ''}
          </p>
          {(open.labelUrl || open.trackingCode) && (
            <>
              <p>
                {open.labelUrl ? (
                  <a href={open.labelUrl} target="_blank" rel="noreferrer">
                    Open label
                  </a>
                ) : null}
                {open.trackingCode ? (
                  <>
                    {' · '}
                    <TrackingLink order={open} />
                  </>
                ) : null}
              </p>
              {voidLabelButton(true)}
            </>
          )}
        </div>

        <div className="mail-queue__side-card">
          <h3>Activity</h3>
          {!thanksAlreadySent(open) ? (
            <div className="mail-queue__actions" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="btn secondary"
                disabled={sendingThanks || !open.customerEmail}
                onClick={() =>
                  void (async () => {
                    setSendingThanks(true);
                    try {
                      await onRun(() =>
                        pharmacyMailAction(practiceId, open.id, { action: 'thanks' }),
                      );
                    } finally {
                      setSendingThanks(false);
                    }
                  })()
                }
              >
                {sendingThanks ? 'Sending…' : 'Send thanks-for-your-order email'}
              </button>
            </div>
          ) : null}
          {(open.approvalNotes || []).length ? (
            <div className="mail-queue__notes">
              {(() => {
                const notes = open.approvalNotes || [];
                const hidden = activityExpanded ? 0 : Math.max(0, notes.length - 2);
                const visible = notes.slice(hidden);
                return (
                  <>
                    {hidden > 0 ? (
                      <button
                        type="button"
                        className="mail-queue__pet-link"
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          cursor: 'pointer',
                          font: 'inherit',
                          textAlign: 'left',
                        }}
                        onClick={() => setActivityExpanded(true)}
                      >
                        Show {hidden} earlier
                      </button>
                    ) : notes.length > 2 ? (
                      <button
                        type="button"
                        className="mail-queue__pet-link"
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          cursor: 'pointer',
                          font: 'inherit',
                          textAlign: 'left',
                        }}
                        onClick={() => setActivityExpanded(false)}
                      >
                        Show latest only
                      </button>
                    ) : null}
                    {visible.map((note, idx) => (
                <div key={`${note.at}-${idx}`} className="mail-queue__note">
                  <strong>
                    {note.kind === 'task_sent'
                      ? 'Task sent'
                      : note.kind === 'approved'
                        ? 'Approved'
                        : note.kind === 'rejected'
                          ? 'Rejected'
                          : note.kind === 'send_back'
                            ? 'Sent back'
                            : note.kind === 'sig'
                              ? 'Directions changed'
                              : note.kind === 'contacted'
                                ? 'Contacted'
                                : note.kind === 'thanks'
                                  ? 'Thanks email'
                                  : note.kind === 'check_override'
                                    ? 'Second-person check overridden'
                                    : note.kind === 'passed_through'
                                      ? 'Ordered on another site'
                                      : note.kind === 'doctor'
                                        ? 'Doctor changed'
                                        : 'Note'}
                  </strong>
                  {note.actorName ? ` · ${note.actorName}` : ''}
                  {note.assignedToName ? ` → ${note.assignedToName}` : ''}
                  <div className="settings-muted">{formatOrderedAt(note.at)}</div>
                  {note.notes ? (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{note.notes}</div>
                  ) : null}
                </div>
                    ))}
                  </>
                );
              })()}
            </div>
          ) : (
            <p className="settings-muted" style={{ margin: 0 }}>
              No notes yet.
            </p>
          )}
          <div className="mail-queue__actions" style={{ marginTop: 10 }}>
            <label className="settings-label" style={{ flex: '1 1 160px' }}>
              Internal note
              <input
                className="settings-input"
                value={benchNote}
                onChange={(e) => setBenchNote(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn secondary"
              disabled={!benchNote.trim()}
              onClick={() =>
                void onRun(() =>
                  addMailApprovalNote(practiceId, open.id, benchNote.trim()).then((order) => {
                    setBenchNote('');
                    return order;
                  }),
                )
              }
            >
              Add note
            </button>
          </div>
        </div>

        {stage !== 'done' && stage !== 'rejected' && !anyMailLinesRejected(open) && (
          <div className="mail-queue__side-card mail-queue__danger">
            <h3>Reject entire order</h3>
            <p className="settings-muted" style={{ marginTop: 0 }}>
              {rejectWillRefund
                ? 'Refunds the full Stripe charge, cancels linked auto-ship, and can email or text the client.'
                : 'Cancels the order and linked auto-ship. No refund applies. You can email or text the client.'}
            </p>
            <div className="mail-queue__actions">
              <button
                type="button"
                className="btn secondary"
                disabled={!open.clientId}
                title={!open.clientId ? 'No client record for Gmail email' : undefined}
                onClick={() => {
                  setRejectOutreachOnly(false);
                  setRejectModal('email');
                }}
              >
                {rejectWillRefund ? 'Reject + refund + email' : 'Reject + email'}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={!open.clientId}
                onClick={() => {
                  setRejectOutreachOnly(false);
                  setRejectModal('text');
                }}
              >
                {rejectWillRefund ? 'Reject + refund + text' : 'Reject + text'}
              </button>
            </div>
          </div>
        )}
      </div>
      {contactEmailOpen && open.clientId ? (
        <ClientEmailComposeModal
          open
          clientId={open.clientId}
          clientLabel={open.customerName}
          title={pickup ? 'Email — ready for pickup' : 'Email — order shipped'}
          headerDescription={
            rejectedRefundStillDue(open) > 0.009 && refundRejectedOnSend
              ? `Sends from your shared Gmail send-as, refunds ${money(rejectedRefundStillDue(open))} for rejected item(s), then marks remaining items as contacted.`
              : 'Sends from your shared Gmail send-as, then marks remaining items as contacted.'
          }
          initialSubject={notifySubject}
          initialBodyText={notifyMessage}
          initialBodyHtml={mailOrderContactBodyHtml(open, pickup, firstName(open.customerName))}
          regardingPatients={rejectRegardingPatients}
          regardingPatientIds={contactPatientIds}
          onRegardingPatientIdsChange={setContactPatientIds}
          patientEmrLogging="opt-in"
          includeInPatientEmr={contactIncludeEmr}
          onIncludeInPatientEmrChange={(next) => {
            setContactIncludeEmr(next);
            if (next && contactPatientIds.length === 0 && rejectRegardingPatients.length) {
              setContactPatientIds(rejectRegardingPatients.map((p) => p.id));
            }
          }}
          saveToClientCommunications={contactLogClient}
          onSaveToClientCommunicationsChange={setContactLogClient}
          onAfterSend={async ({ subject, bodyText, bodyHtml, to, from }) => {
            const ok = await onRun(() =>
              pharmacyMailAction(practiceId, open.id, {
                action: 'email_sent',
                notes: `Subject: ${subject}`,
                message: bodyText,
                refundRejected:
                  refundRejectedOnSend && rejectedRefundStillDue(open) > 0.009,
              }),
            );
            if (!ok) throw new Error('Email sent but the order could not be updated.');
            setEmailedAt(sentClock());
            if (contactLogClient || contactIncludeEmr) {
              await recordScoutChartCommunication({
                clientId: open.clientId!,
                patientIds: contactIncludeEmr ? contactPatientIds : [],
                channel: 'email',
                body: bodyHtml || bodyText,
                subject,
                destination: to,
                sentFrom: from,
                typeLabel: pickup ? 'Mail order pickup email' : 'Mail order shipped email',
                includeOnMedicalRecord: contactIncludeEmr,
              });
            }
          }}
          onClose={() => setContactEmailOpen(false)}
        />
      ) : null}
      {rejectModal === 'email' && open.clientId ? (
        <ClientEmailComposeModal
          open
          clientId={open.clientId}
          clientLabel={open.customerName}
          title={
            rejectOutreachOnly
              ? 'Email client about rejected item(s)'
              : rejectWillRefund
                ? 'Reject, refund, and email'
                : 'Reject and email client'
          }
          headerDescription={
            rejectOutreachOnly
              ? rejectedRefundStillDue(open) > 0.009 && refundRejectedOnSend
                ? `Emails the client from your shared Gmail send-as and refunds ${money(rejectedRefundStillDue(open))} for rejected item(s). Does not mark the rest of the order Contacted.`
                : 'Emails the client from your shared Gmail send-as. Does not mark the rest of the order Contacted.'
              : rejectWillRefund
                ? 'Refunds the Stripe charge, cancels linked auto-ship, then sends this email from your shared Gmail send-as.'
                : 'Cancels the order and linked auto-ship, then sends this email from your shared Gmail send-as.'
          }
          initialSubject={rejectSubject}
          initialBodyText={rejectMessage}
          initialBodyHtml={mailOrderRejectEmailBodyHtml(
            open,
            firstName(open.customerName),
            rejectOutreachOnly || mailOrderRejectedLines(open).length > 0,
          )}
          regardingPatients={rejectRegardingPatients}
          regardingPatientIds={rejectPatientIds}
          onRegardingPatientIdsChange={setRejectPatientIds}
          patientEmrLogging="opt-in"
          includeInPatientEmr={rejectIncludeEmr}
          onIncludeInPatientEmrChange={(next) => {
            setRejectIncludeEmr(next);
            if (next && rejectPatientIds.length === 0 && rejectRegardingPatients.length) {
              setRejectPatientIds(rejectRegardingPatients.map((p) => p.id));
            }
          }}
          saveToClientCommunications={rejectLogClient}
          onSaveToClientCommunicationsChange={setRejectLogClient}
          staffOnlyNote={rejectNotes}
          onStaffOnlyNoteChange={setRejectNotes}
          staffOnlyNoteRequired={!rejectOutreachOnly}
          onBeforeSend={
            rejectOutreachOnly
              ? undefined
              : async () => {
                  const ok = await onRun(() =>
                    pharmacyMailAction(practiceId, open.id, {
                      action: 'reject',
                      notes: rejectNotes.trim(),
                      message: undefined,
                    }),
                  );
                  if (!ok) throw new Error('Could not reject order.');
                }
          }
          onAfterSend={async ({ subject, bodyText, bodyHtml, to, from }) => {
            if (rejectOutreachOnly) {
              const ok = await onRun(() =>
                pharmacyMailAction(practiceId, open.id, {
                  action: 'email_sent',
                  rejectOutreach: true,
                  refundRejected:
                    refundRejectedOnSend && rejectedRefundStillDue(open) > 0.009,
                  notes: `Rejected item outreach · ${subject}`,
                  message: bodyText,
                }),
              );
              if (!ok) throw new Error('Email sent but the order could not be updated.');
            }
            if (!rejectLogClient && !rejectIncludeEmr) return;
            await recordScoutChartCommunication({
              clientId: open.clientId!,
              patientIds: rejectIncludeEmr ? rejectPatientIds : [],
              channel: 'email',
              body: bodyHtml || bodyText,
              subject,
              destination: to,
              sentFrom: from,
              typeLabel: rejectOutreachOnly
                ? 'Mail order rejected item email'
                : 'Mail order rejection email',
              includeOnMedicalRecord: rejectIncludeEmr,
            });
          }}
          onClose={() => {
            setRejectModal(null);
            setRejectOutreachOnly(false);
          }}
        />
      ) : null}
      {payEmailOpen && open.clientId ? (
        <ClientEmailComposeModal
          open
          clientId={open.clientId}
          clientLabel={open.customerName}
          title="Email invoice"
          headerDescription={
            mailOrderPayUsesFullInvoice(open, payLinked ?? linkedAmount)
              ? 'Sends from your shared Gmail send-as. This is the full unpaid visit invoice, including the mailed item. Nothing goes out until you confirm.'
              : 'Sends from your shared Gmail send-as. Review the invoice and pay link, then send — nothing goes out until you confirm.'
          }
          initialSubject={paySubject}
          initialBodyText={payMessage}
          initialBodyHtml={mailOrderPayBodyHtml(
            open,
            firstName(open.customerName),
            mailOrderPayAmount(open, payLinked ?? linkedAmount),
            payLink,
            payLinked ?? linkedAmount,
          )}
          regardingPatients={rejectRegardingPatients}
          regardingPatientIds={payPatientIds}
          onRegardingPatientIdsChange={setPayPatientIds}
          patientEmrLogging="opt-in"
          includeInPatientEmr={payIncludeEmr}
          onIncludeInPatientEmrChange={(next) => {
            setPayIncludeEmr(next);
            if (next && payPatientIds.length === 0 && rejectRegardingPatients.length) {
              setPayPatientIds(rejectRegardingPatients.map((p) => p.id));
            }
          }}
          saveToClientCommunications={payLogClient}
          onSaveToClientCommunicationsChange={setPayLogClient}
          onAfterSend={async ({ subject, bodyText, bodyHtml, to, from }) => {
            const ok = await onRun(() =>
              addMailApprovalNote(
                practiceId,
                open.id,
                `Payment invoice email sent · ${subject}`,
              ),
            );
            if (!ok) throw new Error('Email sent but the order could not be updated.');
            setPaySent('Invoice email sent.');
            if (payLogClient || payIncludeEmr) {
              await recordScoutChartCommunication({
                clientId: open.clientId!,
                patientIds: payIncludeEmr ? payPatientIds : [],
                channel: 'email',
                body: bodyHtml || bodyText,
                subject,
                destination: to,
                sentFrom: from,
                typeLabel: 'Mail order payment email',
                includeOnMedicalRecord: payIncludeEmr,
              });
            }
          }}
          onClose={() => setPayEmailOpen(false)}
        />
      ) : null}
      {payTextOpen ? (
        <MailOrderPayTextModal
          practiceId={practiceId}
          order={open}
          rxLinePhone={rxLinePhone}
          regardingPatients={rejectRegardingPatients}
          message={payMessage}
          onMessageChange={setPayMessage}
          onClose={() => setPayTextOpen(false)}
          onRun={async (fn) => {
            const ok = await onRun(fn);
            if (ok) setPaySent('Pay-link text sent.');
            return ok;
          }}
        />
      ) : null}
      {rejectModal === 'text' ? (
        <MailOrderRejectModal
          practiceId={practiceId}
          order={open}
          orderPaid={rejectOutreachOnly ? false : rejectWillRefund}
          outreachOnly={rejectOutreachOnly}
          refundRejected={
            rejectOutreachOnly &&
            refundRejectedOnSend &&
            rejectedRefundStillDue(open) > 0.009
          }
          rxLinePhone={rxLinePhone}
          regardingPatients={rejectRegardingPatients}
          notes={rejectNotes}
          onNotesChange={setRejectNotes}
          message={rejectMessage}
          onMessageChange={setRejectMessage}
          onClose={() => {
            setRejectModal(null);
            setRejectOutreachOnly(false);
          }}
          onRun={onRun}
        />
      ) : null}
      {inventoryDetail ? (
        <InventoryItemDetailModal
          practiceId={practiceId}
          inventoryItemId={inventoryDetail.inventoryItemId}
          title={inventoryDetail.name}
          onClose={() => {
            const lineId = inventoryDetail.lineId;
            setInventoryDetail(null);
            setLotRefreshByLine((prev) => ({
              ...prev,
              [lineId]: (prev[lineId] ?? 0) + 1,
            }));
            setFillLots((prev) => ({
              ...prev,
              [lineId]: { lotId: null, lotNumber: '' },
            }));
          }}
        />
      ) : null}
      {editAutoshipLine ? (
        <EditAutoshipModal
          open
          practiceId={practiceId}
          line={editAutoshipLine}
          patientName={editAutoshipLine.patientName || open.patientName}
          customerName={open.customerName}
          customerEmail={open.customerEmail}
          preferredAssigneeId={open.doctorEmployeeId}
          staff={staff}
          onClose={() => setEditAutoshipLine(null)}
          onSaved={(message) => {
            setEditAutoshipLine(null);
            setAutoshipNote(message || 'Auto-ship updated.');
            void onRun(async () => {
              const rows = await listMailOrders(practiceId);
              const next = rows.find((row) => row.id === open.id);
              if (!next) throw new Error('Order not found after auto-ship update.');
              return next;
            });
          }}
        />
      ) : null}
    </div>
  );
}

function ShipToAddress({
  order,
  practiceId,
  locked,
  onRun,
}: {
  order: MailOrder;
  practiceId: number;
  locked: boolean;
  onRun: (fn: () => Promise<MailOrder>) => Promise<boolean>;
}) {
  const hasAddress = Boolean(order.shipLine1?.trim());
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<MailShipChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async () => {
    if (!choice) return;
    setSaving(true);
    setSaveError(null);
    const ship = shipBodyFromFields(choice.fields);
    const ok = await onRun(() =>
      patchMailOrder(practiceId, order.id, {
        shipName: order.shipName || order.customerName,
        shipLine1: ship.line1,
        shipLine2: ship.line2 ?? null,
        shipCity: ship.city,
        shipState: ship.state,
        shipPostal: ship.postal,
      }),
    );
    if (ok && choice.saveAsMailing && order.clientId) {
      await saveMailingAddressOnFile(order.clientId, choice.fields).catch(() =>
        setSaveError('Address saved on the order, but not on the client as their mailing address.'),
      );
    }
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <div className="mail-queue__ship-edit">
        <MailShipAddressPicker
          clientId={order.clientId}
          onChange={setChoice}
          current={
            hasAddress
              ? {
                  line1: order.shipLine1 || '',
                  line2: order.shipLine2 || undefined,
                  city: order.shipCity || '',
                  state: order.shipState || '',
                  zip: order.shipPostal || '',
                  country: 'US',
                }
              : null
          }
        />
        <div className="mail-queue__actions" style={{ marginTop: 6 }}>
          <button
            type="button"
            className="mail-queue__btn is-primary"
            disabled={!choice || saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save address'}
          </button>
          <button
            type="button"
            className="mail-queue__btn"
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {hasAddress ? (
        <p className="settings-muted" style={{ margin: '0 0 6px' }}>
          {order.shipLine1}
          {order.shipLine2 ? `, ${order.shipLine2}` : ''}
          {order.shipCity ? `, ${order.shipCity}` : ''} {order.shipState} {order.shipPostal}
        </p>
      ) : (
        <p className="mail-queue__ship-missing" role="status">
          No shipping address yet. Add one before buying a label.
        </p>
      )}
      {saveError ? <p className="settings-error-message">{saveError}</p> : null}
      {!locked ? (
        <div className="mail-queue__actions" style={{ margin: '0 0 8px' }}>
          <button
            type="button"
            className={`mail-queue__btn${hasAddress ? '' : ' is-primary'}`}
            onClick={() => {
              setChoice(null);
              setEditing(true);
            }}
          >
            {hasAddress ? 'Change address' : 'Add address'}
          </button>
        </div>
      ) : null}
    </>
  );
}

function clientEmail(row: ClientSearchRow): string | undefined {
  const value = row.email ?? row.emailAddress;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function StaffCreate({
  practiceId,
  createdByEmployeeId,
  onClose,
  onCreate,
}: {
  practiceId: number;
  createdByEmployeeId: number | null;
  onClose: () => void;
  onCreate: (body: Parameters<typeof createStaffMailOrder>[1]) => Promise<void>;
}) {
  const [clientQ, setClientQ] = useState('');
  const [clientHits, setClientHits] = useState<ClientSearchRow[]>([]);
  const [client, setClient] = useState<ClientSearchRow | null>(null);
  const [includeInactiveClients, setIncludeInactiveClients] = useState(false);
  const [patientQ, setPatientQ] = useState('');
  const [patientHits, setPatientHits] = useState<PatientSearchRow[]>([]);
  const [patient, setPatient] = useState<PatientSearchRow | null>(null);
  const [includeInactivePatients, setIncludeInactivePatients] = useState(false);
  const [packageInfo, setPackageInfo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = clientQ.trim();
    if (client || q.length < 2) {
      setClientHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchClientsStaff(q, { includeInactive: includeInactiveClients })
        .then(setClientHits)
        .catch(() => setClientHits([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [clientQ, client, includeInactiveClients]);

  useEffect(() => {
    const q = patientQ.trim();
    if (patient || (q.length < 2 && !client)) {
      setPatientHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      const req = client
        ? searchPatients({
            name: q || undefined,
            clientId: client.id,
            practiceId,
            activeOnly: !includeInactivePatients,
          }).then((res) =>
            extractPatientListFromSearchResponse(res.data).map((r) => r as PatientSearchRow),
          )
        : searchPatientsStaff(q, { practiceId, activeOnly: !includeInactivePatients });
      void req.then(setPatientHits).catch(() => setPatientHits([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [patientQ, patient, client, practiceId, includeInactivePatients]);

  const pickPatient = (row: PatientSearchRow) => {
    setPatient(row);
    setPatientQ(patientDisplayName(row));
    setPatientHits([]);
    const cid = clientIdFromPatientRow(row);
    const cname = clientNameFromPatientRow(row);
    if (cid != null && !client) {
      setClient({ id: cid, firstName: cname || '', lastName: '' });
      setClientQ(cname || String(cid));
    }
  };

  return (
    <div
      className="settings-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-labelledby="new-mail-order-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <h3 id="new-mail-order-title">New mail order</h3>
          <button type="button" className="settings-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="settings-modal-body">
          <p className="settings-muted" style={{ marginTop: 0 }}>
            For ashes and other packages that are not a pharmacy fill. This skips
            approval, fill, and second check so you can print a label.
          </p>
          <div className="mail-queue__field-row">
            <label className="settings-label" style={{ flex: 1 }}>
              Client
              <input
                className="settings-input"
                value={clientQ}
                onChange={(e) => {
                  setClient(null);
                  setClientQ(e.target.value);
                }}
                placeholder="Search client"
              />
            </label>
            <label className="mail-queue__inactive">
              <input
                type="checkbox"
                checked={includeInactiveClients}
                onChange={(e) => setIncludeInactiveClients(e.target.checked)}
              />
              Include inactive
            </label>
          </div>
          {clientHits.length ? (
            <ul className="mail-queue__hits">
              {clientHits.slice(0, 8).map((row) => (
                <li key={String(row.id)}>
                  <button
                    type="button"
                    className="brief-text-btn"
                    onClick={() => {
                      setClient(row);
                      setClientQ(clientDisplayName(row));
                      setClientHits([]);
                    }}
                  >
                    {clientDisplayName(row)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mail-queue__field-row">
            <label className="settings-label" style={{ flex: 1 }}>
              Patient
              <input
                className="settings-input"
                value={patientQ}
                onChange={(e) => {
                  setPatient(null);
                  setPatientQ(e.target.value);
                }}
                placeholder="Search patient"
              />
            </label>
            <label className="mail-queue__inactive">
              <input
                type="checkbox"
                checked={includeInactivePatients}
                onChange={(e) => setIncludeInactivePatients(e.target.checked)}
              />
              Include inactive
            </label>
          </div>
          {patientHits.length ? (
            <ul className="mail-queue__hits">
              {patientHits.slice(0, 8).map((row) => (
                <li key={String(row.id)}>
                  <button type="button" className="brief-text-btn" onClick={() => pickPatient(row)}>
                    {patientDisplayName(row)}
                    {clientNameFromPatientRow(row) ? ` — ${clientNameFromPatientRow(row)}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="settings-label">
            Package info
            <textarea
              className="settings-input"
              rows={3}
              value={packageInfo}
              onChange={(e) => setPackageInfo(e.target.value)}
              placeholder="e.g. Ashes — small urn for Maple"
            />
          </label>
          <div className="settings-modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !client || !packageInfo.trim()}
              onClick={() => {
                const clientId = Number(client?.id);
                const patientId = patient ? Number(patient.id) : null;
                const zip =
                  (typeof client?.zip === 'string' && client.zip) ||
                  (typeof client?.zipcode === 'string' && client.zipcode) ||
                  '';
                setBusy(true);
                void onCreate({
                  origin: 'staff_mail',
                  packageShipment: true,
                  customerName: client ? clientDisplayName(client) : 'Client',
                  customerEmail: client ? clientEmail(client) : undefined,
                  clientId: Number.isFinite(clientId) ? clientId : null,
                  patientId: Number.isFinite(patientId) ? patientId : null,
                  patientName: patient ? patientDisplayName(patient) : null,
                  paymentStatus: 'paid',
                  shippingPaymentStatus: 'paid',
                  shippingChargeName: 'package mail',
                  shipping: 0,
                  notes: packageInfo.trim(),
                  createdByEmployeeId,
                  ship: client
                    ? {
                        name: clientDisplayName(client),
                        line1: typeof client.address1 === 'string' ? client.address1 : undefined,
                        city: typeof client.city === 'string' ? client.city : undefined,
                        state: typeof client.state === 'string' ? client.state : undefined,
                        postal: zip || undefined,
                      }
                    : undefined,
                  lines: [{ name: packageInfo.trim(), quantity: 1 }],
                }).finally(() => setBusy(false));
              }}
            >
              {busy ? 'Adding…' : 'Add to queue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
