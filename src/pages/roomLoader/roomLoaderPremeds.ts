// Owner request Oct 31, 2026: when a pet has the pre-meds alert on its chart, the staff Room Loader
// question "Should we ask this client if they need refills of pre-examination medications?"
// defaults to Yes and is highlighted in the chart's pre-meds purple.

type AnyRecord = Record<string, any>;

/** True when the pet's chart has the pre-meds alert, or a visit on this check-in is flagged for pre-meds. */
export function petHasPremedsAlert(
  patientId: number | string | null | undefined,
  data: { patients?: AnyRecord[]; appointments?: AnyRecord[] } | null | undefined,
): boolean {
  if (patientId == null) return false;
  const id = Number(patientId);
  const pet = (data?.patients ?? []).find((p) => Number(p?.id) === id);
  if (pet?.needsPremeds === true) return true;
  return (data?.appointments ?? []).some(
    (a) =>
      Number(a?.patient?.id) === id && (a?.patient?.needsPremeds === true || a?.needsPremeds === true),
  );
}

/** The answer to show: what staff already chose, otherwise Yes when the pet has the pre-meds alert. */
export function defaultPreMedsAsk(saved: boolean | null | undefined, hasAlert: boolean): boolean {
  return typeof saved === 'boolean' ? saved : hasAlert;
}
