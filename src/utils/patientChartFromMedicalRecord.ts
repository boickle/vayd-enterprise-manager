/** Build unified chart rows from GET /patients/:id/medical-record payload. */

import type { RoomLoader } from '../api/roomLoader';
import type { ScoutChartNote } from '../api/scoutChart';
import type { TreatmentItem, TreatmentWithItems } from '../api/treatments';
import type { PatientProblem, PostedVisitCharge } from '../api/visitWorkflow';
import { buildSubjectiveTextFromRoomLoaderResponse } from './roomLoaderSubjectiveText';
import { communicationBodyForDisplay } from './clientCommunicationDisplay';
import { looksLikeHtmlFragment } from './sanitizeCommunicationHtml';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function employeeName(e: unknown): string {
  const o = asObj(e);
  if (!o) return '—';
  const fn = pickStr(o.firstName);
  const ln = pickStr(o.lastName);
  const joined = [fn, ln].filter(Boolean).join(' ').trim();
  const name = joined || pickStr(o.name);
  if (!name) return '—';
  const designation = pickStr(o.designation);
  return designation ? `${name}, ${designation}` : name;
}

/** Same categories eVet shows on the patient medical-record timeline. */
const EMR_SOURCES = new Set<ChartRowSource>([
  'history',
  'chartNote',
  'exam',
  'document',
  'communication',
  'treatment',
  'visitCharge',
  'roomLoader',
  'scoutNote',
]);

function isStockInventoryName(name: string): boolean {
  return /^felv\s+inventory$/i.test(name);
}

function documentChartLabel(o: Record<string, unknown>): { typeLabel: string; description: string } {
  const name = pickStr(o.name) ?? 'Document';
  const desc = pickStr(o.description);
  const typeId = pickStr(o.documentTypePimsId);
  const blob = `${name} ${desc ?? ''}`.toLowerCase();
  let typeLabel = 'Document';
  if (typeId === '564' || /pre-?appt|check[\s-]?in/.test(blob)) {
    typeLabel = desc && /check|form/i.test(desc) ? desc : 'Pre-appt Check-in form';
  } else if (typeId === '285' || /previous medical|humane society|veterinary hospital/.test(blob)) {
    typeLabel = 'Previous Medical Records';
  } else if (desc && !/certificate|generated/i.test(desc)) {
    typeLabel = desc;
  }
  return { typeLabel, description: `📥 ${name}` };
}

