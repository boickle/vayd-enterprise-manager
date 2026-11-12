/**
 * Match a doctor's display name ("Dr. Hailey Lloyd D.V.M.", "Hailey Lloyd") to a provider
 * record. Appointment requests store a pet's primary doctor by name only.
 */
type ProviderLike = {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

const TITLE_OR_CREDENTIAL =
  /^(dr|doctor|dvm|vmd|d\.v\.m|v\.m\.d|bvsc|mrcvs|cvt|lvt|rvt|ms|phd|dacvim|dabvp)\.?$/i;

/** Lower-case name words without titles, credentials or punctuation. */
export function normalizeDoctorName(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/[,()]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w && !TITLE_OR_CREDENTIAL.test(w))
    .join(' ')
    .replace(/\./g, '')
    .toLowerCase();
}

export function findProviderByDisplayName<T extends ProviderLike>(
  providers: readonly T[],
  displayName: string
): T | undefined {
  const target = normalizeDoctorName(displayName);
  if (!target) return undefined;
  const fullName = (p: T) =>
    normalizeDoctorName([p.firstName, p.lastName].filter(Boolean).join(' '));
  return (
    providers.find((p) => fullName(p) === target) ??
    providers.find((p) => normalizeDoctorName(p.name) === target)
  );
}
