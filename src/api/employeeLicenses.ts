import { http } from './http';

/** State veterinary licenses only: DEA numbers stay in Vet Snap (owner, Nov 12, 2026). */
export type EmployeeLicenseKind = 'veterinary';

export type EmployeeLicense = {
  employeeId: number;
  kind: EmployeeLicenseKind;
  /** Two-letter state, e.g. ME. */
  state: string;
  number: string;
};

export type PracticeLicenses = {
  /** The practice's own state: its license prints on certificates and Rx labels. */
  practiceState: string;
  licenses: EmployeeLicense[];
};

let cache: Promise<PracticeLicenses> | null = null;

/** Every staff license in the login's practice (cached for the session; saving clears it). */
export function loadPracticeLicenses(force = false): Promise<PracticeLicenses> {
  if (!cache || force) {
    cache = http
      .get<PracticeLicenses>('/employee-licenses')
      .then((r) => ({ practiceState: r.data?.practiceState || 'ME', licenses: r.data?.licenses ?? [] }))
      .catch((err) => {
        cache = null;
        throw err;
      });
  }
  return cache;
}

export async function saveEmployeeLicenses(
  employeeId: number,
  practiceId: number,
  licenses: { state: string; number: string }[],
): Promise<PracticeLicenses> {
  const { data } = await http.put<PracticeLicenses>(`/employee-licenses/${employeeId}`, {
    practiceId,
    licenses: licenses.map((l) => ({ kind: 'veterinary', state: l.state, number: l.number })),
  });
  cache = null;
  return data;
}

/** A doctor's license number in one state (the practice's by default); blank when not on file. */
export function doctorLicenseNumber(
  all: PracticeLicenses,
  employeeId: number | null | undefined,
  state?: string | null,
): string {
  if (employeeId == null || !Number.isFinite(Number(employeeId))) return '';
  const st = (state || all.practiceState || 'ME').toUpperCase();
  return (
    all.licenses.find((l) => l.employeeId === Number(employeeId) && l.kind === 'veterinary' && l.state === st)
      ?.number ?? ''
  );
}
