// Book appointment from scheduler (double-click slot) — POST /appointments
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { createAppointment } from '../api/appointments';
import { searchClientsStaff, fetchClientByIdStaff, type ClientSearchRow } from '../api/clientsStaff';
import { searchPatients } from '../api/patients';
import type { Provider } from '../api/employee';
import type { AppointmentType } from '../api/appointmentSettings';
import { Field } from '../components/Field';
import './Scheduler.css';

export type SchedulerBookSlot = {
  start: DateTime;
  end: DateTime;
};

/** Optional prefill when opening from routing / calendar preview (same form as empty-slot book). */
export type SchedulerBookPrefill = {
  clientId: string;
  clientLabel?: string;
  appointmentTypeId?: number;
  /** When true, hide client search — only admins should get false from routing. */
  lockClient?: boolean;
  defaultDescription?: string;
  /** When set, use this provider (internal or PIMS id string) instead of `defaultProviderId` from props. */
  providerId?: string;
  /** Patient ids to omit from the picker (e.g. already booked this client at this time). */
  excludePatientIds?: string[];
  /** Do not replace slot length with the selected appointment type’s default duration. */
  preserveDurationFromSlot?: boolean;
  /** When true, provider dropdown is read-only (same-doctor co-visit). */
  lockProvider?: boolean;
  /** Replaces the default “Book appointment” dialog title. */
  modalTitle?: string;
  /** When true with `lockClient` false, show read-only client (routing: admin cannot search-change client here). */
  disableClientSearch?: boolean;
  /** Employee “add another pet” same-slot flow — copy only. */
  coVisitAddPet?: boolean;
  /** When true, date / start time / duration cannot be changed (same-slot co-visit). */
  lockSlotTimes?: boolean;
};

type Props = {
  open: boolean;
  slot: SchedulerBookSlot | null;
  practiceId: number;
  practiceTz: string;
  appointmentTypes: AppointmentType[];
  providers: Provider[];
  defaultProviderId: string | null;
  prefill?: SchedulerBookPrefill | null;
  onClose: () => void;
  onBooked: () => void;
};

type SearchMode = 'client' | 'patient';

type PetRow = { id: number | string; name: string };

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function extractPatientsFromClientPayload(payload: unknown): PetRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const raw =
    p.patients ??
    p.patientList ??
    p.pets ??
    (Array.isArray(p.patient) ? p.patient : null);
  if (!Array.isArray(raw)) return [];
  const out: PetRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const idRaw = o.id ?? o.patientId;
    if (idRaw == null || (typeof idRaw !== 'string' && typeof idRaw !== 'number')) continue;
    const id = idRaw;
    const joined = [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim();
    const name = pickStr(o.name) ?? (joined || 'Patient');
    out.push({ id, name });
  }
  return out;
}

function clientDisplayName(c: ClientSearchRow): string {
  const fn = pickStr(c.firstName) ?? '';
  const ln = pickStr(c.lastName) ?? '';
  const both = [fn, ln].filter(Boolean).join(' ');
  return both || `Client #${c.id}`;
}

function clientAddressLine(c: ClientSearchRow): string | null {
  const zip = pickStr(c.zip) ?? pickStr(c.zipcode);
  const parts = [pickStr(c.address1), [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', '), zip].filter(
    Boolean
  );
  return parts.length ? parts.join(', ') : null;
}

function apiErr(e: unknown): string {
  const ax = e as {
    response?: { data?: { message?: string | string[] }; status?: number };
    message?: string;
  };
  const m = ax?.response?.data?.message;
  if (Array.isArray(m)) return m.join(', ');
  if (typeof m === 'string' && m.trim()) return m;
  if (ax?.message) return ax.message;
  return 'Request failed';
}

function normalizePatientSearchRow(row: unknown): {
  id: number | string;
  name: string;
  clientId: number | string | null;
  clientLabel: string | null;
} | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Record<string, unknown>;
  const idRaw = o.id ?? o.patientId;
  if (idRaw == null || (typeof idRaw !== 'string' && typeof idRaw !== 'number')) return null;
  const id = idRaw;
  const joined = [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim();
  const name = pickStr(o.name) ?? (joined || 'Patient');
  const client = o.client as Record<string, unknown> | undefined;
  const clientId =
    (o.clientId as number | string | undefined) ??
    (client?.id as number | string | undefined) ??
    null;
  let clientLabel: string | null = null;
  if (client) {
    clientLabel =
      [pickStr(client.firstName), pickStr(client.lastName)].filter(Boolean).join(' ').trim() || null;
  }
  return { id, name, clientId, clientLabel };
}

