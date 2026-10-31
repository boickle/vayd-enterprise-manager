import { useState } from 'react';
import { CalendarRange, Mail, Mails, Printer } from 'lucide-react';
import { ClientEmailComposeModal, type EmailRecipientChoice } from '../ClientEmailComposeModal';
import { fetchPatientChartDocumentFile } from '../../api/patients';
import { getIdexxResult } from '../../api/idexx';
import { listOutsideHospitals, type OutsideHospital } from '../../api/outsideHospitals';
import type { GmailComposeAttachment } from '../../api/gmail';
import { appAlert, appConfirm } from '../../utils/appDialog';
import {
  buildChartRecordsPdf,
  withoutHandlingSection,
  chartRecordRows,
  htmlToText,
  isFileRow,
  labReportFromIdexx,
  recordDetailText,
  recordProvider,
  recordsPdfFilename,
  type RecordPdfEntry,
} from '../../utils/chartRecordsPdf';
import type { ChartRow } from '../../utils/patientChartFromMedicalRecord';

type Scope = 'selected' | 'range' | 'all';

type Props = {
  patientId: number;
  patientName: string;
  clientId: number | null;
  clientLabel: string;
  clientEmail: string | null;
  rows: ChartRow[];
  filteredRows: ChartRow[];
  /** Timeline row ids. */
  selectedIds: Set<string>;
  dateStart: string;
  dateEnd: string;
  /** "Show removed entries" is on — removed rows go out too, labelled as removed. */
  includeRemoved?: boolean;
  /** Signalment, date of birth, microchip — printed under the pet's name. Never alerts. */
  patientFacts?: string[];
};

function removedLabel(row: ChartRow): string {
  const when = row.removedAt ? new Date(row.removedAt).toLocaleDateString('en-US') : null;
  return [
    ['REMOVED', when && `on ${when}`, row.removedByName && `by ${row.removedByName}`]
      .filter(Boolean)
      .join(' '),
    row.removedReason && `Reason: ${row.removedReason}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const EMAIL_LIMIT_BYTES = 20 * 1024 * 1024;

function formatRange(start: string, end: string): string {
  const show = (ymd: string) => {
    const [y, m, d] = ymd.split('-');
    return y && m && d ? `${m}/${d}/${y}` : ymd;
  };
  return `${show(start)} – ${show(end)}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the PDF.'));
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Imported documents carry an inbox emoji in the chart; it does not belong in a PDF or email. */
function rowName(row: ChartRow): string {
  return row.description.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '').trim() || 'document';
}

function isNotFound(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 404;
}

/** "A; B (×4)" — repeats collapse into a count. */
function countedList(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([n, c]) => (c > 1 ? `${n} (×${c})` : n)).join('; ');
}

function rowDate(row: ChartRow): string {
  if (!row.serviceDateIso) return '';
  const d = new Date(row.serviceDateIso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US');
}

function rowDetail(row: ChartRow): string {
  if (row.printText) return recordDetailText(withoutHandlingSection(row.printText));
  const html = row.detailHtml ? htmlToText(row.detailHtml) : '';
  return recordDetailText(
    withoutHandlingSection([row.detailText?.trim(), html].filter(Boolean).join('\n\n'))
  );
}

function openPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    return;
  }
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      // The tab is open; staff can print from there.
    }
  }, 700);
}

