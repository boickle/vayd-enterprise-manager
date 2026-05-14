/** Build unified chart rows from GET /patients/:id/medical-record payload. */

import {
  htmlToPlainText,
  looksLikeHtmlFragment,
  sanitizeCommunicationHtml,
} from './sanitizeCommunicationHtml';

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
  return joined || pickStr(o.name) || '—';
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
};

export type ChartRowSource =
  | 'complaint'
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
  | 'vaccination';

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
};

function communicationMessageObject(o: Record<string, unknown>): Record<string, unknown> | null {
  return asObj(o.communicationMessageLog) ?? asObj(o.messageLog);
}

function communicationRawBody(o: Record<string, unknown>): string | null {
  const msg = communicationMessageObject(o);
  return pickStr(msg?.body) ?? pickStr(msg?.message) ?? pickStr(o.description);
}

function communicationLogSummary(o: Record<string, unknown>): string {
  const msg = communicationMessageObject(o);
  const subject = pickStr(o.subject) ?? pickStr(msg?.subject);
  const rawBody = communicationRawBody(o);
  if (subject && !looksLikeHtmlFragment(subject)) return subject;
  const messageType = pickStr(o.messageType);
  if (messageType) return messageType;
  if (rawBody) {
    if (looksLikeHtmlFragment(rawBody)) {
      const plain = htmlToPlainText(rawBody);
      const t = plain.replace(/\s+/g, ' ').trim();
      if (!t) return 'Client communication';
      return t.length > 140 ? `${t.slice(0, 140)}…` : t;
    }
    return rawBody.length > 140 ? `${rawBody.slice(0, 140)}…` : rawBody;
  }
  return (
    pickStr(o.summary) ?? pickStr(msg?.subject) ?? pickStr(o.messageType) ?? 'Client communication'
  );
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

export function buildChartRowsFromMedicalRecord(mr: MedicalRecordBundle | null | undefined): ChartRow[] {
  if (!mr) return [];
  const out: ChartRow[] = [];

  for (const log of mr.communicationLogs ?? []) {
    const o = asObj(log);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `cc-${out.length}`;
    const serviceDateIso =
      pickStr(o.serviceDate) ??
      pickStr(o.sentAt) ??
      pickStr(o.createdAt) ??
      pickStr(o.deliveredAt);
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
    if (rawBody && looksLikeHtmlFragment(rawBody)) {
      detailHtml = sanitizeCommunicationHtml(rawBody);
    } else if (rawBody) {
      detailText = [detailText, rawBody].filter(Boolean).join('\n\n');
    }
    out.push({
      id: `communication:${id}`,
      source: 'communication',
      typeLabel: 'Client communication entry',
      description: summary,
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
    const id = o.id != null ? String(o.id) : `rm-${out.length}`;
    const serviceDateIso =
      pickStr(o.dueDate) ??
      pickStr(o.reminderDate) ??
      pickStr(o.serviceDate) ??
      pickStr(o.createdAt);
    const title = pickStr(o.title) ?? pickStr(o.name) ?? pickStr(o.description) ?? 'Reminder';
    const desc = pickStr(o.description) && pickStr(o.description) !== title ? pickStr(o.description) : null;
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
      typeLabel: 'Vaccination log',
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
    const serviceDateIso =
      pickStr(o.serviceDate) ?? pickStr(o.createdAt) ?? pickStr(o.recordDate);
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
      detailText: [comments && `Comments: ${comments}`, pickStr(o.pimsId) && `PIMS: ${pickStr(o.pimsId)}`]
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
        ? [rComments && `Result: ${rComments}`, pickStr(result.externalData) && 'Raw data available']
            .filter(Boolean)
            .join('\n')
        : notes ?? '',
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
    const responses = Array.isArray(o.responses) ? o.responses : [];
    const respLines = responses
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
    out.push({
      id: `exam:${id}`,
      source: 'exam',
      typeLabel: 'Exam form',
      description: comments ? `${formName} — ${comments}` : formName,
      provider: employeeName(o.employee),
      serviceDateIso,
      sortTime: parseSortTime(serviceDateIso),
      detailText: [comments, ...respLines].filter(Boolean).join('\n'),
    });
  }

  for (const h of mr.histories ?? []) {
    const o = asObj(h);
    if (!o) continue;
    const id = o.id != null ? String(o.id) : `hx-${out.length}`;
    const serviceDateIso = pickStr(o.serviceDate);
    const formName = pickStr(o.formName) ?? 'History';
    const comments = pickStr(o.comments);
    const responses = Array.isArray(o.responses) ? o.responses : [];
    const respLines = responses
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
    out.push({
      id: `history:${id}`,
      source: 'history',
      typeLabel: 'Medical record notes',
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
      pickStr(o.serviceDate) ?? pickStr(o.studyDate) ?? pickStr(o.createdAt) ?? pickStr(o.recordDate);
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
        pickStr(o.anesthesiaStart) && `Anesthesia: ${pickStr(o.anesthesiaStart)} – ${pickStr(o.anesthesiaEnd) ?? ''}`,
        pickStr(o.ivFluidType) && `Fluids: ${pickStr(o.ivFluidType)} ${pickStr(o.ivFluidRate) ?? ''}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  return out.sort((a, b) => b.sortTime - a.sortTime);
}

/** Group already-filtered rows by calendar day in the browser locale. */
export function groupChartRowsByLocalDate(rows: ChartRow[]): { dateKey: string; rows: ChartRow[] }[] {
  const map = new Map<string, ChartRow[]>();
  for (const row of rows) {
    let key = 'Unknown date';
    if (row.serviceDateIso) {
      const d = new Date(row.serviceDateIso);
      if (!Number.isNaN(d.getTime())) {
        key = d.toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
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
