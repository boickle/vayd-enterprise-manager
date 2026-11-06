import { apiErrorMessage } from '../api/http';
import { patchReminder } from '../api/careOutreach';
import {
  markPatientInactivationRestored,
  restoreMembershipAfterInactivation,
  type InactivationItem,
  type InactivationItemKind,
} from '../api/patientInactivation';
import { updatePatientPrescription } from '../api/visitWorkflow';

/** Kinds Scout can switch back on. The rest are listed for staff to redo by hand. */
export const RESTORABLE_KINDS: readonly InactivationItemKind[] = [
  'membership',
  'reminder',
  'prescription',
];

export function inactivationItemKey(item: Pick<InactivationItem, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`;
}

export function isRestorable(item: InactivationItem): boolean {
  return RESTORABLE_KINDS.includes(item.kind);
}

export type InactivationRestoreResult = {
  restored: InactivationItem[];
  errors: string[];
  notes: string[];
};

function formatDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export async function restoreInactivatedItems(
  items: readonly InactivationItem[]
): Promise<InactivationRestoreResult> {
  const restored: InactivationItem[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  for (const item of items) {
    try {
      if (item.kind === 'membership') {
        const result = await restoreMembershipAfterInactivation(item.id);
        if (result.billingRestarted && result.firstChargeDate) {
          notes.push(`${item.label}: billing restarts ${formatDay(result.firstChargeDate)}.`);
        } else if (!result.billingRestarted) {
          notes.push(`${item.label}: restored, but it had no Stripe billing to restart.`);
        }
      } else if (item.kind === 'reminder') {
        await patchReminder(item.id, { isHidden: false });
      } else if (item.kind === 'prescription') {
        await updatePatientPrescription(item.id, { discontinued: false });
      } else {
        continue;
      }
      restored.push(item);
    } catch (err) {
      errors.push(apiErrorMessage(err) || `Could not restore ${item.label}`);
    }
  }
  return { restored, errors, notes };
}

export async function closeInactivationRecord(
  recordId: number,
  restored: readonly InactivationItem[]
): Promise<void> {
  await markPatientInactivationRestored(recordId, [...restored]);
}
