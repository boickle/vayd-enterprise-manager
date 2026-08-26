import { useEffect, useMemo, useState } from 'react';
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

export function taskLinkLabelKey(entityType: string, entityId: number): string {
  return `${entityType}:${entityId}`;
}

export function fallbackTaskLinkLabel(entityType: string, entityId: number): string {
  const t = entityType.replace(/_/g, ' ');
  return `${t} #${entityId}`;
}

export async function resolveTaskLinkLabelMap(links: TaskLinkRow[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const patientIds = new Set<number>();
  const clientIds = new Set<number>();

  for (const l of links) {
    if (l.entityType === 'patient') patientIds.add(l.entityId);
    else if (l.entityType === 'client') clientIds.add(l.entityId);
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

/** Fetches display names for patient/client task links (deduped by entity id). */
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
