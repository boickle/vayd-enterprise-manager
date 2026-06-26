import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchClientByIdStaff, type ClientSearchRow } from '../api/clientsStaff';
import { searchPimsClientsAndPatients, type PimsPatientSearchHit } from '../api/pimsSearch';
import {
  extractClientAlertsFromPayload,
  extractPatientsFromClientPayload,
} from '../pages/SchedulerBookModal';
import {
  addressMatchAllowsLink,
  clientSearchRowHomeAddress,
  compareVisitAddressToClientHome,
  visitAddressMatchLabel,
} from '../utils/visitAddressMatch';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function clientRowId(c: ClientSearchRow): string | null {
  const id = c.id;
  if (id == null || id === 'undefined' || String(id).trim() === '') return null;
  return String(id);
}

function clientDisplayName(c: ClientSearchRow): string {
  const fn = pickStr(c.firstName) ?? '';
  const ln = pickStr(c.lastName) ?? '';
  const both = [fn, ln].filter(Boolean).join(' ');
  if (both) return both;
  const id = clientRowId(c);
  return id ? `Client #${id}` : 'Client';
}

function clientAddressDisplay(c: ClientSearchRow): string | null {
  const r = c as Record<string, unknown>;
  return pickStr(r.formattedAddress) ?? clientSearchRowHomeAddress(c);
}

export type EditVisitLinkSelection = {
  clientId: string;
  clientLabel: string;
  clientHomeAddress: string | null;
  patientId: string | null;
  patientLabel: string | null;
  /** Link client without matching home; leave alternate routing address unchanged. */
  keepAlternateAddress?: boolean;
};

type LinkClientPetRow = {
  id: string | number;
  name: string;
  alerts?: string | null;
  isActive?: boolean;
  isDeleted?: boolean;
};

type Props = {
  practiceId: number;
  visitAddress: string | null;
  requiresPatient: boolean;
  hideVisitAddress?: boolean;
  /** Visit has an alternate routing address — show keep-alt checkbox. */
  hasAlternateAddress?: boolean;
  /** Parent-owned selection — survives edit modal remount during preview. */
  persistedSelection?: EditVisitLinkSelection | null;
  /** Prefer this pet when the client's patient list loads (online request pet name). */
  preferredPatientName?: string | null;
  onSelectionChange: (selection: EditVisitLinkSelection | null) => void;
};

