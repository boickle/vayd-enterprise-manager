import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  ClipboardList,
  ClipboardPaste,
  Lock,
  Mail,
  Mic,
  Receipt,
  Sparkles,
  Square,
  User,
} from 'lucide-react';
import './SoapEncounterPage.css';
import './MedicalNoteEncounterPage.css';
import {
  createEncounter,
  getHouseholdRoster,
  getInvoiceByAppointment,
  listOrders,
  type EncounterOrder,
  type HouseholdRosterEntry,
  type SoapEncounter,
  type VisitInvoice,
  VISIT_WORKFLOW_PRACTICE_ID,
} from '../api/visitWorkflow';
import { writeVisitWriteup } from '../api/soapScribe';
import { fetchAppointmentById } from '../api/appointments';
import { fetchEmployee } from '../api/appointmentSettings';
import { fetchPatientProfileForRow } from '../api/patients';
import {
  createScoutChartNote,
  finalizeScoutChartNote,
  listScoutChartNotes,
  updateScoutChartNote,
} from '../api/scoutChart';
import { useAuth } from '../auth/useAuth';
import { useBriefRecorder } from '../hooks/useBriefRecorder';
import VisitCheckoutPanel from '../components/soap/VisitCheckoutPanel';
import ScribeSuggestedPlanItems from '../components/soap/ScribeSuggestedPlanItems';
import PlanOrdersSection from '../components/soap/PlanOrdersSection';
import {
  appointmentReasonFromSentToClient,
  buildSubjectiveTextFromRoomLoaderResponse,
  findSubmittedRoomLoaderForAppointment,
} from '../utils/roomLoaderSubjectiveText';

