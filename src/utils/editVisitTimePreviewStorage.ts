/**
 * Session payload while edit-visit placement preview is on the practice calendar
 * (appointment type or time adjustment). Read by schedule preview guards.
 */
import type { EditVisitTimePreview } from './editVisitTimePreview';

export const EDIT_VISIT_TIME_PREVIEW_STORAGE_KEY = 'vayd:edit-visit-time-preview';

export const EDIT_VISIT_TIME_PREVIEW_UPDATED_EVENT = 'vayd:edit-visit-time-preview-updated';

export type EditVisitTimePreviewPayloadV1 = EditVisitTimePreview & { version: 1 };

export function readEditVisitTimePreview(): EditVisitTimePreview | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(EDIT_VISIT_TIME_PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as EditVisitTimePreviewPayloadV1;
    if (p?.version !== 1 || p.appointmentId == null || !p.appointmentStart || !p.appointmentEnd) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function writeEditVisitTimePreview(preview: EditVisitTimePreview): void {
  if (typeof sessionStorage === 'undefined') return;
  const payload: EditVisitTimePreviewPayloadV1 = { version: 1, ...preview };
  sessionStorage.setItem(EDIT_VISIT_TIME_PREVIEW_STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new Event(EDIT_VISIT_TIME_PREVIEW_UPDATED_EVENT));
}

export function clearEditVisitTimePreview(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(EDIT_VISIT_TIME_PREVIEW_STORAGE_KEY);
  window.dispatchEvent(new Event(EDIT_VISIT_TIME_PREVIEW_UPDATED_EVENT));
}
