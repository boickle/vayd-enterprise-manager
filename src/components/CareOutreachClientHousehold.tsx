import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import {
  extractActivePatientsFromClientStaffRecord,
  loadRoutingPatientHoverSummary,
  type RoutingPatientHoverSummary,
} from '../utils/routingPatientHoverData';
import { evetPatientLink } from '../utils/evet';
import { PatientChartSummaryPanel } from './PatientChartSummaryPanel';
import { CareOutreachPetDetailsButton, PatientMembershipHeart } from './CareOutreachPetDetailsButton';
import './CareOutreachHousehold.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type CareOutreachHouseholdPet = {
  id: string;
  patientId: number;
  name: string;
  pimsId: string | null;
  isMember: boolean;
  membershipName: string | null;
  summary: RoutingPatientHoverSummary | null;
  summaryError: string | null;
};

type HouseholdState = {
  loading: boolean;
  error: string | null;
  pets: CareOutreachHouseholdPet[];
  /** True after the user opened "Other household pets" and a load was attempted. */
  loaded: boolean;
};

type HouseholdContextValue = HouseholdState & {
  ensureLoaded: () => void;
};

const EMPTY: HouseholdState = { loading: false, error: null, pets: [], loaded: false };

const noopEnsureLoaded = () => {};

const CareOutreachHouseholdContext = createContext<HouseholdContextValue>({
  ...EMPTY,
  ensureLoaded: noopEnsureLoaded,
});

const cache = new Map<string, HouseholdState>();

export function clearCareOutreachHouseholdCache(): void {
  cache.clear();
}

function pickPimsId(raw: Record<string, unknown>): string | null {
  const v = raw.pimsId ?? raw.pims_id;
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return s || null;
}

function extractHouseholdPets(raw: unknown): Omit<CareOutreachHouseholdPet, 'summary' | 'summaryError'>[] {
  const rows = extractActivePatientsFromClientStaffRecord(raw);
  if (!raw || typeof raw !== 'object') {
    return rows.map((r) => ({
      id: r.id,
      patientId: Number(r.id),
      name: r.name,
      pimsId: null,
      isMember: Boolean(r.isMember),
      membershipName: r.membershipName ?? null,
    }));
  }

  const list =
    (raw as Record<string, unknown>).patients ??
    (raw as Record<string, unknown>).patientList ??
    (raw as Record<string, unknown>).pets;
  const pimsById = new Map<string, string | null>();
  if (Array.isArray(list)) {
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const idRaw = o.id ?? o.patientId;
      if (idRaw == null) continue;
      pimsById.set(String(idRaw), pickPimsId(o));
    }
  }

  return rows.map((r) => ({
    id: r.id,
    patientId: Number(r.id),
    name: r.name,
    pimsId: pimsById.get(r.id) ?? null,
    isMember: Boolean(r.isMember),
    membershipName: r.membershipName ?? null,
  }));
}

async function loadHouseholdState(
  clientId: number,
  practiceTz: string,
  outreachPatientIds: readonly number[]
): Promise<HouseholdState> {
  const cacheKey = String(clientId);
  const cached = cache.get(cacheKey);
  if (cached?.loaded && !cached.loading) return cached;

  try {
    const raw = await fetchClientByIdStaff(clientId);
    const basePets = extractHouseholdPets(raw);
    const outreachSet = new Set(outreachPatientIds.map(Number));
    const pets = await Promise.all(
      basePets.map(async (pet) => {
        if (outreachSet.has(pet.patientId)) {
          return { ...pet, summary: null, summaryError: null };
        }
        try {
          const summary = await loadRoutingPatientHoverSummary(pet.id, PRACTICE_ID, practiceTz);
          return { ...pet, summary, summaryError: null };
        } catch {
          return {
            ...pet,
            summary: null,
            summaryError: 'Could not load patient chart',
          };
        }
      })
    );
    const next: HouseholdState = { loading: false, error: null, pets, loaded: true };
    cache.set(cacheKey, next);
    return next;
  } catch {
    const next: HouseholdState = {
      loading: false,
      error: 'Could not load household pets',
      pets: [],
      loaded: true,
    };
    cache.set(cacheKey, next);
    return next;
  }
}

