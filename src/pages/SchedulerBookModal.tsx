// Book appointment from scheduler (double-click slot) — POST /appointments
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import {
  createAppointment,
  patchAppointment,
  putAppointmentAlternateAddress,
} from '../api/appointments';
import type { RoutingCalendarPreviewPayloadV1 } from '../utils/routingCalendarPreviewStorage';
import { submitRoutingAcceptedFeedbackFromPreview } from '../utils/routingBookFeedback';
import { searchClientsStaff, fetchClientByIdStaff, type ClientSearchRow } from '../api/clientsStaff';
import { searchPatients } from '../api/patients';
import type { Provider } from '../api/employee';
import type { AppointmentType } from '../api/appointmentSettings';
import type { RescheduleVisitPatch } from '../utils/routingRescheduleIntent';
import { Field } from '../components/Field';
import { BookPatientRemindersLink } from '../components/BookPatientRemindersLink';
import { appendScoutBookedDescription } from '../utils/bookedAppointmentDescription';
import './Scheduler.css';

export type { RescheduleVisitPatch };

type RescheduleVisitEdit = {
  appointmentId: number;
  patientId: string;
  patientName: string;
  appointmentTypeId?: number;
  appointmentTypeLabel: string;
  scheduledTimeLabel: string;
  description: string;
};

type RoutingBookVisitEdit = {
  patientId: string;
  patientName: string;
  selected: boolean;
  appointmentTypeId: string;
  description: string;
};

export type SchedulerBookSlot = {
  start: DateTime;
  end: DateTime;
};

/** Optional prefill when opening from routing / calendar preview (same form as empty-slot book). */
export type SchedulerBookPrefill = {
  /** Omitted when routing by address only — user picks a client in the book dialog. */
  clientId?: string;
  clientLabel?: string;
  /** Routing address for PUT /appointments/:id/alternate-address (overrides client home for routing). */
  routingAlternateAddress?: string;
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
  /** When set with routing preview — PATCH existing visit instead of POST create. */
  rescheduleAppointmentId?: number;
  /** Reschedule all of these visits to the new slot (e.g. household same-day). */
  rescheduleAppointmentIds?: number[];
  /** Per-appointment patient, type, and description when rescheduling (e.g. all pets today). */
  rescheduleVisitPatches?: RescheduleVisitPatch[];
  /** Prefer this patient in the picker (e.g. reschedule). */
  preferredPatientId?: string;
  /** Initial selection when booking from routing preview (e.g. preview chip pets). */
  preferredPatientIds?: string[];
  /** Routing calendar preview — lock slot/provider; multi-pet book at same time. */
  routingPreviewBook?: boolean;
  defaultInstructions?: string;
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
  /** When set, POST /routing/feedback after a successful book/reschedule from routing preview. */
  routingLinkPreview?: RoutingCalendarPreviewPayloadV1 | null;
  onClose: () => void;
  onBooked: (detail?: { routingFeedbackWarning?: string }) => void;
};

type SearchMode = 'client' | 'patient';

type PetRow = {
  id: number | string;
  name: string;
  alerts?: string | null;
  isActive?: boolean;
  isDeleted?: boolean;
};

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
    out.push({
      id,
      name,
      alerts: pickStr(o.alerts),
      isActive: o.isActive === true || o.isActive === 1 ? true : o.isActive === false ? false : undefined,
      isDeleted: o.isDeleted === true || o.isDeleted === 1 ? true : o.isDeleted === false ? false : undefined,
    });
  }
  return out;
}

export function extractClientAlertsFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;
  return pickStr(row.alerts) ?? pickStr(row.clientAlert);
}

function BookClientAlerts({ alerts }: { alerts: string | null | undefined }) {
  const text = alerts?.trim();
  if (!text) return null;
  return (
    <div className="scheduler-modal-client-header-alerts scheduler-book-client-alerts" role="alert">
      <span className="scheduler-modal-client-header-alerts-title">Client alerts</span>
      {text}
    </div>
  );
}

