/**
 * Doctor-fallback labeling for Get Best Route.
 *
 * When a single-doctor search has no availability, the API may widen to other
 * doctors (vayd-api doctorFallback). Labels must still show when those flags are
 * missing — otherwise cards look like normal same-doctor results.
 */

export type DoctorFallbackMeta = {
  requestedDoctorIds?: string[] | null;
  requestedDoctorHadNoAvailability?: boolean | null;
  fallbackDoctorIds?: string[] | null;
} | null | undefined;

export type DoctorFallbackSlot = {
  doctorPimsId?: string | null;
  doctorId?: string | null;
  doctorName?: string | null;
  isFallbackDoctor?: boolean | null;
};

function normDoctorId(id: string | null | undefined): string {
  return String(id ?? '').trim();
}

/** True when this search was locked to one doctor (not ASAP / Best fit). */
export function isSingleDoctorRoutingSearch(opts: {
  asapAllDoctorSearch?: boolean;
  multiDoctor?: boolean;
  requestedDoctorId?: string | null;
}): boolean {
  if (opts.asapAllDoctorSearch || opts.multiDoctor) return false;
  return Boolean(normDoctorId(opts.requestedDoctorId));
}

/**
 * Slot belongs to someone other than the doctor the booker asked for.
 * Prefer the API flag; otherwise infer from pims/doctor id mismatch.
 */
export function slotIsFallbackDoctor(
  slot: DoctorFallbackSlot | null | undefined,
  requestedDoctorId: string | null | undefined,
  opts?: {
    asapAllDoctorSearch?: boolean;
    multiDoctor?: boolean;
    apiFallback?: DoctorFallbackMeta;
  }
): boolean {
  if (!slot) return false;
  if (slot.isFallbackDoctor === true) return true;

  const requested = normDoctorId(requestedDoctorId);
  if (!requested) return false;
  if (opts?.asapAllDoctorSearch || opts?.multiDoctor) return false;

  const slotId = normDoctorId(slot.doctorPimsId) || normDoctorId(slot.doctorId);
  if (!slotId) return false;
  if (slotId === requested) return false;

  // Widened search: API meta present, or any other-doctor slot on a single-doctor request.
  if (opts?.apiFallback?.requestedDoctorHadNoAvailability === true) return true;
  return true;
}

export type DoctorFallbackNotice = {
  headline: string;
  detail: string;
};

/**
 * Banner above results when the requested doctor had nothing and other doctors
 * were shown instead. Works with API `doctorFallback` or inferred mismatches.
 */
export function buildDoctorFallbackNotice(opts: {
  apiFallback?: DoctorFallbackMeta;
  requestedDoctorId?: string | null;
  requestedDoctorName?: string | null;
  asapAllDoctorSearch?: boolean;
  multiDoctor?: boolean;
  options: DoctorFallbackSlot[];
}): DoctorFallbackNotice | null {
  const {
    apiFallback,
    requestedDoctorId,
    requestedDoctorName,
    asapAllDoctorSearch,
    multiDoctor,
    options,
  } = opts;

  if (!options.length) return null;
  if (!isSingleDoctorRoutingSearch({ asapAllDoctorSearch, multiDoctor, requestedDoctorId })) {
    // ASAP / Best fit already expect multiple doctors — only trust explicit API meta.
    if (!apiFallback?.requestedDoctorHadNoAvailability) return null;
  }

  const fallbackOpts = options.filter((o) =>
    slotIsFallbackDoctor(o, requestedDoctorId, {
      asapAllDoctorSearch,
      multiDoctor,
      apiFallback,
    })
  );

  const apiSaysWidened = apiFallback?.requestedDoctorHadNoAvailability === true;
  if (!apiSaysWidened && fallbackOpts.length === 0) return null;

  // Single-doctor search: if every shown slot is another doctor, treat as widened
  // even when the API omitted doctorFallback metadata.
  const inferredWidened =
    isSingleDoctorRoutingSearch({ asapAllDoctorSearch, multiDoctor, requestedDoctorId }) &&
    fallbackOpts.length === options.length;

  if (!apiSaysWidened && !inferredWidened) return null;

  const labeled = fallbackOpts.length > 0 ? fallbackOpts : options;
  const requestedName = requestedDoctorName?.trim() || 'The requested doctor';
  const otherNames = Array.from(
    new Set(
      labeled
        .map((o) => o.doctorName?.trim())
        .filter((n): n is string => Boolean(n))
    )
  );
  const who =
    otherNames.length === 0
      ? 'other doctors'
      : otherNames.length === 1
        ? otherNames[0]
        : `${otherNames.length} other doctors`;

  return {
    headline: `${requestedName} has no availability for this request`,
    detail: `The ${options.length} slot${
      options.length === 1 ? '' : 's'
    } below belong to ${who}, shown because the original search found nothing.`,
  };
}