export function EditVisitLinkClientPanel({
  practiceId,
  visitAddress,
  requiresPatient,
  hideVisitAddress = false,
  hasAlternateAddress = false,
  persistedSelection = null,
  preferredPatientName = null,
  onSelectionChange,
}: Props) {
  const [combinedQuery, setCombinedQuery] = useState('');
  const [combinedClientResults, setCombinedClientResults] = useState<ClientSearchRow[]>([]);
  const [combinedPatientResults, setCombinedPatientResults] = useState<PimsPatientSearchHit[]>([]);
  const [combinedSearching, setCombinedSearching] = useState(false);
  const [combinedSearchDone, setCombinedSearchDone] = useState(false);
  const [showCombinedDd, setShowCombinedDd] = useState(false);
  const combinedDdRef = useRef<HTMLDivElement>(null);
  const latestCombinedQ = useRef('');

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClientLabel, setSelectedClientLabel] = useState('');
  const [selectedClientHome, setSelectedClientHome] = useState<string | null>(null);
  const [selectedClientAlerts, setSelectedClientAlerts] = useState<string | null>(null);
  const [clientPets, setClientPets] = useState<LinkClientPetRow[]>([]);
  const [loadingClientPets, setLoadingClientPets] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPatientLabel, setSelectedPatientLabel] = useState('');
  const [keepAlternateAddress, setKeepAlternateAddress] = useState(false);

  const trimmedVisitAddress = visitAddress?.trim() || null;
  const hydratedSelectionKeyRef = useRef<string | null>(null);
  const clientPetsFetchGenRef = useRef(0);
  const loadedPetsForClientRef = useRef<string | null>(null);

  const applyClientPayload = useCallback((payload: unknown, clientId: string) => {
    if (payload && typeof payload === 'object') {
      const row = payload as ClientSearchRow;
      setSelectedClientLabel(clientDisplayName(row));
      const fromPayload = clientSearchRowHomeAddress(row);
      if (fromPayload) setSelectedClientHome(fromPayload);
    }
    setClientPets(extractPatientsFromClientPayload(payload));
    setSelectedClientAlerts(extractClientAlertsFromPayload(payload));
    loadedPetsForClientRef.current = clientId;
  }, []);

  const fetchClientPetsById = useCallback(
    async (clientId: string) => {
      const gen = ++clientPetsFetchGenRef.current;
      setLoadingClientPets(true);
      try {
        const payload = await fetchClientByIdStaff(clientId);
        if (clientPetsFetchGenRef.current !== gen) return;
        applyClientPayload(payload, clientId);
      } catch {
        if (clientPetsFetchGenRef.current !== gen) return;
        setClientPets([]);
        setSelectedClientAlerts(null);
        loadedPetsForClientRef.current = null;
      } finally {
        if (clientPetsFetchGenRef.current === gen) {
          setLoadingClientPets(false);
        }
      }
    },
    [applyClientPayload],
  );

  useEffect(() => {
    setKeepAlternateAddress(false);
  }, [trimmedVisitAddress]);

  useEffect(() => {
    if (!persistedSelection?.clientId?.trim()) return;
    const clientId = persistedSelection.clientId.trim();
    const hydrateKey = [
      clientId,
      persistedSelection.patientId ?? '',
      persistedSelection.keepAlternateAddress ? '1' : '0',
    ].join(':');
    if (hydratedSelectionKeyRef.current === hydrateKey) {
      setLoadingClientPets(false);
      return;
    }

    const prevClientId = hydratedSelectionKeyRef.current?.split(':')[0] ?? null;
    hydratedSelectionKeyRef.current = hydrateKey;

    setSelectedClientId(clientId);
    setSelectedClientLabel(persistedSelection.clientLabel);
    setSelectedClientHome(persistedSelection.clientHomeAddress);
    setSelectedPatientId(persistedSelection.patientId);
    setSelectedPatientLabel(persistedSelection.patientLabel ?? '');
    setKeepAlternateAddress(Boolean(persistedSelection.keepAlternateAddress));

    if (loadedPetsForClientRef.current === clientId) {
      setLoadingClientPets(false);
      return;
    }

    if (prevClientId === clientId) {
      return;
    }

    void fetchClientPetsById(clientId);
  }, [persistedSelection, fetchClientPetsById]);

  useEffect(() => {
    const q = combinedQuery.trim();
    latestCombinedQ.current = q;
    if (!q) {
      setCombinedClientResults([]);
      setCombinedPatientResults([]);
      setCombinedSearchDone(false);
      setShowCombinedDd(false);
      return;
    }
    const t = window.setTimeout(async () => {
      setCombinedSearching(true);
      setCombinedSearchDone(false);
      try {
        const { clients, patients } = await searchPimsClientsAndPatients(q, {
          practiceId,
          activeOnly: false,
        });
        if (latestCombinedQ.current === q) {
          setCombinedClientResults(clients.filter((c) => clientRowId(c) != null));
          setCombinedPatientResults(patients);
          setCombinedSearchDone(true);
          setShowCombinedDd(true);
        }
      } catch {
        if (latestCombinedQ.current === q) {
          setCombinedClientResults([]);
          setCombinedPatientResults([]);
          setCombinedSearchDone(true);
          setShowCombinedDd(true);
        }
      } finally {
        setCombinedSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [combinedQuery, practiceId]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (combinedDdRef.current && !combinedDdRef.current.contains(t)) setShowCombinedDd(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const loadClientDetails = useCallback(async (c: ClientSearchRow, homeOverride?: string | null) => {
    const id = clientRowId(c);
    if (!id) return;
    loadedPetsForClientRef.current = null;
    setSelectedClientId(id);
    setSelectedClientLabel(clientDisplayName(c));
    setSelectedClientHome(homeOverride ?? clientAddressDisplay(c));
    setCombinedQuery('');
    setCombinedClientResults([]);
    setCombinedPatientResults([]);
    setShowCombinedDd(false);
    setSelectedPatientId(null);
    setSelectedPatientLabel('');
    setKeepAlternateAddress(false);
    setClientPets([]);
    setSelectedClientAlerts(null);
    await fetchClientPetsById(id);
  }, [fetchClientPetsById]);

  const pickPatientFromSearch = useCallback(
    (p: PimsPatientSearchHit) => {
      setCombinedQuery('');
      setCombinedClientResults([]);
      setCombinedPatientResults([]);
      setShowCombinedDd(false);
      if (p.clientId != null) {
        const patientId = String(p.id);
        const patientLabel = p.name;
        void (async () => {
          await loadClientDetails(
            {
              id: p.clientId as string | number,
              firstName: undefined,
              lastName: undefined,
            },
            null
          );
          setSelectedClientLabel(p.clientLabel ?? `Client #${p.clientId}`);
          setSelectedPatientId(patientId);
          setSelectedPatientLabel(patientLabel);
        })();
      }
    },
    [loadClientDetails]
  );

  const clearSelectedClient = useCallback(() => {
    hydratedSelectionKeyRef.current = null;
    loadedPetsForClientRef.current = null;
    clientPetsFetchGenRef.current += 1;
    setLoadingClientPets(false);
    setSelectedClientId(null);
    setSelectedClientLabel('');
    setSelectedClientHome(null);
    setSelectedClientAlerts(null);
    setClientPets([]);
    setSelectedPatientId(null);
    setSelectedPatientLabel('');
    setKeepAlternateAddress(false);
    onSelectionChange(null);
  }, [onSelectionChange]);

  const selectedMatchQuality = useMemo(() => {
    if (!selectedClientId || !trimmedVisitAddress) return null;
    return compareVisitAddressToClientHome(trimmedVisitAddress, selectedClientHome);
  }, [selectedClientId, trimmedVisitAddress, selectedClientHome]);

  const pushSelection = useCallback(
    (overrides?: {
      keepAlternateAddress?: boolean;
      patientId?: string | null;
      patientLabel?: string | null;
    }) => {
      if (!selectedClientId) return;
      const keepAlt = overrides?.keepAlternateAddress ?? keepAlternateAddress;
      const patientId =
        overrides?.patientId !== undefined ? overrides.patientId : selectedPatientId;
      const patientLabel =
        overrides?.patientLabel !== undefined ? overrides.patientLabel : selectedPatientLabel;
      onSelectionChange({
        clientId: selectedClientId,
        clientLabel: selectedClientLabel,
        clientHomeAddress: selectedClientHome,
        patientId,
        patientLabel,
        ...(keepAlt ? { keepAlternateAddress: true as const } : {}),
      });
    },
    [
      selectedClientId,
      selectedClientLabel,
      selectedClientHome,
      selectedPatientId,
      selectedPatientLabel,
      keepAlternateAddress,
      onSelectionChange,
    ],
  );

  useEffect(() => {
    pushSelection();
  }, [pushSelection]);

  useEffect(() => {
    const preferred = preferredPatientName?.trim();
    if (!preferred || !selectedClientId || selectedPatientId) return;
    const target = preferred.toLowerCase();
    const match = clientPets.find((p) => {
      if (p.isDeleted === true || p.isActive === false) return false;
      return p.name.trim().toLowerCase() === target;
    });
    if (!match) return;
    const id = String(match.id);
    setSelectedPatientId(id);
    setSelectedPatientLabel(match.name);
    pushSelection({ patientId: id, patientLabel: match.name });
  }, [preferredPatientName, selectedClientId, selectedPatientId, clientPets, pushSelection]);

  const activePetChoices = useMemo(
    () =>
      clientPets.filter((p) => {
        if (p.isDeleted === true) return false;
        if (p.isActive === false) return false;
        return true;
      }),
    [clientPets]
  );

  const matchMismatch =
    Boolean(trimmedVisitAddress && selectedClientId) &&
    selectedMatchQuality != null &&
    !addressMatchAllowsLink(selectedMatchQuality) &&
    !keepAlternateAddress;

  return (
    <div className="scheduler-edit-link-client" role="region" aria-label="Link client to visit">
      <div className="scheduler-edit-link-client-head">
        <h3 className="scheduler-edit-link-client-title">Link client to this visit</h3>
        <p className="scheduler-edit-hint scheduler-edit-link-client-lead">
          {trimmedVisitAddress
            ? 'Search for the client, then confirm their home address matches the visit address below.'
            : 'Search for a client by name, pet name, or phone.'}
        </p>
      </div>

      {trimmedVisitAddress && !hideVisitAddress ? (
        <div className="scheduler-edit-link-client-visit-address" role="status">
          <span className="scheduler-edit-link-client-visit-label">Visit address</span>
          <span>{trimmedVisitAddress}</span>
        </div>
      ) : null}

      {hasAlternateAddress &&
      !(selectedMatchQuality && addressMatchAllowsLink(selectedMatchQuality) && !keepAlternateAddress) ? (
        <label className="scheduler-edit-link-client-keep-alt">
          <input
            type="checkbox"
            checked={keepAlternateAddress}
            onChange={(e) => {
              const next = e.target.checked;
              setKeepAlternateAddress(next);
              pushSelection({ keepAlternateAddress: next });
            }}
          />
          <span>
            Keep as alternate address, but link this client
          </span>
        </label>
      ) : null}

      <label className="scheduler-edit-field scheduler-edit-field--full">
        <span>Search client or patient</span>
        <div ref={combinedDdRef} className="scheduler-edit-link-client-search-wrap">
          <input
            value={combinedQuery}
            onChange={(e) => setCombinedQuery(e.target.value)}
            onFocus={() =>
              (combinedClientResults.length > 0 || combinedPatientResults.length > 0) &&
              setShowCombinedDd(true)
            }
            placeholder="Client name, pet name, or phone…"
            autoComplete="off"
          />
          {combinedSearching ? <div className="scheduler-edit-hint">Searching…</div> : null}
          {showCombinedDd && combinedSearchDone ? (
            combinedClientResults.length > 0 || combinedPatientResults.length > 0 ? (
            <ul className="scheduler-book-dropdown scheduler-edit-link-client-dropdown">
              {combinedClientResults.length > 0 ? (
                <>
                  <li className="scheduler-book-dropdown-section">Clients</li>
                  {combinedClientResults.map((c) => {
                    const id = clientRowId(c);
                    if (!id) return null;
                    return (
                      <li key={`link-client-${id}`}>
                        <button
                          type="button"
                          className="scheduler-book-dd-item"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            void loadClientDetails(c);
                          }}
                        >
                          <span className="scheduler-book-dd-primary">{clientDisplayName(c)}</span>
                          <span className="scheduler-book-dd-secondary">
                            {clientAddressDisplay(c) ?? 'Client'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </>
              ) : null}
              {combinedPatientResults.length > 0 ? (
                <>
                  <li className="scheduler-book-dropdown-section">Patients</li>
                  {combinedPatientResults.map((p) => (
                    <li key={`link-patient-${String(p.id)}`}>
                      <button
                        type="button"
                        className="scheduler-book-dd-item"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickPatientFromSearch(p);
                        }}
                      >
                        <span className="scheduler-book-dd-primary">{p.name}</span>
                        <span className="scheduler-book-dd-secondary">
                          {p.clientLabel ??
                            (p.clientId != null ? `Client #${p.clientId}` : 'No client on file')}
                        </span>
                      </button>
                    </li>
                  ))}
                </>
              ) : null}
            </ul>
            ) : (
              <p className="scheduler-edit-hint scheduler-edit-link-client-no-results">No results</p>
            )
          ) : null}
        </div>
      </label>

      {selectedClientId ? (
        <div className="scheduler-edit-link-client-selected">
          <div className="scheduler-edit-link-client-selected-head">
            <div>
              <span className="scheduler-edit-link-client-selected-name">{selectedClientLabel}</span>
              {selectedClientHome ? (
                <span className="scheduler-edit-link-client-selected-address">{selectedClientHome}</span>
              ) : null}
            </div>
            <button type="button" className="scheduler-edit-link-client-clear" onClick={clearSelectedClient}>
              Clear
            </button>
          </div>
          {selectedClientAlerts?.trim() ? (
            <p className="scheduler-edit-hint scheduler-edit-link-client-alerts" role="alert">
              Client alerts: {selectedClientAlerts}
            </p>
          ) : null}
          {matchMismatch ? (
            <p className="scheduler-edit-error scheduler-edit-link-client-match-error" role="alert">
              This client&apos;s home address does not match the visit address. Choose a client at the same
              location, or check &ldquo;Keep as alternate address, but link this client&rdquo; above.
            </p>
          ) : keepAlternateAddress &&
            selectedMatchQuality != null &&
            !addressMatchAllowsLink(selectedMatchQuality) ? (
            <p className="scheduler-edit-hint scheduler-edit-link-client-match-ok" role="status">
              Home address differs — alternate address will stay on this visit. Ready to link on Save.
            </p>
          ) : selectedMatchQuality && addressMatchAllowsLink(selectedMatchQuality) ? (
            <p className="scheduler-edit-hint scheduler-edit-link-client-match-ok" role="status">
              {visitAddressMatchLabel(selectedMatchQuality)} — ready to link on Save.
              {hasAlternateAddress && !keepAlternateAddress
                ? ' Alternate address will be removed; the visit will use this client\'s home.'
                : ''}
            </p>
          ) : trimmedVisitAddress ? (
            <p className="scheduler-edit-hint" role="status">
              Confirm the client&apos;s home address matches the visit address before saving.
            </p>
          ) : null}

          {requiresPatient ? (
            loadingClientPets ? (
              <p className="scheduler-edit-hint">Loading patients…</p>
            ) : activePetChoices.length > 0 ? (
              <label className="scheduler-edit-field scheduler-edit-field--full">
                <span>Patient *</span>
                <select
                  value={selectedPatientId ?? ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) {
                      setSelectedPatientId(null);
                      setSelectedPatientLabel('');
                      pushSelection({ patientId: null, patientLabel: null });
                      return;
                    }
                    const pet = activePetChoices.find((p) => String(p.id) === id);
                    const label = pet?.name ?? 'Patient';
                    setSelectedPatientId(id);
                    setSelectedPatientLabel(label);
                    pushSelection({ patientId: id, patientLabel: label });
                  }}
                >
                  <option value="">—</option>
                  {activePetChoices.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="scheduler-edit-hint">No active patients on file for this client.</p>
            )
          ) : activePetChoices.length > 0 ? (
            <label className="scheduler-edit-field scheduler-edit-field--full">
              <span>Patient (optional)</span>
              <select
                value={selectedPatientId ?? ''}
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) {
                    setSelectedPatientId(null);
                    setSelectedPatientLabel('');
                    pushSelection({ patientId: null, patientLabel: null });
                    return;
                  }
                  const pet = activePetChoices.find((p) => String(p.id) === id);
                  const label = pet?.name ?? 'Patient';
                  setSelectedPatientId(id);
                  setSelectedPatientLabel(label);
                  pushSelection({ patientId: id, patientLabel: label });
                }}
              >
                <option value="">—</option>
                {activePetChoices.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