function BookPatientAlerts({ alerts }: { alerts: string | null | undefined }) {
  const text = alerts?.trim();
  if (!text) return null;
  return (
    <div className="scheduler-modal-alerts-box scheduler-book-patient-alerts" role="alert">
      <span className="scheduler-modal-alerts-box-label">Patient alerts</span>
      {text}
    </div>
  );
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
  routingLinkPreview,
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
  const [selectedClientAlerts, setSelectedClientAlerts] = useState<string | null>(null);
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
  const [alternateAddressText, setAlternateAddressText] = useState('');
  const [rescheduleVisitEdits, setRescheduleVisitEdits] = useState<RescheduleVisitEdit[]>([]);
  const [routingBookVisitEdits, setRoutingBookVisitEdits] = useState<RoutingBookVisitEdit[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedType = useMemo(
    () => appointmentTypes.find((t) => String(t.id) === typeId),
    [appointmentTypes, typeId]
  );

  const selectedProvider = useMemo(
    () => providers.find((p) => String(p.id) === providerId),
    [providers, providerId]
  );

  const isRescheduleBook = prefill?.rescheduleAppointmentId != null;

  const isRoutingPreviewBook = Boolean(prefill?.routingPreviewBook && !isRescheduleBook);

  const routingBookHasPrefilledClient = Boolean(prefill?.clientId?.trim());

  const lockedRoutingBookFields = isRescheduleBook || isRoutingPreviewBook;

  const hasLinkedClient = Boolean(selectedClientId?.trim());

  /** Address-only routing: alternate stop overrides client home; hide once a client is linked. */
  const showRoutingAlternateAddress = Boolean(
    isRoutingPreviewBook && prefill?.routingAlternateAddress?.trim() && !hasLinkedClient
  );

  const perVisitReschedule = isRescheduleBook && rescheduleVisitEdits.length > 0;

  const perVisitRoutingBook = isRoutingPreviewBook && routingBookVisitEdits.length > 0;

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
    return clientPets.filter((p) => {
      if (p.isDeleted === true || p.isActive === false) return false;
      return !ex.has(String(p.id));
    });
  }, [clientPets, prefill?.excludePatientIds]);

  const patientAlertsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of clientPets) {
      const alerts = p.alerts?.trim();
      if (alerts) map.set(String(p.id), alerts);
    }
    return map;
  }, [clientPets]);

  const patientAlertsFor = useCallback(
    (patientId: string | null | undefined) => {
      if (!patientId?.trim()) return null;
      return patientAlertsById.get(patientId.trim()) ?? null;
    },
    [patientAlertsById]
  );

  const clientHasNoPetsOnFile =
    hasLinkedClient && !loadingClientPets && petChoices.length === 0;

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
      String(prefill?.rescheduleAppointmentId ?? ''),
      prefill?.preferredPatientId ?? '',
      prefill?.preferredPatientIds?.join(',') ?? '',
      String(prefill?.routingPreviewBook ?? false),
      prefill?.defaultInstructions ?? '',
      prefill?.routingAlternateAddress ?? '',
      JSON.stringify(prefill?.rescheduleVisitPatches ?? []),
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
    prefill?.rescheduleAppointmentId,
    prefill?.preferredPatientId,
    prefill?.preferredPatientIds,
    prefill?.routingPreviewBook,
    prefill?.defaultInstructions,
    prefill?.routingAlternateAddress,
    prefill?.rescheduleVisitPatches,
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
    setSelectedClientAlerts(null);
    setClientPets([]);
    setSelectedPatientId(null);
    setSelectedPatientLabel('');
    const patches = prefill?.rescheduleVisitPatches?.filter(
      (v) => Number.isFinite(Number(v.appointmentId)) && v.patientId?.trim()
    );
    if (patches?.length) {
      setRescheduleVisitEdits(
        patches.map((p) => {
          const tid =
            p.appointmentTypeId != null && Number.isFinite(Number(p.appointmentTypeId))
              ? Number(p.appointmentTypeId)
              : undefined;
          return {
            appointmentId: Number(p.appointmentId),
            patientId: String(p.patientId).trim(),
            patientName: p.patientName?.trim() || `Pet ${p.patientId}`,
            appointmentTypeId: tid,
            appointmentTypeLabel: p.appointmentTypeLabel?.trim() || '—',
            scheduledTimeLabel: p.scheduledTimeLabel?.trim() || '—',
            description: p.description?.trim() ?? '',
          };
        })
      );
      setDescription('');
    } else {
      setRescheduleVisitEdits([]);
      setRoutingBookVisitEdits([]);
      setDescription(prefill?.defaultDescription?.trim() ?? '');
    }
    setInstructions(prefill?.defaultInstructions?.trim() ?? '');
    setAlternateAddressText(prefill?.routingAlternateAddress?.trim() ?? '');
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
  }, [bookSessionKey, providers, appointmentTypes, prefill?.appointmentTypeId, prefill?.defaultDescription, prefill?.defaultInstructions, prefill?.preserveDurationFromSlot, prefill?.providerId, practiceTz]);

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
    const cid = prefill?.clientId?.trim();
    if (!bookSessionKey || !open || !slot || !cid) return;
    let cancelled = false;
    setLoadingClientPets(true);
    (async () => {
      try {
        const payload = await fetchClientByIdStaff(cid);
        if (cancelled) return;
        setSelectedClientId(cid);
        setSelectedClientLabel(prefill?.clientLabel?.trim() || `Client #${cid}`);
        setClientPets(extractPatientsFromClientPayload(payload));
        setSelectedClientAlerts(extractClientAlertsFromPayload(payload));
        setSelectedPatientId(null);
        setSelectedPatientLabel('');
      } catch {
        if (cancelled) return;
        setSelectedClientId(cid);
        setSelectedClientLabel(prefill?.clientLabel?.trim() || `Client #${cid}`);
        setClientPets([]);
        setSelectedClientAlerts(null);
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
    if (!prefill?.preferredPatientId?.trim()) return;
    const want = prefill.preferredPatientId.trim();
    const hit = petChoices.find((p) => String(p.id) === want);
    if (!hit) return;
    setSelectedPatientId(want);
    setSelectedPatientLabel(hit.name);
  }, [prefill?.preferredPatientId, petChoices]);

  useEffect(() => {
    if (!open || !prefill?.routingPreviewBook) {
      setRoutingBookVisitEdits([]);
      return;
    }
    if (petChoices.length === 0) {
      setRoutingBookVisitEdits([]);
      return;
    }
    const defaultType =
      prefill.appointmentTypeId != null &&
      appointmentTypes.some((t) => String(t.id) === String(prefill.appointmentTypeId))
        ? String(prefill.appointmentTypeId)
        : appointmentTypes[0]
          ? String(appointmentTypes[0].id)
          : '';
    const defaultDesc = prefill.defaultDescription?.trim() ?? '';
    const autoSelectOnlyPet = petChoices.length === 1;
    setRoutingBookVisitEdits(
      petChoices.map((p) => ({
        patientId: String(p.id),
        patientName: p.name,
        selected: autoSelectOnlyPet,
        appointmentTypeId: defaultType,
        description: defaultDesc,
      }))
    );
  }, [
    open,
    prefill?.routingPreviewBook,
    prefill?.appointmentTypeId,
    prefill?.defaultDescription,
    petChoices,
    appointmentTypes,
  ]);

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
    setSelectedClientAlerts(null);
    setLoadingClientPets(true);
    try {
      const payload = await fetchClientByIdStaff(id);
      setClientPets(extractPatientsFromClientPayload(payload));
      setSelectedClientAlerts(extractClientAlertsFromPayload(payload));
    } catch {
      setClientPets([]);
      setSelectedClientAlerts(null);
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
        .then((payload) => {
          setClientPets(extractPatientsFromClientPayload(payload));
          setSelectedClientAlerts(extractClientAlertsFromPayload(payload));
        })
        .catch(() => {
          setClientPets([]);
          setSelectedClientAlerts(null);
        })
        .finally(() => setLoadingClientPets(false));
    } else {
      setSelectedClientId(null);
      setSelectedClientLabel('');
      setSelectedClientAlerts(null);
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
    if (perVisitReschedule) {
      if (
        rescheduleVisitEdits.some(
          (v) => v.appointmentTypeId == null || !Number.isFinite(Number(v.appointmentTypeId))
        )
      ) {
        setFormError('One of the visits is missing an appointment type.');
        return;
      }
    } else if (perVisitRoutingBook) {
      const selected = routingBookVisitEdits.filter((v) => v.selected);
      if (selected.length === 0) {
        setFormError('Select at least one patient.');
        return;
      }
      if (selected.some((v) => !v.appointmentTypeId.trim())) {
        setFormError('Select an appointment type for each patient.');
        return;
      }
    } else {
      if (!clientHasNoPetsOnFile && !selectedPatientId) {
        setFormError('Select a patient.');
        return;
      }
      if (!typeId) {
        setFormError('Select an appointment type.');
        return;
      }
    }
    if (!providerId) {
      setFormError('Select a provider.');
      return;
    }
    if (!startLocal?.isValid || !endLocal?.isValid) {
      setFormError('Invalid start time.');
      return;
    }

    setSubmitting(true);
    try {
      const startIso = startLocal.setZone(practiceTz).toUTC().toISO()!;
      const endIso = endLocal.setZone(practiceTz).toUTC().toISO()!;
      const visitPatches =
        prefill?.rescheduleVisitPatches?.filter(
          (v) => Number.isFinite(Number(v.appointmentId)) && v.patientId?.trim()
        ) ?? [];
      const rescheduleIds =
        perVisitReschedule && rescheduleVisitEdits.length > 0
          ? [...new Set(rescheduleVisitEdits.map((v) => v.appointmentId))]
          : visitPatches.length > 0
            ? [...new Set(visitPatches.map((v) => Number(v.appointmentId)))]
            : (
                prefill?.rescheduleAppointmentIds?.length
                  ? prefill.rescheduleAppointmentIds
                  : prefill?.rescheduleAppointmentId != null
                    ? [prefill.rescheduleAppointmentId]
                    : []
              ).filter((id) => Number.isFinite(Number(id)));
      const trimmedAlt = hasLinkedClient ? '' : alternateAddressText.trim();
      if (trimmedAlt.length > 4000) {
        setFormError('Alternate address must be 4000 characters or fewer.');
        setSubmitting(false);
        return;
      }

      async function saveAlternateForAppointment(apptId: number) {
        if (!trimmedAlt) return;
        await putAppointmentAlternateAddress(apptId, { addressText: trimmedAlt });
      }

      const descriptionForNewBook = (raw: string) =>
        appendScoutBookedDescription(raw, practiceTz);

      let savedAppointmentId: number | undefined;
      if (rescheduleIds.length > 0) {
        const patchBody = {
          appointmentStart: startIso,
          appointmentEnd: endIso,
          primaryProviderId: Number(providerId),
          clientId: Number(selectedClientId),
          description: description.trim() || null,
        };
        for (const rescheduleId of rescheduleIds) {
          const edit = perVisitReschedule
            ? rescheduleVisitEdits.find((v) => v.appointmentId === rescheduleId)
            : undefined;
          const visitPatch = visitPatches.find((v) => Number(v.appointmentId) === rescheduleId);
          const patientForPatch = edit?.patientId ?? visitPatch?.patientId ?? selectedPatientId;
          await patchAppointment(rescheduleId, {
            ...patchBody,
            appointmentTypeId: Number(edit?.appointmentTypeId ?? typeId),
            description: (edit?.description ?? description).trim() || null,
            patientId: Number(patientForPatch),
          });
        }
        savedAppointmentId = rescheduleIds[0];
        if (trimmedAlt && savedAppointmentId != null) {
          for (const rescheduleId of rescheduleIds) {
            await saveAlternateForAppointment(rescheduleId);
          }
        }
      } else if (perVisitRoutingBook) {
        const selected = routingBookVisitEdits.filter((v) => v.selected);
        for (const visit of selected) {
          const created = await createAppointment({
            practiceId,
            primaryProviderId: Number(providerId),
            clientId: Number(selectedClientId),
            patientId: Number(visit.patientId),
            appointmentTypeId: Number(visit.appointmentTypeId),
            appointmentStart: startIso,
            appointmentEnd: endIso,
            description: descriptionForNewBook(visit.description) || undefined,
          });
          const idRaw = created?.id;
          if (idRaw != null && Number.isFinite(Number(idRaw))) {
            const apptId = Number(idRaw);
            if (savedAppointmentId == null) savedAppointmentId = apptId;
            await saveAlternateForAppointment(apptId);
          }
        }
      } else {
        const created = await createAppointment({
          practiceId,
          primaryProviderId: Number(providerId),
          clientId: Number(selectedClientId),
          ...(selectedPatientId ? { patientId: Number(selectedPatientId) } : {}),
          ...(trimmedAlt ? { alternateAddressText: trimmedAlt } : {}),
          appointmentTypeId: Number(typeId),
          appointmentStart: startIso,
          appointmentEnd: endIso,
          description: descriptionForNewBook(description) || undefined,
          instructions: instructions.trim() || undefined,
        });
        const idRaw = created?.id;
        if (idRaw != null && Number.isFinite(Number(idRaw))) {
          savedAppointmentId = Number(idRaw);
          await saveAlternateForAppointment(savedAppointmentId);
        }
      }

      let routingFeedbackWarning: string | undefined;
      if (routingLinkPreview && savedAppointmentId != null) {
        const fb = await submitRoutingAcceptedFeedbackFromPreview(
          savedAppointmentId,
          routingLinkPreview
        );
        if (!fb.submitted && fb.error) {
          routingFeedbackWarning =
            'Appointment saved, but routing could not be linked to this suggestion. ' + fb.error;
        }
      }

      onBooked(routingFeedbackWarning ? { routingFeedbackWarning } : undefined);
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
  const routingBookSelectedCount = routingBookVisitEdits.filter((v) => v.selected).length;

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
            <h2 id="scheduler-book-title">
              {prefill?.modalTitle?.trim() ||
                (isRescheduleBook
                  ? perVisitReschedule && rescheduleVisitEdits.length > 1
                    ? 'Reschedule appointments'
                    : 'Reschedule appointment'
                  : 'Book appointment')}
            </h2>
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
          {showRoutingAlternateAddress ? (
            <label className="scheduler-book-field scheduler-book-field--full">
              <span className="scheduler-book-field-label">Alternate address (routing)</span>
              <textarea
                className="scheduler-book-textarea"
                rows={2}
                maxLength={4000}
                value={alternateAddressText}
                onChange={(e) => setAlternateAddressText(e.target.value)}
                placeholder="Used for routing and drive time instead of the client's home address."
              />
              <p className="scheduler-book-hint muted">
                Pre-filled from Get Best Route. Overrides the client home address when set.
              </p>
            </label>
          ) : null}

          {prefill?.lockClient || (prefill?.disableClientSearch && routingBookHasPrefilledClient) ? (
            <div className="scheduler-book-selected" style={{ marginBottom: 12 }}>
              <span className="scheduler-book-selected-label">Client</span>
              <span className="scheduler-book-selected-value">
                {selectedClientLabel ||
                  prefill?.clientLabel?.trim() ||
                  (prefill?.clientId ? `Client #${prefill.clientId}` : '…')}
              </span>
              <BookClientAlerts alerts={selectedClientAlerts} />
              {prefill?.coVisitAddPet ? (
                <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                  This adds another appointment at the same time for a different pet. Pets already scheduled in
                  this visit block (same time or back-to-back with this appointment) are not listed below.
                </p>
              ) : prefill?.routingPreviewBook ? (
                <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                  {routingBookHasPrefilledClient
                    ? 'Choose one or more patients for this slot. Each patient gets their own appointment at the same time with its own type and description.'
                    : 'Optionally search for a client below, then choose patients. The alternate address above is used for routing regardless of client home address.'}
                </p>
              ) : prefill?.lockClient ? (
                <p className="scheduler-book-hint muted" style={{ marginTop: 6, marginBottom: 0 }}>
                  Select which patient is being booked for this visit.
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
                  <BookClientAlerts alerts={selectedClientAlerts} />
                </div>
              ) : null}
            </>
          )}

          {!perVisitReschedule && !perVisitRoutingBook ? (
          <Field label="Patient">
            {isRescheduleBook ? (
              <>
                <div className="scheduler-book-selected scheduler-book-patient-name-row">
                  <span className="scheduler-book-selected-value">
                    {selectedPatientLabel || '…'}
                  </span>
                  {selectedPatientId ? (
                    <BookPatientRemindersLink
                      patientId={selectedPatientId}
                      patientName={selectedPatientLabel || ''}
                    />
                  ) : null}
                </div>
                <BookPatientAlerts alerts={patientAlertsFor(selectedPatientId)} />
              </>
            ) : loadingClientPets ? (
              <div className="scheduler-book-hint">Loading patients…</div>
            ) : petChoices.length > 0 ? (
              <>
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
                {selectedPatientId ? (
                  <>
                    <div className="scheduler-book-patient-reminders-below">
                      <BookPatientRemindersLink
                        patientId={selectedPatientId}
                        patientName={selectedPatientLabel || ''}
                      />
                    </div>
                    <BookPatientAlerts alerts={patientAlertsFor(selectedPatientId)} />
                  </>
                ) : null}
              </>
            ) : selectedPatientId ? (
              <>
                <div className="scheduler-book-selected scheduler-book-patient-name-row">
                  <span className="scheduler-book-selected-value">{selectedPatientLabel}</span>
                  <BookPatientRemindersLink
                    patientId={selectedPatientId}
                    patientName={selectedPatientLabel || ''}
                  />
                </div>
                <BookPatientAlerts alerts={patientAlertsFor(selectedPatientId)} />
              </>
            ) : selectedClientId && clientPets.length > 0 ? (
              <div className="scheduler-book-hint muted">
                Every pet on file for this client is already in this visit block on the schedule.
              </div>
            ) : clientHasNoPetsOnFile ? (
              <div className="scheduler-book-hint muted">
                No patients on file for this client. You can book without selecting a patient.
              </div>
            ) : (
              <div className="scheduler-book-hint muted">
                {selectedClientId
                  ? 'No patients found for this client. Try patient search or update the client record.'
                  : 'Select a client or search for a patient first.'}
              </div>
            )}
          </Field>
          ) : null}

          {lockedRoutingBookFields ? (
            <>
              <div className="scheduler-book-row2">
                <Field label="Provider">
                  <div className="scheduler-book-selected">
                    <span className="scheduler-book-selected-value">
                      {selectedProvider?.name ?? '…'}
                    </span>
                  </div>
                </Field>
                {isRescheduleBook && !perVisitReschedule ? (
                  <Field label="Appointment type">
                    <div className="scheduler-book-selected">
                      <span className="scheduler-book-selected-value">
                        {selectedType?.name || selectedType?.prettyName || '…'}
                      </span>
                    </div>
                  </Field>
                ) : null}
              </div>
              <div className="scheduler-book-row2">
                <Field label="Date">
                  <div className="scheduler-book-selected">
                    <span className="scheduler-book-selected-value">
                      {startLocal.setZone(practiceTz).toFormat('MM/dd/yyyy')}
                    </span>
                  </div>
                </Field>
                <Field label="Start time">
                  <div className="scheduler-book-selected">
                    <span className="scheduler-book-selected-value">
                      {startLocal.toFormat('h:mm a')}
                    </span>
                  </div>
                </Field>
                <Field label="Duration">
                  <div className="scheduler-book-selected">
                    <span className="scheduler-book-selected-value">{durationMin} min</span>
                  </div>
                </Field>
              </div>
              {perVisitReschedule ? (
                <div className="scheduler-book-reschedule-visits">
                  {rescheduleVisitEdits.map((visit, idx) => (
                    <div
                      key={`${visit.appointmentId}-${visit.patientId}`}
                      className="scheduler-book-reschedule-visit"
                    >
                      <div className="scheduler-book-reschedule-visit-meta">
                        <div className="scheduler-book-patient-name-row">
                          <span className="scheduler-book-reschedule-visit-name">
                            {visit.patientName}
                          </span>
                          <BookPatientRemindersLink
                            patientId={visit.patientId}
                            patientName={visit.patientName}
                          />
                        </div>
                        <span className="scheduler-book-reschedule-visit-was muted">
                          Was {visit.scheduledTimeLabel}
                        </span>
                        <span className="scheduler-book-reschedule-visit-type muted">
                          {visit.appointmentTypeLabel}
                        </span>
                      </div>
                      <BookPatientAlerts alerts={patientAlertsFor(visit.patientId)} />
                      <label className="scheduler-book-reschedule-visit-desc">
                        <span className="scheduler-book-reschedule-visit-desc-label muted">
                          Description
                        </span>
                        <textarea
                          className="scheduler-book-textarea scheduler-book-textarea--compact"
                          value={visit.description}
                          onChange={(e) => {
                            const next = e.target.value;
                            setRescheduleVisitEdits((rows) =>
                              rows.map((row, i) =>
                                i === idx ? { ...row, description: next } : row
                              )
                            );
                          }}
                          rows={3}
                          placeholder="Notes for this visit…"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              ) : null}
              {perVisitRoutingBook ? (
                <div className="scheduler-book-reschedule-visits">
                  {routingBookVisitEdits.map((visit, idx) => (
                    <div key={visit.patientId} className="scheduler-book-reschedule-visit">
                      <div className="scheduler-book-routing-patient-head">
                        <label className="scheduler-book-routing-patient-check">
                          <input
                            type="checkbox"
                            checked={visit.selected}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setRoutingBookVisitEdits((rows) =>
                                rows.map((row, i) =>
                                  i === idx ? { ...row, selected: checked } : row
                                )
                              );
                            }}
                          />
                          <span className="scheduler-book-reschedule-visit-name">
                            {visit.patientName}
                          </span>
                        </label>
                        <BookPatientRemindersLink
                          patientId={visit.patientId}
                          patientName={visit.patientName}
                        />
                      </div>
                      <BookPatientAlerts alerts={patientAlertsFor(visit.patientId)} />
                      <Field label="Appointment type">
                        <select
                          className="scheduler-book-input"
                          value={visit.appointmentTypeId}
                          onChange={(e) => {
                            const next = e.target.value;
                            setRoutingBookVisitEdits((rows) =>
                              rows.map((row, i) =>
                                i === idx ? { ...row, appointmentTypeId: next } : row
                              )
                            );
                          }}
                          required={visit.selected}
                          disabled={!visit.selected}
                        >
                          <option value="">Select…</option>
                          {appointmentTypes.map((t) => (
                            <option key={t.id} value={String(t.id)}>
                              {t.name || t.prettyName}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <label className="scheduler-book-reschedule-visit-desc">
                        <span className="scheduler-book-reschedule-visit-desc-label muted">
                          Description (optional)
                        </span>
                        <textarea
                          className="scheduler-book-textarea scheduler-book-textarea--compact"
                          value={visit.description}
                          onChange={(e) => {
                            const next = e.target.value;
                            setRoutingBookVisitEdits((rows) =>
                              rows.map((row, i) =>
                                i === idx ? { ...row, description: next } : row
                              )
                            );
                          }}
                          rows={2}
                          placeholder="Notes for this visit…"
                          disabled={!visit.selected}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              ) : isRoutingPreviewBook ? (
                <div className="scheduler-book-hint muted">
                  {!selectedClientId
                    ? 'Search for a client above to choose which patients to book.'
                    : loadingClientPets
                      ? 'Loading patients…'
                      : clientHasNoPetsOnFile
                        ? 'No patients on file for this client — you can book without a patient.'
                        : clientPets.length > 0
                          ? 'Every pet on file for this client is already scheduled in this time slot.'
                          : 'No patients on file for this client.'}
                </div>
              ) : null}
            </>
          ) : (
            <>
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
                        {t.name || t.prettyName}
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
            </>
          )}

          {!perVisitReschedule && !perVisitRoutingBook ? (
            <Field label="Description (optional)">
              <textarea
                className="scheduler-book-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Reason for visit, internal notes…"
              />
            </Field>
          ) : null}

          {formError ? <div className="scheduler-book-error">{formError}</div> : null}

          <div className="scheduler-book-actions">
            <button type="button" className="scheduler-book-btn secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="scheduler-book-btn primary" disabled={submitting}>
              {submitting
                ? isRescheduleBook
                  ? 'Saving…'
                  : 'Booking…'
                : isRescheduleBook
                  ? 'Reschedule appointment'
                  : isRoutingPreviewBook && routingBookSelectedCount > 1
                    ? `Book ${routingBookSelectedCount} appointments`
                    : 'Book appointment'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