export default function ChartRecordsSendBar({
  patientId,
  patientName,
  clientId,
  clientLabel,
  clientEmail,
  rows,
  filteredRows,
  selectedIds,
  dateStart,
  dateEnd,
  includeRemoved = false,
  patientFacts = [],
}: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState<{ attachment: GmailComposeAttachment } | null>(null);
  const [hospitals, setHospitals] = useState<OutsideHospital[] | null>(null);

  const rangeLabel = formatRange(dateStart, dateEnd);
  const allRows = chartRecordRows(rows, { includeRemoved });
  const rangeRows = chartRecordRows(filteredRows, { includeRemoved });
  const selectedRows = allRows.filter((row) => selectedIds.has(row.id));
  const who = patientName.trim() || 'this patient';

  const run = async (scope: Scope, mode: 'email' | 'print') => {
    const picked = scope === 'selected' ? selectedRows : scope === 'range' ? rangeRows : allRows;
    if (!picked.length) {
      await appAlert(
        scope === 'selected'
          ? 'Check the rows you want to send.'
          : scope === 'range'
            ? 'There is nothing on the chart in this date range.'
            : 'There is nothing on this chart yet.'
      );
      return;
    }
    const removedCount = picked.filter((row) => row.removed).length;
    if (removedCount > 0) {
      const ok = await appConfirm({
        title: 'Include removed entries?',
        message: `This ${mode === 'print' ? 'printout' : 'email'} will include ${removedCount} entr${
          removedCount === 1 ? 'y' : 'ies'
        } that ${removedCount === 1 ? 'was' : 'were'} removed from the record. Each is labelled REMOVED with who removed it, when and why. Turn off “Show removed entries” to leave them out.`,
        confirmLabel: 'Include them',
        cancelLabel: 'Cancel',
      });
      if (!ok) return;
    }
    setBusy(true);
    setStatus(null);
    const entries: RecordPdfEntry[] = [];
    if (removedCount > 0) {
      entries.push({
        kind: 'text',
        date: '',
        typeLabel: 'Notice',
        description: `This record includes ${removedCount} entr${
          removedCount === 1 ? 'y' : 'ies'
        } marked REMOVED. Removed entries are kept for the audit trail and are not part of the active medical record.`,
        provider: '',
        detail: '',
      });
    }
    const skipped: string[] = [];
    const notStored: string[] = [];
    const files = picked.filter(isFileRow).length;
    let opened = 0;
    const textEntry = (
      row: ChartRow,
      detail: string
    ): Extract<RecordPdfEntry, { kind: 'text' }> => ({
      kind: 'text',
      date: rowDate(row),
      typeLabel: row.typeLabel,
      description: rowName(row),
      provider: recordProvider(row.provider),
      detail,
    });
    try {
      for (const row of picked) {
        if (row.removed) {
          entries.push({
            ...textEntry(row, [removedLabel(row), rowDetail(row)].filter(Boolean).join('\n')),
            typeLabel: `${row.typeLabel} — REMOVED`,
          } as RecordPdfEntry);
          continue;
        }
        if (row.idexxResult) {
          setStatus(`Adding IDEXX results from ${rowDate(row) || 'IDEXX'}`);
          const result = await getIdexxResult(row.idexxResult.id).catch(() => null);
          entries.push(
            result?.categories?.length
              ? { ...textEntry(row, ''), lab: labReportFromIdexx(result) }
              : textEntry(row, 'Results are on file at the practice.')
          );
          continue;
        }
        if (!isFileRow(row)) {
          entries.push(textEntry(row, rowDetail(row)));
          continue;
        }
        opened += 1;
        setStatus(`Opening ${opened} of ${files}: ${rowName(row)}`);
        try {
          const file = await fetchPatientChartDocumentFile(
            Number(row.filePatientId),
            Number(row.fileDocumentId),
            rowName(row)
          );
          URL.revokeObjectURL(file.objectUrl);
          entries.push({
            kind: 'file',
            name: rowName(row) || file.filename,
            filename: file.filename,
            blob: file.blob,
          });
        } catch (err) {
          if (isNotFound(err)) {
            notStored.push(rowName(row));
            entries.push(
              textEntry(row, 'The attached file for this entry is not available in this record.')
            );
          } else {
            skipped.push(rowName(row));
          }
        }
      }
      if (!entries.length) {
        throw new Error(
          skipped.length ? `Could not open: ${skipped.join('; ')}.` : 'Nothing to include.'
        );
      }
      const cover = {
        practice: 'Vet At Your Door',
        patientName: who,
        facts: patientFacts,
        owner: clientLabel && clientLabel !== 'Client' ? clientLabel : '',
        printedOn: new Date().toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        }),
        note: [
          scope === 'range' ? `Entries from ${rangeLabel}` : null,
          removedCount > 0 ? 'Includes entries marked REMOVED' : null,
        ]
          .filter(Boolean)
          .join('  |  '),
      };
      const built = await buildChartRecordsPdf(entries, cover, (_done, _total, name) => {
        setStatus(`Adding ${name}`);
      });
      const missed = [...skipped, ...built.skipped];
      const note = [
        notStored.length &&
          `Listed without the attachment — Scout never received a copy of the file from eVet (eVet returns "not found" for it): ${countedList(notStored)}.`,
        missed.length && `Could not be read and was left out: ${countedList(missed)}.`,
      ]
        .filter(Boolean)
        .join(' ');
      const filename = recordsPdfFilename(patientName);
      if (note) await appAlert(note);
      if (mode === 'print') {
        openPdf(built.blob, filename);
        setStatus(
          note ||
            `Opened ${built.included} chart entr${built.included === 1 ? 'y' : 'ies'} as one PDF, newest first.`
        );
        return;
      }
      if (built.blob.size > EMAIL_LIMIT_BYTES) {
        await appAlert(
          `That PDF is ${Math.ceil(built.blob.size / (1024 * 1024))} MB, which is too large to email. Print it instead.`
        );
        openPdf(built.blob, filename);
        setStatus(note || 'Opened the PDF to print.');
        return;
      }
      if (!clientEmail?.trim() && clientId == null) {
        await appAlert('There is no email on this client. The PDF is open so you can print it.');
        openPdf(built.blob, filename);
        return;
      }
      if (hospitals == null) {
        setHospitals(await listOutsideHospitals().catch(() => []));
      }
      setEmail({
        attachment: {
          filename,
          mimeType: 'application/pdf',
          contentBase64: await blobToBase64(built.blob),
        },
      });
      setStatus(note || null);
    } catch (err) {
      await appAlert(err instanceof Error ? err.message : 'Could not build the PDF.');
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const pet = escapeHtml(who);
  const recipientChoices: EmailRecipientChoice[] = [
    {
      key: 'client',
      label: clientLabel || 'Client',
      to: clientEmail?.trim() ?? '',
      group: 'Client',
      bodyText: `<p>Medical records for ${pet} are attached as one PDF, newest first.</p>`,
    },
    ...(hospitals ?? [])
      .filter((h) => h.isActive)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((h) => ({
        key: `hospital:${h.id}`,
        label: h.name,
        to: h.email?.trim() ?? '',
        group: 'Veterinary hospitals',
        bodyText: `<p>Hello,</p><p>Attached are the medical records for ${pet}${
          clientLabel ? ` (owner: ${escapeHtml(clientLabel)})` : ''
        }, as one PDF with the most recent first.</p><p>Please let us know if you need anything else.</p>`,
      })),
  ];

  return (
    <>
      <div className="pims-patient-detail__send" role="group" aria-label="Email or print records">
        <button
          type="button"
          disabled={busy}
          title={
            selectedRows.length
              ? `Email ${selectedRows.length} selected record${selectedRows.length === 1 ? '' : 's'} as one PDF`
              : 'Check the chart rows to email'
          }
          aria-label="Email selected records"
          onClick={() => void run('selected', 'email')}
        >
          <Mail size={15} aria-hidden />
        </button>
        <button
          type="button"
          disabled={busy}
          title={`Email the chart from ${rangeLabel}`}
          aria-label="Email records in this date range"
          onClick={() => void run('range', 'email')}
        >
          <Mail size={15} aria-hidden />
          <CalendarRange size={13} aria-hidden />
        </button>
        <button
          type="button"
          disabled={busy}
          title={`Email ${who}'s whole chart as one PDF`}
          aria-label="Email all records"
          onClick={() => void run('all', 'email')}
        >
          <Mails size={15} aria-hidden />
        </button>
        <button
          type="button"
          disabled={busy}
          title={
            selectedRows.length
              ? `Print ${selectedRows.length} selected record${selectedRows.length === 1 ? '' : 's'} as one PDF`
              : 'Check the chart rows to print'
          }
          aria-label="Print selected records"
          onClick={() => void run('selected', 'print')}
        >
          <Printer size={15} aria-hidden />
        </button>
        <button
          type="button"
          disabled={busy}
          title={`Print the chart from ${rangeLabel}`}
          aria-label="Print records in this date range"
          onClick={() => void run('range', 'print')}
        >
          <Printer size={15} aria-hidden />
          <CalendarRange size={13} aria-hidden />
        </button>
        <button
          type="button"
          disabled={busy}
          title={`Print ${who}'s whole chart as one PDF`}
          aria-label="Print all records"
          onClick={() => void run('all', 'print')}
        >
          <Printer size={15} aria-hidden />
          <span>all</span>
        </button>
      </div>
      {status ? <p className="pims-patient-detail__send-status">{status}</p> : null}
      {email ? (
        <ClientEmailComposeModal
          open
          clientId={clientId}
          clientLabel={clientLabel}
          initialTo={clientEmail ?? ''}
          title={`Email records · ${who}`}
          initialSubject={`Medical records — ${who}`}
          initialBodyText={recipientChoices[0]!.bodyText!}
          recipientChoices={recipientChoices}
          initialAttachments={[email.attachment]}
          regardingPatients={
            Number.isFinite(patientId) && patientId > 0 ? [{ id: patientId, name: who }] : []
          }
          regardingPatientIds={Number.isFinite(patientId) && patientId > 0 ? [patientId] : []}
          onClose={() => setEmail(null)}
        />
      ) : null}
    </>
  );
}
