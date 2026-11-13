// src/utils/recordSignOff.ts
// Who may sign and lock a record (EMR-07, owner decision D2, Nov 2, 2026; medical notes changed
// Nov 12, 2026). Mirrors the API's PermissionsService.signOffBlockReason; the server re-checks
// every sign-off.
//   - a full SOAP (`comprehensive`): a licensed veterinarian only
//   - a quick visit: a vet or a licensed technician
//   - a medical note: anyone on staff (any role except a read-only observer)
import type { EffectivePermissions } from '../api/permissions';
import type { SoapEncounterMode } from '../api/visitWorkflow';

export type SignOffPermissions = {
  effective: EffectivePermissions | null;
  can: (permissionKey: string) => boolean;
  isLicensed: boolean;
  licenseType: 'veterinarian' | 'technician' | null;
};

export const SOAP_SIGN_REASON = 'Only a licensed veterinarian can sign and lock a SOAP.';
export const NOTE_SIGN_REASON =
  'Only a licensed veterinarian or licensed technician can sign this record.';
export const MEDICAL_NOTE_SIGN_REASON = 'Only staff of this practice can sign a medical note.';

/** Why this person can't sign a record of this type, or null when they can (or we don't know yet). */
export function signOffBlockReason(
  perms: SignOffPermissions,
  mode: SoapEncounterMode | null | undefined,
): string | null {
  // Not loaded (or failed to load): don't hide the button; the server decides.
  if (!perms.effective) return null;
  if (perms.effective.isPlatformAdmin) return null;
  const canSign = perms.can('record.sign');
  const isVet = perms.isLicensed && perms.licenseType === 'veterinarian';
  if (mode == null || mode === 'comprehensive') {
    return canSign && isVet ? null : SOAP_SIGN_REASON;
  }
  if (mode === 'medical_note') {
    const staff = (perms.effective.roles ?? []).some((role) => role !== 'observer');
    return staff ? null : MEDICAL_NOTE_SIGN_REASON;
  }
  return canSign ? null : NOTE_SIGN_REASON;
}

/** The first reason any of these records can't be signed by this person, or null. */
export function signOffBlockReasonForAll(
  perms: SignOffPermissions,
  modes: Array<SoapEncounterMode | null | undefined>,
): string | null {
  for (const mode of modes) {
    const reason = signOffBlockReason(perms, mode);
    if (reason) return reason;
  }
  return null;
}
