import { fetchPatientChartDocumentFile } from '../api/patients';
import { extractTextFromUpload } from './extractUploadText';
import type { HouseholdPdfExcerpt } from './buildHouseholdSource';
import type { MedicalRecordBundle } from './patientChartFromMedicalRecord';

const PRIORITY =
  /previous|prior|outside|old record|medical record|referral|rdvm|clinic|hospital|records request/i;
const SKIP = /rabies certificate|pre exam|check[-\s]?in|consent|invoice|pay link/i;

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function isPdfDoc(o: Record<string, unknown>): boolean {
  const ext = (pickStr(o.extension) ?? '').toLowerCase();
  const type = (pickStr(o.contentType) ?? '').toLowerCase();
  return ext.includes('pdf') || type.includes('pdf');
}

function truthyFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === 't' || t === '1' || t === 'yes';
  }
  return false;
}

function hasStoredFile(o: Record<string, unknown>): boolean {
  if (o.removedAt) return false;
  if (o.filePurgedAt) return false;
  return truthyFlag(o.hasFile) || truthyFlag(o.isUploadedToBlob);
}

/**
 * Previous-record / outside-clinic PDFs we should open and read. Certificates
 * and check-in PDFs are skipped — those facts already live on the chart.
 */
export function pickHouseholdPdfDocuments(
  mr: MedicalRecordBundle | null | undefined,
  limit: number,
): Array<{ id: number; name: string; date: string | null }> {
  if (!mr?.chartDocuments?.length || limit <= 0) return [];
  const rows = mr.chartDocuments
    .map(asObj)
    .filter((o): o is Record<string, unknown> => Boolean(o && isPdfDoc(o) && hasStoredFile(o)))
    .map((o) => {
      const id = Number(o.id);
      const name = pickStr(o.name) ?? 'Document';
      return {
        id,
        name,
        date: pickStr(o.serviceDate)?.slice(0, 10) ?? pickStr(o.createdAt)?.slice(0, 10) ?? null,
        priority: PRIORITY.test(name) ? 0 : 1,
        skip: SKIP.test(name),
        sort: Date.parse(pickStr(o.serviceDate) ?? pickStr(o.createdAt) ?? '') || 0,
      };
    })
    .filter((r) => Number.isFinite(r.id) && r.id > 0 && !r.skip)
    .sort((a, b) => a.priority - b.priority || b.sort - a.sort);
  return rows.slice(0, limit).map(({ id, name, date }) => ({ id, name, date }));
}

/** Pull extractable text from a handful of chart PDFs. Images/scans with no text layer are skipped. */
export async function extractHouseholdPdfExcerpts(
  patientId: number,
  mr: MedicalRecordBundle | null | undefined,
  limit: number,
): Promise<HouseholdPdfExcerpt[]> {
  const picks = pickHouseholdPdfDocuments(mr, limit);
  const out: HouseholdPdfExcerpt[] = [];
  for (const pick of picks) {
    try {
      const { blob, filename, objectUrl } = await fetchPatientChartDocumentFile(
        patientId,
        pick.id,
        `${pick.name}.pdf`,
      );
      try {
        const file = new File([blob], filename || `${pick.name}.pdf`, {
          type: blob.type || 'application/pdf',
        });
        const extracted = await extractTextFromUpload(file);
        const text = extracted.text.replace(/\s+/g, ' ').trim();
        if (text.length < 40) continue;
        out.push({ name: pick.name, date: pick.date, text: text.slice(0, 4000) });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      // A missing blob must not block the rest of the household source.
    }
  }
  return out;
}
