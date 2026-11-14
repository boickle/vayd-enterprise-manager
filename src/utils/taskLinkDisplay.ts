import { useEffect, useMemo, useState } from 'react';
import { fetchAppointmentById } from '../api/appointments';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { fetchPatientByIdStaff } from '../api/patients';
import type { TaskLinkRow } from '../api/tasks';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function patientDisplayNameFromPayload(data: unknown): string {
  if (!data || typeof data !== 'object') return 'Patient';
  const p = data as Record<string, unknown>;
  const joined = [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ').trim();
  return (pickStr(p.name) ?? pickStr(p.patientName) ?? joined) || 'Patient';
}

export function clientDisplayNameFromPayload(data: unknown): string {
  if (!data || typeof data !== 'object') return 'Client';
  const c = data as Record<string, unknown>;
  const joined = [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ').trim();
  return joined || pickStr(c.name) || 'Client';
}

const VISIT_REASON_MAX = 40;

/**
 * T-B4: an appointment link reads as the visit, "Visit Nov 11", dated in Eastern (the
 * practice's day, whatever the computer's zone), plus the visit reason when it has one.
 */
export function appointmentLinkLabel(appt: {
  appointmentStart?: string | null;
  description?: string | null;
}): string {
  const start = appt.appointmentStart ? new Date(appt.appointmentStart) : null;
  const day =
    start && !Number.isNaN(start.getTime())
      ? start.toLocaleDateString('en-US', {
          timeZone: 'America/New_York',
          month: 'short',
          day: 'numeric',
        })
      : null;
  const base = day ? `Visit ${day}` : 'Visit';
  const reason = appt.description?.replace(/\s+/g, ' ').trim();
  if (!reason) return base;
  const short =
    reason.length > VISIT_REASON_MAX ? `${reason.slice(0, VISIT_REASON_MAX - 1).trimEnd()}…` : reason;
  return `${base} · ${short}`;
}

export function taskLinkLabelKey(entityType: string, entityId: number): string {
  return `${entityType}:${entityId}`;
}

export function fallbackTaskLinkLabel(entityType: string, entityId: number): string {
  // T-B2: the task screen shows the call itself; the link only needs a plain name.
  if (entityType === 'openphone_call') return 'Phone call';
  if (entityType === 'appointment') return `Visit #${entityId}`;
  const t = entityType.replace(/_/g, ' ');
  return `${t} #${entityId}`;
}

/**
 * True for the stand-ins a link label shows before (or without) the real name: "client #12",
 * "Client". Greeting a family with one of those reads "Hi client,".
 */
export function isPlaceholderClientName(name: string | null | undefined): boolean {
  const t = String(name ?? '').trim();
  return !t || /^client(\s*#?\d+)?$/i.test(t) || /^the owner$/i.test(t);
}

export async function resolveTaskLinkLabelMap(links: TaskLinkRow[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const patientIds = new Set<number>();
  const clientIds = new Set<number>();
  const appointmentIds = new Set<number>();

  for (const l of links) {
    if (l.entityType === 'patient') patientIds.add(l.entityId);
    else if (l.entityType === 'client') clientIds.add(l.entityId);
    else if (l.entityType === 'appointment') appointmentIds.add(l.entityId);
  }

  await Promise.all([
    ...[...patientIds].map(async (id) => {
      const key = taskLinkLabelKey('patient', id);
      try {
        const data = await fetchPatientByIdStaff(id);
        out[key] = patientDisplayNameFromPayload(data);
      } catch {
        out[key] = fallbackTaskLinkLabel('patient', id);
      }
    }),
    ...[...clientIds].map(async (id) => {
      const key = taskLinkLabelKey('client', id);
      try {
        const data = await fetchClientByIdStaff(id);
        out[key] = clientDisplayNameFromPayload(data);
      } catch {
        out[key] = fallbackTaskLinkLabel('client', id);
      }
    }),
    ...[...appointmentIds].map(async (id) => {
      const key = taskLinkLabelKey('appointment', id);
      try {
        const appt = await fetchAppointmentById(id);
        out[key] = appt ? appointmentLinkLabel(appt) : fallbackTaskLinkLabel('appointment', id);
      } catch {
        out[key] = fallbackTaskLinkLabel('appointment', id);
      }
    }),
  ]);

  return out;
}

export function taskLinkDisplayLabel(
  link: TaskLinkRow,
  labels: Record<string, string> | undefined
): string {
  const key = taskLinkLabelKey(link.entityType, link.entityId);
  return labels?.[key] ?? fallbackTaskLinkLabel(link.entityType, link.entityId);
}

function linksResolveKey(links: TaskLinkRow[]): string {
  return links.map((l) => `${l.entityType}:${l.entityId}`).join('|');
}

/** Fetches display names for patient/client/appointment task links (deduped by entity id). */
export function useTaskLinkLabels(links: TaskLinkRow[] | undefined): Record<string, string> {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const key = useMemo(() => linksResolveKey(links ?? []), [links]);

  useEffect(() => {
    if (!links?.length) {
      setLabels({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = await resolveTaskLinkLabelMap(links);
      if (!cancelled) setLabels(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, links]);

  return labels;
}
