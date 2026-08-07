/**
 * Mirrors the API's `hasUnsyncedScoutEdits` (vayd-api/src/common/pimsLocalEdit.util.ts).
 *
 * A client or patient is "managed in Scout" when it was created here, or when a Scout
 * edit is newer than the last eVet data we applied. While that holds, the eVet import
 * skips the record and Scout stays the source of truth.
 */

function toEpochMs(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : ms;
}

function pimsTypeOf(record: Record<string, unknown> | null | undefined): string {
  const raw = record?.pimsType;
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

/** True for records created in Scout — they have no eVet counterpart at all. */
export function isScoutCreatedRecord(record: Record<string, unknown> | null | undefined): boolean {
  return pimsTypeOf(record) === 'VAYD';
}

/** True while Scout edits are shielding this record from the eVet import. */
export function isScoutManagedRecord(record: Record<string, unknown> | null | undefined): boolean {
  if (!record) return false;
  if (isScoutCreatedRecord(record)) return true;

  const editedMs = toEpochMs(record.externalUpdated);
  if (editedMs == null) return false;

  const syncedMs = toEpochMs(record.lastPimsSyncedAt);
  if (syncedMs == null) return true;

  return editedMs > syncedMs;
}

export type ScoutManagedState = {
  /** Created in Scout; eVet has no copy. */
  scoutCreated: boolean;
  /** Scout edits currently take precedence over eVet. */
  scoutManaged: boolean;
  label: string;
  title: string;
};

export function scoutManagedState(
  record: Record<string, unknown> | null | undefined,
  entity: 'client' | 'patient',
): ScoutManagedState {
  const scoutCreated = isScoutCreatedRecord(record);
  const scoutManaged = isScoutManagedRecord(record);

  if (scoutCreated) {
    return {
      scoutCreated,
      scoutManaged,
      label: 'Created in Scout',
      title: `This ${entity} was created in Scout and does not exist in eVet. Nothing will overwrite it.`,
    };
  }
  if (scoutManaged) {
    return {
      scoutCreated,
      scoutManaged,
      label: 'Managed in Scout',
      title: `Edited in Scout after the last eVet sync. The eVet import will not overwrite this ${entity} unless eVet changes more recently.`,
    };
  }
  return {
    scoutCreated,
    scoutManaged,
    label: 'Synced from eVet',
    title: `This ${entity} still matches eVet. Editing it here makes Scout the source of truth.`,
  };
}
