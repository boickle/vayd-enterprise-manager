/** Persist PIMS Clients / Patients list + detail query params across sidebar navigation. */

const K_CLIENTS = 'vayd:pims:clients:v1';
const K_PATIENTS = 'vayd:pims:patients:v1';

export type PimsClientsSession = {
  q: string;
  includeInactive: boolean;
  clientId: string;
};

export type PimsPatientsSession = {
  q: string;
  includeInactive: boolean;
  patientId: string;
};

export function readPimsClientsSession(): PimsClientsSession | null {
  try {
    const raw = sessionStorage.getItem(K_CLIENTS);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<PimsClientsSession>;
    return {
      q: typeof j.q === 'string' ? j.q : '',
      includeInactive: !!j.includeInactive,
      clientId: typeof j.clientId === 'string' ? j.clientId : '',
    };
  } catch {
    return null;
  }
}

export function writePimsClientsSession(s: PimsClientsSession): void {
  try {
    sessionStorage.setItem(K_CLIENTS, JSON.stringify(s));
  } catch {
    /* quota / private mode */
  }
}

export function readPimsPatientsSession(): PimsPatientsSession | null {
  try {
    const raw = sessionStorage.getItem(K_PATIENTS);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<PimsPatientsSession>;
    return {
      q: typeof j.q === 'string' ? j.q : '',
      includeInactive: !!j.includeInactive,
      patientId: typeof j.patientId === 'string' ? j.patientId : '',
    };
  } catch {
    return null;
  }
}

export function writePimsPatientsSession(s: PimsPatientsSession): void {
  try {
    sessionStorage.setItem(K_PATIENTS, JSON.stringify(s));
  } catch {
    /* quota / private mode */
  }
}

/** Merge URL search with saved session when the URL has no PIMS params yet. */
export function initialClientsSearchFromUrlAndSession(): { q: string; includeInactive: boolean } {
  const sp = new URLSearchParams(window.location.search);
  const urlQ = sp.get('q') ?? '';
  const urlClient = sp.get('clientId') ?? '';
  const saved = readPimsClientsSession();
  if (urlQ) {
    return { q: urlQ, includeInactive: saved?.includeInactive ?? false };
  }
  if (urlClient) {
    return { q: saved?.q ?? '', includeInactive: saved?.includeInactive ?? false };
  }
  if (saved) return { q: saved.q, includeInactive: saved.includeInactive };
  return { q: '', includeInactive: false };
}

export function initialPatientsSearchFromUrlAndSession(): { q: string; includeInactive: boolean } {
  const sp = new URLSearchParams(window.location.search);
  const urlQ = sp.get('q') ?? '';
  const urlPat = sp.get('patientId') ?? '';
  const saved = readPimsPatientsSession();
  if (urlQ) {
    return { q: urlQ, includeInactive: saved?.includeInactive ?? false };
  }
  if (urlPat) {
    return { q: saved?.q ?? '', includeInactive: saved?.includeInactive ?? false };
  }
  if (saved) return { q: saved.q, includeInactive: saved.includeInactive };
  return { q: '', includeInactive: false };
}