function parseSortTime(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export type ChartRow = {
  id: string;
  source: ChartRowSource;
  typeLabel: string;
  description: string;
  provider: string;
  serviceDateIso: string | null;
  sortTime: number;
  detailText: string;
  /** Sanitized HTML body for communication rows when the source payload is HTML email. */
  detailHtml?: string;
  hasResult?: boolean;
  /** Membership-covered visit charge — show a heart next to the description. */
  isCovered?: boolean;
};

export type ChartRowSource =
  | 'complaint'
  | 'problem'
  | 'diagnosis'
  | 'medication'
  | 'lab'
  | 'exam'
  | 'history'
  | 'imaging'
  | 'dental'
  | 'monitoring'
  | 'communication'
  | 'reminder'
  | 'vaccination'
  | 'visitCharge'
  | 'chartNote'
  | 'document'
  | 'treatment'
  | 'roomLoader'
  | 'scoutNote';

export type MedicalRecordBundle = {
  labOrders?: unknown[];
  complaints?: unknown[];
  diagnoses?: unknown[];
  medications?: unknown[];
  imagingStudies?: unknown[];
  dentalCharts?: unknown[];
  anestheticMonitorForms?: unknown[];
  exams?: unknown[];
  histories?: unknown[];
  communicationLogs?: unknown[];
  reminders?: unknown[];
  wellnessPlans?: unknown[];
  vaccinationLogs?: unknown[];
  /** Exam vital weights, ordered by service date on the server. */
  weightHistory?: unknown[];
  /** EVET free-text chart notes (`name` + `noteText`). */
  chartNotes?: unknown[];
  chartDocuments?: unknown[];
};

function communicationMessageObject(o: Record<string, unknown>): Record<string, unknown> | null {
  return asObj(o.communicationMessageLog) ?? asObj(o.messageLog);
}

function communicationRawBody(o: Record<string, unknown>): string | null {
  const msg = communicationMessageObject(o);
  return pickStr(msg?.body) ?? pickStr(msg?.message) ?? pickStr(o.description);
}

function communicationTypeLabel(o: Record<string, unknown>): string {
  const msg = communicationMessageObject(o);
  return (
    pickStr(msg?.communicationTypeLabel) ??
    pickStr(o.communicationTypeLabel) ??
    pickStr(o.messageType) ??
    'Client communication'
  );
}

function communicationLogSummary(o: Record<string, unknown>): string {
  const msg = communicationMessageObject(o);
  const typeLabel = communicationTypeLabel(o);
  const rawBody = communicationRawBody(o);
  if (rawBody) {
    const parsed = communicationBodyForDisplay(rawBody);
    if (parsed.subject && !looksLikeHtmlFragment(parsed.subject)) return parsed.subject;
    const t = parsed.text.replace(/\s+/g, ' ').trim();
    if (t) return t.length > 140 ? `${t.slice(0, 140)}…` : t;
  }
  const subject = pickStr(o.subject) ?? pickStr(msg?.subject);
  if (subject && !looksLikeHtmlFragment(subject)) return subject;
  return pickStr(o.summary) ?? pickStr(o.displayName) ?? typeLabel;
}

function vitalSignLines(vital: Record<string, unknown> | null): string[] {
  if (!vital) return [];
  const bits: string[] = [];
  const weight = vital.weight != null ? String(vital.weight).trim() : '';
  if (weight) {
    const unit = pickStr(vital.weightUnit) ?? pickStr(vital.weightUnitValue);
    bits.push(`Weight: ${weight}${unit ? ` ${unit}` : ''}`);
  }
  if (vital.temperature != null && String(vital.temperature).trim()) {
    bits.push(`Temp: ${String(vital.temperature).trim()}`);
  }
  if (vital.heartRate != null && String(vital.heartRate).trim()) {
    bits.push(`HR: ${String(vital.heartRate).trim()}`);
  }
  if (vital.respiratoryRate != null && String(vital.respiratoryRate).trim()) {
    bits.push(`RR: ${String(vital.respiratoryRate).trim()}`);
  }
  return bits;
}

function formResponseLines(responses: unknown[]): string[] {
  return responses
    .map((r) => {
      const ro = asObj(r);
      if (!ro) return null;
      const cn = pickStr(ro.componentName);
      const sel = pickStr(ro.selectedOptions);
      const cm = pickStr(ro.comment);
      if (!cn && !sel && !cm) return null;
      return [cn, sel, cm].filter(Boolean).join(': ');
    })
    .filter(Boolean) as string[];
}

function vaccinationLogSummary(o: Record<string, unknown>): string {
  const inv = asObj(o.inventoryItem);
  return (
    pickStr(o.vaccineName) ??
    pickStr(o.name) ??
    pickStr(o.description) ??
    (inv ? pickStr(inv.name) : null) ??
    'Vaccination'
  );
}

const PROBLEM_TYPE_LABEL: Record<string, string> = {
  acute: 'Acute problem',
  chronic: 'Chronic problem',
};

function visitChargeTypeLabel(c: PostedVisitCharge): string {
  if (c.isVaccine || c.isMed) return 'Inventory Item';
  if (c.kind === 'diagnostic') return 'Lab';
  if (c.kind === 'exam') return 'Exam Form';
  return 'Procedure';
}

function firstPrescription(item: Record<string, unknown>): Record<string, unknown> | null {
  const list = item.prescriptions;
  if (!Array.isArray(list)) return null;
  for (const raw of list) {
    const o = asObj(raw);
    if (!o || o.isDeleted === true) continue;
    return o;
  }
  return null;
}

function productMatchKey(name: string | null | undefined): string {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+inventory$/i, '')
    .replace(/,?\s*individual chew\b/gi, '')
    .replace(/\b\d+\s*ct\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type MedicationHint = {
  treatmentItemId: number | null;
  productName: string | null;
  serviceDate: string | null;
  instructions: string | null;
  strength: string | null;
  refillsAllowed: number | null;
  rxNumber: string | null;
  quantityLabel: string | null;
};

function medicationHintsFromRows(rows: unknown[] | null | undefined): MedicationHint[] {
  if (!Array.isArray(rows)) return [];
  const out: MedicationHint[] = [];
  for (const raw of rows) {
    const o = asObj(raw);
    if (!o) continue;
    const id = Number(o.treatmentItemId);
    out.push({
      treatmentItemId: Number.isFinite(id) && id > 0 ? id : null,
      productName: pickStr(o.productName) ?? pickStr(o.name),
      serviceDate: pickStr(o.serviceDate) ?? pickStr(o.startDate),
      instructions:
        pickStr(o.instructions) ?? pickStr(o.directions) ?? pickStr(o.sig),
      strength: pickStr(o.strength),
      refillsAllowed:
        o.refillsAllowed != null && Number.isFinite(Number(o.refillsAllowed))
          ? Number(o.refillsAllowed)
          : o.refill != null && Number.isFinite(Number(o.refill))
            ? Number(o.refill)
            : null,
      rxNumber: pickStr(o.rxNumber),
      quantityLabel: pickStr(o.quantityLabel),
    });
  }
  return out;
}

function namesAlign(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

function sameServiceDay(hintDay: string | null | undefined, day: string): boolean {
  const hd = (hintDay || '').slice(0, 10);
  return !day || !hd || hd === day;
}

function hintForTreatmentItem(
  hints: MedicationHint[],
  itemId: number,
  name: string,
  day: string,
): MedicationHint | null {
  const byId = hints.find((h) => h.treatmentItemId === itemId);
  if (byId?.instructions) return byId;
  const nameKey = productMatchKey(name);
  if (!nameKey) return byId ?? null;
  const aligned = hints.filter((h) => namesAlign(productMatchKey(h.productName), nameKey));
  const sameDay = aligned.filter((h) => sameServiceDay(h.serviceDate, day));
  return (
    sameDay.find((h) => h.instructions) ??
    aligned.find((h) => h.instructions) ??
    byId ??
    sameDay[0] ??
    aligned[0] ??
    null
  );
}

function isUnitQtyLabel(label: string | null | undefined): boolean {
  if (!label) return true;
  return /^(qty\s+)?1(\s*(ea|each))?$/i.test(label.trim());
}

function treatmentItemDetail(item: TreatmentItem, hint?: MedicationHint | null): string {
  const bits: string[] = [];
  const qty = Number(item.quantity);
  const ownLabel = hint?.treatmentItemId === item.id ? hint.quantityLabel : null;
  if (ownLabel && !isUnitQtyLabel(ownLabel)) bits.push(ownLabel);
  else if (Number.isFinite(qty) && qty !== 1) bits.push(`Qty ${qty}`);

  const rec = item as Record<string, unknown>;
  const rx = firstPrescription(rec);
  const inv = asObj(item.inventoryItem);

  const sig =
    hint?.instructions ??
    (rx
      ? pickStr(rx.instructions) ?? pickStr(rx.directions) ?? pickStr(rx.sig)
      : null) ??
    (inv ? pickStr(inv.dispenseNote) : null) ??
    pickStr(rec.instructions);
  if (sig) bits.push(sig);
  else if (
    inv &&
    (inv.isMedication === true || inv.isDispensable === true) &&
    bits.length === 0
  ) {
    bits.push('No directions on file');
  }

  const strength = hint?.strength ?? (rx ? pickStr(rx.strength) : null);
  if (strength) bits.push(`Strength ${strength}`);

  const refill =
    hint?.refillsAllowed ??
    (rx && rx.refill != null && Number.isFinite(Number(rx.refill)) ? Number(rx.refill) : null);
  if (refill != null) bits.push(`${refill} refill${refill === 1 ? '' : 's'}`);

  const rxNumber = hint?.rxNumber ?? (rx ? pickStr(rx.rxNumber) : null);
  if (rxNumber) bits.push(`Rx #${rxNumber}`);

  if (inv) {
    const lot = pickStr(inv.lotNumber);
    if (lot) bits.push(`Lot ${lot}`);
    const clientNote = pickStr(inv.clientNote);
    if (clientNote) bits.push(clientNote);
  }

  return bits.join('\n');
}

function visitChargeDetail(c: PostedVisitCharge, hint?: MedicationHint | null): string {
  const bits: string[] = [];
  if (hint?.quantityLabel && !isUnitQtyLabel(hint.quantityLabel) && c.qty !== 1) {
    bits.push(hint.quantityLabel);
  } else if (c.qty > 1) bits.push(`Qty ${c.qty}`);
  if (c.isCovered) bits.push('Membership covered');

  if (c.isMed && c.prescriptionPending && !hint?.instructions) {
    bits.push('Prescription details pending');
  } else {
    const acuity = c.prescription?.acuity;
    if (acuity) bits.push(acuity === 'chronic' ? 'Chronic' : 'Acute');
    const strength = hint?.strength ?? c.prescription?.strength ?? null;
    if (strength) bits.push(`Strength ${strength}`);
    const sig = hint?.instructions ?? c.prescription?.instructions ?? null;
    if (sig) bits.push(sig);
    const refill = hint?.refillsAllowed ?? c.prescription?.refill ?? null;
    if (refill != null) bits.push(`${refill} refill${Number(refill) === 1 ? '' : 's'}`);
    if (hint?.rxNumber) bits.push(`Rx #${hint.rxNumber}`);
  }

  if (c.isVaccine) {
    if (c.vaccinationPending) {
      bits.push('Dose details pending');
    } else if (c.vaccination) {
      if (c.vaccination.lotNumber) bits.push(`Lot ${c.vaccination.lotNumber}`);
      if (c.vaccination.nextVaccinationDate) {
        bits.push(`Next due ${new Date(c.vaccination.nextVaccinationDate).toLocaleDateString()}`);
      }
    }
  }

  return bits.join('\n');
}

function visitChargeChartRow(c: PostedVisitCharge, hint?: MedicationHint | null): ChartRow {
  return {
    id: `visitCharge:${c.id}`,
    source: 'visitCharge',
    typeLabel: visitChargeTypeLabel(c),
    description: c.name,
    provider: '—',
    serviceDateIso: c.postedToRecordAt,
    sortTime: parseSortTime(c.postedToRecordAt),
    detailText: visitChargeDetail(c, hint),
    isCovered: c.isCovered,
    hasResult: !(c.prescriptionPending || c.vaccinationPending),
  };
}

/**
 * @param problems Master Problem List entries for this patient. Only those already published to
 *   the record (`postedToRecordAt`) get a row, so a chart still being drafted leaves no trace.
 * @param visitCharges Finalized Scout visit charges (Trip Fee, Solensia, Revolution, …).
 * @param treatments eVet treatment plans — inventory, procedure, and lab lines (rebates, trip fee, …).
 * @param emrOnly When true, only eVet medical-record types (no Scout extras like vaccination logs).
 */
export function buildChartRowsFromMedicalRecord(
  mr: MedicalRecordBundle | null | undefined,
  problems?: PatientProblem[] | null,
  visitCharges?: PostedVisitCharge[] | null,
  treatments?: TreatmentWithItems[] | null,
  emrOnly = false,
  medicationHistory?: unknown[] | null,
): ChartRow[] {
  if (!mr && !problems?.length && !visitCharges?.length && !treatments?.length) return [];
  const out: ChartRow[] = [];
  const keep = (row: ChartRow) => {
    if (!emrOnly) return true;
    if (!EMR_SOURCES.has(row.source)) return false;
    if (row.source === 'treatment' && isStockInventoryName(row.description)) return false;
    return true;
  };

  for (const p of problems ?? []) {
    if (!p.postedToRecordAt) continue;
    const resolvedAt = p.status === 'resolved' ? p.resolvedAt : null;
    out.push({
      id: `problem:${p.id}`,
      source: 'problem',
      typeLabel: (p.acuity && PROBLEM_TYPE_LABEL[p.acuity]) ?? 'Problem',
      description: p.label,
      provider: '—',
      serviceDateIso: p.postedToRecordAt,
      sortTime: parseSortTime(p.postedToRecordAt),
      detailText: [
        resolvedAt && `Resolved ${new Date(resolvedAt).toLocaleDateString()}`,
        p.status !== 'resolved' && `Status: ${p.status}`,
        p.note,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  const medHints = medicationHintsFromRows(medicationHistory);
  for (const c of visitCharges ?? []) {
    const day = (c.postedToRecordAt || '').slice(0, 10);
    const hint = hintForTreatmentItem(medHints, 0, c.name, day);
    out.push(visitChargeChartRow(c, hint));
  }

  const visitChargeKeys = new Set(
    (visitCharges ?? []).map((c) => {
      const day = (c.postedToRecordAt || '').slice(0, 10);
      return `${day}|${(c.name || '').trim().toLowerCase()}`;
    })
  );
  for (const plan of treatments ?? []) {
    if (plan.isDeleted || plan.isEstimate) continue;
    for (const item of plan.treatmentItems ?? []) {
      if (item.isDeleted || item.isDeclined) continue;
      const inv = item.inventoryItem?.name?.trim();
      const proc = item.procedure?.name?.trim();
      const lab = item.lab?.name?.trim();
      const name = inv || proc || lab;
      if (!name) continue;
      const serviceDateIso = item.serviceDate || plan.created || null;
      const day = (serviceDateIso || '').slice(0, 10);
      if (visitChargeKeys.has(`${day}|${name.toLowerCase()}`)) continue;
      const typeLabel = inv ? 'Inventory Item' : proc ? 'Procedure' : 'Lab';
      const hint = hintForTreatmentItem(medHints, item.id, name, day);
      const rec = item as Record<string, unknown>;
      out.push({
        id: `treatment:${item.id}`,
        source: 'treatment',
        typeLabel,
        description: name,
        provider: employeeName(
          rec.productionEmployee ?? rec.employee ?? rec.provider,
        ),
        serviceDateIso,
        sortTime: parseSortTime(serviceDateIso),
        detailText: treatmentItemDetail(item, hint),
      });
    }
  }

  const finish = (rows: ChartRow[]) =>
    rows.filter(keep).sort((a, b) => b.sortTime - a.sortTime);

  if (!mr) return finish(out);

  for (const log of mr.communicationLogs ?? []) {
    const o = asObj(log);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `cc-${out.length}`;
    const serviceDateIso =
      pickStr(o.serviceDate) ?? pickStr(o.sentAt) ?? pickStr(o.createdAt) ?? pickStr(o.deliveredAt);
    const summary = communicationLogSummary(o);
    const status = (pickStr(o.status) ?? pickStr(o.deliveryStatus) ?? '').toLowerCase();
    const detailBits = [
      pickStr(o.channel) && `Channel: ${pickStr(o.channel)}`,
      pickStr(o.recipient) && `Recipient: ${pickStr(o.recipient)}`,
      pickStr(o.status) && `Status: ${pickStr(o.status)}`,
    ].filter(Boolean);
    const rawBody = communicationRawBody(o);
    let detailText = detailBits.join('\n');
    let detailHtml: string | undefined;
    if (rawBody) {
      const parsed = communicationBodyForDisplay(rawBody);
      if (parsed.subject) {
        detailText = [`Subject: ${parsed.subject}`, detailText].filter(Boolean).join('\n');
      }
      if (parsed.html) {
        detailHtml = parsed.html;
      } else if (parsed.text) {
        detailText = [detailText, parsed.text].filter(Boolean).join('\n\n');
      }
    }
    out.push({
      id: `communication:${id}`,
      source: 'communication',
      typeLabel: 'Client Communication Entry',
      description: (() => {
        const kind = communicationTypeLabel(o);
        if (kind && kind !== 'Client communication' && kind !== summary) {
          return `${kind} - ${summary}`;
        }
        return summary;
      })(),
      provider: employeeName(o.employee ?? o.senderEmployee),
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText,
      detailHtml,
      hasResult: status.includes('deliver') || status.includes('sent') || status === 'complete',
    });
  }

  for (const rem of mr.reminders ?? []) {
    const o = asObj(rem);
    if (!o) continue;
    const hidden = o.isHidden ?? o.is_hidden ?? o.hidden;
    if (hidden === true || hidden === 1) continue;
    if (typeof hidden === 'string') {
      const t = hidden.trim().toLowerCase();
      if (t === 'true' || t === '1' || t === 'yes') continue;
    }
    const id = o.id != null ? String(o.id) : `rm-${out.length}`;
    const serviceDateIso =
      pickStr(o.dueDate) ??
      pickStr(o.reminderDate) ??
      pickStr(o.serviceDate) ??
      pickStr(o.createdAt);
    const title = pickStr(o.title) ?? pickStr(o.name) ?? pickStr(o.description) ?? 'Reminder';
    const desc =
      pickStr(o.description) && pickStr(o.description) !== title ? pickStr(o.description) : null;
    out.push({
      id: `reminder:${id}`,
      source: 'reminder',
      typeLabel: 'Reminder',
      description: desc ? `${title} — ${desc}` : title,
      provider: employeeName(o.employee),
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: [
        pickStr(o.outreachNotes) && `Outreach: ${pickStr(o.outreachNotes)}`,
        pickStr(o.pimsId) && `PIMS: ${pickStr(o.pimsId)}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  for (const v of mr.vaccinationLogs ?? []) {
    const o = asObj(v);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `vx-${out.length}`;
    const serviceDateIso =
      pickStr(o.dateVaccinated) ?? pickStr(o.serviceDate) ?? pickStr(o.administeredDate);
    const label = vaccinationLogSummary(o);
    out.push({
      id: `vaccination:${id}`,
      source: 'vaccination',
      typeLabel: 'Vaccination',
      description: label,
      provider: employeeName(o.employee),
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: [pickStr(o.lotNumber) && `Lot: ${pickStr(o.lotNumber)}`, pickStr(o.notes)]
        .filter(Boolean)
        .join('\n'),
    });
  }

  for (const c of mr.complaints ?? []) {
    const o = asObj(c);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `c-${out.length}`;
    const serviceDateIso = pickStr(o.serviceDate) ?? pickStr(o.createdAt) ?? pickStr(o.recordDate);
    const name = pickStr(o.complaintName) ?? 'Complaint';
    const comments = pickStr(o.customComments);
    out.push({
      id: `complaint:${id}`,
      source: 'complaint',
      typeLabel: 'Chief complaint',
      description: comments ? `${name} — ${comments}` : name,
      provider: '—',
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: comments ?? '',
    });
  }

  for (const d of mr.diagnoses ?? []) {
    const o = asObj(d);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `d-${out.length}`;
    const serviceDateIso = pickStr(o.serviceDate) ?? pickStr(o.createdAt);
    const name = pickStr(o.name) ?? 'Diagnosis';
    const comments = pickStr(o.comments);
    out.push({
      id: `diagnosis:${id}`,
      source: 'diagnosis',
      typeLabel: 'Diagnosis',
      description: comments ? `${name} — ${comments}` : name,
      provider: employeeName(o.employee),
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: [
        comments && `Comments: ${comments}`,
        pickStr(o.pimsId) && `PIMS: ${pickStr(o.pimsId)}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  for (const m of mr.medications ?? []) {
    const o = asObj(m);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `m-${out.length}`;
    const serviceDateIso = pickStr(o.dateOfService) ?? pickStr(o.serviceDate);
    const name = pickStr(o.name) ?? 'Medication';
    out.push({
      id: `medication:${id}`,
      source: 'medication',
      typeLabel: 'Patient medication',
      description: name,
      provider: '—',
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: pickStr(o.pimsId) ? `PIMS: ${pickStr(o.pimsId)}` : '',
    });
  }

  for (const pair of mr.labOrders ?? []) {
    const p = asObj(pair);
    const order = asObj(p?.order);
    if (!order) continue;
    const oid = order.id != null ? String(order.id) : `lo-${out.length}`;
    const result = asObj(p?.result);
    const submitted = pickStr(order.submittedDate) ?? pickStr(order.orderDate);
    const typeName = pickStr(order.labOrderType) ?? 'Lab';
    const ext = pickStr(order.externalId);
    const notes = pickStr(order.notes);
    const rpt = result ? pickStr(result.reportDate) : null;
    const rComments = result ? pickStr(result.comments) : null;
    const descParts = [notes, ext ? `Ref: ${ext}` : null, rComments].filter(Boolean);
    out.push({
      id: `lab:${oid}`,
      source: 'lab',
      typeLabel: result ? `${typeName} (result)` : typeName,
      description: descParts.join(' · ') || typeName,
      provider: '—',
      serviceDateIso: rpt ?? submitted,
      sortTime: parseSortTime(rpt ?? submitted),
      detailText: result
        ? [
            rComments && `Result: ${rComments}`,
            pickStr(result.externalData) && 'Raw data available',
          ]
            .filter(Boolean)
            .join('\n')
        : (notes ?? ''),
      hasResult: Boolean(result),
    });
  }

  for (const ex of mr.exams ?? []) {
    const o = asObj(ex);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `ex-${out.length}`;
    const serviceDateIso = pickStr(o.serviceDate);
    const formName = pickStr(o.formName) ?? 'Exam';
    const comments = pickStr(o.comments);
    const respLines = formResponseLines(Array.isArray(o.responses) ? o.responses : []);
    const vitalLines = vitalSignLines(asObj(o.vitalSign));
    out.push({
      id: `exam:${id}`,
      source: 'exam',
      typeLabel: 'Exam Form',
      description: comments ? `${formName} — ${comments}` : formName,
      provider: employeeName(o.employee),
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: [comments, ...vitalLines, ...respLines].filter(Boolean).join('\n'),
    });
  }

  for (const h of mr.histories ?? []) {
    const o = asObj(h);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `hx-${out.length}`;
    const serviceDateIso = pickStr(o.serviceDate);
    const formName = pickStr(o.formName) ?? 'History';
    const comments = pickStr(o.comments);
    const respLines = formResponseLines(Array.isArray(o.responses) ? o.responses : []);
    out.push({
      id: `history:${id}`,
      source: 'history',
      typeLabel: 'Medical Record Notes',
      description: comments ? `${formName} — ${comments}` : formName,
      provider: employeeName(o.employee),
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: [comments, ...respLines].filter(Boolean).join('\n'),
    });
  }

  for (const img of mr.imagingStudies ?? []) {
    const o = asObj(img);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `img-${out.length}`;
    const serviceDateIso =
      pickStr(o.serviceDate) ??
      pickStr(o.studyDate) ??
      pickStr(o.createdAt) ??
      pickStr(o.recordDate);
    const acc = pickStr(o.accessionId) ?? pickStr(o.name) ?? 'Imaging';
    out.push({
      id: `imaging:${id}`,
      source: 'imaging',
      typeLabel: 'Imaging',
      description: acc,
      provider: '—',
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: pickStr(o.description) ?? '',
    });
  }

  for (const dc of mr.dentalCharts ?? []) {
    const o = asObj(dc);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `dc-${out.length}`;
    const serviceDateIso = pickStr(o.serviceDate);
    const desc = pickStr(o.description) ?? pickStr(o.chartId) ?? 'Dental';
    out.push({
      id: `dental:${id}`,
      source: 'dental',
      typeLabel: 'Dental chart',
      description: desc,
      provider: employeeName(o.employee),
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: [pickStr(o.chartId), pickStr(o.notes)].filter(Boolean).join('\n'),
    });
  }

  for (const am of mr.anestheticMonitorForms ?? []) {
    const o = asObj(am);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `am-${out.length}`;
    const serviceDateIso = pickStr(o.serviceDate) ?? pickStr(o.anesthesiaStart);
    const title = pickStr(o.name) ?? 'Anesthesia monitoring';
    const desc = pickStr(o.description);
    out.push({
      id: `monitoring:${id}`,
      source: 'monitoring',
      typeLabel: 'Monitoring',
      description: desc ? `${title} — ${desc}` : title,
      provider: employeeName(o.surgeonEmployee),
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: [
        pickStr(o.anesthesiaStart) &&
          `Anesthesia: ${pickStr(o.anesthesiaStart)} – ${pickStr(o.anesthesiaEnd) ?? ''}`,
        pickStr(o.ivFluidType) &&
          `Fluids: ${pickStr(o.ivFluidType)} ${pickStr(o.ivFluidRate) ?? ''}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  for (const note of mr.chartNotes ?? []) {
    const o = asObj(note);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `cn-${out.length}`;
    const title = pickStr(o.name) ?? pickStr(o.recordLabel) ?? 'Medical note';
    const body = pickStr(o.noteText) ?? pickStr(o.description) ?? '';
    const serviceDateIso = pickStr(o.serviceDate) ?? pickStr(o.createdAt);
    out.push({
      id: `chartNote:${id}`,
      source: 'chartNote',
      typeLabel: 'Medical Record Notes',
      description: title,
      provider: employeeName(o.employee),
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: body,
    });
  }

  for (const doc of mr.chartDocuments ?? []) {
    const o = asObj(doc);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `doc-${out.length}`;
    const { typeLabel, description } = documentChartLabel(o);
    const ext = pickStr(o.extension);
    const serviceDateIso = pickStr(o.serviceDate) ?? pickStr(o.createdAt);
    const text = pickStr(o.documentText);
    const name = pickStr(o.name) ?? 'Document';
    out.push({
      id: `document:${id}`,
      source: 'document',
      typeLabel,
      description,
      provider: employeeName(o.employee),
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: [
        text,
        !text && ext && `File: ${name}${ext.startsWith('.') ? ext : `.${ext}`}`,
        !text && pickStr(o.contentType) && `Type: ${pickStr(o.contentType)}`,
        !text &&
          'The file itself is not stored in Scout yet — this is the chart entry from the import.',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  return finish(out);
}

/** Group already-filtered rows by calendar day in the browser locale. */
export function groupChartRowsByLocalDate(
  rows: ChartRow[]
): { dateKey: string; rows: ChartRow[] }[] {
  const map = new Map<string, ChartRow[]>();
  for (const row of rows) {
    let key = 'Unknown date';
    if (row.serviceDateIso) {
      const d = new Date(row.serviceDateIso);
      if (!Number.isNaN(d.getTime())) {
        key = d.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
        });
      }
    }
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return Array.from(map.entries()).map(([dateKey, r]) => ({ dateKey, rows: r }));
}

export function filterRowsByDateRange(
  rows: ChartRow[],
  dateStartMs: number,
  dateEndMs: number
): ChartRow[] {
  return rows.filter((r) => {
    if (!r.sortTime) return true;
    return r.sortTime >= dateStartMs && r.sortTime <= dateEndMs;
  });
}

function roomLoaderIncludesPatient(rl: RoomLoader, patientId: number): boolean {
  if ((rl.patients ?? []).some((p) => Number(p.id) === patientId)) return true;
  return (rl.appointments ?? []).some((a) => Number(a.patient?.id) === patientId);
}

/** Client-submitted Room Loaders belong on the pet medical record. */
export function chartRowsFromClientRoomLoaders(
  loaders: RoomLoader[] | null | undefined,
  patientId: string | number
): ChartRow[] {
  const pid = Number(patientId);
  if (!Number.isFinite(pid) || !loaders?.length) return [];

  const out: ChartRow[] = [];
  for (const rl of loaders) {
    if (rl.sentStatus !== 'completed' && !rl.responseFromClient) continue;
    if (!roomLoaderIncludesPatient(rl, pid)) continue;

    const appt =
      (rl.appointments ?? []).find((a) => Number(a.patient?.id) === pid) ??
      rl.appointments?.[0] ??
      null;
    const serviceDateIso =
      pickStr(appt?.appointmentStart) ?? pickStr(rl.updated) ?? pickStr(rl.created);
    const typeLabel = pickStr(appt?.appointmentType?.prettyName) ??
      pickStr(appt?.appointmentType?.name) ??
      'Pre-visit check-in';
    const answers = buildSubjectiveTextFromRoomLoaderResponse(
      rl.responseFromClient as Parameters<typeof buildSubjectiveTextFromRoomLoaderResponse>[0],
      pid,
      { appointmentReason: pickStr(appt?.description) }
    );

    out.push({
      id: `roomLoader:${rl.id}`,
      source: 'roomLoader',
      typeLabel: 'Room Loader',
      description: `Client submitted · ${typeLabel}`,
      provider: 'Client',
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: answers || 'Client submitted the pre-visit check-in form.',
    });
  }

  return out.sort((a, b) => b.sortTime - a.sortTime);
}

function employeeLabel(emp: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  const name = [emp?.firstName, emp?.lastName].filter(Boolean).join(' ').trim();
  return name || 'Staff';
}

/** Wrapped-up Scout medical notes belong on the pet medical record. */
export function chartRowsFromScoutNotes(notes: ScoutChartNote[] | null | undefined): ChartRow[] {
  if (!notes?.length) return [];
  return notes
    .filter((n) => n.status === 'finalized' && n.body.trim())
    .map((n) => {
      const when = n.finalizedAt || n.updated || n.created;
      return {
        id: `scoutNote:${n.id}`,
        source: 'scoutNote' as const,
        typeLabel: 'Medical note',
        description: n.body.trim().slice(0, 120) + (n.body.trim().length > 120 ? '…' : ''),
        provider: employeeLabel(n.finalizedByEmployee),
        serviceDateIso: when,
        sortTime: parseSortTime(when),
        detailText: n.body.trim(),
      };
    })
    .sort((a, b) => b.sortTime - a.sortTime);
}