const DURATION_OPTIONS = [15, 20, 30, 45, 60, 90, 120];

export function SchedulerBookModal({
  open,
  slot,
  practiceId,
  practiceTz,
  appointmentTypes,
  providers,
  defaultProviderId,
  prefill,
  onClose,
  onBooked,
}: Props) {
  const [searchMode, setSearchMode] = useState<SearchMode>('client');

  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<ClientSearchRow[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [showClientDd, setShowClientDd] = useState(false);
  const clientDdRef = useRef<HTMLDivElement>(null);
  const latestClientQ = useRef('');

  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState<
    { id: number | string; name: string; clientId: number | string | null; clientLabel: string | null }[]
  >([]);
  const [patientSearching, setPatientSearching] = useState(false);
  const [showPatientDd, setShowPatientDd] = useState(false);
  const patientDdRef = useRef<HTMLDivElement>(null);
  const latestPatientQ = useRef('');

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClientLabel, setSelectedClientLabel] = useState('');
  const [clientPets, setClientPets] = useState<PetRow[]>([]);
  const [loadingClientPets, setLoadingClientPets] = useState(false);

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPatientLabel, setSelectedPatientLabel] = useState('');

  const [providerId, setProviderId] = useState<string>('');
  const [typeId, setTypeId] = useState<string>('');
  const [startLocal, setStartLocal] = useState<DateTime | null>(null);
  const [durationMin, setDurationMin] = useState(30);

  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedType = useMemo(
    () => appointmentTypes.find((t) => String(t.id) === typeId),
    [appointmentTypes, typeId]
  );

  const endLocal = useMemo(() => {
    if (!startLocal?.isValid) return null;
    return startLocal.plus({ minutes: durationMin });
  }, [startLocal, durationMin]);

  const durationOpts = useMemo(() => {
    const o = [...DURATION_OPTIONS];
    if (!o.includes(durationMin)) o.push(durationMin);
    return [...new Set(o)].sort((a, b) => a - b);
  }, [durationMin]);

  const petChoices = useMemo(() => {
    const ex = new Set((prefill?.excludePatientIds ?? []).map((id) => String(id)));
    return clientPets.filter((p) => !ex.has(String(p.id)));
  }, [clientPets, prefill?.excludePatientIds]);

  const bookSessionKey = useMemo(() => {
    if (!open || !slot) return '';
    return [
      slot.start.toISO() ?? '',
      slot.end.toISO() ?? '',
      practiceTz,
      defaultProviderId ?? '',
      prefill?.clientId ?? '',
      String(prefill?.lockClient ?? false),
      prefill?.defaultDescription ?? '',
      prefill?.providerId ?? '',
      prefill?.excludePatientIds?.join(',') ?? '',
      String(prefill?.preserveDurationFromSlot ?? false),
      String(prefill?.lockProvider ?? false),
      prefill?.modalTitle ?? '',
      String(prefill?.disableClientSearch ?? false),
      String(prefill?.coVisitAddPet ?? false),
      String(prefill?.lockSlotTimes ?? false),
    ].join('\t');
  }, [
    open,
    slot,
    practiceTz,
    defaultProviderId,
    prefill?.clientId,
    prefill?.lockClient,
    prefill?.defaultDescription,
    prefill?.providerId,
    prefill?.excludePatientIds,
    prefill?.preserveDurationFromSlot,
    prefill?.lockProvider,
    prefill?.modalTitle,
    prefill?.disableClientSearch,
    prefill?.coVisitAddPet,
    prefill?.lockSlotTimes,
  ]);

  useEffect(() => {
    if (!bookSessionKey) return;
    setSearchMode('client');
    setClientQuery('');
    setClientResults([]);
    setPatientQuery('');
    setPatientResults([]);
    setSelectedClientId(null);
    setSelectedClientLabel('');
    setClientPets([]);
    setSelectedPatientId(null);
    setSelectedPatientLabel('');
    setDescription(prefill?.defaultDescription?.trim() ?? '');
    setInstructions('');
    setFormError(null);
    setShowClientDd(false);
    setShowPatientDd(false);

    const s = slot!.start.setZone(practiceTz);
    const e = slot!.end.setZone(practiceTz);
    setStartLocal(s);
    const rawMins = Math.max(1, Math.round(e.diff(s, 'minutes').minutes));
    setDurationMin(rawMins);

    const prefProv = prefill?.providerId?.trim();
    const match =
      prefProv && providers.some((p) => String(p.id) === prefProv || (p.pimsId != null && String(p.pimsId) === prefProv))
        ? providers.find((p) => String(p.id) === prefProv || (p.pimsId != null && String(p.pimsId) === prefProv))
        : providers.find(
            (p) =>
              (defaultProviderId && String(p.id) === defaultProviderId) ||
              (defaultProviderId && String(p.pimsId ?? '') === defaultProviderId)
          );
    setProviderId(
      match ? String(match.id) : providers[0] ? String(providers[0].id) : ''
    );

    if (appointmentTypes.length > 0) {
      const preT = prefill?.appointmentTypeId;
      if (preT != null && appointmentTypes.some((t) => String(t.id) === String(preT))) {
        const t = appointmentTypes.find((x) => String(x.id) === String(preT))!;
        setTypeId(String(t.id));
        if (!prefill?.preserveDurationFromSlot && t.defaultDuration && t.defaultDuration > 0) {
          const d = Math.round(t.defaultDuration);
          if (d >= 5) setDurationMin(DURATION_OPTIONS.includes(d) ? d : Math.min(120, Math.max(15, d)));
        }
      } else {
        const firstType = appointmentTypes[0];
        setTypeId(firstType ? String(firstType.id) : '');
        if (!prefill?.preserveDurationFromSlot && firstType?.defaultDuration && firstType.defaultDuration > 0) {
          const d = Math.round(firstType.defaultDuration);
          if (d >= 5) setDurationMin(DURATION_OPTIONS.includes(d) ? d : Math.min(120, Math.max(15, d)));
        }
      }
    } else {
      setTypeId('');
    }

    if (prefill?.preserveDurationFromSlot) {
      setDurationMin(rawMins);
    }
  }, [bookSessionKey, providers, appointmentTypes, prefill?.appointmentTypeId, prefill?.defaultDescription, prefill?.preserveDurationFromSlot, prefill?.providerId, practiceTz]);

  /** When appointment types load after open, set type without wiping the rest of the form. */
  useEffect(() => {
    if (!open || !slot || !appointmentTypes.length) return;
    setTypeId((prev) => {
      const validPrev = prev && appointmentTypes.some((t) => String(t.id) === prev);
      if (validPrev) return prev;
      const preT = prefill?.appointmentTypeId;
      if (preT != null) {
        const tid = String(preT);
        if (appointmentTypes.some((t) => String(t.id) === tid)) return tid;
      }
      return appointmentTypes[0] ? String(appointmentTypes[0].id) : '';
    });
  }, [open, slot, appointmentTypes, prefill?.appointmentTypeId]);

  useEffect(() => {
    if (!bookSessionKey || !open || !slot || !prefill?.clientId) return;
    let cancelled = false;
    setLoadingClientPets(true);
    (async () => {
      try {
        const payload = await fetchClientByIdStaff(prefill.clientId);
        if (cancelled) return;
        setSelectedClientId(String(prefill.clientId));
        setSelectedClientLabel(prefill.clientLabel?.trim() || `Client #${prefill.clientId}`);
        setClientPets(extractPatientsFromClientPayload(payload));
        setSelectedPatientId(null);
        setSelectedPatientLabel('');
      } catch {
        if (cancelled) return;
        setSelectedClientId(String(prefill.clientId));
        setSelectedClientLabel(prefill.clientLabel?.trim() || `Client #${prefill.clientId}`);
        setClientPets([]);
        setSelectedPatientId(null);
        setSelectedPatientLabel('');
      } finally {
        if (!cancelled) setLoadingClientPets(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookSessionKey, open, slot, prefill?.clientId, prefill?.clientLabel]);

  useEffect(() => {
    if (prefill?.preserveDurationFromSlot) return;
    if (!selectedType?.defaultDuration || selectedType.defaultDuration <= 0) return;
    const d = Math.round(selectedType.defaultDuration);
    if (d >= 5) setDurationMin(DURATION_OPTIONS.includes(d) ? d : Math.min(120, Math.max(15, d)));
  }, [selectedType?.id, selectedType?.defaultDuration, prefill?.preserveDurationFromSlot]);

  useEffect(() => {
    const q = clientQuery.trim();
    latestClientQ.current = q;
    if (!q) {
      setClientResults([]);
      setShowClientDd(false);
      return;
    }
    const t = window.setTimeout(async () => {
      setClientSearching(true);
      try {
        const rows = await searchClientsStaff(q);
        if (latestClientQ.current === q) {
          setClientResults(rows);
          setShowClientDd(true);
        }
      } catch {
        if (latestClientQ.current === q) setClientResults([]);
      } finally {
        setClientSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [clientQuery]);

  useEffect(() => {
    const q = patientQuery.trim();
    latestPatientQ.current = q;
    if (!q) {
      setPatientResults([]);
      setShowPatientDd(false);
      return;
    }
    const t = window.setTimeout(async () => {
      setPatientSearching(true);
      try {
        const res = await searchPatients({
          name: q,
          practiceId,
          activeOnly: true,
        });
        const data = res.data as unknown;
        const list = Array.isArray(data)
          ? data
          : Array.isArray((data as { items?: unknown[] })?.items)
            ? (data as { items: unknown[] }).items
            : Array.isArray((data as { patients?: unknown[] })?.patients)
              ? (data as { patients: unknown[] }).patients
              : [];
        const norm = list.map(normalizePatientSearchRow).filter(Boolean) as NonNullable<
          ReturnType<typeof normalizePatientSearchRow>
        >[];
        if (latestPatientQ.current === q) {
          setPatientResults(norm);
          setShowPatientDd(true);
        }
      } catch {
        if (latestPatientQ.current === q) setPatientResults([]);
      } finally {
        setPatientSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [patientQuery, practiceId]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (clientDdRef.current && !clientDdRef.current.contains(t)) setShowClientDd(false);
      if (patientDdRef.current && !patientDdRef.current.contains(t)) setShowPatientDd(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pickClient = useCallback(async (c: ClientSearchRow) => {
    const id = String(c.id);
    setSelectedClientId(id);
    setSelectedClientLabel(clientDisplayName(c));
    setClientQuery('');
    setClientResults([]);
    setShowClientDd(false);
    setSelectedPatientId(null);
    setSelectedPatientLabel('');
    setClientPets([]);
    setLoadingClientPets(true);
    try {
      const payload = await fetchClientByIdStaff(id);
      const pets = extractPatientsFromClientPayload(payload);
      setClientPets(pets);
    } catch {
      setClientPets([]);
    } finally {
      setLoadingClientPets(false);
    }
  }, []);

  const pickPatientFromSearch = useCallback((p: (typeof patientResults)[0]) => {
    setSelectedPatientId(String(p.id));
    setSelectedPatientLabel(p.name);
    setPatientQuery('');
    setPatientResults([]);
    setShowPatientDd(false);
    if (p.clientId != null) {
      setSelectedClientId(String(p.clientId));
      setSelectedClientLabel(p.clientLabel ?? `Client #${p.clientId}`);
      setLoadingClientPets(true);
      fetchClientByIdStaff(p.clientId)
        .then((payload) => setClientPets(extractPatientsFromClientPayload(payload)))
        .catch(() => setClientPets([]))
        .finally(() => setLoadingClientPets(false));
    } else {
      setSelectedClientId(null);
      setSelectedClientLabel('');
      setClientPets([]);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!selectedClientId) {
      setFormError('Select a client (search by client or patient).');
      return;
    }
    if (!selectedPatientId) {
      setFormError('Select a patient.');
      return;
    }
    if (!providerId) {
      setFormError('Select a provider.');
      return;
    }
    if (!typeId) {
      setFormError('Select an appointment type.');
      return;
    }
    if (!startLocal?.isValid || !endLocal?.isValid) {
      setFormError('Invalid start time.');
      return;
    }

    setSubmitting(true);
    try {
      await createAppointment({
        practiceId,
        primaryProviderId: Number(providerId),
        clientId: Number(selectedClientId),
        patientId: Number(selectedPatientId),
        appointmentTypeId: Number(typeId),
        appointmentStart: startLocal.setZone(practiceTz).toUTC().toISO()!,
        appointmentEnd: endLocal.setZone(practiceTz).toUTC().toISO()!,
        description: description.trim() || undefined,
        instructions: instructions.trim() || undefined,
      });
      onBooked();
      onClose();
    } catch (err) {
      setFormError(apiErr(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || !slot || !startLocal) return null;

  const timeInputValue = startLocal.toFormat('HH:mm');
  const dateInputValue = startLocal.toISODate() ?? '';

  return createPortal(
    <div className="scheduler-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="scheduler-book-modal"
        role="dialog"
        aria-modal
        aria-labelledby="scheduler-book-title"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="scheduler-book-modal-header">
          <div>
            <h2 id="scheduler-book-title">{prefill?.modalTitle?.trim() || 'Book appointment'}</h2>
            <p className="scheduler-book-slot-summary">
              {startLocal.setZone(practiceTz).toFormat('EEEE, MMM d, yyyy')} · {startLocal.toFormat('h:mm a')} –{' '}
              {endLocal?.toFormat('h:mm a')}
            </p>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <form className="scheduler-book-form" onSubmit={handleSubmit}>
          {prefill?.lockClient || prefill?.disableClientSearch ? (
            <div className="scheduler-book-selected" style={{ marginBottom: 12 }}>
              <span className="scheduler-book-selected-label">Client</span>
              <span className="scheduler-book-selected-value">
                {selectedClientLabel ||
                  prefill?.clientLabel?.trim() ||
                  (prefill?.clientId ? `Client #${prefill.clientId}` : '…')}
              </span>
              {prefill?.coVisitAddPet ? (
                <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                  This adds another appointment at the same time for a different pet. Pets already on the schedule
                  for this client at this time are not listed below.
                </p>
              ) : prefill?.lockClient ? (
                <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                  Select which patient is being booked for this visit.
                </p>
              ) : prefill?.disableClientSearch ? (
                <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                  Client is set from routing. Go back to routing results to choose a different client.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="scheduler-book-mode-toggle" role="group" aria-label="Search mode">
                <button
                  type="button"
                  className={searchMode === 'client' ? 'active' : ''}
                  onClick={() => setSearchMode('client')}
                >
                  Find by client
                </button>
                <button
                  type="button"
                  className={searchMode === 'patient' ? 'active' : ''}
                  onClick={() => setSearchMode('patient')}
                >
                  Find by patient
                </button>
              </div>

              {searchMode === 'client' ? (
                <Field label="Search client">
                  <div ref={clientDdRef} style={{ position: 'relative' }}>
                    <input
                      className="scheduler-book-input"
                      value={clientQuery}
                      onChange={(e) => setClientQuery(e.target.value)}
                      onFocus={() => clientResults.length > 0 && setShowClientDd(true)}
                      placeholder="Name, phone, or address…"
                      autoComplete="off"
                    />
                    {clientSearching && <div className="scheduler-book-hint">Searching…</div>}
                    {showClientDd && clientResults.length > 0 && (
                      <ul className="scheduler-book-dropdown">
                        {clientResults.map((c) => (
                          <li key={String(c.id)}>
                            <button
                              type="button"
                              className="scheduler-book-dd-item"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                pickClient(c);
                              }}
                            >
                              <span className="scheduler-book-dd-primary">{clientDisplayName(c)}</span>
                              <span className="scheduler-book-dd-secondary">{clientAddressLine(c) ?? '—'}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Field>
              ) : (
                <Field label="Search patient">
                  <div ref={patientDdRef} style={{ position: 'relative' }}>
                    <input
                      className="scheduler-book-input"
                      value={patientQuery}
                      onChange={(e) => setPatientQuery(e.target.value)}
                      onFocus={() => patientResults.length > 0 && setShowPatientDd(true)}
                      placeholder="Pet name…"
                      autoComplete="off"
                    />
                    {patientSearching && <div className="scheduler-book-hint">Searching…</div>}
                    {showPatientDd && patientResults.length > 0 && (
                      <ul className="scheduler-book-dropdown">
                        {patientResults.map((p) => (
                          <li key={String(p.id)}>
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
                                {p.clientLabel ?? (p.clientId != null ? `Client #${p.clientId}` : '—')}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Field>
              )}

              {selectedClientId ? (
                <div className="scheduler-book-selected">
                  <span className="scheduler-book-selected-label">Client</span>
                  <span className="scheduler-book-selected-value">{selectedClientLabel}</span>
                </div>
              ) : null}
            </>
          )}

          <Field label="Patient">
            {loadingClientPets ? (
              <div className="scheduler-book-hint">Loading patients…</div>
            ) : petChoices.length > 0 ? (
              <select
                className="scheduler-book-input"
                value={selectedPatientId ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedPatientId(v || null);
                  const pet = petChoices.find((x) => String(x.id) === v);
                  setSelectedPatientLabel(pet?.name ?? '');
                }}
                required
              >
                <option value="">Select patient…</option>
                {petChoices.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : selectedPatientId ? (
              <div className="scheduler-book-selected">
                <span className="scheduler-book-selected-value">{selectedPatientLabel}</span>
              </div>
            ) : selectedClientId && clientPets.length > 0 ? (
              <div className="scheduler-book-hint muted">
                Every pet on file for this client already has an appointment overlapping this time.
              </div>
            ) : (
              <div className="scheduler-book-hint muted">
                {selectedClientId
                  ? 'No patients found for this client. Try patient search or update the client record.'
                  : 'Select a client or search for a patient first.'}
              </div>
            )}
          </Field>

          <div className="scheduler-book-row2">
            <Field label="Provider">
              <select
                className="scheduler-book-input"
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                disabled={Boolean(prefill?.lockProvider)}
                required
              >
                <option value="">Select…</option>
                {providers.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Appointment type">
              <select
                className="scheduler-book-input"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {appointmentTypes.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.prettyName || t.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="scheduler-book-row2">
            <Field label="Date">
              <input
                type="date"
                className="scheduler-book-input"
                value={dateInputValue}
                onChange={(e) => {
                  const iso = e.target.value;
                  if (!iso) return;
                  setStartLocal((prev) => {
                    if (!prev?.isValid) return prev;
                    const next = DateTime.fromISO(iso, { zone: practiceTz }).set({
                      hour: prev.hour,
                      minute: prev.minute,
                      second: 0,
                      millisecond: 0,
                    });
                    return next.isValid ? next : prev;
                  });
                }}
                disabled={Boolean(prefill?.lockSlotTimes)}
              />
            </Field>
            <Field label="Start time">
              <input
                type="time"
                className="scheduler-book-input"
                value={timeInputValue}
                step={300}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v || !startLocal) return;
                  const [hh, mm] = v.split(':').map((x) => parseInt(x, 10));
                  if (Number.isNaN(hh) || Number.isNaN(mm)) return;
                  setStartLocal(
                    startLocal.set({ hour: hh, minute: mm, second: 0, millisecond: 0 })
                  );
                }}
                disabled={Boolean(prefill?.lockSlotTimes)}
              />
            </Field>
            <Field label="Duration">
              <select
                className="scheduler-book-input"
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                disabled={Boolean(prefill?.lockSlotTimes)}
              >
                {durationOpts.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Description (optional)">
            <textarea
              className="scheduler-book-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Reason for visit, internal notes…"
            />
          </Field>
          <Field label="Instructions (optional)">
            <textarea
              className="scheduler-book-textarea"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              placeholder="Special instructions for the provider…"
            />
          </Field>

          {formError ? <div className="scheduler-book-error">{formError}</div> : null}

          <div className="scheduler-book-actions">
            <button type="button" className="scheduler-book-btn secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="scheduler-book-btn primary" disabled={submitting}>
              {submitting ? 'Booking…' : 'Book appointment'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
