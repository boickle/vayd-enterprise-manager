import { getIdexxResult, listIdexxResults, type IdexxResultSummary } from '../api/idexx';
import { listPatientLabResults, type LabResult } from '../api/inHouseLabs';
import { labReportBriefText, labReportFromIdexx, labReportFromInHouse } from './chartRecordsPdf';
import { practiceDateKey } from './practiceTimezone';

/** One Scout lab result, as text for the AI case and household summaries. */
export type LabSourceEntry = {
  /** Stable id for a [ref:…] citation, e.g. `idexx-12` or `lab-40`. */
  ref: string;
  /** YYYY-MM-DD, or null when the result has no date. */
  date: string | null;
  label: string;
  text: string;
};

function day(iso: string | null | undefined): string | null {
  return practiceDateKey(iso);
}

function idexxWhen(r: IdexxResultSummary): string | null {
  return day(r.specimenCollectionDate ?? r.receivedAt ?? r.idexxUpdatedAt);
}

async function idexxEntries(patientId: number, limit: number): Promise<LabSourceEntry[]> {
  const list = await listIdexxResults({ patientId, limit: 50 })
    .then((page) => page.items ?? [])
    .catch(() => [] as IdexxResultSummary[]);
  const recent = [...list]
    .filter((r) => (r.status ?? '').toUpperCase() !== 'CANCELLED')
    .sort((a, b) => (idexxWhen(b) ?? '').localeCompare(idexxWhen(a) ?? ''))
    .slice(0, limit);
  const out: LabSourceEntry[] = [];
  for (const r of recent) {
    const label = `IDEXX result: ${r.testNames.join(', ') || 'panel'}`;
    const detail = await getIdexxResult(r.id).catch(() => null);
    const text = detail?.categories?.length
      ? labReportBriefText(labReportFromIdexx(detail))
      : (r.status ?? '').toUpperCase() === 'COMPLETE'
        ? 'Results are on file; values could not be loaded.'
        : 'Pending at IDEXX.';
    out.push({ ref: `idexx-${r.id}`, date: idexxWhen(r), label, text });
  }
  return out;
}

async function inHouseEntries(patientId: number, limit: number): Promise<LabSourceEntry[]> {
  const list = await listPatientLabResults(patientId).catch(() => [] as LabResult[]);
  const when = (r: LabResult) => day(r.resultedAt ?? r.serviceDate);
  return [...list]
    .filter((r) => (r as { isDeleted?: boolean }).isDeleted !== true)
    .sort((a, b) => (when(b) ?? '').localeCompare(when(a) ?? ''))
    .slice(0, limit)
    .map((r) => ({
      ref: `lab-${r.id}`,
      date: when(r),
      label: `In-house lab: ${r.templateName || r.lab?.name || 'lab'}`,
      text:
        r.status === 'complete'
          ? labReportBriefText(labReportFromInHouse([r]))
          : 'Results pending.',
    }));
}

/**
 * Scout's own lab results for a pet, newest first: IDEXX send-outs and in-house forms.
 * Imported eVet labs are already on the medical record and are not repeated here.
 * A failed lookup gives no entries rather than blocking the summary.
 */
export async function fetchPatientLabSource(
  patientId: number,
  limit = 8,
): Promise<LabSourceEntry[]> {
  if (!Number.isFinite(patientId) || patientId <= 0) return [];
  const [idexx, inHouse] = await Promise.all([
    idexxEntries(patientId, limit),
    inHouseEntries(patientId, limit),
  ]);
  return [...idexx, ...inHouse]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, limit);
}
