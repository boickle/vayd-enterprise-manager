import type {
  PatientPrescription,
  PatientProblem,
  SoapEncounter,
  VisitInvoice,
} from '../api/visitWorkflow';
import { PE_SYSTEMS, peExamFromValue } from '../components/soap/peTemplate';
import {
  formatPetInactivationLine,
  type HouseholdPetStatusInput,
} from './householdPetStatus';
import {
  buildChartRowsFromMedicalRecord,
  type ChartRow,
  type MedicalRecordBundle,
} from './patientChartFromMedicalRecord';
import { htmlToPlainText, looksLikeHtmlFragment } from './sanitizeCommunicationHtml';

export type HouseholdPdfExcerpt = {
  name: string;
  date: string | null;
  text: string;
};

export type HouseholdPetSourceInput = HouseholdPetStatusInput & {
  summaryLine: string;
  alerts: string | null;
  problems: PatientProblem[];
  prescriptions: PatientPrescription[];
  /** Chart + SOAP + vaccine/reminder rows. Built from the medical record. */
  medicalRecord?: MedicalRecordBundle | null;
  encounters?: SoapEncounter[];
  /** Text pulled from previous-record / outside-clinic PDFs. */
  pdfExcerpts?: HouseholdPdfExcerpt[];
};

function money(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

function invoiceDue(inv: VisitInvoice): number {
  return Math.max(0, Number(inv.total || 0) - Number(inv.amountPaid || 0));
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function asText(value: string): string {
  return looksLikeHtmlFragment(value) ? htmlToPlainText(value) : value.replace(/<br\s*\/?>/gi, '\n');
}

function clip(value: string, max: number): string {
  const t = value.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}…`;
}

function isoDay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function eventBody(row: ChartRow): string {
  const detail = asText(row.detailText || '').trim();
  const fromHtml = row.detailHtml ? htmlToPlainText(row.detailHtml).trim() : '';
  return [detail, fromHtml].filter(Boolean).join('\n').trim();
}

function vaccineNameFromLog(o: Record<string, unknown>): string {
  const inv = asObj(o.inventoryItem);
  const ti = asObj(o.treatmentItem);
  const tiInv = ti ? asObj(ti.inventoryItem) : null;
  return (
    pickStr(o.vaccineName) ??
    pickStr(o.name) ??
    (inv ? pickStr(inv.name) : null) ??
    (tiInv ? pickStr(tiInv.name) : null) ??
    'Vaccination'
  );
}

function compactSoapLines(enc: SoapEncounter): string[] {
  const when = isoDay(enc.completedAt ?? enc.updated ?? enc.created) || 'undated';
  const mode = enc.mode === 'quick' ? 'Quick SOAP' : 'Comprehensive SOAP';
  const out = [`- ${when} ${mode} (${enc.status})`];
  const history =
    enc.subjective && typeof enc.subjective.history === 'string'
      ? asText(enc.subjective.history).trim()
      : '';
  if (history) out.push(`    Hx: ${clip(history, 700)}`);
  if (enc.objectiveExam && typeof enc.objectiveExam === 'object') {
    const exam = peExamFromValue(enc.objectiveExam);
    for (const sys of PE_SYSTEMS) {
      const finding = exam[sys.key];
      if (!finding || finding.status !== 'abnormal') continue;
      const note = finding.note?.trim();
      out.push(`    PE ${sys.label}: abnormal${note ? ` — ${clip(note, 240)}` : ''}`);
    }
  }
  if (enc.objectiveNotes?.trim()) out.push(`    Obj: ${clip(asText(enc.objectiveNotes), 400)}`);
  if (enc.assessmentReasoning?.trim()) {
    out.push(`    A: ${clip(asText(enc.assessmentReasoning), 600)}`);
  }
  if (enc.planNotes?.trim()) out.push(`    P: ${clip(asText(enc.planNotes), 600)}`);
  return out.length > 1 ? out : [`- ${when} ${mode} (${enc.status}) — no body recorded`];
}

function appendPetChart(lines: string[], pet: HouseholdPetSourceInput): void {
  const mr = pet.medicalRecord ?? null;
  const rows = mr ? buildChartRowsFromMedicalRecord(mr) : [];

  const vaxLogs = (mr?.vaccinationLogs ?? [])
    .map(asObj)
    .filter((o): o is Record<string, unknown> => o != null);
  if (vaxLogs.length) {
    lines.push('Vaccinations (given · next due):');
    const sorted = [...vaxLogs].sort((a, b) => {
      const ad = Date.parse(pickStr(a.dateVaccinated) ?? pickStr(a.serviceDate) ?? '') || 0;
      const bd = Date.parse(pickStr(b.dateVaccinated) ?? pickStr(b.serviceDate) ?? '') || 0;
      return bd - ad;
    });
    for (const o of sorted.slice(0, 40)) {
      const given = isoDay(pickStr(o.dateVaccinated) ?? pickStr(o.serviceDate)) || 'undated';
      const next = isoDay(pickStr(o.nextVaccinationDate));
      lines.push(`- ${vaccineNameFromLog(o)} · given ${given}${next ? ` · next due ${next}` : ''}`);
    }
  } else {
    lines.push('Vaccinations: none listed on the chart');
  }

  const reminders = rows
    .filter((r) => r.source === 'reminder')
    .sort((a, b) => b.sortTime - a.sortTime)
    .slice(0, 16);
  if (reminders.length) {
    lines.push('Reminders / due dates:');
    for (const r of reminders) {
      const when = isoDay(r.serviceDateIso) || 'undated';
      lines.push(`- ${when} ${r.description}`);
    }
  }

  const notes = rows
    .filter((r) => r.source === 'exam' || r.source === 'history' || r.source === 'chartNote')
    .sort((a, b) => b.sortTime - a.sortTime)
    .slice(0, 24);
  if (notes.length) {
    lines.push('Exams / medical notes (read these for historical findings — they are not always on the problem list):');
    for (const r of notes) {
      const when = isoDay(r.serviceDateIso) || 'undated';
      const body = eventBody(r);
      lines.push(`- ${when} ${r.typeLabel}: ${r.description}`);
      if (body) lines.push(`    ${clip(body.replace(/\s+/g, ' '), 900)}`);
    }
  }

  const soaps = [...(pet.encounters ?? [])]
    .sort((a, b) => {
      const aKey = a.completedAt ?? a.updated ?? a.created;
      const bKey = b.completedAt ?? b.updated ?? b.created;
      return bKey.localeCompare(aKey);
    })
    .slice(0, 10);
  if (soaps.length) {
    lines.push('SOAP notes:');
    for (const enc of soaps) lines.push(...compactSoapLines(enc));
  }

  const pdfs = pet.pdfExcerpts?.filter((p) => p.text.trim()) ?? [];
  const titledDocs = rows
    .filter((r) => r.source === 'document' && !r.removed)
    .sort((a, b) => b.sortTime - a.sortTime)
    .slice(0, 12);
  const storedDocText = (mr?.chartDocuments ?? [])
    .map(asObj)
    .filter((o): o is Record<string, unknown> => Boolean(o && pickStr(o.documentText)))
    .map((o) => ({
      name: pickStr(o.name) ?? 'Document',
      date: isoDay(pickStr(o.serviceDate) ?? pickStr(o.createdAt)),
      text: pickStr(o.documentText) ?? '',
    }));
  if (titledDocs.length || pdfs.length || storedDocText.length) {
    lines.push('Chart documents:');
    for (const r of titledDocs) {
      const when = isoDay(r.serviceDateIso) || 'undated';
      lines.push(`- ${when} ${r.typeLabel}: ${r.description}`);
    }
    for (const doc of storedDocText.slice(0, 4)) {
      lines.push(`- Stored text from "${doc.name}"${doc.date ? ` (${doc.date})` : ''}:`);
      lines.push(`    ${clip(doc.text.replace(/\s+/g, ' '), 2000)}`);
    }
    for (const pdf of pdfs.slice(0, 4)) {
      lines.push(
        `- PDF text from "${pdf.name}"${pdf.date ? ` (${pdf.date})` : ''}:`,
      );
      lines.push(`    ${clip(pdf.text.replace(/\s+/g, ' '), 2500)}`);
    }
  }
}

/**
 * Compact household source for client summary/chat — pets in this household,
 * their chart (exams, SOAPs, vaccines, notes), account balance, and invoices.
 */
export function buildHouseholdSourceText(opts: {
  clientName: string;
  clientId: string;
  balance: number | null;
  pets: HouseholdPetSourceInput[];
  invoices: VisitInvoice[];
}): string {
  const lines: string[] = [];
  lines.push(`Household: ${opts.clientName.trim() || 'Client'} (clientId ${opts.clientId})`);
  lines.push(`Pets in this household only: ${opts.pets.length}`);
  lines.push('');

  lines.push('Account:');
  if (opts.balance == null || !Number.isFinite(opts.balance)) {
    lines.push('- Balance: not listed');
  } else if (Math.abs(opts.balance) < 0.005) {
    lines.push('- Balance: $0.00');
  } else if (opts.balance > 0) {
    lines.push(`- Balance due: ${money(opts.balance)}`);
  } else {
    lines.push(`- Credit on account: ${money(Math.abs(opts.balance))}`);
  }

  const invoices = (opts.invoices ?? [])
    .filter((inv) => !inv.isDeleted && inv.status !== 'void')
    .slice(0, 40);
  if (invoices.length === 0) {
    lines.push('- Scout invoices: none listed');
  } else {
    lines.push('- Scout invoices (most recent first):');
    for (const inv of invoices) {
      const num =
        inv.scoutInvoiceNumber != null
          ? `#${inv.scoutInvoiceNumber}`
          : inv.evetInvoiceNumber != null
            ? `eVet #${inv.evetInvoiceNumber}`
            : inv.id.slice(0, 8);
      const due = invoiceDue(inv);
      const petHint =
        inv.patientId != null
          ? ` · patientId ${inv.patientId}`
          : '';
      lines.push(
        `  - ${num} · ${inv.status} · total ${money(Number(inv.total || 0))} · paid ${money(
          Number(inv.amountPaid || 0),
        )} · due ${money(due)}${petHint}${inv.finalizedAt ? ` · finalized ${inv.finalizedAt.slice(0, 10)}` : ''}`,
      );
      const activeLines = (inv.lines ?? []).filter((l) => !l.isDeleted).slice(0, 12);
      for (const line of activeLines) {
        const who = line.patientName?.trim() || (line.patientId != null ? `patient ${line.patientId}` : '');
        lines.push(
          `      · ${line.description} × ${line.qty} @ ${money(Number(line.unitPrice || 0))} = ${money(
            Number(line.amount || 0),
          )}${who ? ` (${who})` : ''}`,
        );
      }
    }
  }

  lines.push('');
  lines.push('Pets:');
  if (opts.pets.length === 0) {
    lines.push('- No pets on this client.');
  }
  for (const pet of opts.pets) {
    lines.push('');
    const inactiveDetail = formatPetInactivationLine(pet);
    lines.push(
      `### ${pet.name} (patientId ${pet.id})${
        pet.active ? '' : inactiveDetail ? ` · ${inactiveDetail}` : ' · inactive'
      }`
    );
    if (pet.summaryLine.trim()) lines.push(`Signalment / summary: ${pet.summaryLine.trim()}`);
    if (pet.alerts?.trim()) lines.push(`Patient alerts: ${pet.alerts.trim()}`);
    if (!pet.active) {
      lines.push(
        'Note: this pet is inactive / not alive — include them in the household snapshot with status, date, and who performed euthanasia when listed. Do not invent a provider or date.'
      );
    }

    const openProblems = pet.problems.filter((p) => p.status !== 'resolved').slice(0, 20);
    if (openProblems.length) {
      lines.push('Active problems:');
      for (const p of openProblems) {
        lines.push(`- ${p.label}${p.kind ? ` (${p.kind})` : ''}${p.note ? ` — ${p.note}` : ''}`);
      }
    } else {
      lines.push('Active problems: none listed');
    }

    const activeRx = pet.prescriptions
      .filter((rx) => !rx.discontinuedAt)
      .slice(0, 20);
    if (activeRx.length) {
      lines.push('Active medications:');
      for (const rx of activeRx) {
      lines.push(
        `- ${rx.name}${rx.startDate ? ` · start ${String(rx.startDate).slice(0, 10)}` : ''}`,
      );
      }
    } else {
      lines.push('Active medications: none listed');
    }

    appendPetChart(lines, pet);
  }

  return lines.join('\n').slice(0, 180_000);
}