export function CareOutreachHouseholdProvider({
  clientId,
  practiceTz,
  outreachPatientIds,
  children,
}: {
  clientId: number | null;
  practiceTz: string;
  outreachPatientIds: readonly number[];
  children: ReactNode;
}) {
  const loadStartedRef = useRef(false);
  const outreachKey = useMemo(
    () => outreachPatientIds.slice().sort((a, b) => a - b).join(','),
    [outreachPatientIds]
  );

  const [state, setState] = useState<HouseholdState>(() => {
    if (clientId == null) return EMPTY;
    return cache.get(String(clientId)) ?? EMPTY;
  });

  useEffect(() => {
    loadStartedRef.current = false;
    if (clientId == null) {
      setState(EMPTY);
      return;
    }
    const cached = cache.get(String(clientId));
    setState(cached ?? EMPTY);
  }, [clientId, outreachKey]);

  const ensureLoaded = useCallback(() => {
    if (clientId == null) return;
    const cacheKey = String(clientId);
    const cached = cache.get(cacheKey);
    if (cached?.loaded && !cached.loading) {
      setState(cached);
      return;
    }
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    setState({ loading: true, error: null, pets: [], loaded: true });
    void loadHouseholdState(clientId, practiceTz, outreachPatientIds).then((next) => {
      setState(next);
    });
  }, [clientId, practiceTz, outreachPatientIds]);

  const contextValue = useMemo<HouseholdContextValue>(
    () => ({ ...state, ensureLoaded }),
    [state, ensureLoaded]
  );

  return (
    <CareOutreachHouseholdContext.Provider value={contextValue}>
      {children}
    </CareOutreachHouseholdContext.Provider>
  );
}

function useCareOutreachHousehold(): HouseholdContextValue {
  return useContext(CareOutreachHouseholdContext);
}

function EvetPatientName({
  name,
  pimsId,
}: {
  name: string;
  pimsId: string | null;
}) {
  if (pimsId) {
    return (
      <a href={evetPatientLink(pimsId)} target="_blank" rel="noreferrer" className="care-outreach-household-pet-name">
        {name}
      </a>
    );
  }
  return <span className="care-outreach-household-pet-name">{name}</span>;
}

export function CareOutreachOtherHouseholdPets({
  outreachPatientIds,
  selectedPatientIds,
  onToggleIncludeInBook,
  practiceTz,
}: {
  outreachPatientIds: readonly number[];
  selectedPatientIds: ReadonlySet<number>;
  onToggleIncludeInBook: (patientId: number, patientName: string, included: boolean) => void;
  practiceTz: string;
}) {
  const { loading, error, pets, loaded, ensureLoaded } = useCareOutreachHousehold();
  const outreachSet = useMemo(() => new Set(outreachPatientIds.map(Number)), [outreachPatientIds]);

  const otherPets = useMemo(
    () => pets.filter((p) => !outreachSet.has(p.patientId)),
    [pets, outreachSet]
  );

  if (loaded && !loading && (error || otherPets.length === 0)) return null;

  return (
    <details
      className="care-outreach-household-details"
      onToggle={(e) => {
        if (e.currentTarget.open) ensureLoaded();
      }}
    >
      <summary className="care-outreach-household-details__summary">
        Other household pets
        {loaded && otherPets.length > 0 ? ` (${otherPets.length})` : ''}
      </summary>
      <div className="care-outreach-household-details__body">
        {loading ? (
          <p className="settings-muted care-outreach-household-loading" style={{ margin: 0, fontSize: 13 }}>
            Loading other household pets…
          </p>
        ) : error ? (
          <p className="settings-muted" style={{ margin: 0, fontSize: 13 }}>
            {error}
          </p>
        ) : (
          otherPets.map((pet) => (
            <article key={pet.id} className="care-outreach-household-pet-card">
              <header className="care-outreach-household-pet-card__head">
                <label className="care-outreach-household-pet-card__include">
                  <input
                    type="checkbox"
                    checked={selectedPatientIds.has(pet.patientId)}
                    onChange={(e) =>
                      onToggleIncludeInBook(pet.patientId, pet.name, e.target.checked)
                    }
                  />
                  <span className="care-outreach-household-pet-card__include-label">Include in book</span>
                </label>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <EvetPatientName name={pet.name} pimsId={pet.pimsId} />
                  {pet.isMember ? (
                    <PatientMembershipHeart membershipName={pet.membershipName} />
                  ) : null}
                </span>
                <CareOutreachPetDetailsButton
                  patientId={pet.patientId}
                  patientName={pet.name}
                  practiceTz={practiceTz}
                  isMember={pet.isMember}
                  membershipName={pet.membershipName}
                  outreachReminders={[]}
                />
              </header>
              {pet.summaryError ? (
                <p className="settings-muted" style={{ margin: 0, fontSize: 13 }}>
                  {pet.summaryError}
                </p>
              ) : (
                <PatientChartSummaryPanel
                  patientName={pet.name}
                  summary={pet.summary}
                  loading={loading && !pet.summary}
                  isMember={pet.isMember}
                  membershipName={pet.membershipName}
                  showHeader={false}
                  showAlerts={false}
                  className="care-outreach-household-pet-card__summary"
                />
              )}
            </article>
          ))
        )}
      </div>
    </details>
  );
}
