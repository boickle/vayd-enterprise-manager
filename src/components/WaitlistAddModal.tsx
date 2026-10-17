import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchAllAppointmentTypes, type AppointmentType } from '../api/appointmentSettings';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { fetchClientByIdStaff, searchClientsStaff, type ClientSearchRow } from '../api/clientsStaff';
import { searchPatientsStaff, type PatientSearchRow } from '../api/patients';
import { extractActivePatientsFromClientStaffRecord } from '../utils/routingPatientHoverData';
import {
  createWaitlistEntry,
  patchWaitlistEntry,
  waitlistConflictExistingId,
  type WaitlistEntry,
  type WaitlistPreferredWindow,
} from '../api/waitlist';
import { waitlistClientDisplayName } from '../utils/waitlistMatch';
import { clientsForPatientSearchRow, primaryClientLabelForPatientRow } from '../utils/pimsPatientSearchRow';
import { WAITLIST_WINDOW_OPTIONS } from '../utils/waitlistMatch';
import type { WaitlistAddPrefill } from '../utils/waitlistAddPrefillFromAppointment';
import { currentPracticeId } from '../utils/practiceIdFromToken';

const PRACTICE_ID = currentPracticeId();

type Props = {
  practiceId?: number;
  onClose: () => void;
  onCreated: (entry: WaitlistEntry) => void;
  /** When set (e.g. schedule right-click), skip search and prefill client / pets / type / doctor. */
  prefill?: WaitlistAddPrefill | null;
  /** Existing waiting row. Client stays fixed; pets, type, doctor, window, and notes can change. */
  editing?: WaitlistEntry | null;
  onUpdated?: (entry: WaitlistEntry) => void;
};

