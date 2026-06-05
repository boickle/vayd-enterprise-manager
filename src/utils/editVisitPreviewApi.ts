import type { Provider } from '../api/employee';
import type { Appointment } from '../api/roomLoader';
import { extractHttpErrorMessage } from './httpErrorMessage';
import { resolveRescheduleIntentDoctorPimsId } from './routingRescheduleIntent';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Routing `doctorId` (PIMS id) for in-place edit-visit preview APIs. */
export function resolveEditVisitRoutingDoctorId(
  appt: Appointment,
  providers: readonly Provider[],
  calendarProvider?: Provider | null
): string | null {
  const pp = appt.primaryProvider;
  const ppInternal = pp?.id != null ? String(pp.id) : '';
  const calInternal = calendarProvider?.id != null ? String(calendarProvider.id) : '';

  if (calendarProvider && ppInternal && calInternal && ppInternal === calInternal) {
    return pickStr(calendarProvider.pimsId) ?? calInternal;
  }

  if (!pp) {
    return calendarProvider ? pickStr(calendarProvider.pimsId) ?? pickStr(calendarProvider.id) : null;
  }

  const resolved = resolveRescheduleIntentDoctorPimsId(
    {
      primaryDoctorPimsId: pp.pimsId != null ? String(pp.pimsId) : undefined,
      primaryProviderInternalId: ppInternal || undefined,
    },
    providers
  );
  return resolved?.pimsId ?? null;
}

export function isEditVisitPreviewUnavailableError(err: unknown): boolean {
  const ax = err as {
    response?: { status?: number; data?: { message?: string; statusCode?: number } };
  };
  const status = ax.response?.status ?? ax.response?.data?.statusCode;
  const msg = (ax.response?.data?.message ?? '').toLowerCase();
  if (status === 404) return true;
  if (
    status === 400 &&
    (msg.includes('not found on the routable doctor day') ||
      msg.includes('missing coordinates') ||
      msg.includes('non-routable'))
  ) {
    return true;
  }
  return false;
}

export const EDIT_VISIT_PREVIEW_UNAVAILABLE_LINE =
  'Routing score unavailable — this visit is missing address coordinates or is excluded from routing. You can still adjust the time.';

export function editVisitPreviewErrorSummaryLine(err: unknown): string {
  if (isEditVisitPreviewUnavailableError(err)) {
    return EDIT_VISIT_PREVIEW_UNAVAILABLE_LINE;
  }
  return extractHttpErrorMessage(err, 'Could not compare routing scores.');
}
