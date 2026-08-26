import type { SendClientSmsPayload } from '../api/clientSms';
import { phonesMatchForQuo } from './quoContact';

export type OnMyWaySmsFromLineInput = {
  primaryProviderId?: number;
  /** Visit assignee Quo/OpenPhone line when known. */
  quoFromLine?: string | null;
  /** Employee contact phone1 — backend On My Way send-from when set. */
  employeePhone1?: string | null;
  /** Practice main line (backup when the assignee has no dedicated OpenPhone line). */
  practiceMainPhone?: string | null;
  /** Scheduling reminders OpenPhone line — must not be used as On My Way backup. */
  remindersFrom?: string | null;
};

export type OnMyWaySmsFromLineResult = {
  /** Fields to merge into `sendClientSms` (excluding message/source). */
  payload: Pick<SendClientSmsPayload, 'primaryProviderId' | 'from'>;
  /** Display label for the line that will send (when known). */
  fromLineLabel: string | null;
  /** True when falling back to the practice main line instead of a provider line. */
  usedPracticeBackup: boolean;
};

function trimPhone(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  return s || null;
}

/**
 * Resolve On My Way SMS send-from routing.
 *
 * Prefer the visit assignee's Quo/phone1 line via `primaryProviderId`. When that
 * provider has no dedicated line (common for Tech Team), use the practice main
 * phone as `from` — never the reminders OpenPhone line.
 */
export function resolveOnMyWaySmsFromLine(
  input: OnMyWaySmsFromLineInput
): OnMyWaySmsFromLineResult {
  const primaryProviderId =
    input.primaryProviderId != null && Number.isFinite(input.primaryProviderId)
      ? input.primaryProviderId
      : undefined;
  const quoFromLine = trimPhone(input.quoFromLine);
  const employeePhone1 = trimPhone(input.employeePhone1);
  const practiceMainPhone = trimPhone(input.practiceMainPhone);
  const remindersFrom = trimPhone(input.remindersFrom);

  const employeePhoneIsReminders =
    Boolean(employeePhone1) &&
    Boolean(remindersFrom) &&
    phonesMatchForQuo(employeePhone1, remindersFrom);

  const hasProviderSendLine =
    Boolean(quoFromLine) || (Boolean(employeePhone1) && !employeePhoneIsReminders);

  if (hasProviderSendLine && primaryProviderId != null) {
    return {
      payload: { primaryProviderId },
      fromLineLabel: quoFromLine ?? employeePhone1,
      usedPracticeBackup: false,
    };
  }

  if (practiceMainPhone) {
    return {
      payload: { from: practiceMainPhone },
      fromLineLabel: practiceMainPhone,
      usedPracticeBackup: true,
    };
  }

  // Last resort: keep prior behavior so send still attempts when practice phone is unknown.
  if (primaryProviderId != null) {
    return {
      payload: { primaryProviderId },
      fromLineLabel: quoFromLine ?? employeePhone1,
      usedPracticeBackup: false,
    };
  }

  return {
    payload: {},
    fromLineLabel: null,
    usedPracticeBackup: false,
  };
}