type PetPick = { id: number; name: string };

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function clientLabel(c: ClientSearchRow): string {
  const name = [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ').trim();
  return name || `Client #${c.id}`;
}

function patientName(row: PatientSearchRow): string {
  const r = row as Record<string, unknown>;
  const joined = [pickStr(row.firstName), pickStr(row.lastName)].filter(Boolean).join(' ').trim();
  return (pickStr(row.name) ?? pickStr(r.patientName) ?? joined) || 'Patient';
}

function errMsg(e: unknown, fallback: string): string {
  const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const m = ax?.response?.data?.message;
  if (Array.isArray(m)) return m.join(', ');
  if (typeof m === 'string' && m.trim()) return m;
  if (ax?.message) return ax.message;
  return fallback;
}

export function WaitlistAddModal({
  practiceId = PRACTICE_ID,
  onClose,
  onCreated,
  prefill = null,
  editing = null,
  onUpdated,
}: Props) {
  const editingClientLabel = editing ? waitlistClientDisplayName(editing) : '';
  const [query, setQuery] = useState(editing ? editingClientLabel : (prefill?.clientLabel ?? ''));
  const [searching, setSearching] = useState(false);
  const [clientHits, setClientHits] = useState<ClientSearchRow[]>([]);
  const [patientHits, setPatientHits] = useState<PatientSearchRow[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const prefillApplied = useRef(false);

  const [selectedClient, setSelectedClient] = useState<{ id: number; label: string } | null>(
    editing
      ? { id: editing.clientId, label: editingClientLabel }
      : prefill
        ? { id: prefill.clientId, label: prefill.clientLabel }
        : null,
  );
  const [pets, setPets] = useState<PetPick[]>([]);
  const [selectedPetIds, setSelectedPetIds] = useState<Set<number>>(new Set());
  const [petsLoading, setPetsLoading] = useState(false);

  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [appointmentTypeId, setAppointmentTypeId] = useState(
    editing?.appointmentTypeId != null
      ? String(editing.appointmentTypeId)
      : prefill?.appointmentTypeId != null
        ? String(prefill.appointmentTypeId)
        : '',
  );
  const [providers, setProviders] = useState<Provider[]>([]);
  const [preferredProviderId, setPreferredProviderId] = useState(
    editing?.preferredProviderId != null
      ? String(editing.preferredProviderId)
      : prefill?.preferredProviderId != null
        ? String(prefill.preferredProviderId)
        : '',
  );
  const [preferredWindow, setPreferredWindow] = useState<WaitlistPreferredWindow>(
    editing?.preferredWindow ?? 'asap',
  );
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchAllAppointmentTypes(practiceId, { activeOnly: true })
      .then((rows) =>
        setTypes(
          rows.filter((t) => t.isDeleted !== true && t.isHold !== true && t.excludeFromRouting !== true),
        ),
      )
      .catch(() => setTypes([]));
    void fetchPrimaryProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, [practiceId]);

  useEffect(() => {
    if (!prefill || prefillApplied.current) return;
    prefillApplied.current = true;
    void (async () => {
      setPetsLoading(true);
      try {
        const payload = await fetchClientByIdStaff(prefill.clientId);
        const next: PetPick[] = extractActivePatientsFromClientStaffRecord(payload)
          .map((row) => {
            const id = Number(row.id);
            if (!Number.isFinite(id) || id <= 0) return null;
            return { id, name: row.name?.trim() || `Patient ${id}` };
          })
          .filter((p): p is PetPick => p != null);
        setPets(next);
        if (prefill.patientIds.length > 0) {
          const visitIds = new Set(prefill.patientIds);
          const fromVisit = next.filter((p) => visitIds.has(p.id)).map((p) => p.id);
          setSelectedPetIds(new Set(fromVisit.length > 0 ? fromVisit : next.map((p) => p.id)));
        } else {
          setSelectedPetIds(new Set(next.map((p) => p.id)));
        }
      } catch {
        setPets([]);
        setSelectedPetIds(new Set(prefill.patientIds));
      } finally {
        setPetsLoading(false);
      }
    })();
  }, [prefill]);

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    void (async () => {
      setPetsLoading(true);
      try {
        const payload = await fetchClientByIdStaff(editing.clientId);
        const next: PetPick[] = extractActivePatientsFromClientStaffRecord(payload)
          .map((row) => {
            const id = Number(row.id);
            if (!Number.isFinite(id) || id <= 0) return null;
            return { id, name: row.name?.trim() || `Patient ${id}` };
          })
          .filter((p): p is PetPick => p != null);
        const byId = new Map(next.map((p) => [p.id, p]));
        for (const p of editing.patients ?? []) {
          const id = Number(p.id);
          if (!Number.isFinite(id) || id <= 0 || byId.has(id)) continue;
          byId.set(id, { id, name: p.name?.trim() || `Patient ${id}` });
        }
        if (cancelled) return;
        setPets([...byId.values()]);
        const selected = (editing.patientIds ?? []).filter((id) => byId.has(id));
        setSelectedPetIds(new Set(selected.length > 0 ? selected : [...byId.keys()]));
      } catch {
        if (cancelled) return;
        const fallback = (editing.patients ?? [])
          .map((p) => {
            const id = Number(p.id);
            if (!Number.isFinite(id) || id <= 0) return null;
            return { id, name: p.name?.trim() || `Patient ${id}` };
          })
          .filter((p): p is PetPick => p != null);
        setPets(fallback);
        setSelectedPetIds(
          new Set(
            (editing.patientIds ?? []).length > 0
              ? editing.patientIds
              : fallback.map((p) => p.id),
          ),
        );
      } finally {
        if (!cancelled) setPetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editing]);

  useEffect(() => {
    const q = query.trim();
    if (selectedClient || q.length < 2) {
      setClientHits([]);
      setPatientHits([]);
      if (!selectedClient) setSearching(false);
      return;
    }
    const n = ++seq.current;
    setSearching(true);
    const t = window.setTimeout(() => {
      void Promise.all([
        searchClientsStaff(q).catch(() => [] as ClientSearchRow[]),
        searchPatientsStaff(q, { practiceId, activeOnly: true }).catch(() => [] as PatientSearchRow[]),
      ]).then(([clients, patients]) => {
        if (seq.current !== n) return;
        setClientHits(clients.slice(0, 8));
        setPatientHits(patients.slice(0, 8));
        setSearching(false);
        setOpen(true);
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [query, practiceId, selectedClient]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function loadPetsForClient(clientId: number, preselectId?: number) {
    setPetsLoading(true);
    try {
      const payload = await fetchClientByIdStaff(clientId);
      const next: PetPick[] = extractActivePatientsFromClientStaffRecord(payload)
        .map((row) => {
          const id = Number(row.id);
          if (!Number.isFinite(id) || id <= 0) return null;
          return { id, name: row.name?.trim() || `Patient ${id}` };
        })
        .filter((p): p is PetPick => p != null);
      setPets(next);
      setSelectedPetIds(new Set(preselectId != null ? [preselectId] : next.map((p) => p.id)));
    } catch {
      setPets([]);
      setSelectedPetIds(new Set());
    } finally {
      setPetsLoading(false);
    }
  }

  function pickClient(c: ClientSearchRow) {
    const id = Number(c.id);
    if (!Number.isFinite(id) || id <= 0) return;
    setSelectedClient({ id, label: clientLabel(c) });
    setQuery(clientLabel(c));
    setOpen(false);
    void loadPetsForClient(id);
  }

  function pickPatient(row: PatientSearchRow) {
    const owners = clientsForPatientSearchRow(row);
    const primary = owners[0];
    const clientId = Number(primary?.id ?? row.clientId);
    const patientId = Number((row as Record<string, unknown>).id);
    if (!Number.isFinite(clientId) || clientId <= 0) return;
    const label =
      primaryClientLabelForPatientRow(row) ||
      (primary ? primary.name : `Client #${clientId}`);
    setSelectedClient({ id: clientId, label });
    setQuery(label);
    setOpen(false);
    void loadPetsForClient(clientId, Number.isFinite(patientId) ? patientId : undefined);
  }

  const bookableTypes = useMemo(
    () => types.filter((t) => t.isActive !== false),
    [types],
  );

  async function submit() {
    if (!selectedClient) {
      setError('Search and select a client.');
      return;
    }
    const patientIds = [...selectedPetIds];
    if (patientIds.length === 0) {
      setError('Select at least one pet.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const typeId = appointmentTypeId.trim() ? Number(appointmentTypeId) : undefined;
      const providerId = preferredProviderId.trim() ? Number(preferredProviderId) : undefined;
      const type = bookableTypes.find((t) => Number(t.id) === typeId);
      const resolvedTypeId = typeId != null && Number.isFinite(typeId) ? typeId : null;
      const serviceMinutes =
        type?.defaultDuration != null && Number.isFinite(Number(type.defaultDuration))
          ? Math.max(1, Math.round(Number(type.defaultDuration)))
          : undefined;
      if (editing) {
        const keepExistingMinutes =
          serviceMinutes == null && (editing.appointmentTypeId ?? null) === resolvedTypeId;
        const updated = await patchWaitlistEntry(editing.id, {
          practiceId,
          patientIds,
          appointmentTypeId: resolvedTypeId,
          preferredProviderId: providerId != null && Number.isFinite(providerId) ? providerId : null,
          preferredWindow,
          serviceMinutes: keepExistingMinutes ? (editing.serviceMinutes ?? null) : (serviceMinutes ?? null),
          notes: notes.trim(),
        });
        onUpdated?.(updated);
        return;
      }
      const entry = await createWaitlistEntry({
        practiceId,
        clientId: selectedClient.id,
        patientIds,
        ...(typeId != null && Number.isFinite(typeId) ? { appointmentTypeId: typeId } : {}),
        ...(providerId != null && Number.isFinite(providerId) ? { preferredProviderId: providerId } : {}),
        preferredWindow,
        ...(serviceMinutes != null ? { serviceMinutes } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onCreated(entry);
    } catch (e) {
      const existing = waitlistConflictExistingId(e);
      setError(
        existing
          ? 'This client is already on the waitlist. Open that card to update notes or pets.'
          : errMsg(
            e,
            editing ? 'Could not save waitlist changes.' : 'Could not add to waitlist.',
          ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="waitlist-add-title"
      className="waitlist-modal-backdrop"
      onClick={onClose}
    >
      <div className="waitlist-modal" onClick={(e) => e.stopPropagation()}>
        <h3 id="waitlist-add-title">{editing ? 'Edit waitlist' : 'Add to waitlist'}</h3>
        <p className="settings-muted" style={{ marginTop: 0 }}>
          {editing
            ? 'Update pets, visit type, doctor, and how soon they can come in. The client stays the same.'
            : prefill
              ? 'Client and pets are filled from the schedule visit. Choose how soon they can come in, then save.'
              : 'Use when the schedule is full. CLs can recommend a slot and text the household when a cancellation opens.'}
        </p>

        <label className="waitlist-field">
          <span>{editing ? 'Client' : 'Client or pet'}</span>
          <div ref={wrapRef} style={{ position: 'relative' }}>
            <input
              className="settings-input"
              value={query}
              readOnly={editing != null}
              onChange={(e) => {
                if (editing) return;
                setQuery(e.target.value);
                setSelectedClient(null);
              }}
              onFocus={() => {
                if (clientHits.length || patientHits.length) setOpen(true);
              }}
              placeholder="Search by owner or pet name"
            />
            {open && (clientHits.length > 0 || patientHits.length > 0 || searching) ? (
              <ul className="waitlist-search-menu">
                {searching ? <li className="waitlist-search-hint">Searching…</li> : null}
                {clientHits.map((c) => (
                  <li key={`c-${c.id}`}>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); pickClient(c); }}>
                      {clientLabel(c)}
                      <span className="settings-muted"> Client</span>
                    </button>
                  </li>
                ))}
                {patientHits.map((p) => {
                  const id = String((p as Record<string, unknown>).id ?? '');
                  const owner = primaryClientLabelForPatientRow(p);
                  return (
                    <li key={`p-${id}`}>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); pickPatient(p); }}>
                        {patientName(p)}
                        {owner ? <span className="settings-muted"> — {owner}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </label>

        {selectedClient ? (
          <div className="waitlist-field">
            <span>Pets to get in</span>
            {petsLoading ? (
              <p className="settings-muted">Loading pets…</p>
            ) : pets.length === 0 ? (
              <p className="settings-muted">No active pets found for this client.</p>
            ) : (
              <div className="waitlist-pet-picks">
                {pets.map((p) => {
                  const checked = selectedPetIds.has(p.id);
                  return (
                    <label key={p.id} className="waitlist-pet-pick">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedPetIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(p.id)) next.delete(p.id);
                            else next.add(p.id);
                            return next;
                          });
                        }}
                      />
                      {p.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        <label className="waitlist-field">
          <span>Visit type</span>
          <select
            className="settings-input"
            value={appointmentTypeId}
            onChange={(e) => setAppointmentTypeId(e.target.value)}
          >
            <option value="">Any / decide when booking</option>
            {editing?.appointmentTypeId != null &&
            !bookableTypes.some((t) => Number(t.id) === Number(editing.appointmentTypeId)) ? (
              <option value={String(editing.appointmentTypeId)}>
                {editing.appointmentTypeName || `Visit type #${editing.appointmentTypeId}`}
              </option>
            ) : null}
            {bookableTypes.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name || t.prettyName}
              </option>
            ))}
          </select>
        </label>

        <label className="waitlist-field">
          <span>Preferred doctor</span>
          <select
            className="settings-input"
            value={preferredProviderId}
            onChange={(e) => setPreferredProviderId(e.target.value)}
          >
            <option value="">Any doctor</option>
            {editing?.preferredProviderId != null &&
            !providers.some((p) => Number(p.id) === Number(editing.preferredProviderId)) ? (
              <option value={String(editing.preferredProviderId)}>
                {editing.preferredProvider?.name ||
                  [editing.preferredProvider?.firstName, editing.preferredProvider?.lastName]
                    .filter(Boolean)
                    .join(' ')
                    .trim() ||
                  `Doctor #${editing.preferredProviderId}`}
              </option>
            ) : null}
            {providers.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="waitlist-field">
          <legend>How soon can they come in?</legend>
          <div className="waitlist-window-picks">
            {WAITLIST_WINDOW_OPTIONS.map((opt) => (
              <label key={opt.value} className="waitlist-window-pick">
                <input
                  type="radio"
                  name="waitlist-window"
                  checked={preferredWindow === opt.value}
                  onChange={() => setPreferredWindow(opt.value)}
                />
                <span>
                  <strong>{opt.label}</strong>
                  <span className="settings-muted"> {opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="waitlist-field">
          <span>Notes</span>
          <textarea
            className="settings-input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Needs a wellness + vaccines, prefers mornings, called 8/26 — schedule full through next week"
          />
        </label>

        {error ? <p className="waitlist-error">{error}</p> : null}

        <div className="waitlist-modal-actions">
          <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save' : 'Add to waitlist'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
