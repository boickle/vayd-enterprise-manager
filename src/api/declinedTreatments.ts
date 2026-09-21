import { http } from './http';

/** Invoice-only decline: off the bill, not written to the chart or reminder list. */
export const OFF_RECORD_DECLINE_MARKER = 'Declined (off record)';

export function isOffRecordDeclineNote(note?: string | null): boolean {
  return (note ?? '').includes(OFF_RECORD_DECLINE_MARKER);
}

export function offRecordDeclineNote(reason?: string | null): string {
  const extra = reason?.trim();
  return extra ? `${OFF_RECORD_DECLINE_MARKER}: ${extra}` : OFF_RECORD_DECLINE_MARKER;
}

export type DeclinedTreatmentItem = {
  id: number;
  label: string;
  declinedAt: string | null;
  laterReceivedAt?: string | null;
  catalogItemType?: 'inventory' | 'procedure' | 'lab' | null;
  catalogItemId?: number | null;
  patientId?: number;
};

export function formatDeclinedDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}

export function parseDeclinedItems(raw: unknown): DeclinedTreatmentItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const o = row as Record<string, unknown>;
      const catalogItemType: DeclinedTreatmentItem['catalogItemType'] =
        o.catalogItemType === 'inventory' ||
        o.catalogItemType === 'procedure' ||
        o.catalogItemType === 'lab'
          ? o.catalogItemType
          : null;
      return {
        id: Number(o.id) || 0,
        label: String(o.label ?? o.description ?? 'Declined item'),
        declinedAt:
          typeof o.declinedAt === 'string'
            ? o.declinedAt
            : typeof o.serviceDate === 'string'
              ? o.serviceDate
              : null,
        laterReceivedAt:
          typeof o.laterReceivedAt === 'string' ? o.laterReceivedAt : null,
        catalogItemType,
        catalogItemId:
          o.catalogItemId != null && Number.isFinite(Number(o.catalogItemId))
            ? Number(o.catalogItemId)
            : null,
        patientId:
          o.patientId != null && Number.isFinite(Number(o.patientId))
            ? Number(o.patientId)
            : undefined,
      };
    })
    .filter((row) => row.id > 0 || row.label);
}

export async function declineReminder(
  reminderId: number | string,
  note?: string | null
): Promise<DeclinedTreatmentItem> {
  const { data } = await http.post<DeclinedTreatmentItem>(
    `/reminders/${encodeURIComponent(String(reminderId))}/decline`,
    note?.trim() ? { note: note.trim() } : {}
  );
  return data;
}