function patientField(patient: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!patient) return null;
  for (const key of keys) {
    const value = patient[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function personName(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
}

function examDayLabel(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString();
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function asOfDateFromIso(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function appointmentTypeName(appt: unknown): string {
  if (!appt || typeof appt !== 'object') return '';
  const row = appt as Record<string, unknown>;
  const at = row.appointmentType;
  if (typeof at === 'string') return at.trim();
  if (at && typeof at === 'object') {
    const named = at as { prettyName?: unknown; name?: unknown };
    const pretty = typeof named.prettyName === 'string' ? named.prettyName.trim() : '';
    const name = typeof named.name === 'string' ? named.name.trim() : '';
    return pretty || name;
  }
  return typeof row.appointmentTypeName === 'string' ? row.appointmentTypeName.trim() : '';
}

function composeChartBody(history: string, plan: string): string {
  const h = history.trim();
  const p = plan.trim();
  if (!h && !p) return '';
  const parts: string[] = [];
  if (h) parts.push(h.startsWith('History') ? h : `History\n${h}`);
  if (p) parts.push(p.startsWith('Plan') ? p : `Plan\n${p}`);
  return parts.join('\n\n');
}

function parseChartBody(body: string): { history: string; plan: string } {
  const text = body.trim();
  if (!text) return { history: '', plan: '' };
  const split = text.split(/\n(?=Plan\b)/i);
  if (split.length >= 2) {
    return { history: split[0].trim(), plan: split.slice(1).join('\n').trim() };
  }
  return { history: text, plan: '' };
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * One pet's chart note on this visit. A household tech visit (three dogs, one transcript)
 * produces one of these per pet, each filed to its own medical record.
 */
type PetDraft = {
  patientId: number;
  patientName: string;
  history: string;
  plan: string;
  noteId: string | null;
  /** Last body written to the chart note — keeps the autosave from re-saving unchanged text. */
  savedBody: string;
};

type MedNoteTab = 'history' | 'plan' | 'checkout-prep' | 'email';

const MED_NOTE_TABS: {
  id: MedNoteTab;
  label: string;
  short: string;
  icon: typeof ClipboardList;
}[] = [
  { id: 'history', label: 'History', short: 'H', icon: ClipboardList },
  { id: 'plan', label: 'Plan', short: 'P', icon: ClipboardList },
  { id: 'checkout-prep', label: 'Checkout prep', short: '$', icon: Receipt },
  { id: 'email', label: 'Client email', short: '@', icon: Mail },
];

export default function MedicalNoteEncounterPage() {
  const { appointmentId: appointmentIdParam, patientId: patientIdParam } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { employeeId } = useAuth();

  const appointmentId = Number(appointmentIdParam);
  const patientId = Number(patientIdParam);
  const clientIdParam = searchParams.get('clientId');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [encounter, setEncounter] = useState<SoapEncounter | null>(null);
  const [invoice, setInvoice] = useState<VisitInvoice | null>(null);
  const [orders, setOrders] = useState<EncounterOrder[]>([]);
  const [roster, setRoster] = useState<HouseholdRosterEntry[]>([]);
  const [patientName, setPatientName] = useState('');
  const [clientName, setClientName] = useState('');
  const [staffName, setStaffName] = useState('');
  const [visitType, setVisitType] = useState('');
  const [appointmentStart, setAppointmentStart] = useState<string | null>(null);
  const [clientId, setClientId] = useState<number | null>(
    clientIdParam && Number.isFinite(Number(clientIdParam)) ? Number(clientIdParam) : null
  );
  const [roomLoaderHistory, setRoomLoaderHistory] = useState('');
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pets, setPets] = useState<PetDraft[]>([]);
  const [activePetId, setActivePetId] = useState(patientId);
  const [recapSubject, setRecapSubject] = useState('');
  const [recapBody, setRecapBody] = useState('');
  const [writingUp, setWritingUp] = useState(false);
  const [started, setStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wrapping, setWrapping] = useState(false);
  const [copied, setCopied] = useState<'all' | 'recap' | null>(null);
  const [activeTab, setActiveTab] = useState<MedNoteTab>('history');
  const [checkoutPrepPendingCount, setCheckoutPrepPendingCount] = useState(0);

  const petsRef = useRef(pets);
  petsRef.current = pets;

  const activePet = pets.find((p) => p.patientId === activePetId) ?? pets[0] ?? null;
  const history = activePet?.history ?? '';
  const plan = activePet?.plan ?? '';
  const anyWritten = pets.some((p) => composeChartBody(p.history, p.plan).trim());
  /** Only worth naming the pet on the section headings when the visit had more than one. */
  const petLabel =
    pets.length > 1 && activePet?.patientName ? ` — ${activePet.patientName}` : '';

  const updatePet = useCallback((id: number, patch: Partial<PetDraft>) => {
    setPets((prev) => prev.map((p) => (p.patientId === id ? { ...p, ...patch } : p)));
  }, []);

  const setHistory = useCallback(
    (text: string) => {
      if (activePet) updatePet(activePet.patientId, { history: text });
    },
    [activePet, updatePet]
  );
  const setPlan = useCallback(
    (text: string) => {
      if (activePet) updatePet(activePet.patientId, { plan: text });
    },
    [activePet, updatePet]
  );

  const recorder = useBriefRecorder(encounter?.id ?? null);
  const recording = recorder.recording;
  const transcriptValue = recording
    ? `${recorder.transcript}${recorder.interim ? ` ${recorder.interim}` : ''}`
    : recorder.transcript;

  const refreshInvoice = useCallback(async () => {
    try {
      const inv = await getInvoiceByAppointment(appointmentId);
      setInvoice(inv);
    } catch {
      /* invoice may not exist yet */
    }
  }, [appointmentId]);

  useEffect(() => {
    if (!Number.isFinite(appointmentId) || !Number.isFinite(patientId)) {
      setError('This medical note is missing a visit or patient.');
      setLoading(false);
      return;
    }

    let canceled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const enc = await createEncounter({
          appointmentId,
          patientId,
          clientId: clientIdParam ? Number(clientIdParam) : undefined,
        });
        if (canceled) return;
        setEncounter(enc);
        if (enc.clientId != null) setClientId(enc.clientId);

        void Promise.all([
          listOrders(enc.id).catch(() => [] as EncounterOrder[]),
          refreshInvoice(),
        ]).then(([ords]) => {
          if (canceled) return;
          setOrders(ords);
        });

        const household = await getHouseholdRoster(enc.id).catch(
          () => [] as HouseholdRosterEntry[]
        );
        if (canceled) return;
        setRoster(household);

        // Everyone seen on this visit gets their own chart note. The roster already includes
        // the current patient; fall back to them alone when it comes back empty.
        const onVisit = household.length
          ? household.map((r) => ({ patientId: r.patientId, patientName: r.patientName }))
          : [{ patientId, patientName: '' }];
        const noteClientId = enc.clientId ?? (clientIdParam ? Number(clientIdParam) : null);

        const drafted = await Promise.all(
          onVisit.map(async (pet): Promise<PetDraft> => {
            const drafts = await listScoutChartNotes(pet.patientId, 'draft').catch(() => []);
            const existing = drafts[0] ?? null;
            if (existing) {
              const parsed = parseChartBody(existing.body);
              return {
                ...pet,
                history: parsed.history,
                plan: parsed.plan,
                noteId: existing.id,
                savedBody: existing.body,
              };
            }
            // Only the pet whose chart we opened gets an empty note up front. Housemates get
            // one the moment the write-up actually says something about them.
            if (pet.patientId !== patientId) {
              return { ...pet, history: '', plan: '', noteId: null, savedBody: '' };
            }
            const created = await createScoutChartNote({
              patientId,
              clientId: noteClientId,
              body: '',
              noteDate: enc.created ?? undefined,
            });
            return {
              ...pet,
              history: '',
              plan: '',
              noteId: created.id,
              savedBody: created.body,
            };
          })
        );
        if (canceled) return;
        setPets(drafted);
        setStarted(true);

        const [profileResult, appt, roomLoader] = await Promise.all([
          fetchPatientProfileForRow({ id: String(patientId) }).catch(() => null),
          fetchAppointmentById(appointmentId, { practiceId: VISIT_WORKFLOW_PRACTICE_ID }),
          findSubmittedRoomLoaderForAppointment(appointmentId).catch(() => null),
        ]);
        if (canceled) return;

        const patient =
          profileResult && typeof profileResult === 'object'
            ? (profileResult as Record<string, unknown>)
            : null;
        setPatientName(patientField(patient, 'name') ?? `Patient #${patientId}`);

        if (appt) {
          setAppointmentStart(
            typeof appt.appointmentStart === 'string' ? appt.appointmentStart : null
          );
          const client = appt.client;
          if (client) {
            setClientName(personName(client.firstName, client.lastName));
            if (client.id != null && Number.isFinite(Number(client.id))) {
              setClientId(Number(client.id));
            }
          }
          setVisitType(appointmentTypeName(appt));
        }

        if (roomLoader?.responseFromClient) {
          const intake = buildSubjectiveTextFromRoomLoaderResponse(
            roomLoader.responseFromClient,
            patientId,
            {
              appointmentReason: appointmentReasonFromSentToClient(
                roomLoader.sentToClient,
                patientId
              ),
            }
          );
          setRoomLoaderHistory(intake.trim());
        }
      } catch (err) {
        if (!canceled) {
          setError(err instanceof Error ? err.message : 'Could not open this medical note.');
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [appointmentId, patientId, clientIdParam, refreshInvoice]);

  useEffect(() => {
    if (employeeId == null || !Number.isFinite(Number(employeeId))) return;
    let canceled = false;
    void fetchEmployee(Number(employeeId))
      .then((emp) => {
        if (canceled) return;
        const name = personName(emp.firstName, emp.lastName);
        if (name) setStaffName(name);
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [employeeId]);

  useEffect(() => {
    if (!started) return;
    const dirty = pets.filter(
      (pet) => composeChartBody(pet.history, pet.plan) !== pet.savedBody
    );
    if (!dirty.length) return;
    const handle = window.setTimeout(() => {
      setSaving(true);
      void Promise.all(
        dirty.map(async (pet) => {
          const body = composeChartBody(pet.history, pet.plan);
          if (pet.noteId) {
            await updateScoutChartNote(pet.noteId, body);
            updatePet(pet.patientId, { savedBody: body });
            return;
          }
          if (!body.trim()) return;
          const created = await createScoutChartNote({
            patientId: pet.patientId,
            clientId,
            body,
          });
          updatePet(pet.patientId, { noteId: created.id, savedBody: body });
        })
      )
        .catch(() => undefined)
        .finally(() => setSaving(false));
    }, 800);
    return () => window.clearTimeout(handle);
  }, [pets, started, clientId, updatePet]);

  const stopRecording = async () => {
    const text = await recorder.stop();
    const next = text.trim() || recorder.transcript;
    recorder.setTranscript(next);
    if (next.trim()) setPasteOpen(true);
  };

  const runWriteUp = async () => {
    const transcript = recorder.transcript.trim();
    if (!transcript || writingUp) return;
    setWritingUp(true);
    setError(null);
    setHint('Writing up the visit…');
    try {
      const result = await writeVisitWriteup({
        transcript,
        patients: pets.map((p) => ({
          patientId: p.patientId,
          name: p.patientName || patientName,
          species: roster.find((r) => r.patientId === p.patientId)?.species ?? null,
        })),
        patientId,
        clientId,
        appointmentId,
        soapEncounterId: encounter?.id ?? null,
        patientName,
        clientName,
        staffName,
        // Visit type is intentionally omitted — it renamed the visit when the room talked
        // about something other than what was booked.
        asOfDate: asOfDateFromIso(appointmentStart),
        roomLoaderHistory,
      });
      const written = new Map(result.patients.map((p) => [p.patientId, p]));
      setPets((prev) =>
        prev.map((pet) => {
          const next = written.get(pet.patientId);
          // Fall back to the flat fields for the pet whose chart is open, so a single-pet
          // visit still fills in when the roster never loaded.
          const fallback =
            pet.patientId === patientId && !next
              ? { history: result.history, plan: result.plan }
              : null;
          const source = next ?? fallback;
          if (!source) return pet;
          return {
            ...pet,
            history: source.history || pet.history,
            plan: source.plan || pet.plan,
          };
        })
      );
      if (result.clientEmailSubject) setRecapSubject(result.clientEmailSubject);
      if (result.clientEmailBody) setRecapBody(result.clientEmailBody);
      setActiveTab('history');
      setHint(
        pets.length > 1
          ? `Visit write-up is ready for all ${pets.length} pets — check each one before you wrap up.`
          : 'Visit write-up is ready — edit anything before you wrap up.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write up this visit.');
      setHint(null);
    } finally {
      setWritingUp(false);
    }
  };

  const copyText = async (text: string, which: 'all' | 'recap') => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setHint('Could not copy. Select the text instead.');
    }
  };

  const copyRecap = () => {
    void copyText([recapSubject.trim(), recapBody.trim()].filter(Boolean).join('\n\n'), 'recap');
  };

  const copyAll = () => {
    const recap = [recapSubject.trim(), recapBody.trim()].filter(Boolean).join('\n\n');
    const charts = pets
      .map((pet) => {
        const body = composeChartBody(pet.history, pet.plan);
        if (!body.trim()) return '';
        return pets.length > 1 ? `${pet.patientName}\n${body}` : body;
      })
      .filter(Boolean);
    void copyText([...charts, recap].filter(Boolean).join('\n\n'), 'all');
  };

  const wrapUp = async () => {
    if (wrapping) return;
    // Sign off every pet who got a note today; a housemate left blank is simply not signed.
    const written = petsRef.current
      .map((pet) => ({ pet, body: composeChartBody(pet.history, pet.plan) }))
      .filter((row) => row.body.trim());
    if (!written.length) {
      setError('Write History or Plan before wrapping up.');
      return;
    }
    setWrapping(true);
    setError(null);
    try {
      for (const { pet, body } of written) {
        let id = pet.noteId;
        if (!id) {
          const created = await createScoutChartNote({
            patientId: pet.patientId,
            clientId,
            body,
          });
          id = created.id;
        } else if (body !== pet.savedBody) {
          await updateScoutChartNote(id, body);
        }
        await finalizeScoutChartNote(id);
      }
      navigate('/schedule/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not wrap up this note.');
    } finally {
      setWrapping(false);
    }
  };

  if (!Number.isFinite(appointmentId) || !Number.isFinite(patientId)) {
    return (
      <div className="soap-page">
        <p className="soap-error-page">This medical note is missing a visit or patient.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="soap-page">
        <p className="soap-loading">Opening medical note…</p>
      </div>
    );
  }

  return (
    <div className="soap-page soap-page--workspace med-note-page">
      <header className="soap-header">
        <div className="soap-header-main">
          <ClipboardList size={20} />
          <div className="soap-header-patient">
            <h1>
              <Link
                className="soap-header-patient-link"
                to={`/schedule/patients?patientId=${encodeURIComponent(String(patientId))}`}
                title="Open patient medical record"
              >
                {patientName || `Patient #${patientId}`}
              </Link>
              {clientName.trim() ? (
                <>
                  <span className="soap-header-client-sep" aria-hidden>
                    ·
                  </span>
                  {clientId != null ? (
                    <Link
                      className="soap-header-client"
                      to={`/schedule/clients?clientId=${encodeURIComponent(String(clientId))}`}
                      title="Open client record"
                    >
                      <User size={14} aria-hidden />
                      {clientName.trim()}
                    </Link>
                  ) : (
                    <span className="soap-header-client">
                      <User size={14} aria-hidden />
                      {clientName.trim()}
                    </span>
                  )}
                </>
              ) : null}
            </h1>
            <span className="soap-header-sub">
              {examDayLabel(appointmentStart)}
              {visitType ? ` · ${visitType}` : ''} · Medical note · Visit #{appointmentId}
              {pets.length > 1 ? ` · ${pets.length} pets` : ''}
            </span>
          </div>
        </div>
        <div className="soap-header-actions">
          <Link className="soap-btn" to="/schedule/home">
            <ArrowLeft size={15} /> Schedule
          </Link>
          <button
            type="button"
            className="soap-btn primary"
            disabled={wrapping || !anyWritten}
            onClick={() => void wrapUp()}
          >
            <Lock size={15} />
            {wrapping ? 'Wrapping up…' : 'Wrap up'}
          </button>
        </div>
      </header>

      {error ? <div className="soap-error soap-error-banner">{error}</div> : null}

      <div className="soap-body soap-workspace med-note-workspace">
        <main className="soap-main">
          <section className="soap-section med-note-scribe">
            <h2>Visit write-up</h2>
            <p className="soap-section-hint">
              Record or paste the room conversation. Write-up turns it into History, Plan, checkout
              prep, and a client email — not a SOAP.
            </p>
            <div className="soap-scribe-bar">
              <button
                type="button"
                className={`soap-scribe-record-btn${recording ? ' recording' : ''}`}
                disabled={writingUp || !encounter}
                onClick={() => {
                  if (recording) void stopRecording();
                  else void recorder.start();
                }}
              >
                {recording ? <Square size={14} /> : <Mic size={14} />}
                {recording
                  ? `Stop · ${formatElapsed(recorder.elapsed)}`
                  : encounter
                    ? 'Start AI scribe'
                    : 'Starting scribe…'}
              </button>
              {!recording ? (
                <button
                  type="button"
                  className={`soap-scribe-paste-toggle${pasteOpen ? ' active' : ''}`}
                  disabled={writingUp}
                  onClick={() => setPasteOpen((open) => !open)}
                >
                  <ClipboardPaste size={13} /> Paste transcript
                </button>
              ) : null}
              <button
                type="button"
                className="soap-btn primary small"
                disabled={writingUp || recording || !recorder.transcript.trim()}
                onClick={() => void runWriteUp()}
              >
                <Sparkles size={14} />
                {writingUp ? 'Writing up…' : 'Write up visit'}
              </button>
            </div>
            {recorder.error ? <p className="med-note-error">{recorder.error}</p> : null}
            {hint ? <p className="soap-section-hint">{hint}</p> : null}
            {(pasteOpen || recording || recorder.transcript.trim()) && (
              <textarea
                className="soap-textarea med-note-transcript"
                value={transcriptValue}
                onChange={(e) => {
                  if (recording) return;
                  recorder.setTranscript(e.target.value);
                }}
                readOnly={recording || writingUp}
                placeholder="Paste a visit transcript here, or use Start AI scribe to record…"
                rows={8}
              />
            )}
          </section>

          {pets.length > 1 ? (
            <div className="med-note-pets" role="tablist" aria-label="Pets on this visit">
              {pets.map((pet) => {
                const written = Boolean(composeChartBody(pet.history, pet.plan).trim());
                return (
                  <button
                    key={pet.patientId}
                    type="button"
                    role="tab"
                    aria-selected={pet.patientId === activePet?.patientId}
                    className={`med-note-pet${
                      pet.patientId === activePet?.patientId ? ' active' : ''
                    }${written ? ' written' : ''}`}
                    title={written ? `${pet.patientName} — note written` : pet.patientName}
                    onClick={() => setActivePetId(pet.patientId)}
                  >
                    {pet.patientName || `Patient #${pet.patientId}`}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="soap-doc-tabbar med-note-tabbar">
            <div className="soap-tabs" role="tablist" aria-label="Medical note sections">
              {MED_NOTE_TABS.map(({ id, label, short, icon: Icon }) => {
                const filled =
                  id === 'history'
                    ? Boolean(history.trim())
                    : id === 'plan'
                      ? Boolean(plan.trim())
                      : id === 'email'
                        ? Boolean(recapSubject.trim() || recapBody.trim())
                        : orders.length > 0 || checkoutPrepPendingCount > 0;
                const flagged = id === 'checkout-prep' && checkoutPrepPendingCount > 0;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === id}
                    className={[
                      'soap-tab',
                      activeTab === id ? 'active' : '',
                      filled ? 'is-filled' : '',
                      flagged ? 'needs-attention' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    title={
                      flagged
                        ? `${checkoutPrepPendingCount} item${
                            checkoutPrepPendingCount === 1 ? '' : 's'
                          } still to match`
                        : filled
                          ? `${label} — written`
                          : label
                    }
                    onClick={() => setActiveTab(id)}
                  >
                    <Icon size={15} aria-hidden />
                    <span className="soap-tab-label">{label}</span>
                    <span className="soap-tab-short">{short}</span>
                    {flagged ? <span className="soap-tab-badge">{checkoutPrepPendingCount}</span> : null}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={`soap-btn ghost small soap-doc-copy-all${copied === 'all' ? ' ok' : ''}`}
              disabled={!anyWritten && !recapSubject.trim() && !recapBody.trim()}
              onClick={() => void copyAll()}
            >
              {copied === 'all' ? 'Copied' : 'Copy all'}
            </button>
          </div>

          <div className="soap-tab-panel">
            <section
              className="soap-section"
              role="tabpanel"
              aria-label="History"
              hidden={activeTab !== 'history'}
            >
              <h2>History{petLabel}</h2>
              <textarea
                className="soap-textarea med-note-tab-textarea"
                value={history}
                onChange={(e) => setHistory(e.target.value)}
                placeholder="Why they are here, how the pet is doing, owner observations…"
                rows={14}
              />
              {roomLoaderHistory ? (
                <div className="med-note-checkin-block">
                  <button
                    type="button"
                    className="med-note-checkin-toggle"
                    onClick={() => setShowCheckIn((open) => !open)}
                  >
                    Room Loader check-in {showCheckIn ? '▾' : '▸'}
                  </button>
                  {showCheckIn ? (
                    <pre className="med-note-checkin">{roomLoaderHistory}</pre>
                  ) : (
                    <p className="soap-section-hint">
                      Included as background when you write up the visit.
                    </p>
                  )}
                </div>
              ) : null}
            </section>

            <section
              className="soap-section"
              role="tabpanel"
              aria-label="Plan"
              hidden={activeTab !== 'plan'}
            >
              <h2>Plan{petLabel}</h2>
              <p className="soap-section-hint">
                What was given today and what happens next. Match bullets to charges on Checkout
                prep — that step is not part of the signed record.
              </p>
              <textarea
                className="soap-textarea med-note-tab-textarea"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                placeholder="What was given today and what happens next…"
                rows={14}
              />
            </section>

            <section
              className="soap-section"
              role="tabpanel"
              aria-label="Checkout prep"
              hidden={activeTab !== 'checkout-prep'}
            >
              <h2>
                <Receipt size={16} /> Checkout prep
              </h2>
              <p className="soap-section-hint">
                Optional — match today&apos;s plan to catalog charges. This step is not saved as
                part of the medical record when you wrap up.
              </p>
              {encounter ? (
                <>
                  <ScribeSuggestedPlanItems
                    key={`med-note-plan-items-${encounter.id}`}
                    encounterId={encounter.id}
                    suggestions={[]}
                    planNotes={plan}
                    orders={orders}
                    patientId={patientId}
                    clientId={clientId ?? undefined}
                    practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                    onPendingCountChange={setCheckoutPrepPendingCount}
                    onOrderAdded={(order) => {
                      setOrders((prev) =>
                        prev.some((row) => row.id === order.id) ? prev : [...prev, order]
                      );
                      void refreshInvoice();
                    }}
                    onInvoiceShouldRefresh={() => void refreshInvoice()}
                  />
                  <PlanOrdersSection
                    key={`med-note-plan-orders-${encounter.id}`}
                    encounterId={encounter.id}
                    orders={orders}
                    patientId={patientId}
                    clientId={clientId ?? undefined}
                    practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                    showSearch={false}
                    onChange={(next) => {
                      setOrders(next);
                      void refreshInvoice();
                    }}
                    onInvoiceShouldRefresh={() => void refreshInvoice()}
                  />
                </>
              ) : (
                <p className="soap-section-hint">Opening the visit so charges can be matched…</p>
              )}
            </section>

            <section
              className="soap-section"
              role="tabpanel"
              aria-label="Client email"
              hidden={activeTab !== 'email'}
            >
              <div className="med-note-recap-head">
                <h2>Client email</h2>
                <button
                  type="button"
                  className="soap-btn small"
                  disabled={!recapSubject.trim() && !recapBody.trim()}
                  onClick={() => void copyRecap()}
                >
                  {copied === 'recap' ? 'Copied' : 'Copy email'}
                </button>
              </div>
              <p className="soap-section-hint">
                A warm note the owner can keep. Edit freely — it is not locked on wrap-up.
              </p>
              <input
                className="med-note-subject"
                value={recapSubject}
                onChange={(e) => setRecapSubject(e.target.value)}
                placeholder="Subject — e.g. Harley’s Adequan injection"
              />
              <textarea
                className="soap-textarea soap-textarea--email med-note-tab-textarea"
                value={recapBody}
                onChange={(e) => setRecapBody(e.target.value)}
                placeholder="Hi — how the pet is doing, the plan going forward…"
                rows={12}
              />
            </section>
          </div>

          <p className="med-note-meta">
            {saving ? 'Saving draft…' : started ? 'Draft saved' : ''}
          </p>
        </main>

        <aside className="soap-aside">
          <VisitCheckoutPanel
            encounterId={encounter?.id}
            invoice={invoice}
            orders={orders}
            clientId={clientId}
            patientId={patientId}
            roster={roster}
            practiceId={VISIT_WORKFLOW_PRACTICE_ID}
            onInvoiceChange={setInvoice}
            onOrdersChange={(next) => {
              setOrders(next);
              void refreshInvoice();
            }}
            onInvoiceShouldRefresh={() => void refreshInvoice()}
            onOpenEuthanasiaPrepay={() => undefined}
          />
        </aside>
      </div>
    </div>
  );
}
